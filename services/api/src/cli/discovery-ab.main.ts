/**
 * Child half of the discovery A/B harness: one side, one branch, one
 * configuration.
 *
 * This is the matrix child (`runChild` in `discovery-env-matrix.main.ts`) with
 * exactly two differences, and nothing else redesigned: the graph runs inside
 * that side's environment configuration instead of a fixed matrix row, and the
 * slot's `rowId` is the side id rather than a matrix row id. Boundary
 * classification, candidate collection, evaluator projection, judge wiring, the
 * `executeRuns` retry wrapper and the failed-slot fallback are reused verbatim.
 *
 * One process handles exactly one side, because `withDiscoveryEnvironment`
 * mutates the real `process.env`: two configurations applied concurrently in
 * one process would read each other's flags. `executeRuns` runs its slots
 * sequentially, and `selectAbSideSlots` refuses a batch that carries more than
 * one configuration, so no cross-configuration overlap is possible here.
 */
import { expectedBaseMetadata, verifyBaseFixtureIntegrity, verifyProtectedBase } from './discovery-env-matrix-base.main';
import { ATTEMPT_TIMEOUT_MS, MatrixExecutionError, buildMatrixArtifactEvidence, closeChildResources, collectCandidates, collectEvaluatorTraces, composeCaseRuntime, createChildDependencies, databaseCase, loadJudge, loadMatrixEval, projectFinalCandidates, resolveFixtureTriggerIntent, runMatrixBoundary, runWithChildCleanup, sanitizeMatrixError, type MatrixCandidate, type MatrixEvaluatorTrace, type MatrixExecutionEvidence, type MatrixGraphRuntimeInput, type MatrixRetrievalCandidate, type MatrixSlotResult } from './discovery-env-matrix.main';
import { withDiscoveryEnvironment } from './discovery-env-matrix.runtime';
import { baseSeedPayload, type HistoricalMatrixFixture } from './discovery-env-matrix.shared';

import type { AbEnvConfig } from './discovery-ab.flags';
import type { AbSide, AbSideId, AbSlot } from './discovery-ab.plan';

const HARNESS = 'discovery-ab';
/** Identical to the matrix child's graph invocation, and to its policy projection. */
const AB_MIN_SCORE = 50;

/**
 * The evidence types an A/B slot may cite: all of them.
 *
 * This is deliberately a relaxation, and it is not a hidden one. The matrix's
 * `allowed_evidence` assertion asks "did the graph respect *this row's* evidence
 * restriction", which is well defined only because the five `MATRIX_ROWS` were
 * authored together with their `allowedEvidence`. The A/B harness compares two
 * arbitrary operator-chosen configurations, for which no such authored mapping
 * exists; inferring one from the config would fail a 40-minute live run on our
 * guess rather than on the graph's behaviour. So A/B does **not** enforce
 * per-row evidence gating — do not read a passing A/B slot as evidence that a
 * configuration's evidence restriction held. Every other deterministic
 * assertion still applies, including the non-empty evidence check this set
 * preserves (a candidate citing no evidence still fails `missing_evidence`).
 */
export const AB_ALLOWED_EVIDENCE = ['intent', 'premise', 'user_context'] as const;

export type AbConfigDelta = { key: string; before: null; after: string };
export type AbChildOutput = { slots: MatrixSlotResult[]; execution: MatrixExecutionEvidence };
export interface AbSideSelection { side: AbSide; slots: AbSlot[] }

/** What one attempt produced, or the empty outcome of a slot that exhausted its attempts. */
export interface AbSlotOutcome {
  candidates: readonly MatrixCandidate[];
  rawCandidates?: readonly MatrixRetrievalCandidate[];
  evaluatorTraces?: readonly MatrixEvaluatorTrace[];
  completed: boolean;
}

/**
 * The `scoreMatrixSlot` input for one A/B slot, minus the judge callback, plus
 * the `caseId` the child writes over the scored slot afterwards.
 */
export interface AbSlotScoreInput extends AbSlotOutcome {
  caseId: string;
  matrixCase: HistoricalMatrixFixture;
  rowId: AbSideId;
  repetition: number;
  allowedEvidence: typeof AB_ALLOWED_EVIDENCE;
  configDeltas: AbConfigDelta[];
}

/**
 * Repetition is 0-based in the plan and 1-based in the id, matching the matrix
 * harness exactly so the two harnesses' artifacts read the same way.
 */
export function abSlotCaseId(slot: AbSlot): string {
  return `${slot.matrixCase.id}/${slot.side.id}/r${slot.repetition + 1}`;
}

/**
 * Records the side's exact configuration on every slot through the
 * `configDeltas` field `scoreMatrixSlot` already accepts, so each side's
 * configuration reaches the artifact with no schema change. `before` is `null`
 * because the child applies the configuration around the graph call rather than
 * changing an established value. Keys are sorted so two runs of the same
 * configuration produce identical artifacts regardless of flag order.
 */
export function abConfigDeltas(config: AbEnvConfig): AbConfigDelta[] {
  return Object.keys(config).sort().map((key) => ({ key, before: null, after: config[key]! }));
}

/**
 * Builds everything `scoreMatrixSlot` is given for one A/B slot except the judge
 * callback, so the scored path and the failed-slot fallback cannot drift apart.
 *
 * The three A/B-specific fields live here and nowhere else: `rowId` is the side
 * (not a matrix row), `allowedEvidence` is `AB_ALLOWED_EVIDENCE` — without it
 * `scoreMatrixSlot` resolves the row through `rowFor` and throws
 * `Unknown discovery environment matrix row: a` for every candidate-bearing
 * slot — and `configDeltas` records the side's configuration on the artifact,
 * including on a failed slot. `caseId` is returned alongside because the child
 * writes it over the scored slot; `scoreMatrixSlot` itself is not given it.
 */
export function buildAbSlotScoreInput(slot: AbSlot, outcome: AbSlotOutcome): AbSlotScoreInput {
  return {
    caseId: abSlotCaseId(slot),
    matrixCase: databaseCase(slot.matrixCase),
    rowId: slot.side.id,
    repetition: slot.repetition,
    candidates: outcome.candidates,
    ...(outcome.rawCandidates ? { rawCandidates: outcome.rawCandidates } : {}),
    ...(outcome.evaluatorTraces ? { evaluatorTraces: outcome.evaluatorTraces } : {}),
    completed: outcome.completed,
    allowedEvidence: AB_ALLOWED_EVIDENCE,
    configDeltas: abConfigDeltas(slot.side.config),
  };
}

/** Canonical, order-independent identity of a configuration, for comparison only. */
function configIdentity(config: AbEnvConfig): string {
  return JSON.stringify(abConfigDeltas(config).map((delta) => [delta.key, delta.after]));
}

/**
 * Narrows a plan to the slots this child owns and proves it owns exactly one
 * configuration.
 *
 * The single-configuration check is a safety property, not a formality: this
 * process applies its side's configuration to the real `process.env`, so a
 * batch carrying two configurations under one side id would run some slots
 * under a configuration the artifact does not attribute to them.
 */
export function selectAbSideSlots(sideId: AbSideId, slots: readonly AbSlot[]): AbSideSelection {
  const owned = slots.filter((slot) => slot.side.id === sideId);
  if (owned.length === 0) {
    throw new Error(`Discovery A/B child ${sideId} owns no slots`);
  }
  const side = owned[0]!.side;
  const identity = configIdentity(side.config);
  const conflicting = owned.find((slot) => configIdentity(slot.side.config) !== identity);
  if (conflicting) {
    throw new Error(
      `Discovery A/B child ${sideId} was given more than one configuration; one process applies exactly `
      + `one configuration to process.env, so its slots would not all run under the configuration recorded for them`,
    );
  }
  return { side, slots: owned };
}

/** Parses the child invocation contract: `--side a|b --child-output <path>`. */
export function parseAbChildArgs(args: readonly string[]): { sideId: AbSideId; outputPath: string } {
  const valueOf = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const side = valueOf('--side');
  if (side !== 'a' && side !== 'b') {
    throw new Error(`--side must be exactly a or b (received ${side ?? 'nothing'})`);
  }
  const outputPath = valueOf('--child-output');
  if (outputPath === undefined || outputPath.trim() === '' || outputPath.startsWith('--')) {
    throw new Error('--child-output <path> is required for a discovery A/B child invocation');
  }
  return { sideId: side, outputPath };
}

/** Invokes the graph for one slot under that side's configuration. */
export async function invokeAbDiscoveryGraph<T>(
  graph: { invoke(input: { userId: string; networkId: string; triggerIntentId: string; options: { minScore: number } }, config?: { signal?: AbortSignal }): Promise<T> },
  runtime: MatrixGraphRuntimeInput,
  config: AbEnvConfig,
  signal?: AbortSignal,
): Promise<T> {
  return withDiscoveryEnvironment(config, () => graph.invoke({
    userId: runtime.sourceUserId,
    networkId: runtime.networkId,
    triggerIntentId: runtime.triggerIntentId,
    options: { minScore: AB_MIN_SCORE },
  }, signal ? { signal } : undefined));
}

/** Proves this branch still carries the protected base before any graph spend. */
async function verifyAbBranchBase(cases: readonly HistoricalMatrixFixture[]): Promise<void> {
  const expected = await expectedBaseMetadata(cases);
  const childDb = (await import('../lib/drizzle/drizzle')).default;
  const childSchema = await import('../schemas/database.schema');
  await verifyProtectedBase(childDb, childSchema, expected);
  await verifyBaseFixtureIntegrity(childDb, childSchema, baseSeedPayload(cases));
}

/** Runs every slot of one side sequentially against this process's single branch. */
async function runAbSide(
  selection: AbSideSelection,
  deps: Awaited<ReturnType<typeof createChildDependencies>>,
): Promise<AbChildOutput> {
  const { HISTORICAL_MATRIX_CASES, scoreMatrixSlot, buildExecutionEvidence, executeRuns } = await loadMatrixEval();
  const assertLLM = await loadJudge();
  const { side, slots } = selection;
  await verifyAbBranchBase(HISTORICAL_MATRIX_CASES as HistoricalMatrixFixture[]);

  const batch = await executeRuns(async ({ runIndex, signal }: { runIndex: number; signal: AbortSignal }) => runMatrixBoundary('matrix_runtime_failure', async () => {
    const slot = slots[runIndex]!;
    const matrixCase = databaseCase(slot.matrixCase);
    const fixturePayload = baseSeedPayload([slot.matrixCase]);
    const fixtureCase = fixturePayload.cases[0];
    const network = fixturePayload.networks[0];
    if (!network || !fixtureCase) throw new MatrixExecutionError('matrix_runtime_failure');
    const triggerIntentId = resolveFixtureTriggerIntent(fixturePayload, fixtureCase.sourceUserId, network.id);
    const composed = await composeCaseRuntime(deps, matrixCase, network, triggerIntentId);
    const graphResult = await runMatrixBoundary('matrix_graph_failure', async () => invokeAbDiscoveryGraph(
      deps.opportunityGraph as never,
      composed,
      side.config,
      signal,
    )) as Record<string, unknown>;
    if (graphResult.error) throw new MatrixExecutionError('matrix_graph_failure');
    const rawCandidates = collectCandidates(graphResult, new Set(matrixCase.participants.map((participant) => participant.id)));
    const candidates = projectFinalCandidates(graphResult, rawCandidates, fixtureCase.sourceUserId, AB_MIN_SCORE);
    const evaluatorTraces = collectEvaluatorTraces(graphResult, rawCandidates, candidates);
    const { caseId, ...scoreInput } = buildAbSlotScoreInput(slot, { candidates, rawCandidates, evaluatorTraces, completed: true });
    const scored = await runMatrixBoundary('matrix_scoring_failure', async () => scoreMatrixSlot({
      ...scoreInput,
      judge: async (input: { candidateIds: string[]; evidenceTypes: string[]; caseDescription: string; rowId: string; sourceText: string; expectedUserId: string; excludedUserIds: string[] }) => {
        try {
          await runMatrixBoundary('matrix_judge_failure', async () => assertLLM({ candidateIds: input.candidateIds, evidenceTypes: input.evidenceTypes }, [
            'Assess this discovery A/B result.',
            `Case: ${input.caseDescription}`,
            `Side: ${input.rowId}`,
            `Source text: ${input.sourceText}`,
            `Expected target: ${input.expectedUserId}`,
            `Excluded targets: ${input.excludedUserIds.join(', ') || 'none'}`,
            `Returned candidates: ${input.candidateIds.join(', ') || 'none'}`,
            `Evidence types: ${input.evidenceTypes.join(', ') || 'none'}`,
          ].join('\n')));
          return { passed: true };
        } catch (error) {
          return { passed: false, detail: sanitizeMatrixError(error) };
        }
      },
    }));
    return { ...scored, caseId };
  }), slots.length, {
    caseId: `${HARNESS}/${side.id}`,
    policy: 'strict',
    attemptTimeoutMs: ATTEMPT_TIMEOUT_MS,
    label: HARNESS,
  });

  // A slot that exhausted its attempts still produces a scored, failed slot, so
  // completeness accounting stays honest rather than silently losing the slot.
  const scoredSlots: MatrixSlotResult[] = await Promise.all((batch as { runs: Array<{ output?: MatrixSlotResult }> }).runs.map(async (run, index: number) => {
    if (run.output) return run.output;
    const { caseId, ...scoreInput } = buildAbSlotScoreInput(slots[index]!, { candidates: [], completed: false });
    return { ...(await scoreMatrixSlot(scoreInput)), caseId };
  }));
  return buildMatrixArtifactEvidence(
    scoredSlots,
    buildExecutionEvidence([batch]) as MatrixExecutionEvidence,
  );
}

/**
 * Runs one side's slots against the branch this process is composed against and
 * writes `{ slots, execution }` — the same artifact shape the matrix child
 * writes, so the parent aggregates both harnesses' children identically.
 */
export async function runAbChild(sideId: AbSideId, slots: readonly AbSlot[], outputPath: string): Promise<void> {
  const selection = selectAbSideSlots(sideId, slots);
  await runWithChildCleanup(async () => {
    const deps = await createChildDependencies();
    const output = await runAbSide(selection, deps);
    await Bun.write(outputPath, JSON.stringify(output));
    console.log(`Discovery A/B child artifact written: side=${sideId} path=${outputPath}`);
  }, closeChildResources);
}
