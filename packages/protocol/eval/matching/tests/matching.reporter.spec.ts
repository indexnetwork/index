import { describe, it, expect } from "bun:test";
import { buildScorecard, diffBaseline } from "../matching.reporter.js";
import type { CaseResult, Scorecard } from "../matching.types.js";

const caseResult = (caseId: string, rule: CaseResult["rule"], passRate: number): CaseResult => ({
  caseId,
  rule,
  runs: 3,
  passes: Math.round(passRate * 3),
  passRate,
  flaky: passRate > 0 && passRate < 1,
  runResults: [],
});

describe("buildScorecard", () => {
  it("computes per-rule and aggregate pass-rates", () => {
    const results = [
      caseResult("a", "is_a_identity", 1),
      caseResult("b", "is_a_identity", 0),
      caseResult("c", "same_side", 1),
    ];
    const sc = buildScorecard(results, { model: "m", runs: 3 });
    expect(sc.aggregatePassRate).toBeCloseTo((1 + 0 + 1) / 3, 5);
    const identity = sc.rules.find((r) => r.rule === "is_a_identity")!;
    expect(identity.caseCount).toBe(2);
    expect(identity.passRate).toBeCloseTo(0.5, 5);
  });
});

describe("diffBaseline", () => {
  const current = buildScorecard([caseResult("a", "is_a_identity", 0.33)], { model: "m", runs: 3 });
  const baseline = buildScorecard([caseResult("a", "is_a_identity", 1)], { model: "m", runs: 3 });

  it("flags a case whose pass-rate dropped beyond the threshold", () => {
    const { regressions } = diffBaseline(current, baseline, 0.34);
    expect(regressions.some((r) => r.id === "a" && r.kind === "case")).toBe(true);
  });

  it("returns no regressions when there is no baseline", () => {
    const { regressions } = diffBaseline(current, null, 0.34);
    expect(regressions).toHaveLength(0);
  });

  it("ignores drops smaller than the threshold", () => {
    const small = buildScorecard([caseResult("a", "is_a_identity", 0.8)], { model: "m", runs: 3 });
    const base = buildScorecard([caseResult("a", "is_a_identity", 1)], { model: "m", runs: 3 });
    const { regressions } = diffBaseline(small, base, 0.34);
    expect(regressions).toHaveLength(0);
  });
});
