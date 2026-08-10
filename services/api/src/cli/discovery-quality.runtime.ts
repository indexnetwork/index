import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { classifyAbParentFailure, type AbRunStage } from './discovery.contract';
import { assertAbConfirmation } from './discovery.gate';
import { assertHistoricalQualitySerialEvaluation } from './discovery.flags';
import { createNeonControlPlane } from './discovery-env-matrix.neon';
import { attestWritableQualityBaseTarget, parseQualityBaseRefreshTarget } from './discovery-quality-refresh-target';
import { buildHistoricalQualityChildEnvironment, type HistoricalQualityChildEnvironment } from './discovery-quality.environment';
import { preflightHistoricalQualityChildRuntime } from './discovery-quality.child-loader';
import { embeddingConfigurationFingerprint, HISTORICAL_QUALITY_APPROVED_EMBEDDING_IDENTITY } from '../lib/embedding/embedding.identity';
import { attestHistoricalQualityTargets, parseHistoricalQualityManifest, restoreHistoricalQualitySelectedChild, type AttestedHistoricalQualityManifest } from './discovery.neon';

import type { HistoricalQualityRequest } from './discovery-quality.contract';

export const HISTORICAL_QUALITY_SCORING_POLICY_VERSION = 'historical-quality-v1' as const;

export interface VerifiedHistoricalQualityBase {
  version: 1;
  embedding: {
    provider: string;
    model: string;
    dimensions: number;
    configurationFingerprint: string;
  };
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

export interface HistoricalQualityChildResolvedConfiguration {
  models: Record<string, string>;
  env: Record<string, string>;
  fixed: {
    judgeModelId: string;
    embeddingModelId: string;
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
  /** Canonical fingerprint of the complete HistoricalResolvedConfig. */
  configurationFingerprint: string;
  /** Canonical fingerprint of the strict sanitized child config JSON. */
  childEnvironmentFingerprint: string;
  /**
   * Child-verifiable resolved projection. This excludes only the parent-owned
   * providerAccountFingerprint; the full planner fingerprint above still binds it.
   */
  childResolvedConfigurationFingerprint: string;
  outputPath: string;
}

export interface HistoricalQualityChildOutput {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly slotId: string;
  readonly configurationId: 'a';
  readonly transportRow: Readonly<Record<string, unknown>>;
  readonly executionRun: Readonly<Record<string, unknown>>;
}

export interface HistoricalQualityRuntimeDeps {
  preflightChildRuntime(): Promise<void>;
  attest(): Promise<AttestedHistoricalQualityManifest>;
  verifyBase(manifest: AttestedHistoricalQualityManifest): Promise<VerifiedHistoricalQualityBase>;
  restoreSelectedChild(manifest: AttestedHistoricalQualityManifest): Promise<void>;
  spawnSlot(input: {
    dispatch: HistoricalQualitySlotDispatch;
    environment: HistoricalQualityChildEnvironment;
  }): Promise<unknown>;
  validateSlotOutput(
    slot: HistoricalQualityPilotSlot,
    dispatch: HistoricalQualitySlotDispatch,
    output: unknown,
    forbiddenValues: string[],
  ): Promise<HistoricalQualityChildOutput>;
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
  parseHistoricalQualityChildOutput(value: unknown, expected: {
    runId: string;
    slotId: string;
    configurationId: 'a';
    configurationFingerprint: string;
    logicalCaseId: string;
    trigger: 'intent' | 'enrichment';
    repetition: number;
    forbiddenValues: string[];
  }): HistoricalQualityChildOutput;
};

async function loadHistoricalAuthorities(): Promise<HistoricalAuthorities> {
  // Variables keep the API build from pulling protocol eval source into its
  // rootDir; Bun resolves these source modules only when the eval runtime runs.
  const pilotSpecifier = '../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.pilot.js';
  const sharedSpecifier = '../../../../packages/protocol/eval/shared/index.js';
  const modelsSpecifier = '../../../../packages/protocol/src/shared/agent/model.resolver.js';
  const childOutputSpecifier = '../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.child-output.js';
  const [pilot, shared, models, childOutput] = await Promise.all([
    import(pilotSpecifier),
    import(sharedSpecifier),
    import(modelsSpecifier),
    import(childOutputSpecifier),
  ]);
  return {
    buildHistoricalQualityPilotPlan: pilot.buildHistoricalQualityPilotPlan as HistoricalAuthorities['buildHistoricalQualityPilotPlan'],
    fingerprintCanonicalJson: shared.fingerprintCanonicalJson as HistoricalAuthorities['fingerprintCanonicalJson'],
    resolveEvalJudgeModelId: shared.resolveEvalJudgeModelId as HistoricalAuthorities['resolveEvalJudgeModelId'],
    resolveCanonicalAllAgentModels: models.resolveCanonicalAllAgentModels as HistoricalAuthorities['resolveCanonicalAllAgentModels'],
    parseHistoricalQualityChildOutput: childOutput.parseHistoricalQualityChildOutput as HistoricalAuthorities['parseHistoricalQualityChildOutput'],
  };
}

export function historicalQualityChildResolvedProjection(
  configuration: HistoricalResolvedConfiguration,
): HistoricalQualityChildResolvedConfiguration {
  return Object.freeze({
    models: Object.freeze({ ...configuration.models }),
    env: Object.freeze({ ...configuration.env }),
    fixed: Object.freeze({
      judgeModelId: configuration.fixed.judgeModelId,
      embeddingModelId: configuration.fixed.embeddingModelId,
      corpusVersion: configuration.fixed.corpusVersion,
      scoringPolicyFingerprint: configuration.fixed.scoringPolicyFingerprint,
    }),
  }) as HistoricalQualityChildResolvedConfiguration;
}

export async function fingerprintHistoricalQualityChildResolvedConfiguration(
  configuration: HistoricalQualityChildResolvedConfiguration,
): Promise<string> {
  const { fingerprintCanonicalJson } = await loadHistoricalAuthorities();
  return fingerprintCanonicalJson(configuration);
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

export async function resolveHistoricalQualityChildConfiguration(input: {
  configuration: Readonly<Record<string, string>>;
  verifiedBase: VerifiedHistoricalQualityBase;
  environment: Readonly<Record<string, string | undefined>>;
}): Promise<HistoricalQualityChildResolvedConfiguration> {
  const authorities = await loadHistoricalAuthorities();
  const modelEnvironment = {
    CHAT_MODEL: input.configuration.CHAT_MODEL ?? input.environment.CHAT_MODEL,
    EVAL_MODEL_OVERRIDES: input.configuration.EVAL_MODEL_OVERRIDES ?? input.environment.EVAL_MODEL_OVERRIDES,
  };
  const models = { ...authorities.resolveCanonicalAllAgentModels(modelEnvironment) };
  const env = Object.fromEntries(
    Object.entries(input.configuration)
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
      embeddingModelId: input.verifiedBase.embedding.model,
      corpusVersion: input.verifiedBase.corpusVersion,
      scoringPolicyFingerprint: authorities.fingerprintCanonicalJson(historicalQualityScoringPolicy(judgeModelId)),
    },
  };
}

export async function resolveHistoricalQualityConfiguration(input: {
  request: HistoricalQualityRequest;
  verifiedBase: VerifiedHistoricalQualityBase;
  environment: Readonly<Record<string, string | undefined>>;
}): Promise<HistoricalResolvedConfiguration> {
  const childResolved = await resolveHistoricalQualityChildConfiguration({
    configuration: input.request.configuration.config,
    verifiedBase: input.verifiedBase,
    environment: input.environment,
  });
  return {
    models: childResolved.models,
    env: childResolved.env,
    fixed: {
      judgeModelId: childResolved.fixed.judgeModelId,
      embeddingModelId: childResolved.fixed.embeddingModelId,
      providerAccountFingerprint: exactProviderFingerprint(input.environment),
      corpusVersion: childResolved.fixed.corpusVersion,
      scoringPolicyFingerprint: childResolved.fixed.scoringPolicyFingerprint,
    },
  };
}

function parseVerifiedBase(value: unknown): VerifiedHistoricalQualityBase {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Historical quality base verifier returned invalid metadata');
  const record = value as Record<string, unknown>;
  const embedding = record.embedding;
  if (Object.keys(record).sort().join(',') !== 'corpusVersion,embedding,version'
    || record.version !== 1
    || typeof record.corpusVersion !== 'string' || record.corpusVersion.trim() === ''
    || !embedding || typeof embedding !== 'object' || Array.isArray(embedding)) {
    throw new Error('Historical quality base verifier returned invalid metadata');
  }
  const identity = embedding as Record<string, unknown>;
  if (Object.keys(identity).sort().join(',') !== 'configurationFingerprint,dimensions,model,provider'
    || typeof identity.provider !== 'string' || identity.provider.trim() === ''
    || typeof identity.model !== 'string' || identity.model.trim() === ''
    || !Number.isInteger(identity.dimensions) || (identity.dimensions as number) < 1
    || typeof identity.configurationFingerprint !== 'string'
    || !/^[a-f0-9]{64}$/.test(identity.configurationFingerprint)) {
    throw new Error('Historical quality base verifier returned invalid metadata');
  }
  const canonicalIdentity = {
    provider: identity.provider,
    model: identity.model,
    dimensions: identity.dimensions as number,
  };
  if (identity.configurationFingerprint !== embeddingConfigurationFingerprint(canonicalIdentity)) {
    throw new Error('Historical quality base verifier returned invalid metadata');
  }
  return Object.freeze({
    version: 1,
    embedding: Object.freeze({ ...canonicalIdentity, configurationFingerprint: identity.configurationFingerprint }),
    corpusVersion: record.corpusVersion,
  });
}

function reconcileHistoricalQualityEmbedding(
  verifiedBase: VerifiedHistoricalQualityBase,
  environment: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> {
  const runtimeIdentity = {
    provider: HISTORICAL_QUALITY_APPROVED_EMBEDDING_IDENTITY.provider,
    model: environment.EMBEDDING_MODEL ?? HISTORICAL_QUALITY_APPROVED_EMBEDDING_IDENTITY.model,
    dimensions: environment.EMBEDDING_DIMENSIONS === undefined
      ? HISTORICAL_QUALITY_APPROVED_EMBEDDING_IDENTITY.dimensions
      : Number(environment.EMBEDDING_DIMENSIONS),
  };
  const verified = verifiedBase.embedding;
  if (!Number.isInteger(runtimeIdentity.dimensions)
    || runtimeIdentity.provider !== verified.provider
    || runtimeIdentity.model !== verified.model
    || runtimeIdentity.dimensions !== verified.dimensions
    || embeddingConfigurationFingerprint(runtimeIdentity) !== verified.configurationFingerprint) {
    throw new Error('Historical quality runtime embedding identity does not match verified base metadata');
  }
  return {
    ...environment,
    EMBEDDING_MODEL: verified.model,
    EMBEDDING_DIMENSIONS: String(verified.dimensions),
  };
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
      '--child-environment-fingerprint', dispatch.childEnvironmentFingerprint,
      '--child-resolved-configuration-fingerprint', dispatch.childResolvedConfigurationFingerprint,
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

function urlPassword(url: string): string | undefined {
  try {
    return new URL(url).password;
  } catch {
    return undefined;
  }
}

function buildHistoricalQualityForbiddenValues(
  environment: Readonly<Record<string, string | undefined>>,
  manifest: AttestedHistoricalQualityManifest,
): string[] {
  const values: (string | undefined)[] = [
    environment.NEON_API_KEY,
    environment.OPENROUTER_API_KEY,
    environment.DISCOVERY_TARGETS,
    environment.HISTORICAL_QUALITY_PROVIDER_ACCOUNT_FINGERPRINT,
    environment.REDIS_URL,
    environment.REDIS_PASSWORD,
    manifest.baseReadReplica.databaseUrl,
    urlPassword(manifest.baseReadReplica.databaseUrl),
    ...manifest.targets.flatMap((target) => [target.databaseUrl, urlPassword(target.databaseUrl)]),
  ];
  return values.filter((value): value is string => value !== undefined && value.trim() !== '');
}

async function productionValidateSlotOutput(
  slot: HistoricalQualityPilotSlot,
  dispatch: HistoricalQualitySlotDispatch,
  output: unknown,
  forbiddenValues: string[],
): Promise<HistoricalQualityChildOutput> {
  try {
    const { parseHistoricalQualityChildOutput } = await loadHistoricalAuthorities();
    return parseHistoricalQualityChildOutput(output, {
      runId: dispatch.runId,
      slotId: slot.slotId,
      configurationId: dispatch.configurationId,
      configurationFingerprint: dispatch.configurationFingerprint,
      logicalCaseId: slot.caseId,
      trigger: slot.trigger,
      repetition: slot.repetition,
      forbiddenValues,
    });
  } catch {
    throw new Error('Historical quality slot child output was invalid');
  }
}

const productionDependencies: HistoricalQualityRuntimeDeps = {
  preflightChildRuntime: async () => {
    // Consent stays the first production gate, while child availability still
    // precedes topology attestation and every destructive operation.
    assertAbConfirmation(process.env);
    await preflightHistoricalQualityChildRuntime(process.env);
  },
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
    // Parallel mode spends once per candidate. Refuse it before even runtime
    // preflight so the quality cost remains exactly one evaluator call per slot.
    assertHistoricalQualitySerialEvaluation(request.configuration.config);
    // The real Task 6 module must prove its own availability before topology
    // attestation or any destructive/provider operation can be constructed.
    await deps.preflightChildRuntime();
    const manifest = await deps.attest();
    const forbiddenValues = buildHistoricalQualityForbiddenValues(process.env, manifest);
    const verifiedBase = parseVerifiedBase(await deps.verifyBase(manifest));
    const reconciledEnvironment = reconcileHistoricalQualityEmbedding(verifiedBase, process.env);
    const resolved = await resolveHistoricalQualityConfiguration({ request, verifiedBase, environment: reconciledEnvironment });
    const { buildHistoricalQualityPilotPlan, fingerprintCanonicalJson } = await loadHistoricalAuthorities();
    const plan = buildHistoricalQualityPilotPlan({
      caseIds: request.caseIds,
      triggers: request.triggers,
      repetitions: request.repetitions,
      configuration: { id: 'a', config: resolved },
    });
    const recomputedConfigurationFingerprint = fingerprintCanonicalJson(resolved);
    const childResolvedConfigurationFingerprint = await fingerprintHistoricalQualityChildResolvedConfiguration(
      historicalQualityChildResolvedProjection(resolved),
    );
    if (plan.configurationFingerprint !== recomputedConfigurationFingerprint
      || plan.slots.some((slot) => slot.configurationFingerprint !== recomputedConfigurationFingerprint)) {
      throw new Error('Historical quality planner configuration fingerprint mismatch');
    }
    const childEnvironment = buildHistoricalQualityChildEnvironment({
      parentEnvironment: reconciledEnvironment,
      sanitizedConfiguration: request.configuration.config,
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
        configurationFingerprint: recomputedConfigurationFingerprint,
        childEnvironmentFingerprint: childEnvironment.DISCOVERY_HISTORICAL_QUALITY_CONFIG_FINGERPRINT,
        childResolvedConfigurationFingerprint,
        outputPath: path.join(temporaryDirectory, `${slot.slotId}.json`),
      };
      stage = 'spawned';
      const output = await deps.spawnSlot({ dispatch, environment: childEnvironment });
      outputs.push(await deps.validateSlotOutput(slot, dispatch, output, forbiddenValues));
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
