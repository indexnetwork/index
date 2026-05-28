import { describe, it, expect } from "bun:test";
import { MATCHING_MIN_SCORE } from "../matching.constants.js";
import { runCase, type EvaluatorLike } from "../matching.runner.js";
import type { MatchingCase } from "../matching.types.js";
import type { EvaluatedOpportunityWithActors } from "../../../src/opportunity/opportunity.evaluator.js";

const c: MatchingCase = {
  id: "t/case",
  rule: "is_a_identity",
  tier: 1,
  domains: ["technology"],
  description: "synthetic",
  input: { discovererId: "src", entities: [] },
  expect: [],
};

describe("runCase", () => {
  it("invokes the evaluator once per run with returnAll and collects outputs", async () => {
    const calls: Array<{ minScore?: number; returnAll?: boolean }> = [];
    const fake: EvaluatorLike = {
      async invokeEntityBundle(_input, opts) {
        calls.push(opts);
        const out: EvaluatedOpportunityWithActors[] = [
          { reasoning: "r", score: 80, actors: [{ userId: "src", role: "patient", intentId: null }] },
        ];
        return out;
      },
    };

    const runs = await runCase(fake, c, 3);
    expect(runs).toHaveLength(3);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual({ minScore: MATCHING_MIN_SCORE, returnAll: true });
    expect(runs[0][0].score).toBe(80);
  });

  it("retries transient evaluator failures", async () => {
    let attempts = 0;
    const fake: EvaluatorLike = {
      async invokeEntityBundle() {
        attempts += 1;
        if (attempts === 1) throw new Error("temporary connection error");
        return [{ reasoning: "r", score: 80, actors: [{ userId: "src", role: "patient", intentId: null }] }];
      },
    };

    const runs = await runCase(fake, c, 1, { maxAttempts: 2, retryDelayMs: 0 });
    expect(attempts).toBe(2);
    expect(runs).toHaveLength(1);
    expect(runs[0][0].score).toBe(80);
  });
});
