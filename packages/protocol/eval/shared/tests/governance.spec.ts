/**
 * Provider-free specs for the ER4 baseline governance layer (IND-445):
 * comparability assessment, fail-closed comparison verdicts, the
 * `--update-baseline` gate, the reviewable update summary, exit-code mapping,
 * and rolling-input filtering. The regression statistics themselves are
 * asserted unchanged: governed comparisons must produce byte-identical
 * regression output to a raw `diffBaseline` call over the same inputs.
 */
import { describe, it, expect } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, rm } from "node:fs/promises";

import { EVAL_BASELINE_ARTIFACT_TYPE, buildEvalArtifact, migrateLegacyBaseline, type EvalRunMeta } from "../artifact.js";
import { writeEvalArtifact } from "../artifact.io.js";
import { assertBaselineWriteEligible, diffBaseline, writeBaseline, writeRunReport } from "../baseline.js";
import { EVAL_EXIT_EXECUTION_ERROR, EVAL_EXIT_INSUFFICIENT_EVIDENCE, EVAL_EXIT_PASS, EVAL_EXIT_REGRESSION, resolveEvalExitCode, runEvalEvidenceFlow } from "../cli.js";
import { assertBaselineUpdatePermitted, assessBaselineComparability, baselineUpdateSummaryPath, buildBaselineUpdateSummary, buildEvalScoringConfigFingerprint, compareAgainstGovernedBaseline, comparisonSubjectFromMeta, emptyGovernedComparison, formatBaselineUpdateSummary, formatGovernedComparison, governedComparisonExitStatus, governedRegressionCount, performGovernedBaselineUpdate, resolveEvalJudgeModelId, type GovernedComparison } from "../governance.js";
import { computeRollingBaseline } from "../rolling.js";
import { buildScorecard } from "../scorecard.js";
import { summarizeExecution, type EvalExecutionSummary } from "../runner.js";
import type { CaseResultLike, ScorecardLike } from "../types.js";
import { makeSuccessfulExecution, makeTestMeta, TEST_FINGERPRINT, TEST_REVISION } from "./artifact.fixtures.js";

const HARNESS = "test-harness";

/** Aggregate case fixture with deterministic scoredRunIds. */
const caseFixture = (caseId: string, rule: string, passRate: number, runs = 3): CaseResultLike => {
  const passes = Math.round(passRate * runs);
  return {
    caseId,
    rule,
    runs,
    passes,
    passRate: runs === 0 ? 0 : passes / runs,
    flaky: passes > 0 && passes < runs,
    scoredRunIds: Array.from({ length: runs }, (_, runIndex) => `${encodeURIComponent(caseId)}::run:${runIndex + 1}`),
  };
};

const scorecardOf = (cases: CaseResultLike[], runs = 3): ScorecardLike => ({
  ...buildScorecard(cases, { model: "test/model", runs }),
  generatedAt: "2026-01-01T00:01:00.000Z",
});

const metaFor = (cases: CaseResultLike[], overrides: Partial<EvalRunMeta> = {}, runs = 3): EvalRunMeta =>
  makeTestMeta({
    runs,
    execution: makeSuccessfulExecution(cases.map((entry) => entry.caseId), runs),
    ...overrides,
  });

const summaryFor = (meta: EvalRunMeta): EvalExecutionSummary => summarizeExecution(meta.execution);

function baselineEnvelopeOf(cases: CaseResultLike[], overrides: Partial<EvalRunMeta> = {}, runs = 3) {
  const meta = metaFor(cases, overrides, runs);
  return buildEvalArtifact(EVAL_BASELINE_ARTIFACT_TYPE, scorecardOf(cases, runs), meta, { createdAt: "2026-01-01T00:02:00.000Z" });
}

function legacyBaselineEnvelope(cases: CaseResultLike[]) {
  const legacy = {
    ...scorecardOf(cases.map(({ scoredRunIds: _ignored, ...rest }) => rest)),
  };
  return migrateLegacyBaseline(legacy, { harness: HARNESS, harnessVersion: "1" });
}

describe("assessBaselineComparability", () => {
  const cases = [caseFixture("a", "g", 1)];

  it("marks identical provenance comparable", () => {
    const baseline = baselineEnvelopeOf(cases);
    const subject = comparisonSubjectFromMeta(metaFor(cases), summaryFor(metaFor(cases)));
    const result = assessBaselineComparability(subject, baseline);
    expect(result.status).toBe("comparable");
    expect(result.mismatches).toHaveLength(0);
    expect(result.unprovable).toHaveLength(0);
  });

  const provableMismatches: Array<[string, Partial<EvalRunMeta>]> = [
    ["models", { models: ["other/model"] }],
    ["harness-version", { harnessVersion: "2" }],
    ["corpus", { corpusFingerprint: "b".repeat(64) }],
    ["config", { configFingerprint: "c".repeat(64) }],
  ];
  it.each(provableMismatches)("flags a provable %s mismatch as incompatible", (dimension, overrides) => {
    const baseline = baselineEnvelopeOf(cases);
    const meta = metaFor(cases, overrides);
    const result = assessBaselineComparability(comparisonSubjectFromMeta(meta, summaryFor(meta)), baseline);
    expect(result.status).toBe("incompatible");
    expect(result.mismatches.map((finding) => String(finding.dimension))).toContain(dimension);
  });

  it("treats incomplete current evidence as incompatible", () => {
    const baseline = baselineEnvelopeOf(cases);
    const meta = metaFor(cases);
    const subject = { ...comparisonSubjectFromMeta(meta, summaryFor(meta)), complete: false };
    const result = assessBaselineComparability(subject, baseline);
    expect(result.status).toBe("incompatible");
    expect(result.mismatches.map((finding) => finding.dimension)).toContain("completeness");
  });

  it("marks legacy v1 fingerprints unprovable, never incompatible", () => {
    const baseline = legacyBaselineEnvelope(cases);
    const meta = metaFor(cases);
    const result = assessBaselineComparability(comparisonSubjectFromMeta(meta, summaryFor(meta)), baseline);
    expect(result.status).toBe("unprovable");
    expect(result.mismatches).toHaveLength(0);
    expect(result.unprovable.map((finding) => finding.dimension).sort()).toEqual(["config", "corpus", "run-protocol"]);
  });

  it("marks filtered current selections unprovable on corpus and selection", () => {
    const baseline = baselineEnvelopeOf(cases);
    const meta = metaFor(cases, { selection: { fullCorpus: false, filters: { rule: "g" } }, corpusFingerprint: "d".repeat(64) });
    const result = assessBaselineComparability(comparisonSubjectFromMeta(meta, summaryFor(meta)), baseline);
    expect(result.status).toBe("unprovable");
    expect(result.unprovable.map((finding) => finding.dimension).sort()).toEqual(["corpus", "selection"]);
  });
});

describe("diffBaseline case reporting", () => {
  it("reports added, removed, and unscored cases explicitly without changing the statistics", () => {
    const current = scorecardOf([
      caseFixture("kept", "g", 1),
      caseFixture("new", "g", 1),
      { caseId: "failed", rule: "g", runs: 0, passes: 0, passRate: 0, flaky: false, scoredRunIds: [] },
    ]);
    const baseline = scorecardOf([caseFixture("kept", "g", 1), caseFixture("gone", "g", 1)]);
    const diff = diffBaseline(current, baseline, 0.05);
    expect(diff.addedCaseIds).toEqual(["new", "failed"]);
    expect(diff.skippedCaseIds).toEqual(["new"]);
    expect(diff.removedCaseIds).toEqual(["gone"]);
    expect(diff.unscoredCaseIds).toEqual(["failed"]);
  });
});

describe("compareAgainstGovernedBaseline", () => {
  const cases = [caseFixture("a", "g", 0), caseFixture("b", "g", 1)];
  const baselineCases = [caseFixture("a", "g", 1, 7), caseFixture("b", "g", 1, 7)];

  async function withBaseline(envelope: Awaited<ReturnType<typeof baselineEnvelopeOf>> | ReturnType<typeof legacyBaselineEnvelope>, run: (path: string) => Promise<void>): Promise<void> {
    const dir = join(tmpdir(), `governed-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    const path = join(dir, "baseline.json");
    await writeEvalArtifact(path, envelope, { force: true });
    try {
      await run(path);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("returns no-baseline when the file is missing", async () => {
    const meta = metaFor(cases);
    const comparison = await compareAgainstGovernedBaseline({
      scorecard: scorecardOf(cases),
      alpha: 0.05,
      evidencePolicy: "normal",
      meta,
      execution: summaryFor(meta),
      baselinePath: join(tmpdir(), `missing-${Date.now()}.json`),
    });
    expect(comparison.verdict).toBe("no-baseline");
  });

  it("refuses to diff a provably incompatible baseline (fail closed)", async () => {
    const meta = metaFor(cases, { models: ["other/model"] });
    await withBaseline(baselineEnvelopeOf(baselineCases, {}, 7), async (baselinePath) => {
      const comparison = await compareAgainstGovernedBaseline({
        scorecard: scorecardOf(cases),
        alpha: 0.05,
        evidencePolicy: "normal",
        meta,
        execution: summaryFor(meta),
        baselinePath,
      });
      expect(comparison.verdict).toBe("incompatible");
      expect(comparison.regressions).toHaveLength(0);
      expect(governedRegressionCount(comparison)).toBe(0);
      expect(governedComparisonExitStatus(comparison)).toBe("incompatible");
      // During an update the old baseline's incompatibility is reviewable, not fatal.
      expect(governedComparisonExitStatus(comparison, { forUpdate: true })).toBeUndefined();
      expect(formatGovernedComparison(comparison, { fullCorpus: true })).toContain("provably incompatible");
    });
  });

  it("compares an identical-provenance baseline with unchanged regression math", async () => {
    const meta = metaFor(cases);
    await withBaseline(baselineEnvelopeOf(baselineCases, {}, 7), async (baselinePath) => {
      const comparison = await compareAgainstGovernedBaseline({
        scorecard: scorecardOf(cases),
        alpha: 0.05,
        evidencePolicy: "normal",
        meta,
        execution: summaryFor(meta),
        baselinePath,
      });
      expect(comparison.verdict).toBe("compared");
      // The governance layer must not change the statistics: identical output
      // to a raw diffBaseline call over the same payloads.
      const raw = diffBaseline(scorecardOf(cases), scorecardOf(baselineCases, 7), 0.05);
      expect(comparison.regressions).toEqual(raw.regressions);
      expect(comparison.regressions.some((regression) => regression.id === "a" && regression.kind === "case")).toBe(true);
      expect(governedComparisonExitStatus(comparison)).toBe("compared");
    });
  });

  it("keeps comparing committed legacy v1 baselines under the normal policy", async () => {
    const meta = metaFor(cases);
    await withBaseline(legacyBaselineEnvelope(baselineCases), async (baselinePath) => {
      const comparison = await compareAgainstGovernedBaseline({
        scorecard: scorecardOf(cases),
        alpha: 0.05,
        evidencePolicy: "normal",
        meta,
        execution: summaryFor(meta),
        baselinePath,
      });
      expect(comparison.verdict).toBe("compared-unprovable");
      expect(comparison.regressions.length).toBeGreaterThan(0);
      expect(governedComparisonExitStatus(comparison)).toBe("compared");
    });
  });

  it("fails closed on unprovable comparability under the strict policy", async () => {
    const meta = metaFor(cases);
    await withBaseline(legacyBaselineEnvelope(baselineCases), async (baselinePath) => {
      const comparison = await compareAgainstGovernedBaseline({
        scorecard: scorecardOf(cases),
        alpha: 0.05,
        evidencePolicy: "strict",
        meta,
        execution: summaryFor(meta),
        baselinePath,
      });
      expect(comparison.verdict).toBe("not-comparable-strict");
      expect(comparison.regressions).toHaveLength(0);
      expect(governedComparisonExitStatus(comparison)).toBe("not-comparable-strict");
    });
  });

  it("still produces a descriptive diff for the update summary under strict update mode", async () => {
    const meta = metaFor(cases);
    await withBaseline(legacyBaselineEnvelope(baselineCases), async (baselinePath) => {
      const comparison = await compareAgainstGovernedBaseline({
        scorecard: scorecardOf(cases),
        alpha: 0.05,
        evidencePolicy: "strict",
        meta,
        execution: summaryFor(meta),
        baselinePath,
        forUpdate: true,
      });
      expect(comparison.verdict).toBe("compared-unprovable");
      expect(comparison.regressions.length).toBeGreaterThan(0);
    });
  });
});

describe("baseline write eligibility gate", () => {
  const cases = [caseFixture("a", "g", 1)];

  const ineligibleMetas: Array<[string, Partial<EvalRunMeta>]> = [
    ["dirty working tree", { git: { revision: TEST_REVISION, dirty: true } }],
    ["unverifiable working tree", { git: { revision: TEST_REVISION, dirty: null } }],
    ["unknown revision", { git: { revision: "unknown", dirty: null } }],
    ["filtered selection", { selection: { fullCorpus: false, filters: { rule: "g" } } }],
  ];
  it.each(ineligibleMetas)("writeBaseline refuses a %s", async (_label, overrides) => {
    const path = join(tmpdir(), `gated-baseline-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    await expect(writeBaseline(path, scorecardOf(cases), { meta: metaFor(cases, overrides) })).rejects.toThrow(/Refusing to write baseline/);
    expect(await Bun.file(path).exists()).toBe(false);
  });

  it("writeBaseline refuses incomplete evidence", async () => {
    const incompleteExecution = {
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
    const meta = makeTestMeta({ runs: 1, execution: incompleteExecution });
    const path = join(tmpdir(), `gated-incomplete-${Date.now()}.json`);
    await expect(
      writeBaseline(path, scorecardOf([{ caseId: "a", rule: "g", runs: 0, passes: 0, passRate: 0, flaky: false, scoredRunIds: [] }], 1), { meta }),
    ).rejects.toThrow(/incomplete evidence/);
  });

  it("does not gate diagnostic run reports (incomplete diagnostics stay persistable)", async () => {
    const path = join(tmpdir(), `ungated-report-${Date.now()}.json`);
    const meta = metaFor(cases, { git: { revision: "unknown", dirty: null } });
    await writeRunReport(path, scorecardOf(cases), { meta });
    expect(await Bun.file(path).exists()).toBe(true);
    await rm(path, { force: true });
  });

  it("assertBaselineWriteEligible accepts clean, complete, full-corpus meta", () => {
    expect(() => assertBaselineWriteEligible(metaFor(cases))).not.toThrow();
  });
});

describe("assertBaselineUpdatePermitted", () => {
  const cases = [caseFixture("a", "g", 1)];

  it("requires an operator reason", () => {
    const meta = metaFor(cases);
    expect(() => assertBaselineUpdatePermitted({ meta, execution: summaryFor(meta), reason: undefined })).toThrow(/--reason/);
    expect(() => assertBaselineUpdatePermitted({ meta, execution: summaryFor(meta), reason: "  " })).toThrow(/--reason/);
    expect(() => assertBaselineUpdatePermitted({ meta, execution: summaryFor(meta), reason: "model upgrade" })).not.toThrow();
  });

  it("requires complete execution evidence", () => {
    const meta = metaFor(cases);
    const incomplete = { ...summaryFor(meta), complete: false, completedRuns: 1 };
    expect(() => assertBaselineUpdatePermitted({ meta, execution: incomplete, reason: "why" })).toThrow(/incomplete evidence/);
  });
});

describe("performGovernedBaselineUpdate", () => {
  const previousCases = [caseFixture("kept", "g", 1, 7), caseFixture("gone", "g", 1, 7)];
  const nextCases = [caseFixture("kept", "g", 0), caseFixture("new", "h", 1)];

  async function runUpdate(): Promise<{ dir: string; summary: Awaited<ReturnType<typeof performGovernedBaselineUpdate>>; baselinePath: string }> {
    const dir = join(tmpdir(), `update-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(dir, { recursive: true });
    const baselinePath = join(dir, "test.baseline.json");
    await writeEvalArtifact(baselinePath, baselineEnvelopeOf(previousCases, {}, 7), { force: true });
    const meta = metaFor(nextCases);
    const execution = summaryFor(meta);
    const scorecard = scorecardOf(nextCases);
    const comparison = await compareAgainstGovernedBaseline({
      scorecard,
      alpha: 0.05,
      evidencePolicy: "strict",
      meta,
      execution,
      baselinePath,
      forUpdate: true,
    });
    const summary = await performGovernedBaselineUpdate({
      baselinePath,
      scorecard,
      meta,
      execution,
      reason: "corpus refresh after scorer fix",
      force: true,
      comparison,
      writeBaselineArtifact: () => writeBaseline(baselinePath, scorecard, { meta, force: true }),
    });
    return { dir, summary, baselinePath };
  }

  it("writes the baseline and persists a reviewable, deterministic update summary", async () => {
    const { dir, summary, baselinePath } = await runUpdate();
    try {
      const summaryPath = baselineUpdateSummaryPath(baselinePath);
      expect(summaryPath.endsWith("test.baseline.update.json")).toBe(true);
      const persisted = await Bun.file(summaryPath).json();
      expect(persisted).toEqual(JSON.parse(JSON.stringify(summary)));

      expect(summary.reason).toBe("corpus refresh after scorer fix");
      expect(summary.previous?.schemaVersion).toBe(2);
      expect(summary.previous?.corpusFingerprint).toBe(TEST_FINGERPRINT);
      expect(summary.next.schemaVersion).toBe(2);
      expect(summary.next.git.revision).toBe(TEST_REVISION);
      expect(summary.caseChanges).toEqual({ added: ["new"], removed: ["gone"], retainedCount: 1 });
      expect(summary.ruleChanges).toEqual({ added: ["h"], removed: [] });
      expect(summary.aggregatePassRate.previous).toBe(1);
      expect(summary.aggregatePassRate.next).toBe(0.5);
      expect(summary.aggregatePassRate.delta).toBe(-0.5);
      expect(summary.regressions.some((regression) => regression.id === "kept")).toBe(true);
      expect(summary.execution.recoveredRuns).toBe(0);

      // Deterministic: rebuilding from the same inputs yields the same summary.
      const rebuilt = buildBaselineUpdateSummary({
        scorecard: scorecardOf(nextCases),
        meta: metaFor(nextCases),
        execution: summary.execution,
        reason: summary.reason,
        comparison: await compareAgainstGovernedBaseline({
          scorecard: scorecardOf(nextCases),
          alpha: 0.05,
          evidencePolicy: "strict",
          meta: metaFor(nextCases),
          execution: summary.execution,
          baselinePath,
          forUpdate: true,
        }),
      });
      // The baseline file now holds the *new* payload, so only provenance-stable
      // fields are compared for determinism.
      expect(rebuilt.reason).toBe(summary.reason);
      expect(rebuilt.createdAt).toBe(summary.createdAt);
      expect(rebuilt.next).toEqual(summary.next);

      const text = formatBaselineUpdateSummary(summary);
      expect(text).toContain("Baseline update summary");
      expect(text).toContain("corpus refresh after scorer fix");
      expect(text).toContain("+ new");
      expect(text).toContain("- gone");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses the update without a reason and leaves both files untouched", async () => {
    const dir = join(tmpdir(), `update-refused-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const baselinePath = join(dir, "test.baseline.json");
    await writeEvalArtifact(baselinePath, baselineEnvelopeOf(previousCases, {}, 7), { force: true });
    const before = await Bun.file(baselinePath).text();
    const meta = metaFor(nextCases);
    try {
      await expect(performGovernedBaselineUpdate({
        baselinePath,
        scorecard: scorecardOf(nextCases),
        meta,
        execution: summaryFor(meta),
        reason: undefined,
        force: true,
        comparison: emptyGovernedComparison(),
        writeBaselineArtifact: () => writeBaseline(baselinePath, scorecardOf(nextCases), { meta, force: true }),
      })).rejects.toThrow(/--reason/);
      expect(await Bun.file(baselinePath).text()).toBe(before);
      expect(await Bun.file(baselineUpdateSummaryPath(baselinePath)).exists()).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("exit-code mapping for governed comparisons", () => {
  const complete: EvalExecutionSummary = { requestedRuns: 3, completedRuns: 3, failedRuns: 0, recoveredRuns: 0, totalAttempts: 3, complete: true };
  const incomplete: EvalExecutionSummary = { ...complete, completedRuns: 2, failedRuns: 1, complete: false };

  it("maps incompatible baselines to the artifact-error exit and strict-unprovable to insufficient evidence", () => {
    expect(resolveEvalExitCode({ regressionCount: 0, evidencePolicy: "normal", execution: complete, comparison: "incompatible" })).toBe(EVAL_EXIT_EXECUTION_ERROR);
    expect(resolveEvalExitCode({ regressionCount: 0, evidencePolicy: "strict", execution: complete, comparison: "not-comparable-strict" })).toBe(EVAL_EXIT_INSUFFICIENT_EVIDENCE);
    expect(resolveEvalExitCode({ regressionCount: 0, evidencePolicy: "normal", execution: complete, comparison: "compared" })).toBe(EVAL_EXIT_PASS);
    expect(resolveEvalExitCode({ regressionCount: 2, evidencePolicy: "normal", execution: complete, comparison: "compared" })).toBe(EVAL_EXIT_REGRESSION);
  });

  it("keeps the ER3 incomplete-evidence contract ahead of comparison status", () => {
    expect(resolveEvalExitCode({ regressionCount: 0, evidencePolicy: "normal", execution: incomplete, comparison: "incompatible" })).toBe(EVAL_EXIT_EXECUTION_ERROR);
    expect(resolveEvalExitCode({ regressionCount: 0, evidencePolicy: "strict", execution: incomplete, comparison: "compared" })).toBe(EVAL_EXIT_INSUFFICIENT_EVIDENCE);
  });

  it("runEvalEvidenceFlow forwards the comparison to updateBaseline and honors comparisonStatus", async () => {
    let received: GovernedComparison | undefined;
    const comparison: GovernedComparison = { ...emptyGovernedComparison("incompatible") };
    const flow = await runEvalEvidenceFlow<GovernedComparison>({
      evidencePolicy: "normal",
      execution: complete,
      noComparison: emptyGovernedComparison(),
      compareBaseline: async () => comparison,
      regressionCount: governedRegressionCount,
      comparisonStatus: (entry) => governedComparisonExitStatus(entry),
      updateBaseline: async (entry) => {
        received = entry;
      },
      persistDiagnosticReport: async () => {},
    });
    expect(received === comparison).toBe(true);
    expect(flow.exitCode).toBe(EVAL_EXIT_EXECUTION_ERROR);
  });
});

describe("rolling baseline governance", () => {
  it("excludes incompatible artifacts with explicit reasons and aggregates only compatible complete reports", async () => {
    const dir = join(tmpdir(), `rolling-governance-${Date.now()}`);
    await mkdir(dir, { recursive: true });
    const now = new Date("2026-01-02T00:00:00.000Z");
    const cases = [caseFixture("a", "g", 1)];
    const mk = (passRate: number): ScorecardLike => ({
      ...scorecardOf([caseFixture("a", "g", passRate)]),
      generatedAt: "2026-01-01T12:00:00.000Z",
    });
    const meta = metaFor(cases);
    await writeRunReport(join(dir, "compatible-1.json"), mk(1), { meta });
    await writeRunReport(join(dir, "compatible-2.json"), mk(1 / 3), { meta });
    await writeRunReport(join(dir, "other-model.json"), mk(0), { meta: metaFor(cases, { models: ["other/model"] }) });
    await writeRunReport(join(dir, "filtered.json"), mk(0), {
      meta: metaFor(cases, { selection: { fullCorpus: false, filters: { rule: "g" } } }),
    });
    await writeRunReport(join(dir, "other-config.json"), mk(0), { meta: metaFor(cases, { configFingerprint: "e".repeat(64) }) });
    await Bun.write(join(dir, "corrupt.json"), "{not json");

    const rolling = await computeRollingBaseline(dir, 7, now, {
      evidencePolicy: "normal",
      compatibility: {
        harness: HARNESS,
        harnessVersion: "1",
        models: ["test/model"],
        corpusFingerprint: TEST_FINGERPRINT,
        configFingerprint: TEST_FINGERPRINT,
      },
    });
    expect(rolling.includedFiles).toEqual(["compatible-1.json", "compatible-2.json"]);
    // 3/3 + 1/3 → 4/6, unchanged aggregation math over admitted inputs.
    expect(rolling.scorecard!.cases[0].passRate).toBeCloseTo(4 / 6, 5);
    const reasonByFile = new Map(rolling.excluded.map((entry) => [entry.file, entry.reason]));
    expect(reasonByFile.get("corrupt.json")).toContain("invalid run-report artifact");
    expect(reasonByFile.get("other-model.json")).toContain("model IDs");
    expect(reasonByFile.get("filtered.json")).toContain("filtered run");
    expect(reasonByFile.get("other-config.json")).toContain("scoring-config fingerprint");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("scoring-config fingerprint", () => {
  it("is stable across execution knobs and sensitive to the judge and judge model", () => {
    expect(buildEvalScoringConfigFingerprint({ judge: true, judgeModelId: "j/m" }))
      .toBe(buildEvalScoringConfigFingerprint({ judge: true, judgeModelId: "j/m" }));
    expect(buildEvalScoringConfigFingerprint({ judge: true, judgeModelId: "j/m" }))
      .not.toBe(buildEvalScoringConfigFingerprint({ judge: false }));
    expect(buildEvalScoringConfigFingerprint({ judge: true, judgeModelId: "j/m" }))
      .not.toBe(buildEvalScoringConfigFingerprint({ judge: true, judgeModelId: "j/other" }));
    expect(resolveEvalJudgeModelId({})).toBe("google/gemini-2.5-flash");
    expect(resolveEvalJudgeModelId({ SMARTEST_VERIFIER_MODEL: "x/y" })).toBe("x/y");
  });
});

describe("committed schema-v1 baselines", () => {
  const committed: Array<[string]> = [["matching"], ["opportunity"], ["premise"], ["profile"]];

  it.each(committed)("eval/%s committed baseline stays readable and is unprovable, never incompatible, for a same-model run", async (harness) => {
    const path = new URL(`../../${harness}/${harness}.eval.ts`, import.meta.url).pathname
      .replace(`${harness}.eval.ts`, `baselines/${harness}.baseline.json`);
    const { readBaselineArtifact } = await import("../baseline.js");
    const envelope = await readBaselineArtifact(path, { harness });
    expect(envelope).not.toBeNull();
    expect(envelope!.schemaVersion).toBe(1);
    const subject = {
      harness,
      harnessVersion: envelope!.harnessVersion,
      models: [...envelope!.models],
      selection: { fullCorpus: true, filters: {} },
      corpusFingerprint: TEST_FINGERPRINT,
      configFingerprint: TEST_FINGERPRINT,
      complete: true,
    };
    const result = assessBaselineComparability(subject, envelope!);
    expect(result.status).toBe("unprovable");
    expect(result.mismatches).toHaveLength(0);
  });
});

describe("harness governance adoption", () => {
  const harnesses: Array<[string]> = [["matching"], ["opportunity"], ["premise"], ["profile"]];

  it.each(harnesses)("eval/%s adopts the shared governed comparison, update, and reason gate", async (harness) => {
    const source = await Bun.file(new URL(`../../${harness}/${harness}.eval.ts`, import.meta.url).pathname).text();
    expect(source).toContain("compareAgainstGovernedBaseline(");
    expect(source).toContain("performGovernedBaselineUpdate(");
    expect(source).toContain("governedComparisonExitStatus(");
    expect(source).toContain('flagValue("--reason")');
    expect(source).toContain("buildEvalScoringConfigFingerprint(");
    // Baseline writes only happen inside the governed update path.
    expect(source).not.toContain("fingerprintEvalConfig(");
  });
});
