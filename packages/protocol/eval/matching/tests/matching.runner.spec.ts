import { describe, it, expect } from "bun:test";
import { runCase, type EvaluatorLike } from "../matching.runner.js";
import type { MatchingCase } from "../matching.types.js";
import type { EvaluatedOpportunityWithActors } from "../../../src/opportunity/opportunity.evaluator.js";

const c: MatchingCase = {
  id: "t/case",
  rule: "is_a_identity",
  tier: 1,
  description: "synthetic",
  input: { discovererId: "src", entities: [] },
  expect: [],
};

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
  expect(calls[0]).toEqual({ minScore: 30, returnAll: true });
  expect(runs[0][0].score).toBe(80);
});
