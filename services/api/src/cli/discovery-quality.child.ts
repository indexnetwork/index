import { createHash } from 'node:crypto';
import { z } from 'zod';

import { DISCOVERY_ENV_KEYS, assertAbEnvConfig } from './discovery.flags';
import { HISTORICAL_QUALITY_CHILD_RUNTIME_CONTRACT_VERSION } from './discovery-quality.child-loader';
import { parseHistoricalQualityRuntimeEnvironment, type HistoricalQualityChildEnvironment, type HistoricalQualityRuntimeEnvironment } from './discovery-quality.environment';
import { NamespacedHydeCache } from './discovery-quality.cache';
import { AB_BRANCH_NAMES, parseHistoricalQualityManifest } from './discovery.neon';
import { createNeonControlPlane, isEndpointHost } from './discovery-env-matrix.neon';
import { fingerprintHistoricalQualityChildResolvedConfiguration, resolveHistoricalQualityChildConfiguration, type HistoricalQualityChildOutput, type VerifiedHistoricalQualityBase } from './discovery-quality.runtime';
import { embeddingConfigurationFingerprint, HISTORICAL_QUALITY_APPROVED_EMBEDDING_IDENTITY } from '../lib/embedding/embedding.identity';

import type { HydeCache } from '@indexnetwork/protocol';
import type { DrizzleDB } from '../lib/drizzle/drizzle';
import type { HistoricalSharedPoolSeedProjection } from './discovery-quality-base';

export { HISTORICAL_QUALITY_CHILD_RUNTIME_CONTRACT_VERSION };
export const contractVersion = HISTORICAL_QUALITY_CHILD_RUNTIME_CONTRACT_VERSION;

const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const outputPathSchema = z.string().trim().min(1);

export const HistoricalQualitySlotDispatchSchema = z.object({
  runId: z.string().regex(/^hq-run-[a-f0-9]{32}$/),
  slotId: z.string().regex(/^hq-slot-[a-f0-9]{64}$/),
  configurationId: z.literal('a'),
  configurationFingerprint: sha256Schema,
  childEnvironmentFingerprint: sha256Schema,
  childResolvedConfigurationFingerprint: sha256Schema,
  outputPath: outputPathSchema,
}).strict();

export type HistoricalQualitySlotDispatch = z.infer<typeof HistoricalQualitySlotDispatchSchema>;
export type DiscoveryEnvKey = (typeof DISCOVERY_ENV_KEYS)[number];

const CREDENTIAL_KEY_PATTERN = /(?:^|_)(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|URL|URI|DSN|AUTH)(?:_|$)/;
const EXACT_CREDENTIAL_KEYS = new Set(['DISCOVERY_TARGETS', 'OPENROUTER_API_KEY', 'OPENROUTER_BASE_URL']);
const CREDENTIAL_VALUE_PATTERN = /(?:postgres(?:ql)?|rediss?|https?):\/\/|(?:^|[\s"'=:])sk-[A-Za-z0-9_-]{8,}|\bbearer\s+[A-Za-z0-9._~+/-]+=*|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_ -]?key|secret|token|password|passwd|credential)\s*[:=]/i;

function isCredentialKey(key: string): boolean {
  return EXACT_CREDENTIAL_KEYS.has(key) || CREDENTIAL_KEY_PATTERN.test(key);
}

function configurationIssues(value: Record<string, string>, context: z.RefinementCtx): void {
  for (const [key, candidate] of Object.entries(value)) {
    if (isCredentialKey(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is a credential and is forbidden` });
      continue;
    }
    if (!DISCOVERY_ENV_KEYS.includes(key)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is not readable by the discovery graph` });
      continue;
    }
    if (CREDENTIAL_VALUE_PATTERN.test(candidate)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} contains a credential-like value` });
    }
  }
}

export const HistoricalQualityChildConfigurationSchema = z
  .record(z.string(), z.string())
  .superRefine(configurationIssues);

/** Parses, validates and canonicalizes only the dedicated child configuration JSON. */
export function parseHistoricalQualityChildConfiguration(input: {
  raw: string | undefined;
  expectedFingerprint: string;
}): Readonly<Record<DiscoveryEnvKey, string>> {
  if (input.raw === undefined || input.raw.trim() === '') {
    throw new Error('Historical quality child configuration JSON is required');
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(input.raw);
  } catch {
    throw new Error('Historical quality child configuration must be valid JSON');
  }
  let parsed: Record<string, string>;
  try {
    parsed = HistoricalQualityChildConfigurationSchema.parse(decoded);
    assertAbEnvConfig(parsed);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('Historical quality child configuration is invalid', { cause: error });
  }
  const canonical = Object.fromEntries(
    Object.entries(parsed).sort(([left], [right]) => left.localeCompare(right)),
  ) as Record<DiscoveryEnvKey, string>;
  const canonicalJson = JSON.stringify(canonical);
  const fingerprint = createHash('sha256').update(canonicalJson).digest('hex');
  if (!sha256Schema.safeParse(input.expectedFingerprint).success || fingerprint !== input.expectedFingerprint) {
    throw new Error('Historical quality child configuration fingerprint mismatch');
  }
  return Object.freeze(canonical);
}

const DISPATCH_FLAGS = Object.freeze({
  '--run-id': 'runId',
  '--slot-id': 'slotId',
  '--configuration-id': 'configurationId',
  '--configuration-fingerprint': 'configurationFingerprint',
  '--child-environment-fingerprint': 'childEnvironmentFingerprint',
  '--child-resolved-configuration-fingerprint': 'childResolvedConfigurationFingerprint',
  '--child-output': 'outputPath',
} as const);

/** Strictly parses the child-only opaque argv contract. */
export function parseHistoricalQualitySlotDispatch(args: readonly string[]): HistoricalQualitySlotDispatch {
  if (args.filter((arg) => arg === '--historical-quality-child').length !== 1) {
    throw new Error('--historical-quality-child must appear exactly once');
  }
  const value: Record<string, string> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    if (arg === '--historical-quality-child') continue;
    const field = DISPATCH_FLAGS[arg as keyof typeof DISPATCH_FLAGS];
    if (field === undefined) throw new Error(`Unknown historical quality child flag: ${arg}`);
    if (value[field] !== undefined) throw new Error(`${arg} may appear exactly once`);
    const next = args[index + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`${arg} requires a value`);
    value[field] = next;
    index += 1;
  }
  try {
    return HistoricalQualitySlotDispatchSchema.parse(value);
  } catch {
    const missingChildFingerprint = value.childEnvironmentFingerprint === undefined;
    throw new Error(missingChildFingerprint
      ? '--child-environment-fingerprint is required for a historical quality child'
      : 'Historical quality child dispatch is invalid');
  }
}

export interface HistoricalQualityControlPlane {
  getBranch(projectId: string, branchId: string): Promise<{
    id: string;
    name: string;
    parentId?: string | null;
    primary: boolean;
  }>;
  listEndpoints(projectId: string, branchId: string): Promise<Array<{
    id: string;
    branchId: string;
    host: string;
    type: 'read_only' | 'read_write';
  }>>;
}

export interface AttestedHistoricalQualitySelectedChild {
  readonly target: {
    readonly sideId: 'a';
    readonly branchId: string;
    readonly endpointId: string;
    readonly databaseUrl: string;
  };
}

/** Re-attests only the exact selected v2 child and collapses all provider detail. */
export async function reattestExactSelectedChild(input: {
  manifest: string;
  neonApiKey: string;
  dispatch: HistoricalQualitySlotDispatch;
  controlPlane?: HistoricalQualityControlPlane;
}): Promise<AttestedHistoricalQualitySelectedChild> {
  try {
    if (input.dispatch.configurationId !== 'a') throw new Error('side');
    const manifest = parseHistoricalQualityManifest(input.manifest);
    const target = manifest.targets.find((candidate) => candidate.sideId === input.dispatch.configurationId);
    if (!target) throw new Error('selected target');
    const controlPlane = input.controlPlane ?? createNeonControlPlane(input.neonApiKey);
    const base = await controlPlane.getBranch(manifest.projectId, manifest.baseBranchId);
    if (base.id !== manifest.baseBranchId || base.name !== 'eval-discovery-base' || base.primary) throw new Error('base');
    const branch = await controlPlane.getBranch(manifest.projectId, target.branchId);
    if (branch.id !== target.branchId || branch.name !== AB_BRANCH_NAMES.a
      || branch.parentId !== base.id || branch.primary) throw new Error('branch');
    const url = new URL(target.databaseUrl);
    const endpoint = (await controlPlane.listEndpoints(manifest.projectId, target.branchId))
      .find((candidate) => candidate.id === target.endpointId);
    if (!endpoint || endpoint.branchId !== branch.id || endpoint.type !== 'read_write'
      || !isEndpointHost(url.hostname, endpoint.host)) throw new Error('endpoint');
    return Object.freeze({ target: Object.freeze({ ...target, sideId: 'a' as const }) });
  } catch {
    throw new Error('Historical quality selected child failed control-plane attestation');
  }
}

export function reconcileHistoricalQualityChildEmbedding(
  verifiedBase: VerifiedHistoricalQualityBase,
  runtimeEnvironment: Readonly<Record<string, string | undefined>>,
): Readonly<{ model: string; dimensions: number }> {
  const runtime = {
    provider: HISTORICAL_QUALITY_APPROVED_EMBEDDING_IDENTITY.provider,
    model: runtimeEnvironment.EMBEDDING_MODEL,
    dimensions: Number(runtimeEnvironment.EMBEDDING_DIMENSIONS),
  };
  const verified = verifiedBase.embedding;
  if (!runtime.model || !Number.isInteger(runtime.dimensions)
    || runtime.provider !== verified.provider || runtime.model !== verified.model
    || runtime.dimensions !== verified.dimensions
    || embeddingConfigurationFingerprint(runtime as { provider: string; model: string; dimensions: number }) !== verified.configurationFingerprint) {
    throw new Error('Historical quality child embedding identity does not match verified published state');
  }
  return Object.freeze({ model: verified.model, dimensions: verified.dimensions });
}

interface HistoricalQualityVerifier {
  db: DrizzleDB;
  close(): Promise<void>;
}

export interface HistoricalQualityConstructedDependencies {
  readonly [key: string]: unknown;
}

export interface HistoricalQualityAcquiredResource {
  readonly kind: 'cache' | 'database';
  close(): Promise<void>;
}

export interface HistoricalQualityResourceRegistry {
  add(resource: HistoricalQualityAcquiredResource): void;
}

export interface HistoricalQualityChildDeps {
  environment: Readonly<Record<string, string | undefined>>;
  reattestSelectedChild(input: {
    runtimeEnvironment: HistoricalQualityRuntimeEnvironment;
    dispatch: HistoricalQualitySlotDispatch;
  }): Promise<AttestedHistoricalQualitySelectedChild>;
  openVerifier(databaseUrl: string): Promise<HistoricalQualityVerifier>;
  verifyPublishedState(db: DrizzleDB): Promise<VerifiedHistoricalQualityBase>;
  resolveChildResolvedConfigurationFingerprint(input: {
    configuration: Readonly<Record<DiscoveryEnvKey, string>>;
    runtimeEnvironment: HistoricalQualityRuntimeEnvironment;
    base: VerifiedHistoricalQualityBase;
  }): Promise<string>;
  createCache(
    seed: HistoricalQualitySlotDispatch,
    resources: HistoricalQualityResourceRegistry,
  ): Promise<HydeCache> | HydeCache;
  createDependencies(input: {
    configuration: Readonly<Record<DiscoveryEnvKey, string>>;
    runtimeEnvironment: HistoricalQualityRuntimeEnvironment;
    selectedDatabaseUrl: string;
    embedding: Readonly<{ model: string; dimensions: number }>;
    cache: HydeCache;
  }, resources: HistoricalQualityResourceRegistry): Promise<HistoricalQualityConstructedDependencies>;
  executeSlot(input: {
    dispatch: HistoricalQualitySlotDispatch;
    configuration: Readonly<Record<DiscoveryEnvKey, string>>;
    dependencies: HistoricalQualityConstructedDependencies;
  }): Promise<HistoricalQualityChildOutput>;
}

async function closeAcquiredResources(resources: readonly HistoricalQualityAcquiredResource[]): Promise<void> {
  let failed = false;
  for (const resource of [...resources].reverse()) {
    try {
      await resource.close();
    } catch {
      failed = true;
    }
  }
  if (failed) throw new Error('Historical quality child resource cleanup failed');
}

async function closeWithoutMasking(primary: unknown, close: () => Promise<void>): Promise<void> {
  try {
    await close();
  } catch (cleanupError) {
    if (primary === undefined) throw cleanupError;
  }
}

async function runHistoricalQualityChildCore(
  dispatch: HistoricalQualitySlotDispatch,
  deps: HistoricalQualityChildDeps,
): Promise<HistoricalQualityChildOutput> {
  const environmentFingerprint = deps.environment.DISCOVERY_HISTORICAL_QUALITY_CONFIG_FINGERPRINT;
  if (environmentFingerprint !== dispatch.childEnvironmentFingerprint) {
    throw new Error('Historical quality child environment fingerprint does not match dispatch');
  }
  const configuration = parseHistoricalQualityChildConfiguration({
    raw: deps.environment.DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON,
    expectedFingerprint: dispatch.childEnvironmentFingerprint,
  });
  const runtimeEnvironment = parseHistoricalQualityRuntimeEnvironment(deps.environment);
  const attested = await deps.reattestSelectedChild({ runtimeEnvironment, dispatch });
  if (attested.target.sideId !== dispatch.configurationId) {
    throw new Error('Historical quality attested child does not match dispatch');
  }
  const selectedDatabaseUrl = attested.target.databaseUrl;

  const verifier = await deps.openVerifier(selectedDatabaseUrl);
  let verifiedBase: VerifiedHistoricalQualityBase | undefined;
  let verifyError: unknown;
  try {
    verifiedBase = await deps.verifyPublishedState(verifier.db);
  } catch (error) {
    verifyError = error;
  }
  await closeWithoutMasking(verifyError, verifier.close);
  if (verifyError !== undefined) throw verifyError;
  if (verifiedBase === undefined) throw new Error('Historical quality child verifier returned no published state');

  const embedding = reconcileHistoricalQualityChildEmbedding(verifiedBase, runtimeEnvironment);
  const childResolvedFingerprint = await deps.resolveChildResolvedConfigurationFingerprint({ configuration, runtimeEnvironment, base: verifiedBase });
  if (childResolvedFingerprint !== dispatch.childResolvedConfigurationFingerprint) {
    throw new Error('Historical quality child-resolved configuration fingerprint mismatch');
  }

  const acquiredResources: HistoricalQualityAcquiredResource[] = [];
  const resourceRegistry: HistoricalQualityResourceRegistry = {
    add: (resource) => { acquiredResources.push(resource); },
  };
  let primaryError: unknown;
  let result: HistoricalQualityChildOutput | undefined;
  try {
    const cache = await deps.createCache(dispatch, resourceRegistry);
    const dependencies = await deps.createDependencies({
      configuration,
      runtimeEnvironment,
      selectedDatabaseUrl,
      embedding,
      cache,
    }, resourceRegistry);
    result = await deps.executeSlot({ dispatch, configuration, dependencies });
  } catch (error) {
    primaryError = error;
  }
  await closeWithoutMasking(primaryError, () => closeAcquiredResources(acquiredResources));
  if (primaryError !== undefined) throw primaryError;
  if (result === undefined) throw new Error('Historical quality child produced no output');
  return result;
}

async function openProductionVerifier(databaseUrl: string): Promise<HistoricalQualityVerifier> {
  const [{ drizzle }, postgresModule, schema] = await Promise.all([
    import('drizzle-orm/postgres-js'),
    import('postgres'),
    import('../schemas/database.schema'),
  ]);
  const client = postgresModule.default(databaseUrl, { prepare: false });
  return {
    db: drizzle(client, { schema }) as DrizzleDB,
    close: async () => client.end({ timeout: 5 }),
  };
}

async function verifyProductionPublishedState(db: DrizzleDB): Promise<VerifiedHistoricalQualityBase> {
  // Keep protocol eval source outside the API build's rootDir; Bun resolves it
  // only in the dedicated child after attestation has selected the verifier DB.
  const fixtureSpecifier = '../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.js';
  const [baseModule, fixtureModule] = await Promise.all([
    import('./discovery-quality-base'),
    import(fixtureSpecifier) as Promise<{ HISTORICAL_SHARED_POOL_SEED_PROJECTION: HistoricalSharedPoolSeedProjection }>,
  ]);
  const attestation = await baseModule.readVerifiedHistoricalQualityPublishedState(
    db,
    fixtureModule.HISTORICAL_SHARED_POOL_SEED_PROJECTION,
    baseModule.productionHistoricalQualityBaseDependencies,
  );
  return Object.freeze({
    version: 1 as const,
    embedding: Object.freeze({ ...attestation.embedding }),
    corpusVersion: attestation.corpusVersion,
  });
}

function productionDependencies(environment: HistoricalQualityChildEnvironment): HistoricalQualityChildDeps {
  return {
    environment,
    reattestSelectedChild: ({ runtimeEnvironment, dispatch }) => reattestExactSelectedChild({
      manifest: runtimeEnvironment.DISCOVERY_TARGETS,
      neonApiKey: runtimeEnvironment.NEON_API_KEY,
      dispatch,
    }),
    openVerifier: openProductionVerifier,
    verifyPublishedState: verifyProductionPublishedState,
    resolveChildResolvedConfigurationFingerprint: async ({ configuration, runtimeEnvironment, base }) => {
      const effectiveConfiguration: Record<string, string> = { ...configuration };
      if (runtimeEnvironment.CHAT_MODEL !== undefined) effectiveConfiguration.CHAT_MODEL = runtimeEnvironment.CHAT_MODEL;
      if (runtimeEnvironment.EVAL_MODEL_OVERRIDES !== undefined) effectiveConfiguration.EVAL_MODEL_OVERRIDES = runtimeEnvironment.EVAL_MODEL_OVERRIDES;
      const resolved = await resolveHistoricalQualityChildConfiguration({
        configuration: effectiveConfiguration,
        verifiedBase: base,
        environment: runtimeEnvironment,
      });
      return fingerprintHistoricalQualityChildResolvedConfiguration(resolved);
    },
    createCache: async (seed, resources) => {
      // Loaded only after attestation, exact DB verification, verifier close,
      // embedding reconciliation, and full planner-fingerprint comparison.
      const cacheModule = await import('../adapters/cache.adapter');
      const cache = new cacheModule.RedisCacheAdapter();
      resources.add(Object.freeze({
        kind: 'cache' as const,
        close: async () => cacheModule.closeRedisConnection(),
      }));
      return new NamespacedHydeCache(cache, seed);
    },
    createDependencies: async ({ selectedDatabaseUrl, embedding, cache }, resources) => {
      // The process is dedicated to one slot. This assignment is the first and
      // only DATABASE_URL authority and is derived from the re-attested target.
      process.env.DATABASE_URL = selectedDatabaseUrl;
      const drizzleModule = await import('../lib/drizzle/drizzle');
      resources.add(Object.freeze({
        kind: 'database' as const,
        close: async () => drizzleModule.closeDb(),
      }));

      // Import and construct each later dependency only after the concrete DB
      // handle has a registered closer. The core owns cleanup from this point.
      const adapterModule = await import('../adapters/chat.database.adapter');
      const database = new adapterModule.ChatDatabaseAdapter();
      const embedderModule = await import('../adapters/embedder.adapter');
      const embedder = new embedderModule.EmbedderAdapter();
      if (embedder.identity.model !== embedding.model || embedder.identity.dimensions !== embedding.dimensions) {
        throw new Error('Historical quality constructed embedder identity drifted after verification');
      }
      const protocol = await import('@indexnetwork/protocol');
      const graphDb = database as never;
      const hydeGraph = new protocol.HydeGraphFactory(
        graphDb,
        embedder,
        cache,
        new protocol.LensInferrer(),
        new protocol.HydeGenerator(),
      ).createGraph();
      const opportunityGraph = new protocol.OpportunityGraphFactory(
        graphDb,
        embedder,
        hydeGraph,
        new protocol.OpportunityEvaluator(),
      ).createGraph();
      return { database, embedder, hydeGraph, opportunityGraph };
    },
    executeSlot: async () => {
      // Task 7 supplies production-shaped trigger execution and the canonical
      // HistoricalQualityChildOutput. Keeping this boundary explicit prevents
      // Task 6 from inventing or weakening that schema.
      throw new Error('Historical quality slot execution is unavailable');
    },
  };
}

/**
 * Parent preflight proves this exact versioned module is loadable. A direct
 * child environment additionally proves its config handoff is self-consistent.
 */
export async function preflightHistoricalQualityChildRuntime(
  environment: Readonly<Record<string, string | undefined>>,
): Promise<void> {
  const raw = environment.DISCOVERY_HISTORICAL_QUALITY_CONFIG_JSON;
  const fingerprint = environment.DISCOVERY_HISTORICAL_QUALITY_CONFIG_FINGERPRINT;
  if (raw === undefined && fingerprint === undefined) return;
  if (raw === undefined || fingerprint === undefined) {
    throw new Error('Historical quality child configuration handoff is incomplete');
  }
  parseHistoricalQualityChildConfiguration({ raw, expectedFingerprint: fingerprint });
  parseHistoricalQualityRuntimeEnvironment(environment);
}

export function runHistoricalQualityChild(
  dispatch: HistoricalQualitySlotDispatch,
  deps: HistoricalQualityChildDeps,
): Promise<HistoricalQualityChildOutput>;
export function runHistoricalQualityChild(
  args: readonly string[],
  environment: HistoricalQualityChildEnvironment,
): Promise<void>;
export async function runHistoricalQualityChild(
  dispatchOrArgs: HistoricalQualitySlotDispatch | readonly string[],
  depsOrEnvironment: HistoricalQualityChildDeps | HistoricalQualityChildEnvironment,
): Promise<HistoricalQualityChildOutput | void> {
  if (Array.isArray(dispatchOrArgs)) {
    const dispatch = parseHistoricalQualitySlotDispatch(dispatchOrArgs);
    const output = await runHistoricalQualityChildCore(
      dispatch,
      productionDependencies(depsOrEnvironment as HistoricalQualityChildEnvironment),
    );
    await Bun.write(dispatch.outputPath, JSON.stringify(output));
    return;
  }
  return runHistoricalQualityChildCore(
    dispatchOrArgs as HistoricalQualitySlotDispatch,
    depsOrEnvironment as HistoricalQualityChildDeps,
  );
}
