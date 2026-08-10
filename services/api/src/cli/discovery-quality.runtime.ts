import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { HistoricalQualityLeaseReleaseError, HistoricalQualitySpentRunError, classifyAbParentFailure, type AbRunStage } from './discovery.contract';
import { assertAbConfirmation } from './discovery.gate';
import { createNeonControlPlane } from './discovery-env-matrix.neon';
import { attestWritableQualityBaseTarget, parseQualityBaseRefreshTarget } from './discovery-quality-refresh-target';
import { buildHistoricalQualityChildEnvironment, type HistoricalQualityChildEnvironment } from './discovery-quality.environment';
import { preflightHistoricalQualityChildRuntime } from './discovery-quality.child-loader';
import { acquireHistoricalQualityOperationLease, type HistoricalQualityOperationLease } from './discovery-quality-operation-lease';
import { buildHistoricalQualityBaseVerifierEnvironment } from './discovery-quality-verifier.environment';
import { embeddingConfigurationFingerprint, HISTORICAL_QUALITY_APPROVED_EMBEDDING_IDENTITY } from '../lib/embedding/embedding.identity';
import { attestHistoricalQualityTargets, parseHistoricalQualityManifest, restoreHistoricalQualitySelectedChild, type AttestedHistoricalQualityManifest } from './discovery.neon';

import { HISTORICAL_QUALITY_APPROVED_CASE_IDS, HISTORICAL_QUALITY_APPROVED_FINGERPRINTS, assertHistoricalQualitySerialEvaluation, type HistoricalQualityRequest } from './discovery-quality.contract';

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

/**
 * Build-only view of the dynamically imported canonical protocol type. Runtime
 * construction and parsing remain exclusively owned by
 * HistoricalQualityChildOutputSchema/parseHistoricalQualityChildOutput.
 */
export interface HistoricalQualityChildOutput {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly slotId: string;
  readonly configurationId: 'a';
  readonly transportRow: Readonly<Record<string, unknown>>;
  readonly executionRun: Readonly<Record<string, unknown>>;
}

export interface HistoricalQualityRuntimeDeps {
  /** Parent-only consent gate; optional to preserve isolated runtime seam tests. */
  assertHistoricalQualityAuthorization?(): void;
  acquireOperationLease(): Promise<Pick<HistoricalQualityOperationLease, 'identifier' | 'release'>>;
  preflightChildRuntime(): Promise<void>;
  attest(): Promise<AttestedHistoricalQualityManifest>;
  verifyBase(manifest: AttestedHistoricalQualityManifest): Promise<VerifiedHistoricalQualityBase>;
  restoreSelectedChild(manifest: AttestedHistoricalQualityManifest): Promise<void>;
  spawnSlot(input: {
    dispatch: HistoricalQualitySlotDispatch;
    environment: HistoricalQualityChildEnvironment;
    markSpawned(): void;
  }): Promise<unknown>;
  validateSlotOutput(
    slot: HistoricalQualityPilotSlot,
    dispatch: HistoricalQualitySlotDispatch,
    output: unknown,
    forbiddenValues: string[],
  ): Promise<HistoricalQualityChildOutput>;
  prepareArtifactWrite?(reportPath: string, force: boolean): Promise<void>;
  artifactWriter?: HistoricalQualityArtifactWriter;
  createTemporaryDirectory?(): Promise<string>;
  cleanupTemporaryDirectory?(directory: string): Promise<void>;
  log?(message: string): void;
}

export type HistoricalQualityFailureClass =
  | 'restore-failure'
  | 'spawn-failure'
  | 'supervisor-timeout'
  | 'missing-child-output'
  | 'malformed-child-output'
  | 'artifact-writer-unavailable'
  | 'artifact-write-failure';

/** Opaque, content-free parent diagnostics are the only operational detail persisted. */
export interface HistoricalQualityParentDiagnostic {
  failureClass: HistoricalQualityFailureClass;
}

export type SanitizedOperationalFailure = HistoricalQualityParentDiagnostic;

export interface HistoricalQualityArtifactWriter {
  (reportPath: string, artifact: unknown, options?: { force?: boolean }): Promise<void>;
}

export interface HistoricalQualityRunSummary {
  qualityVerdictAvailable: boolean;
  completedSlots: number;
  requestedSlots: number;
  groups: unknown[] | null;
  message?: 'no quality verdict';
}

export interface HistoricalQualityArtifactView extends Record<string, unknown> {
  completeness: { complete: boolean } & Record<string, unknown>;
  measurement: {
    requestedSlots: number;
    completedSlots: number;
    qualityVerdictAvailable: boolean;
  };
  selection: { fullCorpus: boolean; filters: Record<string, string> };
  execution: { policy: 'strict'; runs: unknown[] };
  payload: { aggregatePassRate: number; cases: unknown[] };
}

export interface HistoricalQualityAggregation {
  artifact: HistoricalQualityArtifactView;
  qualitySummary: HistoricalQualityRunSummary | null;
}

export interface HistoricalQualityParentResult extends HistoricalQualityAggregation {
  runId: string;
  configurationFingerprint: string;
  outputs: HistoricalQualityChildOutput[];
  reportPath: string;
  exitCode: 0 | 3;
}

export class HistoricalQualitySlotOperationalError extends Error {
  readonly failureClass: HistoricalQualityFailureClass;

  constructor(failureClass: HistoricalQualityFailureClass, options?: ErrorOptions) {
    super(`Historical quality ${failureClass}`, options);
    this.name = 'HistoricalQualitySlotOperationalError';
    this.failureClass = failureClass;
  }
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
  summarizeHistoricalQualitySlot(input: {
    completed: boolean;
    participantMetrics: readonly unknown[];
  }): Record<string, unknown>;
  summarizeHistoricalQualityRun(
    slots: readonly Record<string, unknown>[],
    requestedSlots: number,
    repetitionsRequested: number,
  ): HistoricalQualityRunSummary;
  parseHistoricalQualityArtifact(value: unknown): HistoricalQualityArtifactView;
  readEvalGitProvenance(cwd: string): { revision: string; dirty: boolean | null };
  writeEvalArtifact(path: string, artifact: unknown, options?: { force?: boolean }): Promise<void>;
  assertEvalWritePlan(plan: { inputs: string[]; outputs: string[]; force?: boolean }): Promise<void>;
};

async function loadHistoricalAuthorities(): Promise<HistoricalAuthorities> {
  // Variables keep the API build from pulling protocol eval source into its
  // rootDir; Bun resolves these source modules only when the eval runtime runs.
  const pilotSpecifier = '../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.pilot.js';
  const sharedSpecifier = '../../../../packages/protocol/eval/shared/index.js';
  const modelsSpecifier = '../../../../packages/protocol/src/shared/agent/model.resolver.js';
  const childOutputSpecifier = '../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.child-output.js';
  const metricsSpecifier = '../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.metrics.js';
  const artifactSpecifier = '../../../../packages/protocol/eval/shared/artifact.js';
  const artifactIoSpecifier = '../../../../packages/protocol/eval/shared/artifact.io.js';
  const [pilot, shared, models, childOutput, metrics, artifact, artifactIo] = await Promise.all([
    import(pilotSpecifier),
    import(sharedSpecifier),
    import(modelsSpecifier),
    import(childOutputSpecifier),
    import(metricsSpecifier),
    import(artifactSpecifier),
    import(artifactIoSpecifier),
  ]);
  return {
    buildHistoricalQualityPilotPlan: pilot.buildHistoricalQualityPilotPlan as HistoricalAuthorities['buildHistoricalQualityPilotPlan'],
    fingerprintCanonicalJson: shared.fingerprintCanonicalJson as HistoricalAuthorities['fingerprintCanonicalJson'],
    resolveEvalJudgeModelId: shared.resolveEvalJudgeModelId as HistoricalAuthorities['resolveEvalJudgeModelId'],
    resolveCanonicalAllAgentModels: models.resolveCanonicalAllAgentModels as HistoricalAuthorities['resolveCanonicalAllAgentModels'],
    parseHistoricalQualityChildOutput: childOutput.parseHistoricalQualityChildOutput as HistoricalAuthorities['parseHistoricalQualityChildOutput'],
    summarizeHistoricalQualitySlot: metrics.summarizeHistoricalQualitySlot as HistoricalAuthorities['summarizeHistoricalQualitySlot'],
    summarizeHistoricalQualityRun: metrics.summarizeHistoricalQualityRun as HistoricalAuthorities['summarizeHistoricalQualityRun'],
    parseHistoricalQualityArtifact: (value) => artifact.HistoricalQualityArtifactEnvelopeSchema.parse(value) as HistoricalQualityArtifactView,
    readEvalGitProvenance: artifact.readEvalGitProvenance as HistoricalAuthorities['readEvalGitProvenance'],
    writeEvalArtifact: artifactIo.writeEvalArtifact as HistoricalAuthorities['writeEvalArtifact'],
    assertEvalWritePlan: artifactIo.assertEvalWritePlan as HistoricalAuthorities['assertEvalWritePlan'],
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

export interface HistoricalQualityBaseVerifierSpawnOptions {
  cmd: string[];
  env: NodeJS.ProcessEnv;
  stdout: 'pipe';
  stderr: 'pipe';
}

export interface HistoricalQualityBaseVerifierChild {
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  exited: Promise<number>;
}

export type HistoricalQualityBaseVerifierSpawn = (
  options: HistoricalQualityBaseVerifierSpawnOptions,
) => HistoricalQualityBaseVerifierChild;

export async function verifyBaseInFreshProcess(
  manifest: AttestedHistoricalQualityManifest,
  spawn?: HistoricalQualityBaseVerifierSpawn,
): Promise<VerifiedHistoricalQualityBase> {
  const options: HistoricalQualityBaseVerifierSpawnOptions = {
    cmd: [process.execPath, new URL('./discovery-quality-base.runtime.ts', import.meta.url).pathname, '--verify'],
    env: buildHistoricalQualityBaseVerifierEnvironment(manifest.baseReadReplica.databaseUrl),
    stdout: 'pipe',
    stderr: 'pipe',
  };
  const child = spawn ? spawn(options) : Bun.spawn(options) as HistoricalQualityBaseVerifierChild;
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

export const HISTORICAL_QUALITY_SUPERVISOR_TIMEOUT_MS = 210_000;
export const HISTORICAL_QUALITY_SUPERVISOR_KILL_GRACE_MS = 5_000;

export interface HistoricalQualitySupervisorClock {
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface HistoricalQualitySupervisedChild {
  exited: Promise<number>;
  kill(signal: string): void;
}

const productionSupervisorClock: HistoricalQualitySupervisorClock = {
  setTimeout: (callback, delayMs) => {
    const timer = setTimeout(callback, delayMs);
    timer.unref?.();
    return timer;
  },
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** Production supervision seam: deadline TERM, bounded grace, then KILL. */
export async function superviseHistoricalQualityChild(
  child: HistoricalQualitySupervisedChild,
  options: {
    clock?: HistoricalQualitySupervisorClock;
    timeoutMs?: number;
    killGraceMs?: number;
  } = {},
): Promise<number> {
  const clock = options.clock ?? productionSupervisorClock;
  let deadline: unknown;
  const timeout = new Promise<'timeout'>((resolve) => {
    deadline = clock.setTimeout(() => resolve('timeout'), options.timeoutMs ?? HISTORICAL_QUALITY_SUPERVISOR_TIMEOUT_MS);
  });
  const exit = child.exited.then((exitCode) => ({ kind: 'exit' as const, exitCode }));
  const supervised = await Promise.race([exit, timeout]);
  if (deadline !== undefined) clock.clearTimeout(deadline);
  if (supervised !== 'timeout') return supervised.exitCode;

  child.kill('SIGTERM');
  const escalation = clock.setTimeout(
    () => child.kill('SIGKILL'),
    options.killGraceMs ?? HISTORICAL_QUALITY_SUPERVISOR_KILL_GRACE_MS,
  );
  await child.exited.catch(() => undefined);
  clock.clearTimeout(escalation);
  throw new HistoricalQualitySlotOperationalError('supervisor-timeout');
}

async function productionSpawnSlot(input: {
  dispatch: HistoricalQualitySlotDispatch;
  environment: HistoricalQualityChildEnvironment;
  markSpawned(): void;
}): Promise<unknown> {
  const { dispatch } = input;
  let child: ReturnType<typeof Bun.spawn>;
  try {
    child = Bun.spawn({
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
    input.markSpawned();
  } catch (error) {
    throw new HistoricalQualitySlotOperationalError('spawn-failure', { cause: error });
  }
  const consume = (stream: unknown): Promise<string> => stream instanceof ReadableStream
    ? new Response(stream).text().catch(() => '')
    : Promise.resolve('');
  // Drain immediately so a verbose child cannot block on a full pipe before exit.
  const stdout = consume(child.stdout);
  const stderr = consume(child.stderr);
  let exitCode: number;
  try {
    exitCode = await superviseHistoricalQualityChild({
      exited: child.exited,
      kill: (signal) => child.kill(signal === 'SIGTERM' ? 'SIGTERM' : 'SIGKILL'),
    });
  } catch (error) {
    await Promise.all([stdout, stderr]);
    throw error;
  }
  await Promise.all([stdout, stderr]);
  if (exitCode !== 0) throw new HistoricalQualitySlotOperationalError('spawn-failure');
  const file = Bun.file(dispatch.outputPath);
  if (!(await file.exists())) throw new HistoricalQualitySlotOperationalError('missing-child-output');
  try {
    return await file.json();
  } catch (error) {
    throw new HistoricalQualitySlotOperationalError('malformed-child-output', { cause: error });
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

interface HistoricalQualityPilotPlanShape {
  slots: HistoricalQualityPilotSlot[];
  childSlots?: Array<{ slotId: string; configurationId: 'a' }>;
  configurationFingerprint: string;
  graphInvocations?: number;
  evaluatorCalls?: number;
  maxAttempts?: 1;
}

const HISTORICAL_QUALITY_FAILURE_CLASSES = new Set<HistoricalQualityFailureClass>([
  'restore-failure',
  'spawn-failure',
  'supervisor-timeout',
  'missing-child-output',
  'malformed-child-output',
  'artifact-writer-unavailable',
  'artifact-write-failure',
]);

function assertHistoricalQualityPlanCardinality(plan: HistoricalQualityPilotPlanShape): number {
  const requestedSlots = plan.slots.length;
  if (requestedSlots < 1
    || plan.graphInvocations !== undefined && plan.graphInvocations !== requestedSlots
    || plan.evaluatorCalls !== undefined && plan.evaluatorCalls !== requestedSlots
    || plan.maxAttempts !== undefined && plan.maxAttempts !== 1) {
    throw new Error('Historical quality plan cardinality is inconsistent');
  }
  const slotIds = plan.slots.map((slot) => slot.slotId);
  const tupleIds = plan.slots.map((slot) => JSON.stringify([slot.caseId, slot.trigger, slot.repetition]));
  if (new Set(slotIds).size !== requestedSlots || new Set(tupleIds).size !== requestedSlots
    || plan.slots.some((slot) => slot.selectedSide !== 'a'
      || slot.configurationFingerprint !== plan.configurationFingerprint || slot.maxAttempts !== 1)) {
    throw new Error('Historical quality plan identities are inconsistent');
  }
  if (plan.childSlots !== undefined) {
    if (plan.childSlots.length !== requestedSlots
      || plan.childSlots.some((slot, index) => slot.slotId !== plan.slots[index]!.slotId || slot.configurationId !== 'a')) {
      throw new Error('Historical quality plan child cardinality is inconsistent');
    }
  }
  const repetitionsByGroup = new Map<string, number[]>();
  for (const slot of plan.slots) {
    const key = JSON.stringify([slot.caseId, slot.trigger]);
    const repetitions = repetitionsByGroup.get(key) ?? [];
    repetitions.push(slot.repetition);
    repetitionsByGroup.set(key, repetitions);
  }
  const first = repetitionsByGroup.values().next().value as number[] | undefined;
  const repetitionsRequested = first?.length ?? 0;
  if (repetitionsRequested < 1 || [...repetitionsByGroup.values()].some((repetitions) =>
    repetitions.length !== repetitionsRequested
      || [...repetitions].sort((left, right) => left - right).some((value, index) => value !== index))) {
    throw new Error('Historical quality plan repetition cardinality is inconsistent');
  }
  return repetitionsRequested;
}

function isoAtLeast(values: readonly string[], fallback: string, kind: 'min' | 'max'): string {
  if (values.length === 0) return fallback;
  const times = values.map((value) => Date.parse(value));
  return new Date(kind === 'min' ? Math.min(...times) : Math.max(...times)).toISOString();
}

/**
 * Aggregates only canonical child envelopes. Per-slot parsing binds every
 * parent-owned identity; this layer adds cross-output set and cardinality rules.
 */
export async function aggregateHistoricalQualityChildren(input: {
  plan: HistoricalQualityPilotPlanShape;
  outputs: readonly HistoricalQualityChildOutput[];
  diagnostics: readonly HistoricalQualityParentDiagnostic[];
  models?: readonly string[];
  model?: string;
}): Promise<HistoricalQualityAggregation> {
  const authorities = await loadHistoricalAuthorities();
  const repetitionsRequested = assertHistoricalQualityPlanCardinality(input.plan);
  if (input.diagnostics.length > 1
    || input.diagnostics.some((diagnostic) => !HISTORICAL_QUALITY_FAILURE_CLASSES.has(diagnostic.failureClass))) {
    throw new Error('Historical quality parent diagnostics are invalid');
  }
  if (input.diagnostics.length === 0 && input.outputs.length !== input.plan.slots.length) {
    throw new Error('Missing historical quality slot output');
  }
  if (input.outputs.length > input.plan.slots.length) throw new Error('Historical quality output cardinality exceeds plan');

  const expected = new Map(input.plan.slots.map((slot) => [slot.slotId, slot]));
  const seen = new Set<string>();
  const parsedOutputs: HistoricalQualityChildOutput[] = [];
  let commonRunId: string | undefined;
  for (const output of input.outputs) {
    const candidate = output as HistoricalQualityChildOutput;
    const slot = expected.get(candidate.slotId);
    if (!slot) throw new Error('Unplanned historical quality slot output');
    if (seen.has(candidate.slotId)) throw new Error('Duplicate historical quality slot output');
    const parsed = authorities.parseHistoricalQualityChildOutput(output, {
      runId: commonRunId ?? candidate.runId,
      slotId: slot.slotId,
      configurationId: 'a',
      configurationFingerprint: input.plan.configurationFingerprint,
      logicalCaseId: slot.caseId,
      trigger: slot.trigger,
      repetition: slot.repetition,
      forbiddenValues: [],
    });
    commonRunId ??= parsed.runId;
    seen.add(parsed.slotId);
    parsedOutputs.push(parsed);
  }

  const runSlots = parsedOutputs.map((output) => {
    const transport = output.transportRow as {
      logicalCaseId: string;
      trigger: 'intent' | 'enrichment';
      repetition: number;
      completed: boolean;
      participantMetrics: readonly unknown[];
    };
    return {
      logicalCaseId: transport.logicalCaseId,
      trigger: transport.trigger,
      repetition: transport.repetition,
      slotSummary: authorities.summarizeHistoricalQualitySlot({
        completed: transport.completed,
        participantMetrics: transport.participantMetrics,
      }),
    };
  });
  const qualitySummary = authorities.summarizeHistoricalQualityRun(
    runSlots,
    input.plan.slots.length,
    repetitionsRequested,
  );
  if (input.diagnostics.length > 0 && qualitySummary.qualityVerdictAvailable === true) {
    throw new Error('Historical quality operational diagnostic cannot carry a quality verdict');
  }

  const cases = parsedOutputs.map(({ transportRow, executionRun }) => ({
    caseId: executionRun.caseId,
    rule: 'execution-completeness' as const,
    runs: 1 as const,
    passes: transportRow.completed ? 1 as const : 0 as const,
    passRate: transportRow.completed ? 1 as const : 0 as const,
    flaky: false as const,
    scoredRunIds: transportRow.completed ? [executionRun.runId] : [],
    ...transportRow,
  }));
  const executionRuns = parsedOutputs.map((output) => output.executionRun as {
    runId: string;
    caseId: string;
    outcome: string;
    recovered: boolean;
    attempts: Array<{ startedAt: string; completedAt: string }>;
  });
  const completedSlots = parsedOutputs.filter((output) => (output.transportRow as { completed: boolean }).completed).length;
  const successRuns = executionRuns.filter((run) => run.outcome === 'success').length;
  const recoveredRuns = executionRuns.filter((run) => run.recovered).length;
  const totalAttempts = executionRuns.reduce((total, run) => total + run.attempts.length, 0);
  const attemptStarts = executionRuns.flatMap((run) => run.attempts.map((attempt) => attempt.startedAt));
  const attemptEnds = executionRuns.flatMap((run) => run.attempts.map((attempt) => attempt.completedAt));
  const now = new Date().toISOString();
  const startedAt = isoAtLeast(attemptStarts, now, 'min');
  const completedAt = isoAtLeast(attemptEnds, now, 'max');
  const createdAt = new Date(Math.max(Date.parse(now), Date.parse(completedAt))).toISOString();
  const failureClass = input.diagnostics[0]?.failureClass;
  const selectedCaseIds = [...new Set(input.plan.slots.map((slot) => slot.caseId))];
  const selectedTriggers = [...new Set(input.plan.slots.map((slot) => slot.trigger))];
  const fullSelection = failureClass === undefined
    && selectedCaseIds.length === HISTORICAL_QUALITY_APPROVED_CASE_IDS.length
    && HISTORICAL_QUALITY_APPROVED_CASE_IDS.every((caseId) => selectedCaseIds.includes(caseId))
    && selectedTriggers.length === 2;
  const filters: Record<string, string> = {};
  if (!fullSelection) {
    filters.case = selectedCaseIds.join(',');
    filters.trigger = selectedTriggers.join(',');
  }
  if (failureClass !== undefined) filters.operationalFailureClass = failureClass;
  const rate = cases.length === 0 ? 0 : completedSlots / cases.length;
  const completeSelection = qualitySummary.qualityVerdictAvailable === true && failureClass === undefined;
  const verdict = completeSelection && fullSelection;
  const models = [...new Set(input.models ?? ['configured runtime models'])];
  const model = input.model ?? models[0] ?? 'configured runtime models';
  if (models.length === 0 || models.some((value) => value.trim() === '') || model.trim() === '') {
    throw new Error('Historical quality artifact models are invalid');
  }
  const artifact = {
    artifactType: 'index-eval/run-report' as const,
    schemaVersion: 2 as const,
    harness: 'discovery',
    harnessVersion: '1',
    source: 'run' as const,
    createdAt,
    startedAt,
    completedAt,
    models,
    runs: 1 as const,
    selection: { fullCorpus: fullSelection, filters },
    corpusFingerprint: HISTORICAL_QUALITY_APPROVED_FINGERPRINTS.planFingerprint,
    configFingerprint: input.plan.configurationFingerprint,
    git: authorities.readEvalGitProvenance(import.meta.dir),
    completeness: {
      caseCount: cases.length,
      ruleCount: 1,
      totalRuns: cases.length,
      totalPasses: completedSlots,
      flakyCaseCount: 0,
      requestedRuns: executionRuns.length,
      completedRuns: successRuns,
      failedRuns: executionRuns.length - successRuns,
      recoveredRuns,
      totalAttempts,
      complete: completeSelection,
    },
    measurement: {
      kind: 'historical-quality-pilot' as const,
      scorecardSemantics: 'execution-completeness' as const,
      repetitionsRequested,
      requestedSlots: input.plan.slots.length,
      completedSlots,
      qualityVerdictAvailable: verdict,
    },
    execution: { policy: 'strict' as const, runs: executionRuns },
    payload: {
      generatedAt: completedAt,
      model,
      runs: 1 as const,
      aggregatePassRate: rate,
      rules: [{ rule: 'execution-completeness' as const, caseCount: cases.length, passRate: rate }],
      cases,
    },
  };
  return {
    artifact: authorities.parseHistoricalQualityArtifact(artifact),
    qualitySummary: verdict ? qualitySummary : null,
  };
}

export async function writeOperationalDiagnosticBestEffort(input: {
  plan: HistoricalQualityPilotPlanShape;
  acceptedOutputs: readonly HistoricalQualityChildOutput[];
  primaryFailure: SanitizedOperationalFailure;
  reportPath: string;
  writer: HistoricalQualityArtifactWriter;
}): Promise<{ written: boolean; artifactWriteFailure?: SanitizedOperationalFailure }> {
  try {
    const { artifact } = await aggregateHistoricalQualityChildren({
      plan: input.plan,
      outputs: input.acceptedOutputs,
      diagnostics: [input.primaryFailure],
    });
    await input.writer(input.reportPath, artifact);
    return { written: true };
  } catch {
    return { written: false, artifactWriteFailure: { failureClass: 'artifact-write-failure' } };
  }
}

const productionDependencies: HistoricalQualityRuntimeDeps = {
  assertHistoricalQualityAuthorization: () => assertAbConfirmation(process.env),
  acquireOperationLease: async () => acquireHistoricalQualityOperationLease(process.env.DISCOVERY_TARGETS),
  preflightChildRuntime: async () => {
    // Child availability still precedes topology attestation and destruction.
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
  prepareArtifactWrite: async (reportPath, force) => {
    const { assertEvalWritePlan } = await loadHistoricalAuthorities();
    await assertEvalWritePlan({ inputs: [], outputs: [reportPath], force });
  },
  artifactWriter: async (reportPath, artifact, options) => {
    const { writeEvalArtifact } = await loadHistoricalAuthorities();
    await writeEvalArtifact(reportPath, artifact, options);
  },
  log: (message) => console.log(message),
};

export async function runHistoricalQualityRuntime(
  request: HistoricalQualityRequest,
  deps: HistoricalQualityRuntimeDeps = productionDependencies,
): Promise<HistoricalQualityParentResult> {
  let stage: AbRunStage | null = null;
  let temporaryDirectory: string | undefined;
  let plan: HistoricalQualityPilotPlanShape | undefined;
  let reportPath: string | undefined;
  let artifactModels: string[] | undefined;
  let artifactModel: string | undefined;
  let priorSideStarted = false;
  let operationLease: Pick<HistoricalQualityOperationLease, 'identifier' | 'release'> | undefined;
  let primaryErrorForLeaseRelease: unknown;
  let completedResult: HistoricalQualityParentResult | undefined;
  let leaseReleaseFailed = false;
  const outputs: HistoricalQualityChildOutput[] = [];
  try {
    // Parallel mode spends once per candidate. Refuse it before even runtime
    // preflight so the quality cost remains exactly one evaluator call per slot.
    assertHistoricalQualitySerialEvaluation(request.configuration.config);
    // Parent-only consent must refuse before parsing the manifest to acquire a
    // lease, while isolated runtime seams may deliberately omit this legacy gate.
    deps.assertHistoricalQualityAuthorization?.();
    // Parse strict manifest v2 and acquire the shared side-a identity before
    // preflight, control-plane calls, restore, provider spend, or artifacts.
    operationLease = await deps.acquireOperationLease();
    // The real Task 6 module must prove its own availability before topology
    // attestation or any destructive/provider operation can be constructed.
    await deps.preflightChildRuntime();
    const manifest = await deps.attest();
    const forbiddenValues = buildHistoricalQualityForbiddenValues(process.env, manifest);
    const verifiedBase = parseVerifiedBase(await deps.verifyBase(manifest));
    const reconciledEnvironment = reconcileHistoricalQualityEmbedding(verifiedBase, process.env);
    const resolved = await resolveHistoricalQualityConfiguration({ request, verifiedBase, environment: reconciledEnvironment });
    const { buildHistoricalQualityPilotPlan, fingerprintCanonicalJson } = await loadHistoricalAuthorities();
    plan = buildHistoricalQualityPilotPlan({
      caseIds: request.caseIds,
      triggers: request.triggers,
      repetitions: request.repetitions,
      configuration: { id: 'a', config: resolved },
    }) as HistoricalQualityPilotPlanShape;
    const recomputedConfigurationFingerprint = fingerprintCanonicalJson(resolved);
    const childResolvedConfigurationFingerprint = await fingerprintHistoricalQualityChildResolvedConfiguration(
      historicalQualityChildResolvedProjection(resolved),
    );
    artifactModels = [...new Set([...Object.values(resolved.models), resolved.fixed.judgeModelId])];
    artifactModel = resolved.fixed.judgeModelId;
    if (plan.configurationFingerprint !== recomputedConfigurationFingerprint
      || plan.slots.some((slot) => slot.configurationFingerprint !== recomputedConfigurationFingerprint)) {
      throw new Error('Historical quality planner configuration fingerprint mismatch');
    }
    const childEnvironment = buildHistoricalQualityChildEnvironment({
      parentEnvironment: reconciledEnvironment,
      sanitizedConfiguration: request.configuration.config,
    });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    reportPath = request.reportPath === undefined
      ? path.resolve(import.meta.dir, '../../eval/discovery/runs', `${stamp}.json`)
      : path.resolve(request.reportPath);
    if ((await stat(reportPath).catch(() => undefined))?.isDirectory()) {
      throw new Error(`Historical quality report path must name a file: ${reportPath}`);
    }
    await deps.prepareArtifactWrite?.(reportPath, request.force);

    const runId = `hq-run-${randomBytes(16).toString('hex')}`;
    temporaryDirectory = deps.createTemporaryDirectory === undefined
      ? await mkdtemp(path.join(tmpdir(), 'historical-quality-'))
      : await deps.createTemporaryDirectory();

    for (const slot of plan.slots) {
      stage = 'resetting';
      try {
        await deps.restoreSelectedChild(manifest);
      } catch (error) {
        throw new HistoricalQualitySlotOperationalError('restore-failure', { cause: error });
      }
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
      let output: unknown;
      try {
        output = await deps.spawnSlot({
          dispatch,
          environment: childEnvironment,
          markSpawned: () => { stage = 'spawned'; },
        });
        stage = 'spawned';
      } catch (error) {
        if (error instanceof HistoricalQualitySlotOperationalError) throw error;
        throw new HistoricalQualitySlotOperationalError('spawn-failure', { cause: error });
      }
      try {
        outputs.push(await deps.validateSlotOutput(slot, dispatch, output, forbiddenValues));
        priorSideStarted = true;
      } catch (error) {
        throw new HistoricalQualitySlotOperationalError('malformed-child-output', { cause: error });
      }
    }

    const aggregation = await aggregateHistoricalQualityChildren({
      plan,
      outputs,
      diagnostics: [],
      models: artifactModels,
      model: artifactModel,
    });
    if (!deps.artifactWriter) throw new HistoricalQualitySlotOperationalError('artifact-writer-unavailable');
    try {
      await deps.artifactWriter(reportPath, aggregation.artifact, { force: request.force });
    } catch (error) {
      throw new HistoricalQualitySlotOperationalError('artifact-write-failure', { cause: error });
    }
    const exitCode = aggregation.artifact.completeness.complete ? 0 as const : 3 as const;
    completedResult = {
      runId,
      configurationFingerprint: plan.configurationFingerprint,
      outputs,
      reportPath,
      exitCode,
      ...aggregation,
    };
  } catch (error) {
    if (stage !== null && plan !== undefined && reportPath !== undefined) {
      const primaryFailure: SanitizedOperationalFailure = {
        failureClass: error instanceof HistoricalQualitySlotOperationalError
          ? error.failureClass
          : stage === 'resetting' ? 'restore-failure' : 'spawn-failure',
      };
      let artifactFailure: SanitizedOperationalFailure | undefined;
      let diagnosticReportPath: string | undefined;
      if (primaryFailure.failureClass !== 'artifact-write-failure') {
        if (deps.artifactWriter) {
          const diagnostic = await writeOperationalDiagnosticBestEffort({
            plan,
            acceptedOutputs: outputs,
            primaryFailure,
            reportPath,
            writer: (destination, artifact) => deps.artifactWriter!(destination, artifact, { force: request.force }),
          });
          artifactFailure = diagnostic.artifactWriteFailure;
          if (diagnostic.written) diagnosticReportPath = reportPath;
        } else if (primaryFailure.failureClass !== 'artifact-writer-unavailable') {
          artifactFailure = { failureClass: 'artifact-writer-unavailable' };
        }
      }
      primaryErrorForLeaseRelease = new HistoricalQualitySpentRunError(
        stage,
        primaryFailure.failureClass,
        artifactFailure?.failureClass,
        {
          shape: 'single',
          cause: error,
          priorSideStarted,
          ...(diagnosticReportPath === undefined ? {} : { diagnosticReportPath }),
        },
      );
    } else {
      primaryErrorForLeaseRelease = classifyAbParentFailure(stage, error, { shape: 'single' });
    }
  } finally {
    // Child files are removed only after aggregation/report handling has either
    // succeeded or been classified. Cleanup never replaces the primary result.
    if (temporaryDirectory) {
      const cleanup = deps.cleanupTemporaryDirectory === undefined
        ? rm(temporaryDirectory, { recursive: true, force: true })
        : deps.cleanupTemporaryDirectory(temporaryDirectory);
      await cleanup.catch(() => undefined);
    }
    // Release only through the random token-bound lease handle, and only after
    // success/error artifact handling and temporary child cleanup have ended.
    // A false/throw is never success and never masks an existing primary
    // classification with raw filesystem details.
    if (operationLease) {
      try {
        leaseReleaseFailed = !await operationLease.release();
      } catch {
        leaseReleaseFailed = true;
      }
    }
  }

  if (leaseReleaseFailed) {
    throw new HistoricalQualityLeaseReleaseError({
      ...(primaryErrorForLeaseRelease === undefined ? {} : { primaryError: primaryErrorForLeaseRelease }),
      ...(reportPath === undefined ? {} : { artifactPath: reportPath }),
    });
  }
  if (primaryErrorForLeaseRelease !== undefined) throw primaryErrorForLeaseRelease;
  if (completedResult === undefined) throw new Error('Historical quality runtime ended without a result');
  process.exitCode = completedResult.exitCode;
  deps.log?.(`Historical quality artifact written: ${completedResult.reportPath}`);
  if (completedResult.qualitySummary === null) {
    deps.log?.('no quality verdict');
  } else {
    deps.log?.(`Historical quality summary: ${JSON.stringify(completedResult.qualitySummary)}`);
  }
  return completedResult;
}

/** Name retained for the approved Task 5 interface and bootstrap. */
export const runHistoricalQualityParent = runHistoricalQualityRuntime;
