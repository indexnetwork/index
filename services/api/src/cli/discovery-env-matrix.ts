#!/usr/bin/env bun
/**
 * Live, operator-attested discovery environment matrix evaluation.
 *
 * Neon branch lifecycle is intentionally outside this command. Operators provide
 * all 15 already-created child URLs in DISCOVERY_ENV_MATRIX_CHILDREN; each child
 * runs in a separate Bun process so the API database singleton is composed
 * against exactly one isolated branch.
 */
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { HydeGenerator, HydeGraphFactory, LensInferrer, OpportunityEvaluator, OpportunityGraphFactory, PremiseGraphFactory, UserContextGenerator, type HydeGraphDatabase, type OpportunityGraphDatabase, type PremiseGraphDatabase } from '@indexnetwork/protocol';

import { baseSeedPayload, type BaseSeedPayload, type HistoricalMatrixFixture } from './discovery-env-matrix.shared';
import { expectedBaseMetadata, verifyProtectedBase } from './discovery-env-matrix-base';
import { MATRIX_REPETITIONS, assertCompleteMatrix, assertMatrixEnvironment, buildCanaryPlan, buildMatrixPlan, parseChildManifest, withMatrixEnvironment, type MatrixChildManifestEntry, type MatrixPlanSlot } from './discovery-env-matrix.runtime';

const RUNS_DIR = path.resolve(import.meta.dir, '../../eval/discovery-env-matrix/runs');
const BASELINE_PATH = path.resolve(import.meta.dir, '../../eval/discovery-env-matrix/baselines/discovery-env-matrix.baseline.json');
const HARNESS = 'discovery-env-matrix';
const HARNESS_VERSION = '1';
const ATTEMPT_TIMEOUT_MS = 180_000;

type DatabaseCase = HistoricalMatrixFixture;
export type MatrixCandidateEvidenceIds = {
  candidateIntentId?: string;
  candidatePremiseId?: string;
  candidateContextId?: string;
};

type MatrixCandidate = {
  id: string;
  /** One-based graph-return order retained in the raw run artifact. */
  rank: number;
  evidenceTypes: Array<'intent' | 'premise' | 'user_context'>;
  evidenceIds: MatrixCandidateEvidenceIds;
  rawText?: string;
};
export type MatrixSlotResult = Record<string, unknown> & {
  caseId: string;
  rule: string;
  rowId: string;
  repetition: number;
  runs: number;
  passes: number;
  passRate: number;
  flaky: boolean;
  scoredRunIds?: string[];
};

type MatrixAttemptEvidence = {
  attemptId: string;
  runId: string;
  runIndex: number;
  attemptNumber: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  outcome: 'success' | 'failure' | 'timeout' | 'cancelled';
  retryable: boolean;
  backoffMs: number;
  error?: unknown;
};

type MatrixRunEvidence = {
  runId: string;
  caseId: string;
  runIndex: number;
  outcome: 'success' | 'failed' | 'cancelled';
  recovered: boolean;
  attempts: MatrixAttemptEvidence[];
};

export type MatrixExecutionEvidence = { policy: 'strict'; runs: MatrixRunEvidence[] };
type ChildOutput = { slots: MatrixSlotResult[]; execution: MatrixExecutionEvidence };

/**
 * Re-keys child-batch evidence to the persisted matrix slot case IDs. The shared
 * v2 artifact schema requires one deterministic run ID per scored case, rather
 * than the child-cohort batch IDs used while executing graph calls.
 */
export function buildMatrixArtifactEvidence(
  slots: MatrixSlotResult[],
  execution: MatrixExecutionEvidence,
): { slots: MatrixSlotResult[]; execution: MatrixExecutionEvidence } {
  if (slots.length !== execution.runs.length) {
    throw new Error('Matrix slot results must align one-to-one with execution evidence');
  }
  const runs = execution.runs.map((run, index) => {
    const slot = slots[index]!;
    const runId = `${encodeURIComponent(slot.caseId)}::run:1`;
    return {
      ...run,
      runId,
      caseId: slot.caseId,
      runIndex: 0,
      attempts: run.attempts.map((attempt, attemptIndex) => ({
        ...attempt,
        runId,
        runIndex: 0,
        attemptNumber: attemptIndex + 1,
        attemptId: `${runId}::attempt:${attemptIndex + 1}`,
      })),
    };
  });
  return {
    slots: slots.map((slot, index) => {
      const run = runs[index]!;
      if (run.outcome === 'success') return { ...slot, scoredRunIds: [run.runId] };
      // Shared v2 artifacts score only terminal-success outputs. A failed or
      // cancelled child slot is retained as execution evidence, not as a run.
      return {
        ...slot,
        runs: 0,
        passes: 0,
        passRate: 0,
        flaky: false,
        passed: false,
        scoredRunIds: [],
      };
    }),
    execution: { ...execution, runs },
  };
}

const protocolEvalPath = (relativePath: string): string => path.resolve(import.meta.dir, '../../../../packages/protocol/eval', relativePath);
const protocolSourcePath = (relativePath: string): string => path.resolve(import.meta.dir, '../../../../packages/protocol/src', relativePath);
// Dynamic paths deliberately keep provider-free API tests from loading eval/API modules.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const loadModule = (modulePath: string): Promise<any> => import(modulePath);

async function loadMatrixEval() {
  const [cases, policy, reporter, shared] = await Promise.all([
    loadModule(protocolEvalPath('discovery-env-matrix/historical-matrix.cases.js')),
    loadModule(protocolEvalPath('discovery-env-matrix/historical-matrix.policy.js')),
    loadModule(protocolEvalPath('discovery-env-matrix/historical-matrix.reporter.js')),
    loadModule(protocolEvalPath('shared/index.js')),
  ]);
  return { ...cases, ...policy, ...reporter, ...shared };
}

async function loadJudge(): Promise<(output: unknown, criteria: string) => Promise<void>> {
  return (await loadModule(protocolSourcePath('shared/agent/tests/llm-assert.js'))).assertLLM;
}

type MatrixRuntimeRow = { id: string; allowedTypes: string; profileSource: string };
type MatrixRuntimePlan = MatrixPlanSlot<HistoricalMatrixFixture, MatrixRuntimeRow>;

export interface MatrixExecutionSelection {
  plan: MatrixRuntimePlan[];
  cases: HistoricalMatrixFixture[];
  canary: boolean;
  caseId?: string;
}

/** Resolves the only supported filtered mode: one case across the five r1 rows. */
export function resolveMatrixExecutionSelection(
  cases: readonly HistoricalMatrixFixture[],
  rows: readonly MatrixRuntimeRow[],
  options: { caseId?: string; canary: boolean; runsRequested: boolean; updateBaseline: boolean },
): MatrixExecutionSelection {
  if (options.runsRequested) throw new Error('--runs is not supported; --canary always runs exactly repetition r1');
  if (options.canary !== Boolean(options.caseId)) {
    throw new Error('--case <id> and --canary must be provided together');
  }
  if (options.canary && options.updateBaseline) {
    throw new Error('--canary is non-baselineable and cannot use --update-baseline');
  }
  if (!options.canary) {
    const fullCases = [...cases];
    return {
      plan: buildMatrixPlan(fullCases, rows, MATRIX_REPETITIONS),
      cases: fullCases,
      canary: false,
    };
  }
  const matrixCase = cases.find((candidate) => candidate.id === options.caseId);
  if (!matrixCase) throw new Error(`Unknown discovery environment matrix case: ${options.caseId}`);
  return {
    plan: buildCanaryPlan(matrixCase, rows),
    cases: [matrixCase],
    canary: true,
    caseId: matrixCase.id,
  };
}

function usage(): string {
  return `Discovery environment matrix eval

Required operator attestation:
  DISCOVERY_ENV_MATRIX_CONFIRM=1
  TEST_DATABASE_SAFE=1
  DISCOVERY_ENV_MATRIX_BASE_BRANCH=eval-discovery-base
  DISCOVERY_ENV_MATRIX_CHILDREN='{"children":[{"childKey":"intent-only-r1","branch":"eval-discovery-env-matrix-…","databaseUrl":"postgres://…neon.tech/protocol_eval","baseBranch":"eval-discovery-base"}, …]}'

Default full-matrix runs require all 15 unique row/repetition children. This command never creates or deletes Neon branches.

Baseline updates require --update-baseline --reason <text> --force (when replacing an existing baseline).

Canary (never baselineable):
  --case <id> --canary  Run exactly one case × five rows × repetition r1.
  This requires exactly five matching row-r1 child entries and rejects --update-baseline.
`;
}

/** Rewrites audit fixture participant IDs to the deterministic IDs seeded in the protected base. */
function databaseCase(matrixCase: HistoricalMatrixFixture): DatabaseCase {
  const seeded = baseSeedPayload([matrixCase]);
  const idsByProfile = new Map(seeded.users.map((user) => [user.intro, user.id]));
  const mapId = (id: string): string => {
    const participant = matrixCase.participants.find((candidate) => candidate.id === id);
    if (!participant) throw new Error(`${matrixCase.id}: missing fixture participant ${id}`);
    const databaseId = idsByProfile.get(participant.profileText);
    if (!databaseId) throw new Error(`${matrixCase.id}: protected-base mapping missing for ${id}`);
    return databaseId;
  };
  return {
    ...matrixCase,
    sourceUserId: mapId(matrixCase.sourceUserId),
    expectedUserId: mapId(matrixCase.expectedUserId),
    excludedUserIds: matrixCase.excludedUserIds.map(mapId),
    participants: matrixCase.participants.map((participant) => ({ ...participant, id: mapId(participant.id) })),
  };
}

/** Finds the seeded source intent and verifies every seeded fixture intent has its network membership. */
export function resolveFixtureTriggerIntent(
  payload: BaseSeedPayload,
  sourceUserId: string,
  networkId: string,
): string {
  const memberships = new Set(payload.memberships.map((membership) => `${membership.userId}\u0000${membership.networkId}`));
  for (const intent of payload.intents) {
    if (!memberships.has(`${intent.userId}\u0000${intent.networkId}`)) {
      throw new Error(`Fixture intent ${intent.id} has no membership in ${intent.networkId}`);
    }
  }
  const sourceIntent = payload.intents.find((intent) => intent.userId === sourceUserId && intent.networkId === networkId);
  if (!sourceIntent) throw new Error(`Fixture source user ${sourceUserId} has no intent in ${networkId}`);
  return sourceIntent.id;
}

export interface MatrixGraphRuntimeInput {
  sourceUserId: string;
  networkId: string;
  triggerIntentId: string;
}

/** Provider-free seam around the exact graph invocation used by every matrix slot. */
export async function invokeMatrixDiscoveryGraph<T>(
  graph: { invoke(input: { userId: string; networkId: string; triggerIntentId: string; options: { minScore: number } }): Promise<T> },
  runtime: MatrixGraphRuntimeInput,
  row: { id: string; allowedTypes: string; profileSource: string },
): Promise<T> {
  return withMatrixEnvironment(row, () => graph.invoke({
    userId: runtime.sourceUserId,
    networkId: runtime.networkId,
    triggerIntentId: runtime.triggerIntentId,
    options: { minScore: 50 },
  }));
}

function evidenceTypes(candidate: Record<string, unknown>): MatrixCandidate['evidenceTypes'] {
  const types = new Set<'intent' | 'premise' | 'user_context'>();
  for (const evidence of Array.isArray(candidate.evidence) ? candidate.evidence : []) {
    const kind = evidence && typeof evidence === 'object' ? (evidence as { kind?: unknown }).kind : undefined;
    if (kind === 'query_intent') types.add('intent');
    if (kind === 'query_premise') types.add('premise');
    if (kind === 'query_context' || kind === 'context_to_intent' || kind === 'profile') types.add('user_context');
  }
  // Retain the graph's concrete evidence identifiers/types even if an older graph
  // omitted the normalized evidence envelope.
  if (typeof candidate.candidateIntentId === 'string') types.add('intent');
  if (typeof candidate.candidatePremiseId === 'string') types.add('premise');
  if (typeof candidate.candidateContextId === 'string') types.add('user_context');
  return [...types];
}

/** Preserves graph evidence IDs/types in the raw run artifact before policy scoring. */
export function collectCandidates(result: Record<string, unknown>, fixtureIds: Set<string>): MatrixCandidate[] {
  const candidates = Array.isArray(result.candidates) ? result.candidates : [];
  return candidates.map((candidate, index) => {
    const value = candidate as Record<string, unknown>;
    const nestedUserId = value.candidate && typeof value.candidate === 'object'
      ? (value.candidate as Record<string, unknown>).userId
      : undefined;
    const id = typeof value.candidateUserId === 'string'
      ? value.candidateUserId
      : typeof value.userId === 'string'
        ? value.userId
        : typeof nestedUserId === 'string'
          ? nestedUserId
          : undefined;
    if (!id) throw new Error(`Graph candidate at rank ${index + 1} is missing a user ID`);
    const evidenceIds: MatrixCandidateEvidenceIds = {
      ...(typeof value.candidateIntentId === 'string' ? { candidateIntentId: value.candidateIntentId } : {}),
      ...(typeof value.candidatePremiseId === 'string' ? { candidatePremiseId: value.candidatePremiseId } : {}),
      ...(typeof value.candidateContextId === 'string' ? { candidateContextId: value.candidateContextId } : {}),
    };
    // Fail closed before the judge: unknown candidates remain visible to the
    // deterministic fixture-ownership assertion and are never normalized away.
    if (!fixtureIds.has(id)) return { id, rank: index + 1, evidenceTypes: evidenceTypes(value), evidenceIds, rawText: typeof value.candidatePayload === 'string' ? value.candidatePayload : undefined };
    return { id, rank: index + 1, evidenceTypes: evidenceTypes(value), evidenceIds, rawText: typeof value.candidatePayload === 'string' ? value.candidatePayload : undefined };
  });
}

async function createChildDependencies() {
  const [adapterModule, embedderModule, cacheModule] = await Promise.all([
    import('../adapters/database.adapter'),
    import('../adapters/embedder.adapter'),
    import('../adapters/cache.adapter'),
  ]);
  const database = new adapterModule.ChatDatabaseAdapter();
  const embedder = new embedderModule.EmbedderAdapter();
  const graphDb = database as unknown as OpportunityGraphDatabase & HydeGraphDatabase & PremiseGraphDatabase;
  const premiseGraph = new PremiseGraphFactory(graphDb, embedder).createGraph();
  const contextGenerator = new UserContextGenerator(embedder);
  const hydeGraph = new HydeGraphFactory(graphDb, embedder, new cacheModule.RedisCacheAdapter(), new LensInferrer(), new HydeGenerator()).createGraph();
  const opportunityGraph = new OpportunityGraphFactory(graphDb, embedder, hydeGraph, new OpportunityEvaluator()).createGraph();
  return { database, premiseGraph, contextGenerator, opportunityGraph };
}

async function composeCaseRuntime(
  deps: Awaited<ReturnType<typeof createChildDependencies>>,
  matrixCase: DatabaseCase,
  network: { id: string; title: string; prompt: string },
  triggerIntentId: string,
): Promise<MatrixGraphRuntimeInput> {
  for (const participant of matrixCase.participants) {
    const premise = await deps.premiseGraph.invoke({
      userId: participant.id,
      assertionText: participant.profileText,
      operationMode: 'create',
      scopeType: 'network',
      scopeId: network.id,
      provenanceSource: 'explicit',
      provenanceSourceId: participant.id,
      provenanceConfidence: 1,
    } as never) as { error?: string };
    if (premise.error) throw new Error(`${matrixCase.id}: premise graph failed: ${premise.error}`);
  }
  for (const participant of matrixCase.participants) {
    const premises = await deps.database.getPremisesForUser(participant.id, 'ACTIVE');
    const context = await deps.contextGenerator.generateColdStart({
      premises: premises.map((premise) => ({ text: premise.assertion.text })),
      networkPrompt: network.prompt,
      networkTitle: network.title,
    });
    await deps.database.upsertUserContext({
      userId: participant.id,
      networkId: network.id,
      text: context.text,
      embedding: context.embedding,
      premiseHash: `discovery-env-matrix:${matrixCase.id}`,
    });
  }
  const memberships = await deps.database.getNetworkMemberships(matrixCase.sourceUserId);
  if (!memberships.some((membership) => membership.networkId === network.id)) {
    throw new Error(`${matrixCase.id}: source fixture user is not a member of ${network.id}`);
  }
  const intentNetworks = await deps.database.getNetworkIdsForIntent(triggerIntentId);
  if (!intentNetworks.includes(network.id)) {
    throw new Error(`${matrixCase.id}: source fixture intent is not assigned to ${network.id}`);
  }
  return { sourceUserId: matrixCase.sourceUserId, networkId: network.id, triggerIntentId };
}

async function runChild(child: MatrixChildManifestEntry, selection: MatrixExecutionSelection): Promise<ChildOutput> {
  const { HISTORICAL_MATRIX_CASES, scoreMatrixSlot, buildExecutionEvidence, executeRuns } = await loadMatrixEval();
  const assertLLM = await loadJudge();
  const plan = selection.plan.filter((slot) => slot.childKey === child.childKey);
  const expectedSlots = selection.canary ? 1 : HISTORICAL_MATRIX_CASES.length;
  if (plan.length !== expectedSlots) {
    throw new Error(`Child ${child.childKey} does not own exactly ${expectedSlots} matrix case slot(s)`);
  }
  const environment = assertMatrixEnvironment(process.env);
  if (environment.databaseUrl.toString() !== new URL(child.databaseUrl).toString() || environment.childBranch !== child.branch) {
    throw new Error(`Child ${child.childKey} environment does not match its declared manifest attestation`);
  }
  const deps = await createChildDependencies();
  const expected = await expectedBaseMetadata(HISTORICAL_MATRIX_CASES);
  await verifyProtectedBase((await import('../lib/drizzle/drizzle')).default, await import('../schemas/database.schema'), expected);

  const batch = await executeRuns(async ({ runIndex }: { runIndex: number }) => {
    const slot = plan[runIndex]!;
    const matrixCase = databaseCase(slot.matrixCase);
    const fixturePayload = baseSeedPayload([slot.matrixCase]);
    const fixtureCase = fixturePayload.cases[0];
    const network = fixturePayload.networks[0];
    if (!network || !fixtureCase) throw new Error(`${slot.matrixCase.id}: missing protected-base network`);
    const triggerIntentId = resolveFixtureTriggerIntent(fixturePayload, fixtureCase.sourceUserId, network.id);
    const composed = await composeCaseRuntime(deps, matrixCase, network, triggerIntentId);
    const graphResult = await invokeMatrixDiscoveryGraph(deps.opportunityGraph as never, composed, slot.row) as Record<string, unknown>;
    if (graphResult.error) throw new Error(`${matrixCase.id}: opportunity graph failed: ${String(graphResult.error)}`);
    const candidates = collectCandidates(graphResult, new Set(matrixCase.participants.map((participant) => participant.id)));
    const scored = await scoreMatrixSlot({
      matrixCase,
      rowId: slot.row.id,
      repetition: slot.repetition,
      candidates,
      completed: true,
      configDeltas: [
        { key: 'DISCOVERY_ALLOWED_TYPES', before: null, after: slot.row.allowedTypes },
        { key: 'DISCOVERY_PROFILE_SOURCE', before: null, after: slot.row.profileSource },
      ],
      judge: async (input: { candidateIds: string[]; evidenceTypes: string[]; caseDescription: string; rowId: string; sourceText: string; expectedUserId: string; excludedUserIds: string[] }) => {
        try {
          await assertLLM({ candidateIds: input.candidateIds, evidenceTypes: input.evidenceTypes }, [
            'Assess this discovery environment matrix result.',
            `Case: ${input.caseDescription}`,
            `Row: ${input.rowId}`,
            `Source text: ${input.sourceText}`,
            `Expected target: ${input.expectedUserId}`,
            `Excluded targets: ${input.excludedUserIds.join(', ') || 'none'}`,
            `Returned candidates: ${input.candidateIds.join(', ') || 'none'}`,
            `Evidence types: ${input.evidenceTypes.join(', ') || 'none'}`,
          ].join('\n'));
          return { passed: true };
        } catch (error) {
          return { passed: false, detail: error instanceof Error ? error.message : String(error) };
        }
      },
    });
    return { ...scored, caseId: `${slot.matrixCase.id}/${slot.row.id}/r${slot.repetition + 1}` };
  }, plan.length, {
    caseId: child.childKey,
    policy: 'strict',
    attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
    label: HARNESS,
  });

  const slots: MatrixSlotResult[] = await Promise.all((batch as { runs: Array<{ output?: MatrixSlotResult }> }).runs.map(async (run, index: number) => run.output ?? {
    ...(await scoreMatrixSlot({
      matrixCase: databaseCase(plan[index]!.matrixCase),
      rowId: plan[index]!.row.id,
      repetition: plan[index]!.repetition,
      candidates: [],
      completed: false,
    })),
    caseId: `${plan[index]!.matrixCase.id}/${plan[index]!.row.id}/r${plan[index]!.repetition + 1}`,
  }));
  const artifactEvidence = buildMatrixArtifactEvidence(
    slots,
    buildExecutionEvidence([batch]) as MatrixExecutionEvidence,
  );
  return artifactEvidence;
}

async function runParent(): Promise<void> {
  if (process.env.DISCOVERY_ENV_MATRIX_CONFIRM !== '1') {
    throw new Error('Refusing to mutate: set DISCOVERY_ENV_MATRIX_CONFIRM=1');
  }
  if (process.env.TEST_DATABASE_SAFE !== '1') {
    throw new Error('Refusing to mutate: set TEST_DATABASE_SAFE=1 only for disposable evaluation children');
  }
  if (process.env.DISCOVERY_ENV_MATRIX_BASE_BRANCH !== 'eval-discovery-base') {
    throw new Error('Refusing to mutate: DISCOVERY_ENV_MATRIX_BASE_BRANCH must be exactly eval-discovery-base');
  }
  const {
    HISTORICAL_MATRIX_CASES, MATRIX_ROWS, leanMatrixScorecard, writeHtmlReport,
    has, flagValue, assertEvalWritePlan, baselineUpdateSummaryPath,
    readEvalGitProvenance, summarizeExecution, buildScorecard, resolveEvalJudgeModelId,
    fingerprintEvalCorpus, buildEvalScoringConfigFingerprint, emptyGovernedComparison,
    compareAgainstGovernedBaseline, governedRegressionCount, governedComparisonExitStatus,
    performGovernedBaselineUpdate, writeBaseline, formatBaselineUpdateSummary,
    writeRunReport, runEvalEvidenceFlow, formatGovernedComparison, formatConsole,
  } = await loadMatrixEval();
  const updateBaseline = has('--update-baseline');
  const selection = resolveMatrixExecutionSelection(
    HISTORICAL_MATRIX_CASES as HistoricalMatrixFixture[],
    MATRIX_ROWS as MatrixRuntimeRow[],
    { caseId: flagValue('--case'), canary: has('--canary'), runsRequested: has('--runs'), updateBaseline },
  );
  const childKeys = [...new Set(selection.plan.map((slot) => slot.childKey))];
  const manifest = parseChildManifest(process.env.DISCOVERY_ENV_MATRIX_CHILDREN, childKeys);
  const reason = flagValue('--reason');
  const force = has('--force');
  const report = has('--report');
  const html = has('--html');
  if (updateBaseline && !reason) throw new Error('--update-baseline requires --reason <operator justification>');
  if (updateBaseline) {
    const baselineExists = await Bun.file(BASELINE_PATH).exists();
    if (baselineExists && !force) throw new Error('--update-baseline requires --force when replacing an existing baseline');
    if (!baselineExists && force) throw new Error('--force is only valid when replacing an existing baseline');
  }
  const git = readEvalGitProvenance(import.meta.dir);
  if (updateBaseline && (git.revision === 'unknown' || git.dirty !== false)) {
    throw new Error('--update-baseline requires a clean, identifiable Git revision');
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runPath = path.resolve(RUNS_DIR, `${stamp}.json`);
  const reportPath = report ? flagValue('--report') ?? runPath : runPath;
  const htmlPath = html ? flagValue('--html') ?? path.resolve(RUNS_DIR, `${stamp}.html`) : undefined;
  await assertEvalWritePlan({
    inputs: [BASELINE_PATH],
    outputs: [
      reportPath,
      ...(htmlPath ? [htmlPath] : []),
      ...(updateBaseline ? [{ path: BASELINE_PATH, updatesInput: true }, { path: baselineUpdateSummaryPath(BASELINE_PATH), updatesInput: true }] : []),
    ],
    force,
  });

  const startedAt = new Date().toISOString();
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'discovery-env-matrix-'));
  try {
    const outputs: ChildOutput[] = [];
    for (const child of manifest.children) {
      const outputPath = path.join(temporaryDirectory, `${child.childKey}.json`);
      const proc = Bun.spawn({
        cmd: [
          process.execPath, import.meta.path, '--child-key', child.childKey, '--child-output', outputPath,
          ...(selection.canary ? ['--case', selection.caseId!, '--canary'] : []),
        ],
        env: { ...process.env, DATABASE_URL: child.databaseUrl, DISCOVERY_ENV_MATRIX_CHILD_BRANCH: child.branch, DISCOVERY_ENV_MATRIX_BASE_BRANCH: child.baseBranch },
        stdout: 'inherit', stderr: 'inherit',
      });
      if (await proc.exited !== 0) throw new Error(`Child ${child.childKey} failed`);
      outputs.push(await Bun.file(outputPath).json() as ChildOutput);
    }
    const slots = outputs.flatMap((output) => output.slots);
    const execution = { policy: 'strict' as const, runs: outputs.flatMap((output) => output.execution.runs) };
    const summary = summarizeExecution(execution);
    const scorecard = buildScorecard(slots, { model: process.env.CHAT_MODEL ?? 'configured runtime models', runs: 1 });
    const meta: Record<string, unknown> = {
      harness: HARNESS,
      harnessVersion: HARNESS_VERSION,
      models: [process.env.CHAT_MODEL ?? 'configured runtime models', resolveEvalJudgeModelId()],
      runs: 1,
      selection: selection.canary
        ? { fullCorpus: false, filters: { case: selection.caseId!, canary: 'true' } }
        : { fullCorpus: true, filters: {} },
      corpusFingerprint: fingerprintEvalCorpus(selection.cases),
      configFingerprint: buildEvalScoringConfigFingerprint({ rows: MATRIX_ROWS, repetitions: selection.canary ? 1 : MATRIX_REPETITIONS, judge: true, canary: selection.canary }),
      git,
      startedAt,
      completedAt: new Date().toISOString(),
      execution,
    };
    const flow = await runEvalEvidenceFlow({
      evidencePolicy: selection.canary ? 'normal' : 'strict',
      execution: summary,
      noComparison: emptyGovernedComparison(),
      compareBaseline: selection.canary
        ? async () => emptyGovernedComparison()
        : () => compareAgainstGovernedBaseline({ scorecard, alpha: 0.05, evidencePolicy: 'strict', meta, execution: summary, baselinePath: BASELINE_PATH, forUpdate: updateBaseline }),
      regressionCount: governedRegressionCount,
      comparisonStatus: selection.canary ? undefined : (comparison: unknown) => governedComparisonExitStatus(comparison, { forUpdate: updateBaseline }),
      updateBaseline: updateBaseline ? async (comparison: unknown) => {
        assertCompleteMatrix({ requested: summary.requestedRuns, completed: summary.completedRuns, failed: summary.failedRuns });
        const baselineScorecard = leanMatrixScorecard(scorecard);
        const result = await performGovernedBaselineUpdate({
          baselinePath: BASELINE_PATH, scorecard: baselineScorecard, meta, execution: summary, reason, force, comparison,
          writeBaselineArtifact: () => writeBaseline(BASELINE_PATH, baselineScorecard, { meta, force }),
        });
        console.log(formatBaselineUpdateSummary(result));
      } : undefined,
      persistDiagnosticReport: () => writeRunReport(reportPath, scorecard, { meta, force }),
    });
    const { regressions, skippedCaseIds } = flow.comparison;
    if (flow.compared && !selection.canary) console.log(formatGovernedComparison(flow.comparison, { fullCorpus: true }));
    console.log(formatConsole(scorecard, regressions, skippedCaseIds, { title: 'Discovery environment matrix scorecard', execution }));
    if (htmlPath) await writeHtmlReport(htmlPath, scorecard, regressions, execution);
    const failedAssertions = slots.some((slot) => slot.passes !== slot.runs);
    process.exitCode = failedAssertions && flow.exitCode === 0 ? 1 : flow.exitCode;
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const { has, arg, flagValue } = await loadMatrixEval();
  if (has('--help') || has('-h')) return void console.log(usage());
  const childKey = arg('--child-key');
  if (childKey) {
    const { HISTORICAL_MATRIX_CASES, MATRIX_ROWS } = await loadMatrixEval();
    const selection = resolveMatrixExecutionSelection(
      HISTORICAL_MATRIX_CASES as HistoricalMatrixFixture[],
      MATRIX_ROWS as MatrixRuntimeRow[],
      { caseId: flagValue('--case'), canary: has('--canary'), runsRequested: has('--runs'), updateBaseline: has('--update-baseline') },
    );
    const manifest = parseChildManifest(process.env.DISCOVERY_ENV_MATRIX_CHILDREN, [...new Set(selection.plan.map((slot) => slot.childKey))]);
    const child = manifest.children.find((entry) => entry.childKey === childKey);
    if (!child) throw new Error(`Unknown matrix child key ${childKey}`);
    const output = await runChild(child, selection);
    const outputPath = flagValue('--child-output');
    if (!outputPath) throw new Error('--child-output is required for a child invocation');
    await Bun.write(outputPath, JSON.stringify(output));
    return;
  }
  await runParent();
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 2;
  });
}
