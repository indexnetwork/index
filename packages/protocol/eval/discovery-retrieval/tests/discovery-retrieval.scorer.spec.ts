import { describe, expect, it } from "bun:test";

import { CASES } from "../discovery-retrieval.cases.js";
import { scoreModeRun } from "../discovery-retrieval.scorer.js";

describe("scoreModeRun", () => {
  it("passes a full candidate ranking when an excluded candidate is outside topK", async () => {
    const c = CASES[0]!;
    const [expected, excluded, neutral] = c.candidates;
    const result = await scoreModeRun(
      c,
      "intent_to_context",
      [
        { userId: expected!.userId, score: 0.91, text: expected!.userContext },
        { userId: neutral!.userId, score: 0.72, text: neutral!.userContext },
        { userId: excluded!.userId, score: 0.68, text: excluded!.userContext },
      ],
      async () => true,
    );

    expect(result.passed).toBe(true);
    expect(result.assertions.some((a) => a.kind === "recall_at_k" && a.passed)).toBe(true);
    expect(result.detail.excludedInTopK).toEqual([]);
  });

  it("fails when an excluded candidate appears in topK", async () => {
    const c = CASES.find((x) => x.expect.excludedUserIds.length > 0)!;
    const result = await scoreModeRun(c, "intent_to_context", [{ userId: c.expect.excludedUserIds[0]!, score: 0.99, text: "excluded" }], async () => true);
    expect(result.passed).toBe(false);
    expect(result.assertions.some((a) => a.kind === "excluded_top_k" && !a.passed)).toBe(true);
  });
});
