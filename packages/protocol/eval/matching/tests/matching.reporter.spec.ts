import { describe, it, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, unlink } from "node:fs/promises";
import {
  binomialCI,
  binomialPValue,
  binomialSignificance,
  predictivePValue,
  buildScorecard,
  computeRollingBaseline,
  diffBaseline,
  formatConsole,
  renderHtml,
  writeBaseline,
  writeRunReport,
  readBaseline,
} from "../matching.reporter.js";
import type { CaseResult, MatchingCase, Scorecard } from "../matching.types.js";

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

describe("binomialSignificance", () => {
  it("returns interpretable p-values", () => {
    expect(binomialPValue(2, 7, 0.8)).toBeCloseTo(0.00467, 3);
    expect(binomialPValue(5, 7, 0.8)).toBeGreaterThan(0.4);
  });

  it("does not flag when the baseline is zero", () => {
    expect(binomialPValue(0, 7, 0)).toBe(1);
    expect(binomialSignificance(0, 7, 0, 0.05)).toBe(false);
  });

  it("flags any miss against a perfect baseline", () => {
    expect(binomialPValue(6, 7, 1)).toBe(0);
    expect(binomialSignificance(6, 7, 1, 0.05)).toBe(true);
  });

  it("does not flag perfect current performance against a perfect baseline", () => {
    expect(binomialSignificance(7, 7, 1, 0.05)).toBe(false);
  });

  it("posterior predictive p-value accounts for baseline uncertainty", () => {
    // A point-null test treats 6/7 after a 7/7 baseline as impossible; the
    // posterior-predictive test correctly treats it as plausible finite-sample noise.
    expect(binomialPValue(6, 7, 1)).toBe(0);
    expect(predictivePValue(6, 7, 7, 7)).toBeGreaterThan(0.05);
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

// ── diffBaseline with realistic baseline rates ────────────────────────

const R = 7; // eval --runs default
const BS = 0.8; // null baseline pass-rate for regression tests (stable but not perfect)

/** Build a case result fixture. */
const s = (caseId: string, rule: CaseResult["rule"], passRate: number): CaseResult => {
  const passes = Math.round(passRate * R);
  return { caseId, rule, runs: R, passes, passRate, flaky: passRate > 0 && passRate < 1, runResults: [] };
};

describe("diffBaseline", () => {
  it("flags a severe drop", () => {
    // 0 passes out of 7 is extremely unlikely after a 6/7 baseline.
    const current = buildScorecard([s("a", "is_a_identity", 0)], { model: "m", runs: R });
    const baseline = buildScorecard([s("a", "is_a_identity", BS)], { model: "m", runs: R });
    const { regressions } = diffBaseline(current, baseline, 0.05);
    expect(regressions.some((r) => r.id === "a" && r.kind === "case")).toBe(true);
  });

  it("returns no regressions when there is no baseline", () => {
    const current = buildScorecard([s("a", "is_a_identity", 0.71)], { model: "m", runs: R });
    const { regressions, skippedCaseIds } = diffBaseline(current, null, 0.05);
    expect(regressions).toHaveLength(0);
    expect(skippedCaseIds).toHaveLength(0);
  });

  it("reports current cases absent from the baseline", () => {
    const current = buildScorecard([s("new-case", "is_a_identity", 0)], { model: "m", runs: R });
    const baseline = buildScorecard([s("old-case", "is_a_identity", BS)], { model: "m", runs: R });
    const { regressions, skippedCaseIds } = diffBaseline(current, baseline, 0.05);
    expect(regressions).toHaveLength(0);
    expect(skippedCaseIds).toEqual(["new-case"]);
  });

  it("ignores small fluctuations (same or above baseline)", () => {
    // 6/7 (rate=0.86) > baseline BS=0.8 — observed is above baseline, so can't be a regression.
    const current = buildScorecard([s("a", "is_a_identity", 0.86)], { model: "m", runs: R });
    const baseline = buildScorecard([s("a", "is_a_identity", BS)], { model: "m", runs: R });
    const { regressions } = diffBaseline(current, baseline, 0.05);
    expect(regressions).toHaveLength(0);
  });

  it("ignores typical-performance variance", () => {
    // 5/7 (rate=0.71) vs 6/7 baseline is plausible finite-sample variance.
    const current = buildScorecard([s("a", "is_a_identity", 0.71)], { model: "m", runs: R });
    const baseline = buildScorecard([s("a", "is_a_identity", BS)], { model: "m", runs: R });
    const { regressions } = diffBaseline(current, baseline, 0.05);
    expect(regressions).toHaveLength(0);
  });

  it("flags case-level regression that is clearly worse than baseline", () => {
    // 2/7 (rate=0.29) vs 6/7 baseline is clearly worse.
    const current = buildScorecard([s("a", "is_a_identity", 0.29)], { model: "m", runs: R });
    const baseline = buildScorecard([s("a", "is_a_identity", BS)], { model: "m", runs: R });
    const { regressions } = diffBaseline(current, baseline, 0.05);
    expect(regressions.some((r) => r.id === "a" && r.kind === "case")).toBe(true);
  });

  it("flags rule-level regression when combined evidence is strong", () => {
    // two cases, each 3/7=0.43 → combined 6/14 vs two 6/7 baselines is significant.
    const current = buildScorecard([
      s("a", "same_side", 0.43),
      s("b", "same_side", 0.43),
    ], { model: "m", runs: R });
    const baseline = buildScorecard([
      s("a", "same_side", BS),
      s("b", "same_side", BS),
    ], { model: "m", runs: R });
    const { regressions } = diffBaseline(current, baseline, 0.05);
    const ruleReg = regressions.filter((r) => r.kind === "rule" && r.id === "same_side");
    expect(ruleReg.length).toBeGreaterThan(0);
  });

  it("ignores rule-level noise", () => {
    // two cases, each 6/7=0.86 > baseline BS=0.8 — above baseline → no regression.
    const current = buildScorecard([
      s("a", "is_a_identity", 0.86),
      s("b", "is_a_identity", 0.86),
    ], { model: "m", runs: R });
    const baseline = buildScorecard([
      s("a", "is_a_identity", BS),
      s("b", "is_a_identity", BS),
    ], { model: "m", runs: R });
    const { regressions } = diffBaseline(current, baseline, 0.05);
    expect(regressions).toHaveLength(0);
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
      { id: "is_a_identity", kind: "rule" as const, before: 1, after: 0.5, pValue: 0.001 },
    ];
    const output = formatConsole(sc, regressions, ["new/case"]);
    expect(output).toContain("is_a_identity");
    expect(output).toContain("aggregate pass-rate");
    expect(output).toContain("⚠");
    expect(output).toContain("p=");
    expect(output).toContain("absent from baseline");
  });
});

describe("renderHtml", () => {
  it("renders case metadata, CI hints, reasoning, and p-values", () => {
    const c: CaseResult = {
      caseId: "html/test-case",
      rule: "same_side",
      runs: 1,
      passes: 0,
      passRate: 0,
      flaky: false,
      runResults: [
        {
          passed: false,
          assertions: [
            {
              kind: "band",
              candidateId: "cand",
              passed: false,
              detail: "expected score in [0,29], got 80",
            },
          ],
          candidates: [
            { candidateId: "cand", matched: true, score: 80, role: "peer", reasoning: "because <fit>" },
            { candidateId: "absent", matched: false, score: 0, reasoning: "" },
          ],
        },
      ],
    };
    const sc = buildScorecard([c], { model: "m", runs: 1 });
    const corpus: MatchingCase[] = [
      {
        id: "html/test-case",
        rule: "same_side",
        tier: 1,
        domains: ["technology"],
        description: "HTML renderer should escape <tags> and show detail.",
        input: {
          discovererId: "src",
          entities: [
            { userId: "src", profile: { name: "Source", bio: "b" }, networkId: "n" },
            { userId: "cand", profile: { name: "Candidate", bio: "b" }, networkId: "n" },
            { userId: "absent", profile: { name: "Absent Candidate", bio: "b" }, networkId: "n" },
          ],
        },
        expect: [
          { candidateId: "cand", match: false, scoreBand: [0, 29] },
          { candidateId: "absent", match: false, scoreBand: [0, 29] },
        ],
      },
    ];
    const html = renderHtml(sc, [{ id: "html/test-case", kind: "case", before: 1, after: 0, pValue: 0.001 }], corpus);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("HTML renderer should escape &lt;tags&gt;");
    expect(html).toContain("because &lt;fit&gt;");
    expect(html).toContain("CI₉₅");
    expect(html).toContain("p=0.001");
    expect(html).toContain("What this report is measuring");
    expect(html).toContain("By protocol component");
    expect(html).toContain("Score calibration");
    expect(html).toContain("failed checks");
    // HTML report display names use corpus profile names for readability.
    expect(html).toContain("<strong>Candidate</strong>");
    expect(html).toContain("cand</span>");
    expect(html).toContain("Not returned by the evaluator. No opportunity object existed");
    expect(html).not.toContain("(no reasoning captured)");
  });

  it("uses reportNames when present", () => {
    const c: CaseResult = {
      caseId: "html/real-name-case",
      rule: "historical",
      runs: 1,
      passes: 1,
      passRate: 1,
      flaky: false,
      runResults: [
        {
          passed: true,
          assertions: [],
          candidates: [
            { candidateId: "historical-partner", matched: true, score: 90, role: "agent", reasoning: "strong fit" },
          ],
        },
      ],
    };
    const sc = buildScorecard([c], { model: "m", runs: 1 });
    const corpus: MatchingCase[] = [
      {
        id: "html/real-name-case",
        rule: "historical",
        tier: 3,
        domains: ["research"],
        description: "Report-only names should show real referents.",
        input: {
          discovererId: "historical-source",
          entities: [
            { userId: "historical-source", profile: { name: "(source user)", bio: "b" }, networkId: "n" },
            { userId: "historical-partner", profile: { name: "Synthetic Placeholder", bio: "b" }, networkId: "n" },
          ],
        },
        expect: [{ candidateId: "historical-partner", match: true, scoreBand: [60, 100] }],
        reportNames: { "historical-partner": "Real Partner" },
      },
    ];
    const html = renderHtml(sc, [], corpus);
    expect(html).toContain("<strong>Real Partner</strong>");
    expect(html).not.toContain("Synthetic Placeholder");
  });
});

describe("computeRollingBaseline", () => {
  it("returns null when the run directory is missing or empty", async () => {
    const missing = join(tmpdir(), `missing-rolling-${Date.now()}`);
    const rolling = await computeRollingBaseline(missing, 7, new Date("2026-05-28T00:00:00.000Z"));
    expect(rolling).toBeNull();
  });

  it("averages recent run reports and ignores old ones", async () => {
    const dir = join(tmpdir(), `matching-rolling-${Date.now()}`);
    await mkdir(dir);
    const now = new Date("2026-05-28T00:00:00.000Z");

    const recentPerfect: Scorecard = {
      ...buildScorecard([caseResult("a", "same_side", 1)], { model: "m", runs: 3 }),
      generatedAt: "2026-05-27T00:00:00.000Z",
    };
    const recentPartial: Scorecard = {
      ...buildScorecard([caseResult("a", "same_side", 0.33)], { model: "m", runs: 3 }),
      generatedAt: "2026-05-26T00:00:00.000Z",
    };
    const oldRun: Scorecard = {
      ...buildScorecard([caseResult("a", "same_side", 0)], { model: "m", runs: 3 }),
      generatedAt: "2026-05-01T00:00:00.000Z",
    };

    await writeRunReport(join(dir, "recent-perfect.json"), recentPerfect);
    await writeRunReport(join(dir, "recent-partial.json"), recentPartial);
    await writeRunReport(join(dir, "old.json"), oldRun);

    const rolling = await computeRollingBaseline(dir, 7, now);
    expect(rolling).not.toBeNull();
    expect(rolling!.model).toContain("rolling:7d:2runs");
    expect(rolling!.cases).toHaveLength(1);
    // recentPerfect contributes 3/3, recentPartial contributes 1/3 → 4/6.
    expect(rolling!.cases[0].passRate).toBeCloseTo(4 / 6, 5);
    expect(rolling!.rules[0].passRate).toBeCloseTo(4 / 6, 5);

    await rm(dir, { recursive: true, force: true });
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