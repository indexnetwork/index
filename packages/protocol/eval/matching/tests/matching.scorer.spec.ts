import { describe, it, expect } from "bun:test";
import { scoreRun, scoreCase } from "../matching.scorer.js";
import type { MatchingCase } from "../matching.types.js";
import type { EvaluatedOpportunityWithActors } from "../../../src/opportunity/opportunity.evaluator.js";

const passJudge = async () => true;
const failJudge = async () => false;

const baseCase = (expectOverrides: MatchingCase["expect"]): MatchingCase => ({
  id: "t/case",
  rule: "is_a_identity",
  tier: 1,
  domains: ["technology"],
  description: "synthetic",
  input: { discovererId: "src", entities: [] },
  expect: expectOverrides,
});

const opp = (candidateId: string, score: number, role: "agent" | "patient" | "peer" = "peer"): EvaluatedOpportunityWithActors => ({
  reasoning: "r",
  score,
  actors: [
    { userId: "src", role: "patient", intentId: null },
    { userId: candidateId, role, intentId: null },
  ],
});

describe("scoreRun", () => {
  it("passes a matched candidate whose score is in band and role matches", async () => {
    const c = baseCase([{ candidateId: "cand", match: true, scoreBand: [70, 100], role: "agent" }]);
    const res = await scoreRun(c, [opp("cand", 85, "agent")], passJudge);
    expect(res.passed).toBe(true);
  });

  it("fails when score is outside the band", async () => {
    const c = baseCase([{ candidateId: "cand", match: true, scoreBand: [70, 100] }]);
    const res = await scoreRun(c, [opp("cand", 40)], passJudge);
    expect(res.passed).toBe(false);
    expect(res.assertions.find((a) => a.kind === "band")?.passed).toBe(false);
  });

  it("passes a reject expectation when the candidate is absent (score 0)", async () => {
    const c = baseCase([{ candidateId: "cand", match: false, scoreBand: [0, 35] }]);
    const res = await scoreRun(c, [], passJudge);
    expect(res.passed).toBe(true);
  });

  it("fails a reject expectation when the candidate surfaces above band", async () => {
    const c = baseCase([{ candidateId: "cand", match: false, scoreBand: [0, 35] }]);
    const res = await scoreRun(c, [opp("cand", 80)], passJudge);
    expect(res.passed).toBe(false);
    expect(res.assertions.find((a) => a.kind === "match")?.passed).toBe(false);
  });

  it("fails when the matched candidate has the wrong role", async () => {
    const c = baseCase([{ candidateId: "cand", match: true, role: "patient" }]);
    const res = await scoreRun(c, [opp("cand", 90, "agent")], passJudge);
    expect(res.assertions.find((a) => a.kind === "role")?.passed).toBe(false);
  });

  it("treats a score-0 candidate as not matched (reject expectation passes)", async () => {
    const c = baseCase([{ candidateId: "cand", match: false, scoreBand: [0, 30] }]);
    const res = await scoreRun(c, [opp("cand", 0)], passJudge);
    expect(res.passed).toBe(true);
  });

  it("treats a returned sub-threshold candidate as not surfaced", async () => {
    const c = baseCase([{ candidateId: "cand", match: false, scoreBand: [0, 29] }]);
    const res = await scoreRun(c, [opp("cand", 25)], passJudge);
    expect(res.passed).toBe(true);
    expect(res.assertions.find((a) => a.kind === "match")?.passed).toBe(true);
    expect(res.candidates![0].returned).toBe(true);
    expect(res.candidates![0].matched).toBe(false);
    expect(res.candidates![0].score).toBe(25);
  });

  it("treats a score-0 candidate as not matched (accept expectation fails on match)", async () => {
    const c = baseCase([{ candidateId: "cand", match: true, scoreBand: [70, 100] }]);
    const res = await scoreRun(c, [opp("cand", 0)], passJudge);
    expect(res.assertions.find((a) => a.kind === "match")?.passed).toBe(false);
  });

  it("runs the judge only when reasoningCriteria is set", async () => {
    const withCriteria = baseCase([{ candidateId: "cand", match: true, reasoningCriteria: "must be strong" }]);
    const failed = await scoreRun(withCriteria, [opp("cand", 90)], failJudge);
    expect(failed.assertions.find((a) => a.kind === "reasoning")?.passed).toBe(false);

    const noCriteria = baseCase([{ candidateId: "cand", match: true }]);
    const res = await scoreRun(noCriteria, [opp("cand", 90)], failJudge);
    expect(res.assertions.some((a) => a.kind === "reasoning")).toBe(false);
  });

  it("captures each candidate's outcome with the evaluator's verbatim reasoning", async () => {
    const c = baseCase([{ candidateId: "cand", match: true, scoreBand: [70, 100], role: "agent" }]);
    const evaluated: EvaluatedOpportunityWithActors = {
      reasoning: "Strong complementary fit on ML infrastructure.",
      score: 88,
      actors: [
        { userId: "src", role: "patient", intentId: null },
        { userId: "cand", role: "agent", intentId: null },
      ],
    };
    const res = await scoreRun(c, [evaluated], passJudge);
    expect(res.candidates).toHaveLength(1);
    const outcome = res.candidates![0];
    expect(outcome.candidateId).toBe("cand");
    expect(outcome.returned).toBe(true);
    expect(outcome.matched).toBe(true);
    expect(outcome.score).toBe(88);
    expect(outcome.role).toBe("agent");
    expect(outcome.reasoning).toBe("Strong complementary fit on ML infrastructure.");
  });

  it("records an absent candidate as not matched, no role, empty reasoning", async () => {
    const c = baseCase([{ candidateId: "cand", match: false, scoreBand: [0, 30] }]);
    const res = await scoreRun(c, [], passJudge);
    const outcome = res.candidates![0];
    expect(outcome.returned).toBe(false);
    expect(outcome.matched).toBe(false);
    expect(outcome.score).toBe(0);
    expect(outcome.role).toBeUndefined();
    expect(outcome.reasoning).toBe("");
  });
});

describe("scoreCase", () => {
  it("aggregates N runs into pass-rate and flags flakiness", async () => {
    const c = baseCase([{ candidateId: "cand", match: true, scoreBand: [70, 100] }]);
    const runs = [[opp("cand", 90)], [opp("cand", 40)], [opp("cand", 80)]]; // pass, fail, pass
    const result = await scoreCase(c, runs, passJudge);
    expect(result.runs).toBe(3);
    expect(result.passes).toBe(2);
    expect(result.passRate).toBeCloseTo(2 / 3, 5);
    expect(result.flaky).toBe(true);
  });

  it("is not flaky when all runs agree", async () => {
    const c = baseCase([{ candidateId: "cand", match: true, scoreBand: [70, 100] }]);
    const result = await scoreCase(c, [[opp("cand", 90)], [opp("cand", 95)]], passJudge);
    expect(result.flaky).toBe(false);
    expect(result.passRate).toBe(1);
  });
});
