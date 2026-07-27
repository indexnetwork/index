import { attachScoredRunProvenance } from "../shared/index.js";
import { projectCaseExecutionEvidence, type CaseRunBatches } from "./discovery-retrieval.runner.js";
import type { CaseResult, DiscoveryRetrievalCase, ModeResult, ModeRunDetail, RankedUser, RetrievalAssertion, RetrievalMode, RunResult } from "./discovery-retrieval.types.js";

const MODES: RetrievalMode[] = ["intent_to_premise", "intent_to_context", "context_to_context"];

/** Grades the semantic relationship represented by a ranked retrieval result. */
export type RetrievalJudge = (c: DiscoveryRetrievalCase, mode: RetrievalMode, ranking: RankedUser[]) => Promise<boolean>;

/** Score one mode/run using deterministic rank checks plus an injected semantic judge. */
export async function scoreModeRun(
  c: DiscoveryRetrievalCase,
  mode: RetrievalMode,
  ranking: RankedUser[],
  judge: RetrievalJudge,
): Promise<RunResult> {
  const topK = ranking.slice(0, c.expect.topK);
  const expectedRanks = Object.fromEntries(
    c.expect.expectedUserIds.map((userId) => [userId, ranking.findIndex((result) => result.userId === userId) + 1 || null]),
  );
  const expectedInTopK = c.expect.expectedUserIds.filter((userId) => (expectedRanks[userId] ?? Infinity) <= c.expect.topK);
  const excludedInTopK = topK.filter((result) => c.expect.excludedUserIds.includes(result.userId)).map((result) => result.userId);
  const recallAtK = expectedInTopK.length / c.expect.expectedUserIds.length;
  const judgePassed = await judge(c, mode, topK);

  const assertions: RetrievalAssertion[] = [
    {
      kind: "recall_at_k",
      passed: expectedInTopK.length === c.expect.expectedUserIds.length,
      detail: `expected ${c.expect.expectedUserIds.length} target(s) in top ${c.expect.topK}, found ${expectedInTopK.length}`,
    },
    {
      kind: "expected_rank",
      passed: c.expect.expectedUserIds.every((userId) => (expectedRanks[userId] ?? Infinity) <= c.expect.maxExpectedRank),
      detail: `expected targets must rank at or above ${c.expect.maxExpectedRank}; ${c.expect.expectedUserIds.map((id) => `${id}:${expectedRanks[id] ?? "absent"}`).join(", ")}`,
    },
    {
      kind: "excluded_top_k",
      passed: excludedInTopK.length === 0,
      detail: excludedInTopK.length === 0 ? `no excluded targets in top ${c.expect.topK}` : `excluded targets in top ${c.expect.topK}: ${excludedInTopK.join(", ")}`,
    },
    { kind: "judge", passed: judgePassed, detail: judgePassed ? "judge passed" : "judge failed" },
  ];
  const detail: ModeRunDetail = { mode, ranking, recallAtK, expectedRanks, excludedInTopK };

  return { passed: assertions.every((assertion) => assertion.passed), assertions, detail };
}

/** Aggregates scored runs across the three retrieval representations for one case. */
export async function scoreCase(
  c: DiscoveryRetrievalCase,
  batches: CaseRunBatches["batches"],
  evaluator: RetrievalJudge,
): Promise<CaseResult> {
  const projectedEvidence = projectCaseExecutionEvidence(c.id, batches);
  const modeResults: ModeResult[] = [];
  for (const mode of MODES) {
    const batch = batches[mode];
    const scoredRuns = await Promise.all(batch.outputs.map((output) => scoreModeRun(c, mode, output.ranking, evaluator)));
    const successfulRuns = projectedEvidence[mode].filter((run) => run.outcome === "success");
    const withProvenance = attachScoredRunProvenance({ runResults: scoredRuns }, successfulRuns).runResults;
    const passes = withProvenance.filter((run) => run.passed).length;
    modeResults.push({
      mode,
      runs: withProvenance.length,
      passes,
      passRate: withProvenance.length === 0 ? 0 : passes / withProvenance.length,
      flaky: passes > 0 && passes < withProvenance.length,
      runResults: withProvenance,
    });
  }
  const runs = modeResults.reduce((total, result) => total + result.runs, 0);
  const passes = modeResults.reduce((total, result) => total + result.passes, 0);
  return {
    caseId: c.id,
    rule: c.rule,
    runs,
    passes,
    passRate: runs === 0 ? 0 : passes / runs,
    flaky: passes > 0 && passes < runs,
    scoredRunIds: MODES.flatMap((mode) => projectedEvidence[mode]
      .filter((run) => run.outcome === "success")
      .map((run) => run.runId)),
    modeResults,
  };
}
