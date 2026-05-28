import { describe, it, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import {
  binomialCI,
  buildScorecard,
  diffBaseline,
  formatConsole,
  writeBaseline,
  writeRunReport,
  readBaseline,
} from "../matching.reporter.js";
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

describe("binomialCI", () => {
  it("returns [0,1] when total is zero", () => {
    const [lo, hi] = binomialCI(0, 0);
    expect(lo).toBe(0);
    expect(hi).toBe(1);
  });

  it("centres on 0.5 for 1/2 with wide CI", () => {
    const [lo, _hi] = binomialCI(1, 2);
    // 1/2 → ~50% with very wide error: lo should be around 0.09–0.15
    expect(lo).toBeLessThan(0.16);
    expect(lo).toBeGreaterThan(0);
  });

  it("tightens dramatically as n grows — lower bound lifts", () => {
    const [lo3, hi3] = binomialCI(3, 3);
    const [lo7, hi7] = binomialCI(7, 7);
    // Both hit 100% upper bound (Wilson preserves 1.0 for perfect scores), but
    // the lower bound tightens substantially: 3/3 → ~0.44, 7/7 → ~0.65.
    expect(hi3).toBe(1);
    expect(hi7).toBe(1);
    expect(lo7).toBeGreaterThan(lo3);
    expect(lo3).toBeLessThan(0.5);
  });

  it("is symmetric within rounding for moderate p", () => {
    const [lo, hi] = binomialCI(21, 30); // 70%
    const spread = hi - lo;
    expect(spread).toBeGreaterThan(0.20); // n=30 still wide
    expect(spread).toBeLessThan(0.50);
  });
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

  it("flags a regression when the drop exactly equals the threshold (inclusive boundary, FP guard)", () => {
    // baseline passRate=1.0, current passRate=0.66 → raw subtraction gives 0.33999999999999997,
    // which is below threshold=0.34 without the epsilon guard. With rounding to 1e9 the drop
    // becomes exactly 0.34 and the regression is correctly flagged.
    const baselineSc = buildScorecard([caseResult("x", "is_a_identity", 1.0)], { model: "m", runs: 3 });
    const currentSc = buildScorecard(
      [caseResult("x", "is_a_identity", 0.66)],
      { model: "m", runs: 3 },
    );
    const { regressions } = diffBaseline(currentSc, baselineSc, 0.34);
    expect(regressions.some((r) => r.id === "x" && r.kind === "case")).toBe(true);
  });
});

describe("formatConsole", () => {
  it("includes rule name, aggregate pass-rate label, and regression marker when there is a regression", () => {
    const sc = buildScorecard(
      [
        caseResult("case1", "is_a_identity", 1),
        caseResult("case2", "is_a_identity", 0),
      ],
      { model: "test-model", runs: 3 },
    );
    const regressions = [
      { id: "is_a_identity", kind: "rule" as const, before: 1, after: 0.5 },
    ];
    const output = formatConsole(sc, regressions);
    expect(output).toContain("is_a_identity");
    expect(output).toContain("aggregate pass-rate");
    expect(output).toContain("⚠");
  });
});

describe("baseline vs run-report reasoning handling", () => {
  const scWithReasoning = (): Scorecard => {
    const cr: CaseResult = {
      caseId: "a",
      rule: "is_a_identity",
      runs: 1,
      passes: 1,
      passRate: 1,
      flaky: false,
      runResults: [
        {
          passed: true,
          assertions: [],
          candidates: [
            { candidateId: "c", matched: true, score: 90, role: "agent", reasoning: "because X" },
          ],
        },
      ],
    };
    return buildScorecard([cr], { model: "m", runs: 1 });
  };

  it("strips candidate reasoning from the committed baseline", async () => {
    const p = join(tmpdir(), `matching-baseline-${Date.now()}.json`);
    await writeBaseline(p, scWithReasoning());
    const back = await readBaseline(p);
    expect(back!.cases[0].runResults[0].candidates).toBeUndefined();
    await unlink(p);
  });

  it("keeps candidate reasoning verbatim in the run report", async () => {
    const p = join(tmpdir(), `matching-report-${Date.now()}.json`);
    await writeRunReport(p, scWithReasoning());
    const back = JSON.parse(await Bun.file(p).text()) as Scorecard;
    expect(back.cases[0].runResults[0].candidates![0].reasoning).toBe("because X");
    await unlink(p);
  });
});
