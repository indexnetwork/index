import { describe, expect, it } from "bun:test";

import { EVAL_ARTIFACT_SCHEMA_VERSION, EVAL_BASELINE_ARTIFACT_TYPE, EVAL_LEGACY_UNAVAILABLE, EVAL_RUN_REPORT_ARTIFACT_TYPE, HistoricalQualityExecutionRunSchema, HistoricalQualityMeasurementSchema, HistoricalQualityTransportRowSchema, buildEvalArtifact, canonicalizeForFingerprint, fingerprintCanonicalJson, fingerprintEvalConfig, fingerprintEvalCorpus, getExecutionEvidence, isEvalArtifactV2, isHistoricalQualityArtifact, looksLikeLegacyScorecard, migrateLegacyBaseline, parseEvalArtifact, readEvalGitProvenance } from "../artifact.js";
import { buildScorecard } from "../scorecard.js";
import type { CaseResultLike, ScorecardLike } from "../types.js";
import { TEST_REVISION, makeHistoricalQualityArtifact, makeIncompleteHistoricalQualityArtifact, makeSuccessfulExecution, makeTestMeta, reassignHistoricalQualitySlot } from "./artifact.fixtures.js";

const caseResult = (caseId: string, rule: string, passes: number, runs = 3): CaseResultLike => ({
  caseId,
  rule,
  runs,
  passes,
  passRate: passes / runs,
  flaky: passes > 0 && passes < runs,
  scoredRunIds: Array.from({ length: runs }, (_, runIndex) => `${encodeURIComponent(caseId)}::run:${runIndex + 1}`),
});

const scorecard = (): ScorecardLike =>
  buildScorecard([caseResult("a", "g", 3), caseResult("b", "g", 1), caseResult("c", "h", 0)], {
    model: "test/model",
    runs: 3,
  });

const legacyScorecard = (): ScorecardLike => {
  const legacy = JSON.parse(JSON.stringify(scorecard())) as ScorecardLike;
  for (const entry of legacy.cases) delete entry.scoredRunIds;
  return legacy;
};

const validEnvelope = () => buildEvalArtifact(
  EVAL_BASELINE_ARTIFACT_TYPE,
  scorecard(),
  makeTestMeta({ runs: 3, execution: makeSuccessfulExecution(["a", "b", "c"], 3) }),
);

describe("buildEvalArtifact + parseEvalArtifact", () => {
  it("round-trips a valid baseline envelope", () => {
    const envelope = validEnvelope();
    const parsed = parseEvalArtifact(envelope, {
      expectedType: EVAL_BASELINE_ARTIFACT_TYPE,
      expectedHarness: "test-harness",
    });
    expect(parsed.schemaVersion).toBe(EVAL_ARTIFACT_SCHEMA_VERSION);
    expect(parsed.payload.cases).toHaveLength(3);
    expect(parsed.completeness).toEqual({
      caseCount: 3,
      ruleCount: 2,
      totalRuns: 9,
      totalPasses: 4,
      flakyCaseCount: 1,
      requestedRuns: 9,
      completedRuns: 9,
      failedRuns: 0,
      recoveredRuns: 0,
      totalAttempts: 9,
      complete: true,
    });
  });

  it("rejects non-object values as corrupt", () => {
    expect(() => parseEvalArtifact("truncated…", { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/corrupt or truncated/);
    expect(() => parseEvalArtifact(null, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/corrupt or truncated/);
  });

  it("rejects legacy unversioned scorecards with a migration pointer", () => {
    expect(() => parseEvalArtifact(scorecard(), { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/migrate-legacy-baselines.*never cast silently/s);
  });

  it("rejects incompatible artifact types", () => {
    const envelope = validEnvelope();
    expect(() => parseEvalArtifact(envelope, { expectedType: EVAL_RUN_REPORT_ARTIFACT_TYPE }))
      .toThrow(/Incompatible artifact type.*index-eval\/run-report.*index-eval\/baseline/);
  });

  it("rejects unknown schema versions with the supported version named", () => {
    const envelope = { ...validEnvelope(), schemaVersion: 999 };
    expect(() => parseEvalArtifact(envelope, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/schema version 999.*supports versions 1 and 2/);
  });

  it("rejects a harness mismatch", () => {
    const envelope = validEnvelope();
    expect(() => parseEvalArtifact(envelope, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE, expectedHarness: "other" }))
      .toThrow(/belongs to harness "test-harness", expected "other"/);
  });

  it("rejects unknown envelope keys", () => {
    const envelope = { ...validEnvelope(), extraneous: true };
    expect(() => parseEvalArtifact(envelope, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/Invalid eval artifact/);
  });

  it("rejects malformed numbers (NaN, out-of-range rates, non-integers)", () => {
    const base = validEnvelope();
    const withCase = (patch: Partial<CaseResultLike>) => ({
      ...base,
      payload: {
        ...base.payload,
        cases: base.payload.cases.map((c, i) => (i === 0 ? { ...c, ...patch } : c)),
      },
    });
    expect(() => parseEvalArtifact(withCase({ passRate: Number.NaN }), { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/Invalid eval artifact/);
    expect(() => parseEvalArtifact(withCase({ passRate: 1.5 }), { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/Invalid eval artifact/);
    expect(() => parseEvalArtifact(withCase({ runs: 2.5 }), { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/Invalid eval artifact/);
    expect(() => parseEvalArtifact(withCase({ passes: -1 }), { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/Invalid eval artifact/);
  });

  it("rejects passes greater than runs", () => {
    const base = validEnvelope();
    const bad = {
      ...base,
      payload: { ...base.payload, cases: base.payload.cases.map((c, i) => (i === 0 ? { ...c, passes: 99 } : c)) },
    };
    expect(() => parseEvalArtifact(bad, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/exceeds runs/);
  });

  it("rejects duplicate case ids and duplicate rule labels", () => {
    const base = validEnvelope();
    const dupCase = {
      ...base,
      payload: { ...base.payload, cases: [...base.payload.cases, base.payload.cases[0]] },
    };
    expect(() => parseEvalArtifact(dupCase, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/duplicate caseId/);
    const dupRule = {
      ...base,
      payload: { ...base.payload, rules: [...base.payload.rules, base.payload.rules[0]] },
    };
    expect(() => parseEvalArtifact(dupRule, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/duplicate rule|rules rollup/);
  });

  it("rejects inconsistent aggregate counts and rates", () => {
    const base = validEnvelope();
    const badAggregate = { ...base, payload: { ...base.payload, aggregatePassRate: 0.123 } };
    expect(() => parseEvalArtifact(badAggregate, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/aggregatePassRate is inconsistent/);
    const badRule = {
      ...base,
      payload: {
        ...base.payload,
        rules: base.payload.rules.map((r, i) => (i === 0 ? { ...r, passRate: 0.001 } : r)),
      },
    };
    expect(() => parseEvalArtifact(badRule, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/passRate is inconsistent with its scored member cases/);
    const badCompleteness = { ...base, completeness: { ...base.completeness, totalPasses: 123 } };
    expect(() => parseEvalArtifact(badCompleteness, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/completeness\.totalPasses/);
  });

  it("rejects inconsistent flaky flags", () => {
    const base = validEnvelope();
    const bad = {
      ...base,
      payload: { ...base.payload, cases: base.payload.cases.map((c, i) => (i === 0 ? { ...c, flaky: true } : c)) },
    };
    expect(() => parseEvalArtifact(bad, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(/flaky flag is inconsistent/);
  });

  it("rejects non-monotonic timestamps", () => {
    const base = validEnvelope();
    const bad = { ...base, startedAt: "2026-02-01T00:00:00.000Z" }; // after completedAt
    expect(() => parseEvalArtifact(bad, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/startedAt <= completedAt <= createdAt/);
  });

  it("rejects legacy fingerprint sentinels on run-sourced artifacts", () => {
    const base = validEnvelope();
    const bad = { ...base, corpusFingerprint: EVAL_LEGACY_UNAVAILABLE };
    expect(() => parseEvalArtifact(bad, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/only valid for source "legacy-migration"/);
  });

  it("rejects an envelope/payload run-count mismatch and duplicate models", () => {
    const base = validEnvelope();
    expect(() => parseEvalArtifact({ ...base, runs: 7 }, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/envelope runs \(7\) != payload runs \(3\)/);
    expect(() => parseEvalArtifact({ ...base, models: ["m", "m"] }, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/duplicate model IDs/);
  });

  it("rejects selection filters on full-corpus artifacts", () => {
    expect(() =>
      buildEvalArtifact(EVAL_BASELINE_ARTIFACT_TYPE, scorecard(), makeTestMeta({
        runs: 3,
        selection: { fullCorpus: true, filters: { rule: "g" } },
      })),
    ).toThrow(/must not carry selection filters/);
  });

  it("derives completeness from payload plus execution rather than trusting callers", () => {
    const envelope = validEnvelope();
    expect(envelope.completeness.totalRuns).toBe(9);
    expect(envelope.completeness.requestedRuns).toBe(9);
    expect(envelope.completeness.totalAttempts).toBe(9);
    expect(envelope.completeness.flakyCaseCount).toBe(1);
  });

  it("rejects impossible attempt state transitions and out-of-window timing", () => {
    const base = JSON.parse(JSON.stringify(validEnvelope())) as ReturnType<typeof validEnvelope>;
    const run = base.execution.runs[0];
    const success = { ...run.attempts[0], attemptId: `${run.runId}::attempt:2`, attemptNumber: 2 };
    run.attempts = [{
      ...run.attempts[0],
      outcome: "cancelled",
      error: { class: "Error", message: "cancelled" },
      retryable: false,
    }, success];
    run.recovered = true;
    base.completeness.totalAttempts += 1;
    base.completeness.recoveredRuns += 1;
    expect(() => parseEvalArtifact(base, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/cancelled attempts are terminal|only retryable attempts/);

    const timing = JSON.parse(JSON.stringify(validEnvelope())) as ReturnType<typeof validEnvelope>;
    timing.execution.runs[0].attempts[0].startedAt = "2025-12-31T23:59:59.000Z";
    timing.execution.runs[0].attempts[0].completedAt = "2025-12-31T23:59:59.010Z";
    expect(() => parseEvalArtifact(timing, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/within the envelope execution window/);
  });

  it("accepts incomplete v2 run reports but rejects incomplete v2 baselines", () => {
    const failedRun = {
      policy: "strict" as const,
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
    const incomplete = buildScorecard([{ caseId: "a", rule: "g", runs: 0, passes: 0, passRate: 0, flaky: false, scoredRunIds: [] }], { model: "test/model", runs: 1 });
    const meta = makeTestMeta({ runs: 1, execution: failedRun });
    const report = buildEvalArtifact(EVAL_RUN_REPORT_ARTIFACT_TYPE, incomplete, meta);
    expect(report.completeness).toMatchObject({ requestedRuns: 1, completedRuns: 0, failedRuns: 1, complete: false });
    expect(() => parseEvalArtifact({ ...report, completeness: { ...report.completeness, complete: true } }, { expectedType: EVAL_RUN_REPORT_ARTIFACT_TYPE }))
      .toThrow(/completeness\.complete is inconsistent with the payload\/execution \(expected false\)/);
    expect(() => parseEvalArtifact({ ...validEnvelope(), completeness: { ...validEnvelope().completeness, complete: false } }, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE }))
      .toThrow(/completeness\.complete is inconsistent with the payload\/execution \(expected true\)/);
    expect(() => buildEvalArtifact(EVAL_BASELINE_ARTIFACT_TYPE, incomplete, meta)).toThrow(/baseline artifacts require complete/);
  });
});

describe("historical quality artifact governance", () => {
  const parseQuality = (value: unknown) => parseEvalArtifact(value, { expectedType: EVAL_RUN_REPORT_ARTIFACT_TYPE });
  const mutation = (change: (value: ReturnType<typeof makeHistoricalQualityArtifact>) => void) => {
    const value = structuredClone(makeHistoricalQualityArtifact());
    change(value);
    return value;
  };

  it("exports canonical measurement, transport-row, and single-attempt execution schemas", () => {
    const artifact = makeHistoricalQualityArtifact();
    expect(HistoricalQualityMeasurementSchema.safeParse(artifact.measurement).success).toBeTrue();
    const { caseId: _caseId, rule: _rule, runs: _runs, passes: _passes, passRate: _passRate, flaky: _flaky, scoredRunIds: _ids, ...transport } = artifact.payload.cases[0];
    expect(HistoricalQualityTransportRowSchema.safeParse(transport).success).toBeTrue();
    expect(HistoricalQualityExecutionRunSchema.safeParse(artifact.execution.runs[0]).success).toBeTrue();
  });

  it("binds execution completeness to exact coverage and reserves verdicts for complete full-corpus selections", () => {
    const completeSubset = structuredClone(makeHistoricalQualityArtifact());
    completeSubset.selection = { fullCorpus: false, filters: { case: "historical/case-1" } };
    completeSubset.measurement.qualityVerdictAvailable = false;
    const completeTriggerSubset = makeHistoricalQualityArtifact({ emittedSlots: 1, requestedSlots: 1 });
    completeTriggerSubset.measurement.qualityVerdictAvailable = false;

    const uneven = makeHistoricalQualityArtifact({ repetitions: 3 });
    reassignHistoricalQualitySlot(uneven, 2, {
      logicalCaseId: "historical/safe-replacement",
      trigger: "intent",
      repetition: 0,
    });
    uneven.measurement.qualityVerdictAvailable = false;
    uneven.completeness.complete = false;

    const diagnostics = [
      { name: "complete full corpus", artifact: makeHistoricalQualityArtifact(), complete: true, verdict: true },
      { name: "complete filtered subset", artifact: completeSubset, complete: true, verdict: false },
      { name: "complete trigger subset", artifact: completeTriggerSubset, complete: true, verdict: false },
      { name: "partial group", artifact: makeHistoricalQualityArtifact({ repetitions: 3, emittedSlots: 29, requestedSlots: 30 }), complete: false, verdict: false },
      { name: "ten of eleven emitted", artifact: makeHistoricalQualityArtifact({ requestedSlots: 11 }), complete: false, verdict: false },
      { name: "zero of eleven emitted", artifact: makeHistoricalQualityArtifact({ emittedSlots: 0, requestedSlots: 11 }), complete: false, verdict: false },
      { name: "count-preserving uneven replacement", artifact: uneven, complete: false, verdict: false },
    ];

    for (const { name, artifact, complete, verdict } of diagnostics) {
      expect(parseQuality(artifact), `${name}: matching indicators`).toBeTruthy();

      const wrongCompleteness = structuredClone(artifact);
      wrongCompleteness.completeness.complete = !complete;
      expect(() => parseQuality(wrongCompleteness), `${name}: completeness.complete`).toThrow(/completeness\.complete/);

      const wrongVerdict = structuredClone(artifact);
      wrongVerdict.measurement.qualityVerdictAvailable = !verdict;
      expect(() => parseQuality(wrongVerdict), `${name}: measurement.qualityVerdictAvailable`).toThrow(/quality verdict availability/);
    }
  });

  it("rejects complete claims for holes, uneven groups, count-preserving replacement, and invalid group-count math", () => {
    const replacement = makeHistoricalQualityArtifact({ repetitions: 3 });
    reassignHistoricalQualitySlot(replacement, 2, {
      logicalCaseId: "historical/safe-replacement",
      trigger: "intent",
      repetition: 0,
    });
    expect(() => parseQuality(replacement)).toThrow(/repetition coverage|requested-slot math/i);

    const invalidMath = makeHistoricalQualityArtifact();
    invalidMath.measurement.repetitionsRequested = 3;
    expect(() => parseQuality(invalidMath)).toThrow(/repetition coverage|requested-slot math/i);
  });

  it("accepts complete and incomplete diagnostics, identifies quality, and forbids baselines/V1", () => {
    const complete = parseQuality(makeHistoricalQualityArtifact());
    expect(isHistoricalQualityArtifact(complete)).toBeTrue();
    expect((parseQuality(makeIncompleteHistoricalQualityArtifact()).completeness as { complete: boolean }).complete).toBeFalse();
    expect(() => parseEvalArtifact({ ...makeHistoricalQualityArtifact(), artifactType: EVAL_BASELINE_ARTIFACT_TYPE }, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow();
    expect(() => parseEvalArtifact({ ...makeHistoricalQualityArtifact(), schemaVersion: 1 }, { expectedType: EVAL_RUN_REPORT_ARTIFACT_TYPE })).toThrow();
  });

  it("rejects terminal-failed rows with final ranks despite coherent execution-stage metrics", () => {
    const artifact = structuredClone(makeIncompleteHistoricalQualityArtifact());
    const failedRow = artifact.payload.cases[9];
    failedRow.participantMetrics = structuredClone(artifact.payload.cases[0].participantMetrics)
      .map((metric) => ({ ...metric, failureStage: "execution" as const }));

    expect(() => parseQuality(artifact)).toThrow(/failed transport row final ranks must be null/);
  });

  it("rejects every independent completion/pass/execution/funnel/verdict inconsistency", () => {
    const changes: Array<(value: ReturnType<typeof makeHistoricalQualityArtifact>) => void> = [
      (value) => { value.runs = 2 as never; },
      (value) => { value.payload.runs = 2 as never; },
      (value) => { value.payload.cases[0].completed = false; },
      (value) => { value.payload.cases[0].passes = 0; },
      (value) => { value.payload.cases[0].passRate = 0; },
      (value) => { value.payload.cases[0].stageFunnel = null; },
      (value) => { value.execution.runs[0].outcome = "failed"; },
      (value) => { value.execution.runs[0].attempts[0].outcome = "failure"; },
      (value) => { value.execution.runs[0].attempts.push(structuredClone(value.execution.runs[0].attempts[0])); },
      (value) => { value.execution.runs[0].recovered = true as never; },
      (value) => { value.execution.runs[0].attempts[0].retryable = true as never; },
      (value) => { value.execution.runs[0].attempts[0].backoffMs = 1 as never; },
      (value) => { value.measurement.completedSlots -= 1; },
      (value) => { value.measurement.qualityVerdictAvailable = false; },
      (value) => { value.payload.cases[0].rule = "other" as never; },
      (value) => { value.measurement.scorecardSemantics = "other" as never; },
      (value) => { value.payload.cases[0].participantMetrics.pop(); },
      (value) => { value.payload.cases[0].stageFunnel!.participants = 23; },
    ];
    for (const [index, change] of changes.entries()) {
      expect(() => parseQuality(mutation(change)), `mutation ${index}`).toThrow();
    }
  });

  it("enforces deterministic unique transport slots and one execution row per emitted slot", () => {
    expect(() => parseQuality(mutation((value) => {
      value.payload.cases[1].caseId = value.payload.cases[0].caseId;
      value.payload.cases[1].logicalCaseId = value.payload.cases[0].logicalCaseId;
      value.payload.cases[1].trigger = value.payload.cases[0].trigger;
    }))).toThrow(/duplicate|deterministic|transport/i);
    expect(() => parseQuality(mutation((value) => { value.payload.cases[0].caseId = "invented"; }))).toThrow(/deterministic|transport/i);
    expect(() => parseQuality(mutation((value) => { value.execution.runs.pop(); }))).toThrow(/execution|row/i);
  });

  it("preserves every legacy attempt/run refinement across independent mutations", () => {
    type LegacyEnvelope = ReturnType<typeof validEnvelope>;
    const invalid = (
      expected: RegExp,
      change: (value: LegacyEnvelope) => void,
      seed: () => LegacyEnvelope = () => structuredClone(validEnvelope()),
    ): void => {
      const value = seed();
      change(value);
      expect(() => parseEvalArtifact(value, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toThrow(expected);
    };
    const recovered = (): LegacyEnvelope => {
      const value = structuredClone(validEnvelope());
      const run = value.execution.runs[0];
      const first = run.attempts[0];
      first.outcome = "failure";
      first.error = { class: "Error", message: "sanitized" };
      first.retryable = true;
      first.backoffMs = 1;
      const second = {
        ...structuredClone(first),
        attemptId: `${run.runId}::attempt:2`,
        attemptNumber: 2,
        startedAt: "2026-01-01T00:00:00.020Z",
        completedAt: "2026-01-01T00:00:00.030Z",
        outcome: "success" as const,
        error: undefined,
        retryable: false,
        backoffMs: 0,
      };
      run.attempts.push(second);
      run.recovered = true;
      value.completeness.totalAttempts += 1;
      value.completeness.recoveredRuns += 1;
      return value;
    };

    invalid(/precedes startedAt/, (value) => { value.execution.runs[0].attempts[0].completedAt = "2025-12-31T23:59:59.999Z"; });
    invalid(/durationMs is inconsistent/, (value) => { value.execution.runs[0].attempts[0].durationMs = 12; });
    invalid(/successful attempt must not have an error/, (value) => { value.execution.runs[0].attempts[0].error = { class: "Error", message: "safe" }; });
    invalid(/successful attempt cannot be retryable/, (value) => { value.execution.runs[0].attempts[0].retryable = true; });
    invalid(/successful attempt cannot schedule backoff/, (value) => { value.execution.runs[0].attempts[0].backoffMs = 1; });
    invalid(/requires a sanitized error/, (value) => { value.execution.runs[0].attempts[0].outcome = "failure"; });
    invalid(/unsanitized secret/, (value) => {
      value.execution.runs[0].attempts[0].outcome = "failure";
      value.execution.runs[0].attempts[0].error = { class: "Error", message: "Authorization: Bearer secret" };
    });
    invalid(/runId must be deterministic/, (value) => { value.execution.runs[0].runId = "invented"; });
    invalid(/does not belong to its run/, (value) => { value.execution.runs[0].attempts[0].runId = "other"; });
    invalid(/attempt numbers must be contiguous/, (value) => { value.execution.runs[0].attempts[0].attemptNumber = 2; });
    invalid(/attemptId must be deterministic/, (value) => { value.execution.runs[0].attempts[0].attemptId = "invented"; });
    invalid(/only retryable attempts/, (value) => { value.execution.runs[0].attempts[0].retryable = false; }, recovered);
    invalid(/cancelled attempts are terminal/, (value) => {
      const first = value.execution.runs[0].attempts[0];
      first.outcome = "cancelled";
      first.error = { class: "Error", message: "cancelled" };
    }, recovered);
    invalid(/chronological and non-overlapping/, (value) => {
      value.execution.runs[0].attempts[1].startedAt = "2026-01-01T00:00:00.005Z";
      value.execution.runs[0].attempts[1].completedAt = "2026-01-01T00:00:00.015Z";
    }, recovered);
    invalid(/non-retryable attempts cannot schedule backoff/, (value) => {
      const first = value.execution.runs[0].attempts[0];
      first.retryable = false;
      first.backoffMs = 1;
    }, recovered);
    invalid(/exactly one successful attempt/, (value) => {
      const first = value.execution.runs[0].attempts[0];
      first.outcome = "success";
      first.error = undefined;
      first.retryable = true;
      first.backoffMs = 0;
    }, recovered);
    invalid(/recovered is inconsistent/, (value) => { value.execution.runs[0].recovered = true; });
    invalid(/non-success run cannot contain a successful attempt/, (value) => { value.execution.runs[0].outcome = "failed"; });
    invalid(/non-success run cannot be recovered/, (value) => { value.execution.runs[0].outcome = "failed"; }, recovered);
    invalid(/failed run requires at least one attempt/, (value) => {
      value.execution.runs[0].outcome = "failed";
      value.execution.runs[0].attempts = [];
    });
    invalid(/run ending in a cancelled attempt must be cancelled/, (value) => {
      const run = value.execution.runs[0];
      run.outcome = "failed";
      run.attempts[0].outcome = "cancelled";
      run.attempts[0].error = { class: "Error", message: "cancelled" };
    });
    invalid(/cancelled attempt requires a cancelled run/, (value) => {
      const run = value.execution.runs[0];
      run.outcome = "failed";
      run.attempts[0].outcome = "cancelled";
      run.attempts[0].error = { class: "Error", message: "cancelled" };
      run.attempts.push({
        ...structuredClone(run.attempts[0]),
        attemptId: `${run.runId}::attempt:2`,
        attemptNumber: 2,
        outcome: "failure",
      });
    });
  });

  it("keeps representative legacy V1/V2 parse outcomes and issue paths stable", () => {
    const v2 = validEnvelope();
    expect(parseEvalArtifact(v2, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toEqual(v2);
    const invalid = structuredClone(v2);
    invalid.execution.runs[0].attempts[0].durationMs = 999;
    try {
      parseEvalArtifact(invalid, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE });
      throw new Error("expected invalid legacy fixture");
    } catch (error) {
      expect(String(error)).toContain("execution.runs.0.attempts.0.durationMs: attempt durationMs is inconsistent with timestamps");
    }
    const v1 = migrateLegacyBaseline(legacyScorecard(), { harness: "test-harness", harnessVersion: "1" });
    expect(parseEvalArtifact(v1, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toEqual(v1);
  });
});

describe("fingerprints", () => {
  it("is independent of key order", () => {
    expect(fingerprintCanonicalJson({ a: 1, b: [{ x: 1, y: 2 }] }))
      .toBe(fingerprintCanonicalJson({ b: [{ y: 2, x: 1 }], a: 1 }));
  });

  it("is sensitive to array order and values", () => {
    expect(fingerprintCanonicalJson([1, 2])).not.toBe(fingerprintCanonicalJson([2, 1]));
    expect(fingerprintCanonicalJson({ a: 1 })).not.toBe(fingerprintCanonicalJson({ a: 2 }));
  });

  it("treats undefined values and functions as absent", () => {
    expect(fingerprintCanonicalJson({ a: 1, b: undefined, f: () => 1 })).toBe(fingerprintCanonicalJson({ a: 1 }));
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalizeForFingerprint({ a: Number.POSITIVE_INFINITY })).toThrow(/non-finite/);
  });

  it("fingerprints a corpus deterministically", () => {
    const corpus = [{ id: "case-1", input: "x" }, { id: "case-2", input: "y" }];
    expect(fingerprintEvalCorpus(corpus)).toBe(fingerprintEvalCorpus([...corpus]));
    expect(fingerprintEvalCorpus(corpus)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("refuses secret-like keys in config fingerprints", () => {
    expect(() => fingerprintEvalConfig({ runs: 3, apiKey: "sk-nope" })).toThrow(/secret-like key/);
    expect(() => fingerprintEvalConfig({ nested: { OPENROUTER_API_KEY: "x" } })).toThrow(/secret-like key/);
    expect(fingerprintEvalConfig({ runs: 3, alpha: 0.05 })).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("readEvalGitProvenance", () => {
  it("reads a clean revision deterministically via the injected runner", () => {
    const git = readEvalGitProvenance("/repo", (args) => (args[0] === "rev-parse" ? TEST_REVISION : ""));
    expect(git).toEqual({ revision: TEST_REVISION, dirty: false });
  });

  it("marks dirty worktrees", () => {
    const git = readEvalGitProvenance("/repo", (args) => (args[0] === "rev-parse" ? TEST_REVISION : " M file.ts"));
    expect(git).toEqual({ revision: TEST_REVISION, dirty: true });
  });

  it("falls back to unknown when git is unavailable", () => {
    const git = readEvalGitProvenance("/repo", () => {
      throw new Error("no git");
    });
    expect(git).toEqual({ revision: "unknown", dirty: null });
  });

  it("rejects non-revision output", () => {
    const git = readEvalGitProvenance("/repo", () => "not-a-hash");
    expect(git).toEqual({ revision: "unknown", dirty: null });
  });
});

describe("migrateLegacyBaseline", () => {
  it("preserves the legacy payload value-for-value with explicit sentinels", () => {
    const legacy = legacyScorecard();
    const envelope = migrateLegacyBaseline(JSON.parse(JSON.stringify(legacy)), {
      harness: "test-harness",
      harnessVersion: "1",
    });
    expect(envelope.source).toBe("legacy-migration");
    expect(envelope.corpusFingerprint).toBe(EVAL_LEGACY_UNAVAILABLE);
    expect(envelope.configFingerprint).toBe(EVAL_LEGACY_UNAVAILABLE);
    expect(envelope.git).toEqual({ revision: "unknown", dirty: null });
    expect(envelope.createdAt).toBe(legacy.generatedAt);
    expect(JSON.parse(JSON.stringify(envelope.payload))).toEqual(JSON.parse(JSON.stringify(legacy)));
    expect(envelope.schemaVersion).toBe(1);
    expect("execution" in envelope).toBe(false);
    expect(getExecutionEvidence(envelope)).toBeNull();
  });

  it("splits legacy multi-model strings into unique model ids", () => {
    const legacy = { ...legacyScorecard(), model: "provider/a / provider/a" };
    const envelope = migrateLegacyBaseline(JSON.parse(JSON.stringify(legacy)), {
      harness: "test-harness",
      harnessVersion: "1",
    });
    expect(envelope.models).toEqual(["provider/a"]);
  });

  it("refuses non-legacy input", () => {
    expect(() => migrateLegacyBaseline(validEnvelope(), { harness: "h", harnessVersion: "1" }))
      .toThrow(/not a legacy unversioned scorecard/);
  });

  it("refuses an internally inconsistent legacy scorecard", () => {
    const legacy = legacyScorecard();
    const bad = { ...legacy, cases: legacy.cases.map((c, i) => (i === 0 ? { ...c, passRate: 0.5 } : c)) };
    expect(() => migrateLegacyBaseline(JSON.parse(JSON.stringify(bad)), { harness: "h", harnessVersion: "1" }))
      .toThrow(/inconsistent|Invalid eval artifact/);
  });

  it("detects legacy scorecards structurally", () => {
    expect(looksLikeLegacyScorecard(legacyScorecard())).toBe(true);
    expect(looksLikeLegacyScorecard(validEnvelope())).toBe(false);
    expect(looksLikeLegacyScorecard("nope")).toBe(false);
  });

  it("reads v1 and v2 envelopes without normalizing v1 provenance", () => {
    const v1 = migrateLegacyBaseline(legacyScorecard(), { harness: "test-harness", harnessVersion: "1" });
    const v2 = validEnvelope();
    const parsedV1 = parseEvalArtifact(v1, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE });
    const parsedV2 = parseEvalArtifact(v2, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE });
    expect(isEvalArtifactV2(parsedV1)).toBe(false);
    expect(getExecutionEvidence(parsedV1)).toBeNull();
    expect(isEvalArtifactV2(parsedV2)).toBe(true);
    expect(getExecutionEvidence(parsedV2)?.runs).toHaveLength(9);
  });
});
