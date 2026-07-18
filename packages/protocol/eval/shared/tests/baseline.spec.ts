import { describe, it, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, unlink } from "node:fs/promises";

import { buildScorecard } from "../scorecard.js";
import { diffBaseline, readBaseline, writeBaseline, writeRunReport } from "../baseline.js";
import { EVAL_RUN_REPORT_ARTIFACT_TYPE } from "../artifact.js";
import { readEvalArtifact } from "../artifact.io.js";
import { computeRollingBaseline } from "../rolling.js";
import { buildExecutionEvidence, executeRuns } from "../runner.js";
import type { CaseResultLike, ScorecardLike } from "../types.js";
import { makeSuccessfulExecution, makeTestMeta } from "./artifact.fixtures.js";

const R = 7;
const BS = 0.8;

/** Aggregate-only case fixture (runResults omitted — shared layer never reads them). */
const s = (caseId: string, rule: string, passRate: number, runs = R): CaseResultLike => {
  const passes = Math.round(passRate * runs);
  return {
    caseId,
    rule,
    runs,
    passes,
    passRate,
    flaky: passRate > 0 && passRate < 1,
    scoredRunIds: Array.from({ length: runs }, (_, runIndex) => `${encodeURIComponent(caseId)}::run:${runIndex + 1}`),
  };
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

  it("excludes cases with no terminal successful outputs from domain rates", () => {
    const sc = buildScorecard([
      s("scored", "g", 1, 1),
      { caseId: "failed", rule: "g", runs: 0, passes: 0, passRate: 0, flaky: false, scoredRunIds: [] },
    ], { model: "m", runs: 1 });
    expect(sc.aggregatePassRate).toBe(1);
    expect(sc.rules[0].passRate).toBe(1);
    expect(sc.cases).toHaveLength(2);
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
      [{ caseId: "a", rule: "g", runs: 1, passes: 1, passRate: 1, flaky: false, scoredRunIds: ["a::run:1"], runResults: [{ passed: true, detail: "verbose" }] }],
      { model: "m", runs: 1 },
    );

  it("applies the per-case transform before serializing", async () => {
    const p = join(tmpdir(), `shared-baseline-${Date.now()}.json`);
    await writeBaseline(p, rich(), {
      meta: makeTestMeta(),
      leanCase: (c) => ({ ...c, runResults: c.runResults.map(({ detail: _d, ...rest }) => rest) }),
    });
    const back = await readBaseline<ScorecardLike<RichCase>>(p, { harness: "test-harness" });
    expect(back!.cases[0].runResults[0].detail).toBeUndefined();
    await unlink(p);
  });

  it("keeps detail verbatim with the default (identity) transform", async () => {
    const p = join(tmpdir(), `shared-report-${Date.now()}.json`);
    await writeRunReport(p, rich(), { meta: makeTestMeta() });
    const back = (JSON.parse(await Bun.file(p).text()) as { payload: ScorecardLike<RichCase> }).payload;
    expect(back.cases[0].runResults[0].detail).toBe("verbose");
    await unlink(p);
  });

  it("readBaseline returns null when the file is missing", async () => {
    const back = await readBaseline(join(tmpdir(), `missing-${Date.now()}.json`), { harness: "test-harness" });
    expect(back).toBeNull();
  });
});

describe("attempt evidence persistence", () => {
  it("round-trips recovered and exhausted attempts through a run report", async () => {
    const startedAt = new Date(Date.now() - 1_000).toISOString();
    const batch = await executeRuns(async ({ runIndex, attemptNumber }) => {
      if (runIndex === 0 && attemptNumber === 1) throw new Error("temporary provider failure");
      if (runIndex === 1) throw Object.assign(new Error("exhausted provider failure"), { code: "503" });
      return "recovered-output";
    }, 2, {
      caseId: "attempt-e2e",
      attemptTimeoutMs: 100,
      maxAttempts: 2,
      retryDelayMs: 0,
    });
    const execution = buildExecutionEvidence([batch]);
    const scorecard = buildScorecard([{
      caseId: "attempt-e2e",
      rule: "g",
      runs: 1,
      passes: 1,
      passRate: 1,
      flaky: false,
      scoredRunIds: batch.successfulRuns.map((run) => run.runId),
    }], { model: "m", runs: 2 });
    const reportPath = join(tmpdir(), `attempt-evidence-${Date.now()}-${Math.random()}.json`);
    await writeRunReport(reportPath, scorecard, {
      meta: makeTestMeta({
        runs: 2,
        startedAt,
        completedAt: new Date().toISOString(),
        execution,
      }),
    });

    const artifact = await readEvalArtifact(reportPath, {
      expectedType: EVAL_RUN_REPORT_ARTIFACT_TYPE,
      expectedHarness: "test-harness",
    });
    expect(artifact?.schemaVersion).toBe(2);
    if (!artifact || artifact.schemaVersion !== 2) throw new Error("expected a v2 run report");
    expect(artifact.execution.runs.map((run) => run.outcome)).toEqual(["success", "failed"]);
    expect(artifact.execution.runs[0]).toMatchObject({
      recovered: true,
      attempts: [{ outcome: "failure" }, { outcome: "success" }],
    });
    expect(artifact.execution.runs[1]).toMatchObject({
      recovered: false,
      attempts: [
        { outcome: "failure", error: { code: "503" } },
        { outcome: "failure", error: { code: "503" } },
      ],
    });
    expect(artifact.payload.cases[0].scoredRunIds).toEqual(["attempt-e2e::run:1"]);
    await unlink(reportPath);
  });
});

describe("computeRollingBaseline", () => {
  it("returns a null scorecard when the run directory is missing", async () => {
    const rolling = await computeRollingBaseline(join(tmpdir(), `missing-rolling-${Date.now()}`), 7, new Date("2026-05-28T00:00:00.000Z"));
    expect(rolling.scorecard).toBeNull();
    expect(rolling.excluded).toHaveLength(0);
  });

  it("averages recent run reports and ignores old ones", async () => {
    const dir = join(tmpdir(), `shared-rolling-${Date.now()}`);
    await mkdir(dir);
    const now = new Date("2026-05-28T00:00:00.000Z");
    const mk = (passRate: number, at: string): ScorecardLike => ({
      ...buildScorecard([s("a", "g", passRate, 3)], { model: "m", runs: 3 }),
      generatedAt: at,
    });
    const meta = makeTestMeta({ runs: 3, execution: makeSuccessfulExecution(["a"], 3) });
    await writeRunReport(join(dir, "recent-perfect.json"), mk(1, "2026-05-27T00:00:00.000Z"), { meta });
    await writeRunReport(join(dir, "recent-partial.json"), mk(1 / 3, "2026-05-26T00:00:00.000Z"), { meta });
    await writeRunReport(join(dir, "old.json"), mk(0, "2026-05-01T00:00:00.000Z"), { meta });

    const failedRun = {
      policy: "normal" as const,
      runs: [{
        runId: "a::run:1",
        caseId: "a",
        runIndex: 0,
        outcome: "failed" as const,
        recovered: false,
        attempts: [{
          attemptId: "a::run:1::attempt:1",
          runId: "a::run:1",
          runIndex: 0,
          attemptNumber: 1,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:00.010Z",
          durationMs: 10,
          outcome: "failure" as const,
          error: { class: "Error", message: "sanitized" },
          retryable: false,
          backoffMs: 0,
        }],
      }],
    };
    const incomplete = {
      ...buildScorecard([{ caseId: "a", rule: "g", runs: 0, passes: 0, passRate: 0, flaky: false, scoredRunIds: [] }], { model: "m", runs: 1 }),
      generatedAt: "2026-05-27T12:00:00.000Z",
    };
    await writeRunReport(join(dir, "recent-incomplete.json"), incomplete, {
      meta: makeTestMeta({ runs: 1, execution: failedRun }),
    });

    const rolling = await computeRollingBaseline(dir, 7, now);
    expect(rolling.scorecard).not.toBeNull();
    expect(rolling.scorecard!.model).toContain("rolling:7d:2runs");
    expect(rolling.scorecard!.cases).toHaveLength(1);
    // 3/3 + 1/3 → 4/6.
    expect(rolling.scorecard!.cases[0].passRate).toBeCloseTo(4 / 6, 5);
    expect(rolling.includedFiles).toEqual(["recent-partial.json", "recent-perfect.json"]);
    // Every rejected artifact is reported with its reason (IND-445).
    expect(rolling.excluded).toEqual([
      { file: "old.json", reason: expect.stringContaining("7-day rolling window") },
      { file: "recent-incomplete.json", reason: expect.stringContaining("incomplete execution evidence") },
    ]);
    await rm(dir, { recursive: true, force: true });
  });
});
