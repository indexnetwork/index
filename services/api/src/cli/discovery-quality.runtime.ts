import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { classifyAbParentFailure, type AbRunStage } from './discovery.contract';
import { assertAbConfirmation } from './discovery.gate';
import { createNeonControlPlane } from './discovery-env-matrix.neon';
import { attestWritableQualityBaseTarget, parseQualityBaseRefreshTarget } from './discovery-quality-refresh-target';
import { buildHistoricalQualityChildEnvironment, type HistoricalQualityChildEnvironment } from './discovery-quality.environment';
import { attestHistoricalQualityTargets, parseHistoricalQualityManifest, restoreHistoricalQualitySelectedChild, type AttestedHistoricalQualityManifest } from './discovery.neon';

import type { HistoricalQualityRequest } from './discovery-quality.contract';

export const HISTORICAL_QUALITY_SCORING_POLICY_VERSION = 'historical-quality-v1' as const;

export interface VerifiedHistoricalQualityBase {
  version: 1;
  embeddingModelId: string;
  corpusVersion: string;
}

export interface HistoricalResolvedConfiguration {
  models: Record<string, string>;
  env: Record<string, string>;
  fixed: {
    judgeModelId: string;
    embeddingModelId: string;
    providerAccountFingerprint: string;
    corpusVersion: string;
    scoringPolicyFingerprint: string;
  };
}

export interface HistoricalQualityPilotSlot {
  slotId: string;
  caseId: string;
  trigger: 'intent' | 'enrichment';
  repetition: number;
  selectedSide: 'a';
  configurationFingerprint: string;
  maxAttempts: 1;
}

export interface HistoricalQualitySlotDispatch {
  runId: string;
  slotId: string;
  configurationId: 'a';
  configurationFingerprint: string;
  outputPath: string;
}

export type HistoricalQualityChildOutput = Readonly<Record<string, unknown>>;

export interface HistoricalQualityRuntimeDeps {
  attest(): Promise<AttestedHistoricalQualityManifest>;
  verifyBase(manifest: AttestedHistoricalQualityManifest): Promise<VerifiedHistoricalQualityBase>;
  restoreSelectedChild(manifest: AttestedHistoricalQualityManifest): Promise<void>;
  spawnSlot(input: {
    dispatch: HistoricalQualitySlotDispatch;
    environment: HistoricalQualityChildEnvironment;
  }): Promise<unknown>;
  validateSlotOutput(slot: HistoricalQualityPilotSlot, output: unknown): HistoricalQualityChildOutput;
}

export interface HistoricalQualityParentResult {
  runId: string;
  configurationFingerprint: string;
  outputs: HistoricalQualityChildOutput[];
}

type HistoricalAuthorities = {
  buildHistoricalQualityPilotPlan(input: {
    caseIds: string[];
    triggers: Array<'intent' | 'enrichment'>;
    repetitions: number;
    configuration: { id: 'a'; config: HistoricalResolvedConfiguration };
  }): { slots: HistoricalQualityPilotSlot[]; configurationFingerprint: string };
  fingerprintCanonicalJson(value: unknown): string;
  resolveEvalJudgeModelId(environment: Record<string, string | undefined>): string;
  resolveCanonicalAllAgentModels(environment: Readonly<Record<string, string | undefined>>): Readonly<Record<string, string>>;
};

async function loadHistoricalAuthorities(): Promise<HistoricalAuthorities> {
  // Variables keep the API build from pulling protocol eval source into its
  // rootDir; Bun resolves these source modules only when the eval runtime runs.
  const pilotSpecifier = '../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.pilot.js';
  const sharedSpecifier = '../../../../packages/protocol/eval/shared/index.js';
  const modelsSpecifier = '../../../../packages/protocol/src/shared/agent/model.resolver.js';
  const [pilot, shared, models] = await Promise.all([
    import(pilotSpecifier),
    import(sharedSpecifier),
    import(modelsSpecifier),
  ]);
  return {
    buildHistoricalQualityPilotPlan: pilot.buildHistoricalQualityPilotPlan as HistoricalAuthorities['buildHistoricalQualityPilotPlan'],
    fingerprintCanonicalJson: shared.fingerprintCanonicalJson as HistoricalAuthorities['fingerprintCanonicalJson'],
    resolveEvalJudgeModelId: shared.resolveEvalJudgeModelId as HistoricalAuthorities['resolveEvalJudgeModelId'],
    resolveCanonicalAllAgentModels: models.resolveCanonicalAllAgentModels as HistoricalAuthorities['resolveCanonicalAllAgentModels'],
  };
}

export function historicalQualityScoringPolicy(judgeModelId: string): Readonly<Record<string, unknown>> {
  return Object.freeze({
    version: HISTORICAL_QUALITY_SCORING_POLICY_VERSION,
    judgeModelId,
    funnel: {
      admission: 'eligible participant admitted to shared-pool retrieval',
      submission: 'candidate submitted to opportunity evaluator',
      return: 'candidate returned by evaluator before final thresholding',
      rank: 'one-based rank in final thresholded evaluator order',
    },
    stages: ['eligible', 'submitted', 'returned', 'final-inclusion'],
    attempts: { perSlot: 1, retry: false, recovery: false, backoffMs: 0 },
    poolPartition: 'each participant is scored within the approved shared historical pool and selected case',
    completeness: 'every planned slot must produce exactly one terminal execution row; subsets are evidence-only and have no verdict',
  });
}

function exactProviderFingerprint(environment: Readonly<Record<string, string | undefined>>): string {
  const value = environment.HISTORICAL_QUALITY_PROVIDER_ACCOUNT_FINGERPRINT ?? '';
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error('HISTORICAL_QUALITY_PROVIDER_ACCOUNT_FINGERPRINT must be a lowercase 64-hex account digest');
  }
  return value;
}

export async function resolveHistoricalQualityConfiguration(input: {
  request: HistoricalQualityRequest;
  verifiedBase: VerifiedHistoricalQualityBase;
  environment: Readonly<Record<string, string | undefined>>;
}): Promise<HistoricalResolvedConfiguration> {
  const authorities = await loadHistoricalAuthorities();
  const modelEnvironment = {
    CHAT_MODEL: input.request.configuration.config.CHAT_MODEL ?? input.environment.CHAT_MODEL,
    EVAL_MODEL_OVERRIDES: input.request.configuration.config.EVAL_MODEL_OVERRIDES ?? input.environment.EVAL_MODEL_OVERRIDES,
  };
  const models = { ...authorities.resolveCanonicalAllAgentModels(modelEnvironment) };
  const env = Object.fromEntries(
    Object.entries(input.request.configuration.config)
      .filter(([key]) => key !== 'CHAT_MODEL' && key !== 'EVAL_MODEL_OVERRIDES')
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const judgeModelId = authorities.resolveEvalJudgeModelId({
    SMARTEST_VERIFIER_MODEL: input.environment.SMARTEST_VERIFIER_MODEL,
  });
  return {
    models,
    env,
    fixed: {
      judgeModelId,
      embeddingModelId: input.verifiedBase.embeddingModelId,
      providerAccountFingerprint: exactProviderFingerprint(input.environment),
      corpusVersion: input.verifiedBase.corpusVersion,
      scoringPolicyFingerprint: authorities.fingerprintCanonicalJson(historicalQualityScoringPolicy(judgeModelId)),
    },
  };
}

function parseVerifiedBase(value: unknown): VerifiedHistoricalQualityBase {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Historical quality base verifier returned invalid metadata');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'corpusVersion,embeddingModelId,version'
    || record.version !== 1
    || typeof record.embeddingModelId !== 'string' || record.embeddingModelId.trim() === ''
    || typeof record.corpusVersion !== 'string' || record.corpusVersion.trim() === '') {
    throw new Error('Historical quality base verifier returned invalid metadata');
  }
  return Object.freeze({
    version: 1,
    embeddingModelId: record.embeddingModelId,
    corpusVersion: record.corpusVersion,
  });
}

async function verifyBaseInFreshProcess(manifest: AttestedHistoricalQualityManifest): Promise<VerifiedHistoricalQualityBase> {
  const child = Bun.spawn({
    cmd: [process.execPath, new URL('./discovery-quality-base.runtime.ts', import.meta.url).pathname, '--verify'],
    env: {
      DATABASE_URL: manifest.baseReadReplica.databaseUrl,
      ...(process.env.NODE_ENV ? { NODE_ENV: process.env.NODE_ENV } : {}),
    },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, _stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error('Historical quality base verification failed');
  const jsonLine = stdout.trim().split('\n').reverse().find((line) => line.trim().startsWith('{'));
  if (!jsonLine) throw new Error('Historical quality base verifier returned invalid metadata');
  try {
    return parseVerifiedBase(JSON.parse(jsonLine));
  } catch {
    throw new Error('Historical quality base verifier returned invalid metadata');
  }
}

async function productionAttest(): Promise<AttestedHistoricalQualityManifest> {
  assertAbConfirmation(process.env);
  const apiKey = process.env.NEON_API_KEY ?? '';
  const controlPlane = createNeonControlPlane(apiKey);
  const manifest = parseHistoricalQualityManifest(process.env.DISCOVERY_TARGETS);
  const refresh = await attestWritableQualityBaseTarget({
    target: parseQualityBaseRefreshTarget(process.env.DISCOVERY_QUALITY_BASE_REFRESH_TARGET),
    controlPlane,
  });
  return attestHistoricalQualityTargets({ manifest, writableRefreshTarget: refresh, controlPlane });
}

async function productionSpawnSlot(input: {
  dispatch: HistoricalQualitySlotDispatch;
  environment: HistoricalQualityChildEnvironment;
}): Promise<unknown> {
  const { dispatch } = input;
  const child = Bun.spawn({
    cmd: [
      process.execPath, new URL('./discovery.ts', import.meta.url).pathname,
      '--historical-quality-child',
      '--run-id', dispatch.runId,
      '--slot-id', dispatch.slotId,
      '--configuration-id', dispatch.configurationId,
      '--configuration-fingerprint', dispatch.configurationFingerprint,
      '--child-output', dispatch.outputPath,
    ],
    env: input.environment,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [_stdout, _stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) throw new Error('Historical quality slot child failed');
  try {
    return await Bun.file(dispatch.outputPath).json();
  } catch {
    throw new Error('Historical quality slot child output was unavailable');
  }
}

function productionValidateSlotOutput(slot: HistoricalQualityPilotSlot, output: unknown): HistoricalQualityChildOutput {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('Historical quality slot child output was invalid');
  }
  const record = output as Record<string, unknown>;
  if (record.slotId !== slot.slotId || record.configurationId !== 'a') {
    throw new Error('Historical quality slot child output did not match its dispatch');
  }
  return Object.freeze({ ...record });
}

const productionDependencies: HistoricalQualityRuntimeDeps = {
  attest: productionAttest,
  verifyBase: verifyBaseInFreshProcess,
  restoreSelectedChild: async (manifest) => restoreHistoricalQualitySelectedChild({
    manifest,
    apiKey: process.env.NEON_API_KEY ?? '',
  }),
  spawnSlot: productionSpawnSlot,
  validateSlotOutput: productionValidateSlotOutput,
};

export async function runHistoricalQualityRuntime(
  request: HistoricalQualityRequest,
  deps: HistoricalQualityRuntimeDeps = productionDependencies,
): Promise<HistoricalQualityParentResult> {
  let stage: AbRunStage | null = null;
  let temporaryDirectory: string | undefined;
  try {
    const manifest = await deps.attest();
    const verifiedBase = parseVerifiedBase(await deps.verifyBase(manifest));
    const resolved = await resolveHistoricalQualityConfiguration({ request, verifiedBase, environment: process.env });
    const { buildHistoricalQualityPilotPlan } = await loadHistoricalAuthorities();
    const plan = buildHistoricalQualityPilotPlan({
      caseIds: request.caseIds,
      triggers: request.triggers,
      repetitions: request.repetitions,
      configuration: { id: 'a', config: resolved },
    });
    const childEnvironment = buildHistoricalQualityChildEnvironment({
      parentEnvironment: process.env,
      sanitizedConfiguration: request.configuration.config,
      configurationFingerprint: plan.configurationFingerprint,
    });
    const runId = `hq-run-${randomBytes(16).toString('hex')}`;
    const outputs: HistoricalQualityChildOutput[] = [];
    temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'historical-quality-'));

    for (const slot of plan.slots) {
      stage = 'resetting';
      await deps.restoreSelectedChild(manifest);
      stage = 'reset';
      const dispatch: HistoricalQualitySlotDispatch = {
        runId,
        slotId: slot.slotId,
        configurationId: 'a',
        configurationFingerprint: slot.configurationFingerprint,
        outputPath: path.join(temporaryDirectory, `${slot.slotId}.json`),
      };
      stage = 'spawned';
      const output = await deps.spawnSlot({ dispatch, environment: childEnvironment });
      outputs.push(deps.validateSlotOutput(slot, output));
    }
    return { runId, configurationFingerprint: plan.configurationFingerprint, outputs };
  } catch (error) {
    throw classifyAbParentFailure(stage, error, { shape: 'single' });
  } finally {
    if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Name retained for the approved Task 5 interface and bootstrap. */
export const runHistoricalQualityParent = runHistoricalQualityRuntime;
