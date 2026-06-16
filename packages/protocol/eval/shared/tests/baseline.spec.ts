import { describe, it, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, unlink } from "node:fs/promises";

import { buildScorecard } from "../scorecard.js";
import { diffBaseline, readBaseline, writeBaseline, writeRunReport } from "../baseline.js";
import { computeRollingBaseline } from "../rolling.js";
import type { CaseResultLike, ScorecardLike } from "../types.js";

const R = 7;
const BS = 0.8;

/** Aggregate-only case fixture (runResults omitted — shared layer never reads them). */
const s = (caseId: string, rule: string, passRate: number, runs = R): CaseResultLike => {
  const passes = Math.round(passRate * runs);
  return { caseId, rule, runs, passes, passRate, flaky: passRate > 0 && passRate < 1 };
};

describe("buildScorecard", () => {
  it("computes per-rule and aggregate pass-rates over a free-string rule label", () => {
    const sc = buildScorecard(
      [s("a", "groupX", 1, 3), s("b", "groupX", 0, 3), s("c", "groupY", 1, 3)],
      { model: "m", runs: 3 },
    );
    expect(sc.aggregatePassRate).toBeCloseTo((1 + 0 + 1) / 3, 5);
    const gx = sc.rules.find((r) => r.rule === "groupX")!;
    expect(gx.caseCount).toBe(2);
    expect(gx.passRate).toBeCloseTo(0.5, 5);
  });
});

describe("diffBaseline", () => {
  it("flags a severe drop", () => {
    const current = buildScorecard([s("a", "g", 0)], { model: "m", runs: R });
    const baseline = buildScorecard([s("a", "g", BS)], { model: "m", runs: R });
    expect(diffBaseline(current, baseline, 0.05).regressions.some((r) => r.id === "a" && r.kind === "case")).toBe(true);
  });

  it("returns nothing without a baseline", () => {
    const current = buildScorecard([s("a", "g", 0.71)], { model: "m", runs: R });
    const { regressions, skippedCaseIds } = diffBaseline(current, null, 0.05);
    expect(regressions).toHaveLength(0);
    expect(skippedCaseIds).toHaveLength(0);
  });

  it("reports current cases absent from the baseline", () => {
    const current = buildScorecard([s("new", "g", 0)], { model: "m", runs: R });
    const baseline = buildScorecard([s("old", "g", BS)], { model: "m", runs: R });
    const { regressions, skippedCaseIds } = diffBaseline(current, baseline, 0.05);
    expect(regressions).toHaveLength(0);
    expect(skippedCaseIds).toEqual(["new"]);
  });

  it("ignores typical-performance variance", () => {
    const current = buildScorecard([s("a", "g", 0.71)], { model: "m", runs: R });
    const baseline = buildScorecard([s("a", "g", BS)], { model: "m", runs: R });
    expect(diffBaseline(current, baseline, 0.05).regressions).toHaveLength(0);
  });

  it("flags a rule-level regression when combined evidence is strong", () => {
    const current = buildScorecard([s("a", "g", 0.43), s("b", "g", 0.43)], { model: "m", runs: R });
    const baseline = buildScorecard([s("a", "g", BS), s("b", "g", BS)], { model: "m", runs: R });
    expect(diffBaseline(current, baseline, 0.05).regressions.some((r) => r.kind === "rule" && r.id === "g")).toBe(true);
  });
});

describe("writeBaseline leanCase transform", () => {
  interface RichCase extends CaseResultLike {
    runResults: { passed: boolean; detail?: string }[];
  }
  const rich = (): ScorecardLike<RichCase> =>
    buildScorecard<RichCase>(
      [{ caseId: "a", rule: "g", runs: 1, passes: 1, passRate: 1, flaky: false, runResults: [{ passed: true, detail: "verbose" }] }],
      { model: "m", runs: 1 },
    );

  it("applies the per-case transform before serializing", async () => {
    const p = join(tmpdir(), `shared-baseline-${Date.now()}.json`);
    await writeBaseline(p, rich(), {
      leanCase: (c) => ({ ...c, runResults: c.runResults.map(({ detail: _d, ...rest }) => rest) }),
    });
    const back = await readBaseline<ScorecardLike<RichCase>>(p);
    expect(back!.cases[0].runResults[0].detail).toBeUndefined();
    await unlink(p);
  });

  it("keeps detail verbatim with the default (identity) transform", async () => {
    const p = join(tmpdir(), `shared-report-${Date.now()}.json`);
    await writeRunReport(p, rich());
    const back = JSON.parse(await Bun.file(p).text()) as ScorecardLike<RichCase>;
    expect(back.cases[0].runResults[0].detail).toBe("verbose");
    await unlink(p);
  });

  it("readBaseline returns null when the file is missing", async () => {
    const back = await readBaseline(join(tmpdir(), `missing-${Date.now()}.json`));
    expect(back).toBeNull();
  });
});

describe("computeRollingBaseline", () => {
  it("returns null when the run directory is missing", async () => {
    const rolling = await computeRollingBaseline(join(tmpdir(), `missing-rolling-${Date.now()}`), 7, new Date("2026-05-28T00:00:00.000Z"));
    expect(rolling).toBeNull();
  });

  it("averages recent run reports and ignores old ones", async () => {
    const dir = join(tmpdir(), `shared-rolling-${Date.now()}`);
    await mkdir(dir);
    const now = new Date("2026-05-28T00:00:00.000Z");
    const mk = (passRate: number, at: string): ScorecardLike => ({
      ...buildScorecard([s("a", "g", passRate, 3)], { model: "m", runs: 3 }),
      generatedAt: at,
    });
    await writeRunReport(join(dir, "recent-perfect.json"), mk(1, "2026-05-27T00:00:00.000Z"));
    await writeRunReport(join(dir, "recent-partial.json"), mk(0.33, "2026-05-26T00:00:00.000Z"));
    await writeRunReport(join(dir, "old.json"), mk(0, "2026-05-01T00:00:00.000Z"));

    const rolling = await computeRollingBaseline(dir, 7, now);
    expect(rolling).not.toBeNull();
    expect(rolling!.model).toContain("rolling:7d:2runs");
    expect(rolling!.cases).toHaveLength(1);
    // 3/3 + 1/3 → 4/6.
    expect(rolling!.cases[0].passRate).toBeCloseTo(4 / 6, 5);
    await rm(dir, { recursive: true, force: true });
  });
});
