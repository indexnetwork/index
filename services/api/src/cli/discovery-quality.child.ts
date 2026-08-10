import { createHash } from 'node:crypto';
import { z } from 'zod';

import { DISCOVERY_ENV_KEYS, assertAbEnvConfig } from './discovery.flags';
import { withDiscoveryEnvironment } from './discovery-env-matrix.runtime';
import { buildEnrichmentDiscoveryTrigger, buildIntentDiscoveryTrigger } from '../queues/opportunity/discovery-trigger.builders';
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

type HistoricalQualityTrigger = 'intent' | 'enrichment';
type HistoricalQualityCandidateRole = 'target' | 'semantic-negative' | 'background';
type HistoricalQualityEvidenceType = 'intent' | 'premise' | 'user_context';

interface HistoricalQualityPlanParticipant {
  participantId: string;
  userId: string;
  intentId: string;
  premiseIds: string[];
  contextId: string;
  retrievalDocumentIds: string[];
}

interface HistoricalQualityPlanCase {
  caseId: string;
  sourceParticipantId: string;
  targetParticipantId: string;
  candidates: Array<{ participantId: string; role: HistoricalQualityCandidateRole }>;
}

interface HistoricalQualityPlan {
  corpusVersion: string;
  network: { id: string; title: string; prompt: string };
  participants: HistoricalQualityPlanParticipant[];
  cases: HistoricalQualityPlanCase[];
  seedProjection: {
    memberships: Array<{ networkId: string; userId: string }>;
    intents: Array<{ id: string; userId: string; text: string }>;
    intentNetworkAssignments: Array<{ networkId: string; intentId: string }>;
    premises: Array<{ id: string; participantId: string; userId: string; intentId: string; text: string; sourcePath: string }>;
    contexts: Array<{ id: string; participantId: string; userId: string; text: string; sourcePaths: string[] }>;
  };
}

interface HistoricalQualityMetric {
  participantId: string;
  role: HistoricalQualityCandidateRole;
  retrieval: null | { rank: number; bestScore: number; evidenceIds: string[]; evidenceTypes: HistoricalQualityEvidenceType[] };
  evaluator: { eligible: boolean; submitted: boolean; returned: boolean; score: number | null; errorClass?: string };
  finalRank: number | null;
  failureStage: string;
}

interface HistoricalExecutionAuthorities {
  plan: HistoricalQualityPlan;
  approvedFingerprints: {
    corpusVersion: string;
    planFingerprint: string;
    seedProjectionFingerprint: string;
    retrievalDocumentFingerprint: string;
  };
  fingerprintCanonicalJson(value: unknown): string;
  dedupeHistoricalRetrieval(rows: readonly HistoricalRetrievalEvidence[]): Array<{ participantId: string }>;
  buildHistoricalParticipantMetrics(input: {
    completed: boolean;
    candidates: ReadonlyArray<{ participantId: string; role: HistoricalQualityCandidateRole }>;
    retrievalEvidence: readonly HistoricalRetrievalEvidence[];
    evaluatorTraces: ReadonlyArray<{
      participantId: string;
      eligible: boolean;
      submitted: boolean;
      returned: boolean;
      score: number | null;
      errorClass?: string;
    }>;
    evaluatedOpportunities: readonly string[];
  }): HistoricalQualityMetric[];
  summarizeHistoricalQualitySlot(input: { completed: boolean; participantMetrics: readonly HistoricalQualityMetric[] }): {
    completed: boolean;
    summary: unknown;
  };
  executeRuns<T>(
    invoke: (context: { signal: AbortSignal }) => Promise<T>,
    runs: number,
    options: {
      caseId: string;
      policy: 'strict';
      maxAttempts: 1;
      retryDelayMs: 0;
      attemptTimeoutMs: number;
      label: string;
      isRetryable: () => false;
    },
  ): Promise<{
    runs: Array<{
      runId: string;
      caseId: string;
      runIndex: number;
      outcome: 'success' | 'failed' | 'cancelled';
      recovered: boolean;
      output?: T;
      attempts: Array<{
        attemptId: string;
        runId: string;
        runIndex: number;
        attemptNumber: number;
        startedAt: string;
        completedAt: string;
        durationMs: number;
        outcome: 'success' | 'failure' | 'timeout' | 'cancelled';
        error?: unknown;
        retryable: boolean;
        backoffMs: number;
      }>;
    }>;
  }>;
  parseTransportRow(value: unknown): Readonly<Record<string, unknown>>;
  parseExecutionRun(value: unknown): Readonly<Record<string, unknown>>;
  parseChildOutput(value: unknown): HistoricalQualityChildOutput;
}

let historicalExecutionAuthoritiesPromise: Promise<HistoricalExecutionAuthorities> | undefined;

async function loadHistoricalExecutionAuthorities(): Promise<HistoricalExecutionAuthorities> {
  historicalExecutionAuthoritiesPromise ??= (async () => {
    const fixtureSpecifier = '../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.shared-pool.fixture.js';
    const metricsSpecifier = '../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.metrics.js';
    const sharedSpecifier = '../../../../packages/protocol/eval/shared/index.js';
    const childOutputSpecifier = '../../../../packages/protocol/eval/discovery-env-matrix/historical-quality.child-output.js';
    const [fixture, metrics, shared, childOutput] = await Promise.all([
      import(fixtureSpecifier), import(metricsSpecifier), import(sharedSpecifier), import(childOutputSpecifier),
    ]);
    return {
      plan: fixture.HISTORICAL_SHARED_POOL_PLAN as HistoricalQualityPlan,
      approvedFingerprints: fixture.HISTORICAL_SHARED_POOL_APPROVAL_RECORD as HistoricalExecutionAuthorities['approvedFingerprints'],
      fingerprintCanonicalJson: shared.fingerprintCanonicalJson as HistoricalExecutionAuthorities['fingerprintCanonicalJson'],
      dedupeHistoricalRetrieval: metrics.dedupeHistoricalRetrieval as HistoricalExecutionAuthorities['dedupeHistoricalRetrieval'],
      buildHistoricalParticipantMetrics: metrics.buildHistoricalParticipantMetrics as HistoricalExecutionAuthorities['buildHistoricalParticipantMetrics'],
      summarizeHistoricalQualitySlot: metrics.summarizeHistoricalQualitySlot as HistoricalExecutionAuthorities['summarizeHistoricalQualitySlot'],
      executeRuns: shared.executeRuns as HistoricalExecutionAuthorities['executeRuns'],
      parseTransportRow: (value) => shared.HistoricalQualityTransportRowSchema.parse(value) as Readonly<Record<string, unknown>>,
      parseExecutionRun: (value) => shared.HistoricalQualityExecutionRunSchema.parse(value) as Readonly<Record<string, unknown>>,
      parseChildOutput: (value) => childOutput.HistoricalQualityChildOutputSchema.parse(value) as HistoricalQualityChildOutput,
    };
  })();
  return historicalExecutionAuthoritiesPromise;
}

interface ResolvedHistoricalQualitySlot {
  case: HistoricalQualityPlanCase;
  source: HistoricalQualityPlanParticipant;
  trigger: HistoricalQualityTrigger;
  repetition: number;
}

async function resolveHistoricalQualitySlot(dispatch: HistoricalQualitySlotDispatch): Promise<ResolvedHistoricalQualitySlot> {
  const authorities = await loadHistoricalExecutionAuthorities();
  const matches: ResolvedHistoricalQualitySlot[] = [];
  for (const qualityCase of authorities.plan.cases) {
    for (const trigger of ['intent', 'enrichment'] as const) {
      for (let repetition = 0; repetition < 200; repetition += 1) {
        const identity = {
          caseId: qualityCase.caseId,
          trigger,
          repetition,
          selectedSide: 'a',
          configurationFingerprint: dispatch.configurationFingerprint,
        } as const;
        if (`hq-slot-${authorities.fingerprintCanonicalJson(identity)}` !== dispatch.slotId) continue;
        const source = authorities.plan.participants.find((participant) => participant.participantId === qualityCase.sourceParticipantId);
        if (!source) throw new Error('Historical quality slot source mapping is invalid');
        matches.push({ case: qualityCase, source, trigger, repetition });
      }
    }
  }
  if (matches.length !== 1) throw new Error('Historical quality slot identity is not an approved planned slot');
  return matches[0]!;
}

export interface HistoricalQualityRestoredStateExpectation {
  readonly fingerprints: {
    readonly corpusVersion: string;
    readonly planFingerprint: string;
    readonly seedProjectionFingerprint: string;
    readonly retrievalDocumentFingerprint: string;
  };
  readonly network: { readonly id: string; readonly title: string; readonly prompt: string };
  readonly source: {
    readonly participantId: string;
    readonly userId: string;
    readonly intent: { readonly id: string; readonly userId: string; readonly text: string };
    readonly membership: { readonly networkId: string; readonly userId: string };
    readonly intentNetworkAssignment: { readonly networkId: string; readonly intentId: string };
    readonly premises: ReadonlyArray<{ readonly id: string; readonly participantId: string; readonly userId: string; readonly intentId: string; readonly text: string; readonly sourcePath: string }>;
    readonly context: { readonly id: string; readonly participantId: string; readonly userId: string; readonly text: string; readonly sourcePaths: readonly string[] };
  };
}

function restoredStateExpectation(
  authorities: HistoricalExecutionAuthorities,
  slot: ResolvedHistoricalQualitySlot,
): HistoricalQualityRestoredStateExpectation {
  const intent = authorities.plan.seedProjection.intents.find((row) => row.id === slot.source.intentId);
  const membership = authorities.plan.seedProjection.memberships.find((row) =>
    row.networkId === authorities.plan.network.id && row.userId === slot.source.userId);
  const assignment = authorities.plan.seedProjection.intentNetworkAssignments.find((row) =>
    row.networkId === authorities.plan.network.id && row.intentId === slot.source.intentId);
  const premises = authorities.plan.seedProjection.premises.filter((row) => slot.source.premiseIds.includes(row.id));
  const context = authorities.plan.seedProjection.contexts.find((row) => row.id === slot.source.contextId);
  if (!intent || !membership || !assignment || premises.length !== slot.source.premiseIds.length || !context) {
    throw new Error('Historical quality source fixture mapping is incomplete');
  }
  return Object.freeze({
    fingerprints: Object.freeze({
      corpusVersion: authorities.approvedFingerprints.corpusVersion,
      planFingerprint: authorities.approvedFingerprints.planFingerprint,
      seedProjectionFingerprint: authorities.approvedFingerprints.seedProjectionFingerprint,
      retrievalDocumentFingerprint: authorities.approvedFingerprints.retrievalDocumentFingerprint,
    }),
    network: Object.freeze({ ...authorities.plan.network }),
    source: Object.freeze({
      participantId: slot.source.participantId,
      userId: slot.source.userId,
      intent: Object.freeze({ ...intent }),
      membership: Object.freeze({ ...membership }),
      intentNetworkAssignment: Object.freeze({ ...assignment }),
      premises: Object.freeze(premises.map((row) => Object.freeze({ ...row }))),
      context: Object.freeze({ ...context, sourcePaths: Object.freeze([...context.sourcePaths]) }),
    }),
  });
}

interface PersistedHistoricalQualityIntent {
  id?: unknown;
  userId?: unknown;
  payload?: unknown;
  summary?: unknown;
  sourceType?: unknown;
  sourceId?: unknown;
  status?: unknown;
  isIncognito?: unknown;
  archivedAt?: unknown;
  embedding?: unknown;
}

function assertExactRestoredSourceIntent(
  value: unknown,
  expected: HistoricalQualityRestoredStateExpectation['source']['intent'],
): asserts value is PersistedHistoricalQualityIntent & { payload: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Historical quality restored source intent is missing');
  }
  const intent = value as PersistedHistoricalQualityIntent;
  if (intent.id !== expected.id || intent.userId !== expected.userId || intent.payload !== expected.text
    || intent.summary !== expected.text || intent.sourceType !== 'discovery_form' || intent.sourceId !== expected.userId
    || intent.status !== 'ACTIVE' || intent.isIncognito !== false || intent.archivedAt !== null
    || intent.embedding !== undefined) {
    throw new Error('Historical quality restored source intent ownership or lifecycle mismatch');
  }
}

interface HistoricalRetrievalEvidence {
  participantId: string;
  score: number;
  evidenceType: HistoricalQualityEvidenceType;
  evidenceId: string;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} is invalid`);
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`${label} must be finite`);
  return value;
}

/** Projects only stable IDs and finite scalars from the production graph state. */
export async function projectHistoricalQualityGraphResult(input: {
  dispatch: HistoricalQualitySlotDispatch;
  result: unknown;
}): Promise<HistoricalQualityMetric[]> {
  const authorities = await loadHistoricalExecutionAuthorities();
  const slot = await resolveHistoricalQualitySlot(input.dispatch);
  const result = asRecord(input.result, 'Historical quality graph result');
  if (result.error !== undefined && result.error !== null && result.error !== '') {
    throw new Error('Historical quality graph returned a terminal error');
  }
  if (!Array.isArray(result.candidates) || !Array.isArray(result.trace) || !Array.isArray(result.evaluatedOpportunities)) {
    throw new Error('Historical quality graph result is missing projection state');
  }

  const participantByUserId = new Map(authorities.plan.participants.map((participant) => [participant.userId, participant]));
  const plannedCandidates = new Map(slot.case.candidates.map((candidate) => [candidate.participantId, candidate]));
  const retrievalEvidence: HistoricalRetrievalEvidence[] = [];
  for (const rawCandidate of result.candidates) {
    const candidate = asRecord(rawCandidate, 'Historical quality retrieval candidate');
    const participant = typeof candidate.candidateUserId === 'string' ? participantByUserId.get(candidate.candidateUserId) : undefined;
    if (!participant || participant.participantId === slot.source.participantId || !plannedCandidates.has(participant.participantId)) {
      throw new Error('Historical quality retrieval contains an unknown or source candidate');
    }
    if (candidate.networkId !== authorities.plan.network.id) {
      throw new Error('Historical quality retrieval candidate is outside the exact shared network');
    }
    const score = finiteNumber(candidate.similarity, 'Historical quality retrieval similarity');
    const evidence: Array<[HistoricalQualityEvidenceType, unknown, readonly string[]]> = [
      ['intent', candidate.candidateIntentId, [participant.intentId]],
      ['premise', candidate.candidatePremiseId, participant.premiseIds],
      ['user_context', candidate.candidateContextId, [participant.contextId]],
    ];
    let evidenceCount = 0;
    for (const [evidenceType, evidenceId, plannedIds] of evidence) {
      if (evidenceId === undefined || evidenceId === null) continue;
      if (typeof evidenceId !== 'string' || !plannedIds.includes(evidenceId)) {
        throw new Error('Historical quality retrieval contains an unplanned evidence ID');
      }
      evidenceCount += 1;
      retrievalEvidence.push({ participantId: participant.participantId, score, evidenceType, evidenceId });
    }
    if (evidenceCount === 0) throw new Error('Historical quality eligible candidate has no planned retrieval evidence');
  }
  const retrieved = authorities.dedupeHistoricalRetrieval(retrievalEvidence);
  const eligibleIds = new Set(retrieved.map((row) => row.participantId));

  const traceByParticipant = new Map<string, { score: number | null; errorClass?: string }>();
  const failedParticipants = new Set<string>();
  for (const rawTrace of result.trace) {
    const trace = asRecord(rawTrace, 'Historical quality evaluator trace');
    if (trace.node === 'evaluation_errors') {
      const data = asRecord(trace.data, 'Historical quality evaluator failure trace data');
      if (!Array.isArray(data.errors)) throw new Error('Historical quality evaluator failure trace is invalid');
      for (const rawFailure of data.errors) {
        const failure = asRecord(rawFailure, 'Historical quality evaluator candidate failure');
        const participant = typeof failure.candidateUserId === 'string' ? participantByUserId.get(failure.candidateUserId) : undefined;
        if (!participant || !plannedCandidates.has(participant.participantId)) {
          throw new Error('Historical quality evaluator failure contains an unknown candidate');
        }
        failedParticipants.add(participant.participantId);
      }
      continue;
    }
    if (trace.node !== 'candidate') continue;
    const data = asRecord(trace.data, 'Historical quality candidate trace data');
    const participant = typeof data.userId === 'string' ? participantByUserId.get(data.userId) : undefined;
    if (!participant || participant.participantId === slot.source.participantId || !plannedCandidates.has(participant.participantId)) {
      throw new Error('Historical quality evaluator trace contains an unknown or source candidate');
    }
    if (traceByParticipant.has(participant.participantId)) {
      throw new Error('Historical quality evaluator trace contains a duplicate candidate');
    }
    const score = data.score === undefined ? null : finiteNumber(data.score, 'Historical quality evaluator score');
    traceByParticipant.set(participant.participantId, { score });
  }
  for (const participantId of failedParticipants) {
    const prior = traceByParticipant.get(participantId);
    if (prior?.score !== null && prior?.score !== undefined) {
      throw new Error('Historical quality evaluator candidate both failed and returned');
    }
    traceByParticipant.set(participantId, { score: null, errorClass: 'evaluator_failure' });
  }

  const finalOrder: string[] = [];
  const finalIds = new Set<string>();
  for (const rawOpportunity of result.evaluatedOpportunities) {
    const opportunity = asRecord(rawOpportunity, 'Historical quality thresholded opportunity');
    const finalScore = finiteNumber(opportunity.score, 'Historical quality final evaluator score');
    if (!Array.isArray(opportunity.actors)) throw new Error('Historical quality final opportunity actors are invalid');
    const actors = opportunity.actors.map((actor) => asRecord(actor, 'Historical quality final opportunity actor'));
    const sourceActors = actors.filter((actor) => actor.userId === slot.source.userId);
    const counterparts = actors.filter((actor) => actor.userId !== slot.source.userId);
    if (sourceActors.length !== 1 || counterparts.length !== 1
      || actors.some((actor) => actor.networkId !== authorities.plan.network.id)) {
      throw new Error('Historical quality final opportunity has invalid source/network actors');
    }
    const participant = typeof counterparts[0]!.userId === 'string' ? participantByUserId.get(counterparts[0]!.userId) : undefined;
    if (!participant || !plannedCandidates.has(participant.participantId)) {
      throw new Error('Historical quality final opportunity contains an unknown counterpart');
    }
    if (finalIds.has(participant.participantId)) throw new Error('Historical quality final opportunity duplicates a counterpart');
    if (!eligibleIds.has(participant.participantId)) throw new Error('Historical quality final opportunity is absent from retrieval');
    const trace = traceByParticipant.get(participant.participantId);
    if (!trace || trace.score === null || trace.score !== finalScore) {
      throw new Error('Historical quality final opportunity lacks an exact finite evaluator return');
    }
    finalIds.add(participant.participantId);
    finalOrder.push(participant.participantId);
  }

  const evaluatorTraces = slot.case.candidates.map((candidate) => {
    const trace = traceByParticipant.get(candidate.participantId);
    const eligible = eligibleIds.has(candidate.participantId);
    const submitted = trace !== undefined;
    const returned = trace?.score !== null && trace?.score !== undefined;
    return {
      participantId: candidate.participantId,
      eligible,
      submitted,
      returned,
      score: returned ? trace!.score : null,
      ...(trace?.errorClass === undefined ? {} : { errorClass: trace.errorClass }),
    };
  });
  return authorities.buildHistoricalParticipantMetrics({
    completed: true,
    candidates: slot.case.candidates,
    retrievalEvidence,
    evaluatorTraces,
    evaluatedOpportunities: finalOrder,
  });
}

export const HISTORICAL_QUALITY_ATTEMPT_TIMEOUT_MS = 180_000;

export interface HistoricalQualitySlotExecutionDependencies {
  verifyRestoredState(input: HistoricalQualityRestoredStateExpectation): Promise<unknown>;
  invokeGraph(input: unknown, options: { signal: AbortSignal }): Promise<unknown>;
  withEnvironment?<T>(configuration: Readonly<Record<string, string>>, run: () => Promise<T>): Promise<T>;
}

function qualityTransportCaseId(slot: ResolvedHistoricalQualitySlot): string {
  return `${encodeURIComponent(slot.case.caseId)}/${slot.trigger}/r${slot.repetition + 1}`;
}

function fixedAttemptError(outcome: string): { class: string; message: string } {
  return outcome === 'timeout'
    ? { class: 'historical_quality_timeout', message: 'Historical quality slot timed out' }
    : { class: 'historical_quality_execution_error', message: 'Historical quality slot execution failed' };
}

/** Enforces Task 7's cross-schema one-attempt/completion invariant without redeclaring Task 5's schema. */
export function parseProjectedHistoricalQualityChildOutput(value: unknown): HistoricalQualityChildOutput {
  const output = asRecord(value, 'Historical quality projected child output') as unknown as HistoricalQualityChildOutput;
  const transport = asRecord(output.transportRow, 'Historical quality projected transport row');
  const execution = asRecord(output.executionRun, 'Historical quality projected execution run');
  const attempts = execution.attempts;
  if (!Array.isArray(attempts) || attempts.length !== 1 || execution.recovered !== false) {
    throw new Error('Historical quality projected execution must contain one unrecovered attempt');
  }
  const attempt = asRecord(attempts[0], 'Historical quality projected attempt');
  if (attempt.retryable !== false || attempt.backoffMs !== 0) {
    throw new Error('Historical quality projected execution cannot retry or back off');
  }
  const completed = transport.completed === true;
  if (completed !== (execution.outcome === 'success' && attempt.outcome === 'success')) {
    throw new Error('Historical quality transport completion does not match execution evidence');
  }
  return output;
}

/** Executes exactly one approved slot and emits only canonical sanitized evidence. */
export async function executeHistoricalQualitySlot(input: {
  dispatch: HistoricalQualitySlotDispatch;
  configuration: Readonly<Record<string, string>>;
  dependencies: HistoricalQualitySlotExecutionDependencies;
}): Promise<HistoricalQualityChildOutput> {
  const authorities = await loadHistoricalExecutionAuthorities();
  const slot = await resolveHistoricalQualitySlot(input.dispatch);
  const expected = restoredStateExpectation(authorities, slot);
  const transportCaseId = qualityTransportCaseId(slot);
  const applyEnvironment = input.dependencies.withEnvironment ?? withDiscoveryEnvironment;
  const batch = await authorities.executeRuns(async ({ signal }) => {
    const persistedIntent = await input.dependencies.verifyRestoredState(expected);
    assertExactRestoredSourceIntent(persistedIntent, expected.source.intent);
    const trigger = slot.trigger === 'intent'
      ? buildIntentDiscoveryTrigger({
          userId: slot.source.userId,
          searchQuery: persistedIntent.payload,
          networkIds: [authorities.plan.network.id],
          triggerIntentId: slot.source.intentId,
        })
      : buildEnrichmentDiscoveryTrigger({
          userId: slot.source.userId,
          networkId: authorities.plan.network.id,
        });
    const result = await applyEnvironment(input.configuration, () => input.dependencies.invokeGraph(trigger, { signal }));
    return projectHistoricalQualityGraphResult({ dispatch: input.dispatch, result });
  }, 1, {
    caseId: transportCaseId,
    policy: 'strict',
    maxAttempts: 1,
    retryDelayMs: 0,
    attemptTimeoutMs: HISTORICAL_QUALITY_ATTEMPT_TIMEOUT_MS,
    label: 'historical-quality',
    isRetryable: () => false,
  });
  const run = batch.runs[0];
  if (!run || run.attempts.length !== 1) throw new Error('Historical quality runner violated the one-attempt contract');
  const completed = run.outcome === 'success' && run.output !== undefined;
  const participantMetrics = completed
    ? run.output!
    : authorities.buildHistoricalParticipantMetrics({
        completed: false,
        candidates: slot.case.candidates,
        retrievalEvidence: [],
        evaluatorTraces: slot.case.candidates.map((candidate) => ({
          participantId: candidate.participantId,
          eligible: false,
          submitted: false,
          returned: false,
          score: null,
        })),
        evaluatedOpportunities: [],
      });
  const slotSummary = completed
    ? authorities.summarizeHistoricalQualitySlot({ completed: true, participantMetrics })
    : { completed: false, summary: null };
  if (completed && (!slotSummary.completed || slotSummary.summary === null)) {
    throw new Error('Historical quality completed metrics did not produce a canonical funnel');
  }
  const transportRow = authorities.parseTransportRow({
    kind: 'historical-quality-pilot',
    logicalCaseId: slot.case.caseId,
    trigger: slot.trigger,
    repetition: slot.repetition,
    configurationFingerprint: input.dispatch.configurationFingerprint,
    completed,
    participantMetrics,
    stageFunnel: completed ? slotSummary.summary : null,
  });
  const sourceAttempt = run.attempts[0]!;
  const executionRun = authorities.parseExecutionRun({
    runId: run.runId,
    caseId: run.caseId,
    runIndex: 0,
    outcome: run.outcome,
    recovered: false,
    attempts: [{
      attemptId: sourceAttempt.attemptId,
      runId: sourceAttempt.runId,
      runIndex: 0,
      attemptNumber: 1,
      startedAt: sourceAttempt.startedAt,
      completedAt: sourceAttempt.completedAt,
      durationMs: sourceAttempt.durationMs,
      outcome: sourceAttempt.outcome,
      ...(sourceAttempt.outcome === 'success' ? {} : { error: fixedAttemptError(sourceAttempt.outcome) }),
      retryable: false,
      backoffMs: 0,
    }],
  });
  const output = authorities.parseChildOutput({
    schemaVersion: 1,
    runId: input.dispatch.runId,
    slotId: input.dispatch.slotId,
    configurationId: input.dispatch.configurationId,
    transportRow,
    executionRun,
  });
  return parseProjectedHistoricalQualityChildOutput(output);
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
      return { db: drizzleModule.default, database, embedder, hydeGraph, opportunityGraph };
    },
    executeSlot: async ({ dispatch, configuration, dependencies }) => {
      const constructed = dependencies as {
        db?: DrizzleDB;
        database?: { getIntent(intentId: string): Promise<unknown> };
        opportunityGraph?: { invoke(input: unknown, options?: { signal?: AbortSignal }): Promise<unknown> };
      };
      if (!constructed.db || !constructed.database || !constructed.opportunityGraph) {
        throw new Error('Historical quality production dependencies are incomplete');
      }
      return executeHistoricalQualitySlot({
        dispatch,
        configuration,
        dependencies: {
          // Reuse the exact Task 6 verifier at the last pre-trigger boundary.
          // It checks reviewed fingerprints plus every restored fixture owner,
          // lifecycle, membership, assignment, premise, context and vector row.
          verifyRestoredState: async (expected) => {
            await verifyProductionPublishedState(constructed.db!);
            return constructed.database!.getIntent(expected.source.intent.id);
          },
          invokeGraph: (trigger, options) => constructed.opportunityGraph!.invoke(trigger, { signal: options.signal }),
        },
      });
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
