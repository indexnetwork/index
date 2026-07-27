import type { DiscoveryRetrievalCase, ModeRunDetail, RankedUser, RetrievalAssertion, RetrievalMode, RunResult } from "./discovery-retrieval.types.js";

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
