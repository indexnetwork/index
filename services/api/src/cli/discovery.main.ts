/**
 * The discovery harness: two operator-chosen environment configurations,
 * the same cases, one child process per side, one artifact holding both.
 *
 * The parent gates, attests, resets both branches, spawns the two children and
 * aggregates them. The child half below it runs one side.
 *
 * ── Child half ──────────────────────────────────────────────────────────────
 * One side, one branch, one configuration.
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
import path from 'node:path';
import { statSync } from 'node:fs';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';

import { AB_BASE_BRANCH, AB_DEFAULT_REPETITIONS, AB_EXIT_COMPARISON, AB_EXIT_INSUFFICIENT_EVIDENCE, AB_MAX_REPETITIONS, abUsage, classifyAbParentFailure, type AbRunStage } from './discovery.contract';
import { AB_SIDE_BRANCH_ENV, AbGateError, assertAbConfirmation, assertAbSideEnvironment } from './discovery.gate';
import { AB_BRANCH_NAMES, attestAbTargets, parseAbManifest, resetAbBranch, type AbTarget } from './discovery.neon';
import { buildAbPlan, configDiff } from './discovery.plan';
import { expectedBaseMetadata, verifyBaseFixtureIntegrity, verifyProtectedBase } from './discovery-env-matrix-base.main';
import { ATTEMPT_TIMEOUT_MS, MatrixExecutionError, awaitMatrixChildProcess, buildMatrixArtifactEvidence, closeChildResources, collectCandidates, collectEvaluatorTraces, composeCaseRuntime, createChildDependencies, databaseCase, loadJudge, loadMatrixEval, projectFinalCandidates, resolveFixtureTriggerIntent, runBoundedChildTasks, runMatrixBoundary, runWithChildCleanup, sanitizeMatrixError, type MatrixCandidate, type MatrixEvaluatorTrace, type MatrixExecutionEvidence, type MatrixGraphRuntimeInput, type MatrixRetrievalCandidate, type MatrixSlotResult } from './discovery-env-matrix.main';
import { createNeonControlPlane } from './discovery-env-matrix.neon';
import { withDiscoveryEnvironment } from './discovery-env-matrix.runtime';
import { baseSeedPayload, type HistoricalMatrixFixture } from './discovery-env-matrix.shared';

import type { AbEnvConfig } from './discovery.flags';
import type { AbSide, AbSideId, AbSlot } from './discovery.plan';

const HARNESS = 'discovery';
const HARNESS_VERSION = '1';
const RUNS_DIR = path.resolve(import.meta.dir, '../../eval/discovery/runs');
/** Identical to the matrix child's graph invocation, and to its policy projection. */
const AB_MIN_SCORE = 50;

/**
 * The evidence types an A/B slot may cite: all of them.
 *
 * This is deliberately a relaxation, and it is not a hidden one. The matrix's
 * `allowed_evidence` assertion asks "did the graph respect *this row's* evidence
 * restriction", which is well defined only because the five `MATRIX_ROWS` were
 * authored together with their `allowedEvidence`. The discovery harness compares two
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
    throw new Error(`Discovery child ${sideId} owns no slots`);
  }
  const side = owned[0]!.side;
  const identity = configIdentity(side.config);
  const conflicting = owned.find((slot) => configIdentity(slot.side.config) !== identity);
  if (conflicting) {
    throw new Error(
      `Discovery child ${sideId} was given more than one configuration; one process applies exactly `
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
    throw new Error('--child-output <path> is required for a discovery child invocation');
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
            'Assess this discovery result.',
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
    console.log(`Discovery child artifact written: side=${sideId} path=${outputPath}`);
  }, closeChildResources);
}

// ── Parent half ─────────────────────────────────────────────────────────────
// Gate, attest, reset both branches, spawn one child per side, aggregate.

/**
 * The operator-facing contract — the repetition bounds and the exit codes —
 * lives in `discovery.contract.ts`, so the bootstrap can print and act on it
 * without importing anything that composes a database. These three are
 * re-exported because they are read as properties of the parent run.
 */
export { AB_DEFAULT_REPETITIONS, AB_EXIT_INSUFFICIENT_EVIDENCE, AB_MAX_REPETITIONS };

/** `executeRuns` gives each slot three attempts, each bounded by ATTEMPT_TIMEOUT_MS. */
const AB_ATTEMPTS_PER_SLOT = 3;
/** The 1s + 2s retry backoff `executeRuns` inserts between those attempts. */
const AB_SLOT_BACKOFF_MS = 3_000;
/** Bounded headroom for child startup, base verification and cleanup. */
const AB_CHILD_STARTUP_HEADROOM_MS = 5 * 60_000;
/** Two sides, two isolated branches, two processes: they never wait on each other. */
const AB_CHILD_CONCURRENCY = 2;
/** How long a sibling gets to honour SIGTERM before it is killed, matching the matrix. */
const AB_CHILD_TERMINATION_GRACE_MS = 5_000;

/**
 * The watchdog for one side, derived from what that side may legitimately take
 * rather than from a fixed number: a side owns every case × repetition slot, and
 * `executeRuns` runs them sequentially.
 */
export function abChildTimeoutMs(slotsPerSide: number): number {
  if (!Number.isInteger(slotsPerSide) || slotsPerSide < 1) {
    throw new Error(`A discovery side must own at least one slot (received ${slotsPerSide})`);
  }
  return slotsPerSide * (AB_ATTEMPTS_PER_SLOT * ATTEMPT_TIMEOUT_MS + AB_SLOT_BACKOFF_MS) + AB_CHILD_STARTUP_HEADROOM_MS;
}

/** What the operator asked for: shared selection, per-side configuration. */
export interface AbRunSelection {
  /** Empty means the full corpus. */
  caseIds: string[];
  repetitions: number;
  sides: [AbSide, AbSide];
  force: boolean;
  /**
   * Where the run report must be written, absolute. Absent means this run names
   * its own timestamped path under `RUNS_DIR`, which is the operator default;
   * a caller that has to find the artifact afterwards (the eval-ops site stores
   * every run at a path it chose) passes `--report`.
   */
  reportPath?: string;
}

const AB_ENV_ASSIGNMENT = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

/** Every value given to a repeatable flag, refusing a flag left without one. */
function collectFlagValues(args: readonly string[], flag: string): string[] {
  const values: string[] = [];
  for (const [index, value] of args.entries()) {
    if (value !== flag) continue;
    const next = args[index + 1];
    if (next === undefined || next.startsWith('--')) throw new Error(`${flag} requires a value`);
    values.push(next);
  }
  return values;
}

/**
 * One side's configuration, built through a Map so a key like `__proto__`
 * cannot reach an object prototype. Which keys are legal is not decided here:
 * `buildAbPlan` asserts them against `AB_FLAGS`, and duplicating that list at
 * the CLI is exactly the drift this harness exists to prevent.
 */
function parseAbSideConfig(args: readonly string[], flag: string, sideId: AbSideId): AbEnvConfig {
  const config = new Map<string, string>();
  for (const assignment of collectFlagValues(args, flag)) {
    const match = AB_ENV_ASSIGNMENT.exec(assignment);
    if (!match) throw new Error(`${flag} expects KEY=VALUE (received ${assignment})`);
    const [, key, value] = match as unknown as [string, string, string];
    if (config.has(key)) throw new Error(`${flag} sets ${key} twice; a side has exactly one value per flag`);
    config.set(key, value);
  }
  if (config.size === 0) {
    throw new Error(`Side ${sideId} has no configuration; pass at least one ${flag} KEY=VALUE`);
  }
  return Object.fromEntries(config);
}

/**
 * The artifact destination `--report` names, resolved to an absolute path.
 *
 * Resolved here, against the working directory the operator typed the flag in,
 * because the write happens later in a process whose relative paths would
 * otherwise be read against whatever `RUNS_DIR` sits under. At most one is
 * accepted: a run writes exactly one report, so two destinations name a
 * mistake rather than a choice.
 *
 * An existing *directory* is refused here rather than left to the write plan,
 * which only asks whether the path exists as a file: `Bun.file(dir).exists()`
 * is false for a directory, so a mistyped destination would pass pre-flight and
 * fail at the write — after both branches were reset and both sides ran, which
 * is a code-4 spend report for a typo. Refusing at parse time keeps it in the
 * code-2 path the contract promises: nothing reset, nothing spawned, nothing
 * spent.
 */
function parseAbReportPath(args: readonly string[]): string | undefined {
  const reports = collectFlagValues(args, '--report');
  if (reports.length > 1) throw new Error('--report may be given at most once; a run writes exactly one report');
  const raw = reports[0];
  if (raw === undefined) return undefined;
  if (raw.trim() === '') throw new Error('--report requires a value');
  const resolved = path.resolve(raw);
  if (statSync(resolved, { throwIfNoEntry: false })?.isDirectory() === true) {
    throw new Error(`--report must name a file to write, but ${resolved} is an existing directory`);
  }
  return resolved;
}

/**
 * Where this run's report is written: the destination `--report` named, or the
 * timestamped default under `RUNS_DIR`.
 *
 * A one-line choice, but the only line that makes `--report` do anything, so it
 * is exported and tested on both branches rather than buried in `runAbComparison`
 * where nothing but a live run could reach it. Whichever it returns is the sole
 * output declared to the write plan, so `--force` guards both alike.
 */
export function abRunReportPath(selection: { reportPath?: string }, stamp: string): string {
  return selection.reportPath ?? path.resolve(RUNS_DIR, `${stamp}.json`);
}

/** Parses the operator's run contract: `--case <id>* --runs <n> --a K=V* --b K=V* [--report <path>] [--force]`. */
export function parseAbRunArgs(args: readonly string[]): AbRunSelection {
  const caseIds = collectFlagValues(args, '--case');
  if (new Set(caseIds).size !== caseIds.length) throw new Error('--case names the same case twice');
  const runs = collectFlagValues(args, '--runs');
  if (runs.length > 1) throw new Error('--runs may be given at most once; both sides share one repetition count');
  const raw = runs[0];
  if (raw !== undefined && !/^[1-9]\d*$/.test(raw)) {
    throw new Error(`--runs must be a positive integer (received ${raw})`);
  }
  const repetitions = raw === undefined ? AB_DEFAULT_REPETITIONS : Number(raw);
  if (repetitions > AB_MAX_REPETITIONS) {
    throw new Error(`--runs must not exceed ${AB_MAX_REPETITIONS}; ${repetitions} repetitions is hours of live graph invocations`);
  }
  const reportPath = parseAbReportPath(args);
  return {
    caseIds,
    repetitions,
    sides: [
      { id: 'a', config: parseAbSideConfig(args, '--a', 'a') },
      { id: 'b', config: parseAbSideConfig(args, '--b', 'b') },
    ],
    force: args.includes('--force'),
    ...(reportPath === undefined ? {} : { reportPath }),
  };
}

/**
 * Re-serializes the selection for the child invocation.
 *
 * The children are handed this rather than the parent's own argv so both sides
 * plan from one normalized input: `buildAbPlan` is pure, so identical arguments
 * produce identical plans, and a side cannot silently run a different
 * selection. `--force` and `--report` are deliberately not forwarded — only the
 * parent writes the run report; a child writes the `--child-output` it is
 * given.
 */
export function formatAbRunArgs(selection: AbRunSelection): string[] {
  return [
    ...selection.caseIds.flatMap((caseId) => ['--case', caseId]),
    '--runs', String(selection.repetitions),
    ...abConfigDeltas(selection.sides[0].config).flatMap((delta) => ['--a', `${delta.key}=${delta.after}`]),
    ...abConfigDeltas(selection.sides[1].config).flatMap((delta) => ['--b', `${delta.key}=${delta.after}`]),
  ];
}

/** Resolves the shared case selection, in the order the operator named it. */
export function resolveAbCases(
  cases: readonly HistoricalMatrixFixture[],
  caseIds: readonly string[],
): HistoricalMatrixFixture[] {
  if (caseIds.length === 0) return [...cases];
  return caseIds.map((caseId) => {
    const matrixCase = cases.find((candidate) => candidate.id === caseId);
    if (!matrixCase) throw new Error(`Unknown discovery case: ${caseId}`);
    return matrixCase;
  });
}

/** The artifact's selection filters; an empty set is what makes a run full-corpus. */
export function abSelectionFilters(caseIds: readonly string[]): Record<string, string> {
  return caseIds.length === 0 ? {} : { case: [...caseIds].join(',') };
}

export interface AbArtifactMetaInput {
  sides: readonly [AbSide, AbSide];
  cases: readonly HistoricalMatrixFixture[];
  repetitions: number;
  startedAt: string;
  git: unknown;
  /** Absent or empty means the run covered the full corpus. */
  filters?: Readonly<Record<string, string>>;
}

/**
 * The run's own description of itself: what was compared, over what corpus,
 * under what scoring configuration.
 *
 * Deliberately no `baselinePath` and no comparison of any kind. Two arbitrary
 * operator-chosen configurations have no committed baseline and never will, so
 * the pair is the result; a harness that quietly grew one would be claiming a
 * regression verdict it has no evidence for.
 *
 * Asynchronous because the corpus and scoring fingerprints are the shared eval
 * library's, and this package can only reach that library through the dynamic
 * `loadMatrixEval` seam — a static cross-package import would violate the API
 * package's `rootDir`. Recomputing either fingerprint here instead would be a
 * second implementation of a value whose entire purpose is to match.
 */
export async function buildAbArtifactMeta(input: AbArtifactMetaInput): Promise<Record<string, unknown>> {
  const { fingerprintEvalCorpus, buildEvalScoringConfigFingerprint, resolveEvalJudgeModelId } = await loadMatrixEval();
  const filters = { ...(input.filters ?? {}) };
  return {
    harness: HARNESS,
    harnessVersion: HARNESS_VERSION,
    // De-duplicated because the envelope refuses repeated model IDs, and the
    // runtime and judge models are configured independently.
    models: [...new Set([process.env.CHAT_MODEL ?? 'configured runtime models', resolveEvalJudgeModelId() as string])],
    runs: 1,
    selection: { fullCorpus: Object.keys(filters).length === 0, filters },
    configs: { a: { ...input.sides[0].config }, b: { ...input.sides[1].config } },
    configDiff: configDiff(input.sides[0].config, input.sides[1].config),
    corpusFingerprint: fingerprintEvalCorpus(input.cases) as string,
    // The two configurations and the repetition count go through
    // `scorerConfig`, which is the only field `buildEvalScoringConfigFingerprint`
    // actually hashes beyond the judge toggle and judge model; passing them as
    // top-level options (as the matrix harness does) drops them silently and
    // would give every pair of configurations the same fingerprint.
    configFingerprint: buildEvalScoringConfigFingerprint({
      judge: true,
      scorerConfig: {
        sides: input.sides.map((side) => ({ ...side.config })),
        repetitions: input.repetitions,
      },
    }) as string,
    git: input.git,
    startedAt: input.startedAt,
  };
}

/**
 * The subset of the A/B meta the governed envelope accepts.
 *
 * Structural mirror of the shared library's `EvalRunMeta`, restated for the
 * same reason `buildAbArtifactMeta` is asynchronous: the eval bundle is only
 * reachable through a dynamic import, so its types cannot be imported here.
 */
export interface AbGovernedRunMeta {
  harness: string;
  harnessVersion: string;
  models: string[];
  runs: number;
  selection: { fullCorpus: boolean; filters: Record<string, string> };
  corpusFingerprint: string;
  configFingerprint: string;
  git: unknown;
  startedAt: string;
  completedAt: string;
  execution: MatrixExecutionEvidence;
}

function metaString(meta: Record<string, unknown>, key: string): string {
  const value = meta[key];
  if (typeof value !== 'string' || value === '') throw new Error(`Discovery meta ${key} must be a non-empty string`);
  return value;
}

/**
 * Projects the A/B meta onto what the governed artifact envelope will accept.
 *
 * `configs` and `configDiff` are intentionally **not** written to the artifact.
 * The shared envelope and scorecard payload schemas are both `.strict()`
 * (`packages/protocol/eval/shared/artifact.ts`), so a run-level configuration
 * block has no legal home in them, and widening a contract shared by every
 * harness and every committed baseline to carry a convenience copy is a bad
 * trade.
 *
 * Nothing is lost. Each case row carries `configDeltas` naming that side's
 * complete configuration — the case schema is the sanctioned `.passthrough()`
 * extension point — so the artifact can always answer "what was A and what was
 * B"; the run-level pair is a rollup of those rows, derivable by grouping them
 * by rule. `assertAbConfigProvenance` is what keeps that derivation true, and
 * the diff is printed to the console so an operator never has to derive it by
 * hand.
 */
export function toGovernedRunMeta(
  meta: Record<string, unknown>,
  input: { completedAt: string; execution: MatrixExecutionEvidence },
): AbGovernedRunMeta {
  const selection = meta.selection;
  if (!selection || typeof selection !== 'object' || typeof (selection as { fullCorpus?: unknown }).fullCorpus !== 'boolean') {
    throw new Error('Discovery meta selection must record fullCorpus and its filters');
  }
  const models = meta.models;
  if (!Array.isArray(models) || models.length === 0 || models.some((model) => typeof model !== 'string')) {
    throw new Error('Discovery meta models must be a non-empty list of model IDs');
  }
  if (typeof meta.runs !== 'number') throw new Error('Discovery meta runs must be a number');
  return {
    harness: metaString(meta, 'harness'),
    harnessVersion: metaString(meta, 'harnessVersion'),
    models: models as string[],
    runs: meta.runs,
    selection: selection as AbGovernedRunMeta['selection'],
    corpusFingerprint: metaString(meta, 'corpusFingerprint'),
    configFingerprint: metaString(meta, 'configFingerprint'),
    git: meta.git,
    startedAt: metaString(meta, 'startedAt'),
    completedAt: input.completedAt,
    execution: input.execution,
  };
}

/** Renders the two configurations and their difference for the console. */
export function formatAbConfigDiff(meta: Record<string, unknown>): string {
  const diff = meta.configDiff;
  if (!Array.isArray(diff) || diff.length === 0) return 'Discovery compared two configurations with no recorded difference';
  const rows = diff.map((entry) => {
    const { key, a, b } = entry as { key: string; a: string | null; b: string | null };
    return `  ${key}: a=${a ?? 'unset'}  b=${b ?? 'unset'}`;
  });
  return ['Discovery configuration difference:', ...rows].join('\n');
}

/**
 * Proves every aggregated slot still names its side's complete configuration.
 *
 * This is load-bearing rather than defensive. Per-case `configDeltas` is the
 * only on-disk record of what each side was (see `toGovernedRunMeta`), so if
 * the child ever stops attaching it — or attaches the wrong side's — the
 * artifact would report that A beat B while omitting what A and B were, and
 * nothing else would notice. The parent refuses to write that artifact.
 */
export function assertAbConfigProvenance(
  slots: readonly MatrixSlotResult[],
  sides: readonly [AbSide, AbSide],
): void {
  const expected = new Map(sides.map((side) => [side.id as string, JSON.stringify(abConfigDeltas(side.config))]));
  for (const slot of slots) {
    const wanted = expected.get(slot.rowId);
    if (wanted === undefined) {
      throw new Error(`Discovery slot ${slot.caseId} names side ${slot.rowId}, which this run did not compare`);
    }
    if (JSON.stringify(slot.configDeltas ?? null) !== wanted) {
      throw new Error(
        `Discovery slot ${slot.caseId} does not record side ${slot.rowId}'s configuration; `
        + 'the artifact would report a comparison without saying what was compared',
      );
    }
  }
}

export interface AbSideCompleteness {
  sideId: AbSideId;
  expected: number;
  produced: number;
  scored: number;
  failed: number;
  passes: number;
  complete: boolean;
}

export interface AbRunOutcome {
  sides: AbSideCompleteness[];
  incompleteSides: AbSideId[];
  /** Null whenever either side is incomplete: half a comparison is not a comparison. */
  verdict: Array<{ sideId: AbSideId; passes: number; runs: number; passRate: number }> | null;
  exitCode: number;
  summary: string;
}

/**
 * Decides whether this run produced a comparison at all.
 *
 * A side is complete only when it returned every slot it was planned and every
 * one of them was scored; a slot that exhausted its attempts comes back with
 * `runs: 0` and is a failure, not a zero. If either side is incomplete the run
 * reports **no verdict** and exits non-zero, naming the side — reporting one
 * side's numbers as though they were a comparison is the specific dishonesty
 * this harness has to avoid.
 */
export function resolveAbRunOutcome(input: {
  slots: readonly MatrixSlotResult[];
  sides: readonly [AbSide, AbSide];
  expectedSlotsPerSide: number;
}): AbRunOutcome {
  const sides = input.sides.map((side): AbSideCompleteness => {
    const owned = input.slots.filter((slot) => slot.rowId === side.id);
    const scored = owned.filter((slot) => slot.runs > 0);
    return {
      sideId: side.id,
      expected: input.expectedSlotsPerSide,
      produced: owned.length,
      scored: scored.length,
      failed: owned.length - scored.length,
      passes: scored.reduce((total, slot) => total + slot.passes, 0),
      complete: owned.length === input.expectedSlotsPerSide && scored.length === owned.length,
    };
  });
  const incompleteSides = sides.filter((side) => !side.complete).map((side) => side.sideId);
  if (incompleteSides.length > 0) {
    const detail = sides
      .filter((side) => !side.complete)
      .map((side) => `side ${side.sideId} scored ${side.scored}/${side.expected} slot(s), ${side.failed} failed`)
      .join('; ');
    return {
      sides,
      incompleteSides,
      verdict: null,
      exitCode: AB_EXIT_INSUFFICIENT_EVIDENCE,
      summary: `Discovery reports no verdict: ${detail}. A comparison with one side missing is not a comparison.`,
    };
  }
  const verdict = sides.map((side) => ({
    sideId: side.sideId,
    passes: side.passes,
    runs: side.scored,
    passRate: side.scored === 0 ? 0 : side.passes / side.scored,
  }));
  return {
    sides,
    incompleteSides,
    verdict,
    exitCode: AB_EXIT_COMPARISON,
    summary: `Discovery result: ${verdict.map((entry) => `side ${entry.sideId} ${entry.passes}/${entry.runs} (${(entry.passRate * 100).toFixed(1)}%)`).join('  vs  ')}`,
  };
}

/** A side's child, described in the shape the shared child supervision reports on. */
function abChildDescriptor(target: AbTarget): { childKey: string; branch: string; databaseUrl: string; baseBranch: string } {
  return {
    childKey: `${HARNESS}/${target.sideId}`,
    branch: AB_BRANCH_NAMES[target.sideId],
    databaseUrl: target.databaseUrl,
    baseBranch: AB_BASE_BRANCH,
  };
}

type AbChildProcess = { exited: Promise<number>; kill(signal?: NodeJS.Signals): void };

/**
 * Cleans up, or reports honestly what was kept.
 *
 * The matrix's `finalizeMatrixChildArtifacts` is not reused because its warning
 * says "Discovery environment matrix retained child artifacts", which names the
 * wrong harness during an A/B run, and because it promises artifacts that are
 * often not there: the failure that retains this directory is usually a dead or
 * timed-out child, which wrote nothing at all. An operator who goes looking for
 * the retained evidence of a forty-minute loss and finds an empty directory has
 * been misled twice. So the directory is read, and the warning says what is
 * actually in it.
 */
export async function finalizeAbChildArtifacts(
  temporaryDirectory: string,
  completedSuccessfully: boolean,
  fs: { readdir: typeof readdir; rm: typeof rm } = { readdir, rm },
  logger: Pick<Console, 'warn'> = console,
): Promise<void> {
  if (completedSuccessfully) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    return;
  }
  const retained = await fs.readdir(temporaryDirectory).catch(() => [] as string[]);
  if (retained.length === 0) {
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    logger.warn('Discovery kept no child artifacts: neither side wrote one before the run failed');
    return;
  }
  logger.warn(
    `Discovery retained ${retained.length} child artifact(s) from a failed run in ${temporaryDirectory}: `
    + `${[...retained].sort().join(', ')}`,
  );
}

/**
 * How far this run has got. It is recorded as the run advances rather than
 * inferred afterwards, because the one thing a failure cannot tell you about
 * itself is whether the money was already spent.
 *
 * Each stage is set at the moment its claim becomes true and not before: the
 * message authored from it is read by an operator deciding whether they just
 * lost forty minutes, so a stage that runs slightly ahead of the run is a
 * message that asserts something that did not happen.
 */
export interface AbRunProgress {
  stage: AbRunStage | null;
  /** Set with the `'written'` stage, so the failure report can name the artifact. */
  artifactPath?: string;
}

/**
 * Runs something that may reset branches and spend money, and turns any failure
 * into a report of what it cost.
 *
 * Everything the operator can act on hangs off this distinction. A failure
 * before the first reset is a refusal: its own message says what to fix and it
 * cost nothing. A failure after it is a loss, and the operator has to be told
 * so rather than left to work out whether "Discovery command failed" meant
 * a typo or forty minutes and two overwritten branches.
 */
export async function withAbSpendAccounting(run: (progress: AbRunProgress) => Promise<void>): Promise<void> {
  const progress: AbRunProgress = { stage: null };
  try {
    await run(progress);
  } catch (error) {
    throw classifyAbParentFailure(progress.stage, error, { artifactPath: progress.artifactPath });
  }
}

/**
 * Gate, attest, reset both branches, run one child per side, aggregate.
 *
 * The bootstrap has already attested these targets before importing this
 * module - that is what keeps the graph and its database singleton unreachable
 * until the branches are proven. This attests them a second time because
 * `resetAbBranch` accepts only the branded `AttestedAbManifest` that
 * `attestAbTargets` produces, and a brand cannot cross a process boundary: the
 * ordering "reset only what you attested" is enforced by the type system rather
 * than by the order two files happen to run in. Six control-plane GETs is a
 * cheap price for that.
 */
async function runAbComparison(args: readonly string[], progress: AbRunProgress): Promise<void> {
  assertAbConfirmation(process.env);
  const apiKey = process.env.NEON_API_KEY ?? '';
  const manifest = parseAbManifest(process.env.DISCOVERY_TARGETS);
  const attested = await attestAbTargets({ manifest, controlPlane: createNeonControlPlane(apiKey) });
  const selection = parseAbRunArgs(args);
  const {
    HISTORICAL_MATRIX_CASES, assertEvalWritePlan, readEvalGitProvenance,
    buildScorecard, writeRunReport, formatConsole,
  } = await loadMatrixEval();
  const cases = resolveAbCases(HISTORICAL_MATRIX_CASES as HistoricalMatrixFixture[], selection.caseIds);
  // Refuses identical, asymmetric and unreachable-flag configurations here,
  // before a single branch is reset or a single graph call is paid for.
  const plan = buildAbPlan(cases, selection.sides, selection.repetitions);
  const slotsPerSide = plan.filter((slot) => slot.side.id === 'a').length;

  // `--report` names the destination; without it the run names its own
  // timestamped path. Either way the plan below is what guards the write, so an
  // existing destination still needs `--force`.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const runPath = abRunReportPath(selection, stamp);
  // No inputs: this harness reads no baseline, so nothing it writes can clobber one.
  await assertEvalWritePlan({ inputs: [], outputs: [runPath], force: selection.force });

  // Reset before, not after: a crashed run leaves dirty branches that the next
  // run cleans, where resetting afterwards leaves a window in which a dirty
  // branch looks clean. Both must succeed before anything is spawned - a
  // half-isolated comparison is not a comparison.
  // Everything from here on can fail with a branch already overwritten, which is
  // a different thing to report than a refusal. Inside the loop only "one or
  // both" is true - a restore refused on side a overwrites nothing at all - so
  // 'reset', which claims both, is not set until the loop has finished.
  progress.stage = 'resetting';
  for (const target of attested.targets) {
    await resetAbBranch({ manifest: attested, branchId: target.branchId, apiKey });
    console.log(`Discovery reset side ${target.sideId} (${AB_BRANCH_NAMES[target.sideId]}) from ${AB_BASE_BRANCH}`);
  }
  progress.stage = 'reset';

  const startedAt = new Date().toISOString();
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'discovery-'));
  let completedSuccessfully = false;
  try {
    const activeChildren = new Set<AbChildProcess>();
    const outputs: AbChildOutput[] = await runBoundedChildTasks({
      items: attested.targets,
      concurrency: AB_CHILD_CONCURRENCY,
      onFailure: () => {
        for (const active of activeChildren) active.kill('SIGTERM');
        const escalation = setTimeout(() => {
          for (const active of activeChildren) active.kill('SIGKILL');
        }, AB_CHILD_TERMINATION_GRACE_MS);
        escalation.unref?.();
      },
      task: async (target) => {
        const outputPath = path.join(temporaryDirectory, `${target.sideId}.json`);
        const proc = Bun.spawn({
          cmd: [
            process.execPath, new URL('./discovery.ts', import.meta.url).pathname,
            '--side', target.sideId, '--child-output', outputPath,
            ...formatAbRunArgs(selection),
          ],
          // One process per side, with that side's DATABASE_URL fixed for its
          // lifetime: withDiscoveryEnvironment mutates the real process.env, so
          // two configurations in one process would read each other's flags.
          env: {
            ...process.env,
            DATABASE_URL: target.databaseUrl,
            [AB_SIDE_BRANCH_ENV]: AB_BRANCH_NAMES[target.sideId],
          },
          stdout: 'inherit', stderr: 'inherit',
        });
        activeChildren.add(proc);
        // A live run now exists: from here a failure costs provider spend and
        // hours, not just the two resets.
        progress.stage = 'spawned';
        console.log(`Discovery side ${target.sideId} started against ${AB_BRANCH_NAMES[target.sideId]} (${slotsPerSide} slot(s))`);
        try {
          // Shared supervision: the same watchdog, SIGTERM/SIGKILL escalation
          // and artifact-availability reporting the matrix children get. Its
          // log lines say "matrix" because the code is shared, not because a
          // matrix run is happening.
          await awaitMatrixChildProcess({
            child: abChildDescriptor(target),
            outputPath,
            timeoutMs: abChildTimeoutMs(slotsPerSide),
            process: proc,
          });
        } finally {
          activeChildren.delete(proc);
        }
        return await Bun.file(outputPath).json() as AbChildOutput;
      },
    });

    const slots = outputs.flatMap((output) => output.slots);
    const execution: MatrixExecutionEvidence = { policy: 'strict', runs: outputs.flatMap((output) => output.execution.runs) };
    assertAbConfigProvenance(slots, selection.sides);
    // rowId is the side, and scoreMatrixSlot copies it to rule, so the
    // scorecard's two rules are the two sides.
    const scorecard = buildScorecard(slots, { model: process.env.CHAT_MODEL ?? 'configured runtime models', runs: 1 });
    const meta = await buildAbArtifactMeta({
      sides: selection.sides,
      cases,
      repetitions: selection.repetitions,
      startedAt,
      git: readEvalGitProvenance(import.meta.dir),
      filters: abSelectionFilters(selection.caseIds),
    });
    await writeRunReport(runPath, scorecard, {
      meta: toGovernedRunMeta(meta, { completedAt: new Date().toISOString(), execution }),
      force: selection.force,
    });
    // The artifact exists from here: a failure below (console formatting, or the
    // finally's temp-directory cleanup) must not tell an operator that nothing
    // of this run survived when the run report is on disk.
    progress.artifactPath = runPath;
    progress.stage = 'written';

    console.log(formatConsole(scorecard, [], [], { title: 'Discovery scorecard', execution }));
    console.log(formatAbConfigDiff(meta));
    console.log(`Discovery artifact written: ${runPath}`);
    const outcome = resolveAbRunOutcome({ slots, sides: selection.sides, expectedSlotsPerSide: slotsPerSide });
    console.log(outcome.summary);
    process.exitCode = outcome.exitCode;
    completedSuccessfully = outcome.exitCode === AB_EXIT_COMPARISON;
  } finally {
    await finalizeAbChildArtifacts(temporaryDirectory, completedSuccessfully);
  }
}

/** The comparison, with every failure after the first reset reported as what it cost. */
async function runAbParent(args: readonly string[]): Promise<void> {
  await withAbSpendAccounting(async (progress) => runAbComparison(args, progress));
}

/**
 * The one entry point, parent and child.
 *
 * A `--side` argument makes this a child invocation, and a child never gets
 * past `assertAbSideEnvironment`: confirm variable, disposable-database marker,
 * Neon host, exactly `protocol_eval`, and the branch label for its own side.
 */
export async function main(args: readonly string[] = process.argv.slice(2)): Promise<void> {
  if (args.includes('--help') || args.includes('-h')) return void console.log(abUsage());
  if (!args.includes('--side')) return void await runAbParent(args);

  const { sideId, outputPath } = parseAbChildArgs(args);
  const environment = assertAbSideEnvironment(process.env, sideId);
  const manifest = parseAbManifest(process.env.DISCOVERY_TARGETS);
  const target = manifest.targets.find((candidate) => candidate.sideId === sideId);
  if (!target || new URL(target.databaseUrl).toString() !== environment.databaseUrl.toString()) {
    throw new AbGateError(`Refusing to mutate: side ${sideId} is not composed against the database its manifest entry declares`);
  }
  const selection = parseAbRunArgs(args);
  const { HISTORICAL_MATRIX_CASES } = await loadMatrixEval();
  const cases = resolveAbCases(HISTORICAL_MATRIX_CASES as HistoricalMatrixFixture[], selection.caseIds);
  await runAbChild(sideId, buildAbPlan(cases, selection.sides, selection.repetitions), outputPath);
}
