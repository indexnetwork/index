import { describe, expect, it } from "bun:test";

import { CASES } from "../discovery-retrieval.cases.js";
import { scoreModeRun } from "../discovery-retrieval.scorer.js";

describe("scoreModeRun", () => {
  it("passes when expected candidate is rank 1 and excluded candidate is outside topK", async () => {
    const result = await scoreModeRun(
      CASES[0]!,
      "intent_to_context",
      [
        { userId: CASES[0]!.expect.expectedUserIds[0]!, score: 0.91, text: "target" },
        { userId: "neutral", score: 0.72, text: "neutral" },
      ],
      async () => true,
    );
    expect(result.passed).toBe(true);
    expect(result.assertions.some((a) => a.kind === "recall_at_k" && a.passed)).toBe(true);
  });

  it("fails when an excluded candidate appears in topK", async () => {
    const c = CASES.find((x) => x.expect.excludedUserIds.length > 0)!;
    const result = await scoreModeRun(c, "intent_to_context", [{ userId: c.expect.excludedUserIds[0]!, score: 0.99, text: "excluded" }], async () => true);
    expect(result.passed).toBe(false);
    expect(result.assertions.some((a) => a.kind === "excluded_top_k" && !a.passed)).toBe(true);
  });
});
