/**
 * Shared test fixtures for the versioned eval artifact envelope. Used by the
 * shared specs and by harness specs that exercise the envelope-backed
 * baseline/run-report writers.
 */
import type { EvalRunMeta } from "../artifact.js";
import type { EvalEvidencePolicy, EvalExecutionEvidence } from "../runner.js";

/** A syntactically valid SHA-256 fingerprint for fixtures. */
export const TEST_FINGERPRINT = "a".repeat(64);

/** A syntactically valid Git revision for fixtures. */
export const TEST_REVISION = "b".repeat(40);

/** Complete first-attempt-success evidence for artifact fixtures. */
export function makeSuccessfulExecution(
  caseIds: string[],
  runs: number,
  policy: EvalEvidencePolicy = "normal",
): EvalExecutionEvidence {
  return {
    policy,
    runs: caseIds.flatMap((caseId) => Array.from({ length: runs }, (_, runIndex) => {
      const runId = `${encodeURIComponent(caseId)}::run:${runIndex + 1}`;
      const attemptId = `${runId}::attempt:1`;
      return {
        runId,
        caseId,
        runIndex,
        outcome: "success" as const,
        recovered: false,
        attempts: [{
          attemptId,
          runId,
          runIndex,
          attemptNumber: 1,
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-01T00:00:00.010Z",
          durationMs: 10,
          outcome: "success" as const,
          retryable: false,
          backoffMs: 0,
        }],
      };
    })),
  };
}

/** A fully populated v2 run meta; override per test. */
export function makeTestMeta(overrides: Partial<EvalRunMeta> = {}): EvalRunMeta {
  return {
    harness: "test-harness",
    harnessVersion: "1",
    models: ["test/model"],
    runs: 1,
    selection: { fullCorpus: true, filters: {} },
    corpusFingerprint: TEST_FINGERPRINT,
    configFingerprint: TEST_FINGERPRINT,
    git: { revision: TEST_REVISION, dirty: false },
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:01:00.000Z",
    execution: makeSuccessfulExecution(["a"], 1),
    ...overrides,
  };
}

function qualityParticipantMetrics(completed: boolean) {
  return Array.from({ length: 24 }, (_, index) => ({
    participantId: `participant-${String(index + 1).padStart(2, "0")}`,
    role: index === 0 ? "target" as const : index < 4 ? "semantic-negative" as const : "background" as const,
    retrieval: completed ? {
      rank: index + 1,
      bestScore: 1 - index / 100,
      evidenceIds: [`evidence-${String(index + 1).padStart(2, "0")}`],
      evidenceTypes: ["intent" as const],
    } : null,
    evaluator: {
      eligible: completed,
      submitted: completed,
      returned: completed,
      score: completed ? 1 - index / 100 : null,
    },
    finalRank: completed ? index + 1 : null,
    failureStage: completed ? "none" as const : "execution" as const,
  }));
}

function qualityFunnel() {
  const stageCounts = (total: number) => ({
    total,
    retrieved: total,
    evaluatorEligible: total,
    evaluatorSubmitted: total,
    evaluatorReturned: total,
    finalIncluded: total,
  });
  return {
    slots: 1,
    participants: 24,
    target: stageCounts(1),
    semanticNegatives: stageCounts(3),
    backgrounds: stageCounts(20),
    targetRetrievalRank: { count: 1, sum: 1, mean: 1 },
    targetFinalRank: { count: 1, sum: 1, mean: 1 },
    failureStages: {
      execution: 0,
      retrieval: 0,
      evaluation_admission: 0,
      evaluation_rejection: 0,
      finalization: 0,
      none: 24,
    },
  };
}

/** Complete ten-slot quality artifact used by strict schema and Ops tests. */
export function makeHistoricalQualityArtifact(options: { emittedSlots?: number; failedSlot?: number; requestedSlots?: number } = {}) {
  const emittedSlots = options.emittedSlots ?? 10;
  const requestedSlots = options.requestedSlots ?? emittedSlots;
  const rows = Array.from({ length: emittedSlots }, (_, index) => {
    const logicalCaseId = `historical/case-${Math.floor(index / 2) + 1}`;
    const trigger = index % 2 === 0 ? "intent" as const : "enrichment" as const;
    const repetition = 0;
    const caseId = `${encodeURIComponent(logicalCaseId)}/${trigger}/r${repetition + 1}`;
    const completed = index !== options.failedSlot;
    return {
      caseId,
      rule: "execution-completeness" as const,
      runs: 1 as const,
      passes: completed ? 1 as const : 0 as const,
      passRate: completed ? 1 as const : 0 as const,
      flaky: false as const,
      scoredRunIds: completed ? [`${encodeURIComponent(caseId)}::run:1`] : [],
      kind: "historical-quality-pilot" as const,
      logicalCaseId,
      trigger,
      repetition,
      configurationFingerprint: TEST_FINGERPRINT,
      completed,
      participantMetrics: qualityParticipantMetrics(completed),
      stageFunnel: completed ? qualityFunnel() : null,
    };
  });
  const executionRuns = rows.map((row) => {
    const runId = `${encodeURIComponent(row.caseId)}::run:1`;
    const successful = row.completed;
    return {
      runId,
      caseId: row.caseId,
      runIndex: 0 as const,
      outcome: successful ? "success" as const : "failed" as const,
      recovered: false as const,
      attempts: [{
        attemptId: `${runId}::attempt:1`,
        runId,
        runIndex: 0 as const,
        attemptNumber: 1 as const,
        startedAt: "2026-01-01T00:00:00.000Z",
        completedAt: "2026-01-01T00:00:00.010Z",
        durationMs: 10,
        outcome: successful ? "success" as const : "failure" as const,
        ...(successful ? {} : { error: { class: "Error", message: "sanitized" } }),
        retryable: false as const,
        backoffMs: 0 as const,
      }],
    };
  });
  const completedSlots = rows.filter((row) => row.completed).length;
  const verdict = completedSlots === requestedSlots && rows.length === requestedSlots;
  return {
    artifactType: "index-eval/run-report" as const,
    schemaVersion: 2 as const,
    harness: "discovery",
    harnessVersion: "1",
    source: "run" as const,
    createdAt: "2026-01-01T00:01:00.000Z",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:30.000Z",
    models: ["test/model"],
    runs: 1 as const,
    selection: { fullCorpus: true, filters: {} },
    corpusFingerprint: TEST_FINGERPRINT,
    configFingerprint: TEST_FINGERPRINT,
    git: { revision: TEST_REVISION, dirty: false },
    completeness: {
      caseCount: rows.length,
      ruleCount: 1,
      totalRuns: rows.length,
      totalPasses: completedSlots,
      flakyCaseCount: 0,
      requestedRuns: rows.length,
      completedRuns: completedSlots,
      failedRuns: rows.length - completedSlots,
      recoveredRuns: 0,
      totalAttempts: rows.length,
      complete: verdict,
    },
    measurement: {
      kind: "historical-quality-pilot" as const,
      scorecardSemantics: "execution-completeness" as const,
      repetitionsRequested: 1,
      requestedSlots,
      completedSlots,
      qualityVerdictAvailable: verdict,
    },
    execution: { policy: "strict" as const, runs: executionRuns },
    payload: {
      generatedAt: "2026-01-01T00:00:30.000Z",
      model: "test/model",
      runs: 1 as const,
      aggregatePassRate: rows.length === 0 ? 0 : completedSlots / rows.length,
      rules: [{ rule: "execution-completeness" as const, caseCount: rows.length, passRate: rows.length === 0 ? 0 : completedSlots / rows.length }],
      cases: rows,
    },
  };
}

/** Ten emitted slots with one terminal failure and no quality verdict. */
export function makeIncompleteHistoricalQualityArtifact() {
  return makeHistoricalQualityArtifact({ failedSlot: 9 });
}
