import { describe, expect, it } from "bun:test";

import { buildHistoricalParticipantMetrics } from "../historical-quality.metrics.js";
import { HISTORICAL_QUALITY_CHILD_OUTPUT_SCHEMA_VERSION, HistoricalQualityChildOutputSchema, parseHistoricalQualityChildOutput, type HistoricalQualityChildOutput } from "../historical-quality.child-output.js";

const fingerprint = "a".repeat(64);
const logicalCaseId = "historical/case-a";
const executionCaseId = `${encodeURIComponent(logicalCaseId)}/intent/r1`;
const executionRunId = `${encodeURIComponent(executionCaseId)}::run:1`;

const forbiddenValues = ["neonA1B2C3", "openrouterX7Y8", "redisZ9W0", "databaseQ1R2", "manifestS3T4", "providerU5V6"];

function failedParticipantMetrics() {
  const candidates = Array.from({ length: 24 }, (_, index) => ({
    participantId: `participant-${String(index + 1).padStart(2, "0")}`,
    role: index === 0 ? "target" as const : index < 4 ? "semantic-negative" as const : "background" as const,
  }));
  return buildHistoricalParticipantMetrics({
    completed: false,
    candidates,
    retrievalEvidence: [],
    evaluatorTraces: candidates.map(({ participantId }) => ({
      participantId,
      eligible: false,
      submitted: false,
      returned: false,
      score: null,
    })),
    evaluatedOpportunities: [],
  });
}

function completedParticipantMetrics(evidenceIdOverride?: string) {
  const candidates = Array.from({ length: 24 }, (_, index) => ({
    participantId: `participant-${String(index + 1).padStart(2, "0")}`,
    role: index === 0 ? "target" as const : index < 4 ? "semantic-negative" as const : "background" as const,
  }));
  const metrics = buildHistoricalParticipantMetrics({
    completed: true,
    candidates,
    retrievalEvidence: candidates.slice(0, 1).map(({ participantId }) => ({
      participantId,
      evidenceId: evidenceIdOverride ?? "evidence-target-01",
      evidenceType: "intent" as const,
      score: 0.5,
    })),
    evaluatorTraces: candidates.map(({ participantId }, index) => ({
      participantId,
      eligible: index === 0,
      submitted: index === 0,
      returned: index === 0,
      score: index === 0 ? 0.5 : null,
    })),
    evaluatedOpportunities: ["participant-01"],
  });
  return metrics;
}

type CanonicalChildOutput = HistoricalQualityChildOutput;
type CanonicalAttemptTuple = CanonicalChildOutput["executionRun"]["attempts"];

const validOutput = (): CanonicalChildOutput => ({
  schemaVersion: HISTORICAL_QUALITY_CHILD_OUTPUT_SCHEMA_VERSION,
  runId: "hq-run-test",
  slotId: "hq-slot-test",
  configurationId: "a" as const,
  transportRow: {
    kind: "historical-quality-pilot" as const,
    logicalCaseId,
    trigger: "intent" as const,
    repetition: 0,
    configurationFingerprint: fingerprint,
    completed: false,
    participantMetrics: failedParticipantMetrics(),
    stageFunnel: null,
  },
  executionRun: {
    runId: executionRunId,
    caseId: executionCaseId,
    runIndex: 0 as const,
    outcome: "success" as const,
    recovered: false as const,
    attempts: [{
      attemptId: `${executionRunId}::attempt:1`,
      runId: executionRunId,
      runIndex: 0,
      attemptNumber: 1,
      startedAt: "2026-08-10T00:00:00.000Z",
      completedAt: "2026-08-10T00:00:00.010Z",
      durationMs: 10,
      outcome: "success",
      retryable: false,
      backoffMs: 0,
    }] as CanonicalAttemptTuple,
  },
});

const mutableOutput = (): CanonicalChildOutput => structuredClone(validOutput());

function validIdentity() {
  return {
    runId: "hq-run-test",
    slotId: "hq-slot-test",
    configurationId: "a" as const,
    configurationFingerprint: fingerprint,
    logicalCaseId,
    trigger: "intent" as const,
    repetition: 0,
    forbiddenValues,
  };
}

describe("HistoricalQualityChildOutputSchema", () => {
  it("strictly accepts exactly one PR A transport row and one execution run", () => {
    const output = validOutput();
    expect(HistoricalQualityChildOutputSchema.parse(output)).toEqual(output);
  });

  it("validates exact dispatch and planned slot identities", () => {
    const output = validOutput();
    expect(parseHistoricalQualityChildOutput(output, validIdentity())).toEqual(output);

    for (const expected of [
      { runId: "other-run" },
      { slotId: "other-slot" },
      { configurationId: "b" },
      { configurationFingerprint: "b".repeat(64) },
      { logicalCaseId: "historical/other" },
      { trigger: "enrichment" },
      { repetition: 1 },
    ]) {
      expect(() => parseHistoricalQualityChildOutput(output, {
        ...validIdentity(),
        ...expected,
      } as never)).toThrow(/identity/);
    }
  });

  it("rejects a mismatched execution run caseId", () => {
    const output = validOutput();
    expect(() => parseHistoricalQualityChildOutput(output, {
      ...validIdentity(),
      logicalCaseId: "historical/other",
    })).toThrow(/identity/);
  });

  it.each(forbiddenValues)("rejects a forbidden sentinel in participantId: %s", (sentinel) => {
    const output = mutableOutput();
    const metrics = output.transportRow.participantMetrics;
    metrics[1] = { ...metrics[1]!, participantId: `prefix-${sentinel}-suffix` };
    expect(() => parseHistoricalQualityChildOutput(output, validIdentity())).toThrow(/forbidden/);
  });

  it.each(forbiddenValues)("rejects a forbidden sentinel in evidenceIds: %s", (sentinel) => {
    const output = mutableOutput();
    output.transportRow.completed = true;
    output.transportRow.participantMetrics = completedParticipantMetrics(`evidence-${sentinel}`);
    output.transportRow.stageFunnel = {
      slots: 1,
      participants: 24,
      target: { total: 1, retrieved: 1, evaluatorEligible: 1, evaluatorSubmitted: 1, evaluatorReturned: 1, finalIncluded: 1 },
      semanticNegatives: { total: 3, retrieved: 0, evaluatorEligible: 0, evaluatorSubmitted: 0, evaluatorReturned: 0, finalIncluded: 0 },
      backgrounds: { total: 20, retrieved: 0, evaluatorEligible: 0, evaluatorSubmitted: 0, evaluatorReturned: 0, finalIncluded: 0 },
      targetRetrievalRank: { count: 1, sum: 1, mean: 1 },
      targetFinalRank: { count: 1, sum: 1, mean: 1 },
      failureStages: { execution: 0, retrieval: 23, evaluation_admission: 0, evaluation_rejection: 0, finalization: 0, none: 1 },
    };
    expect(() => parseHistoricalQualityChildOutput(output, validIdentity())).toThrow(/forbidden/);
  });

  it.each(forbiddenValues)("rejects a forbidden sentinel in error.message: %s", (sentinel) => {
    const output = mutableOutput();
    output.executionRun.outcome = "failed";
    output.executionRun.attempts[0] = {
      ...output.executionRun.attempts[0]!,
      outcome: "failure" as const,
      retryable: false as const,
      error: { class: "runtime", code: "ERR_TEST", message: `boom ${sentinel} leaked` },
    };
    expect(() => parseHistoricalQualityChildOutput(output, validIdentity())).toThrow(/forbidden/);
  });

  it("ignores blank sentinels when scanning for leaks", () => {
    const output = validOutput();
    expect(parseHistoricalQualityChildOutput(output, {
      ...validIdentity(),
      forbiddenValues: ["", "   "],
    })).toEqual(output);
  });

  it.each([
    ["unknown envelope field", (value: ReturnType<typeof validOutput>) => ({ ...value, secret: "credential-sentinel" })],
    ["unknown transport field", (value: ReturnType<typeof validOutput>) => ({ ...value, transportRow: { ...value.transportRow, databaseUrl: "postgres://secret" } })],
    ["unknown execution field", (value: ReturnType<typeof validOutput>) => ({ ...value, executionRun: { ...value.executionRun, apiKey: "secret" } })],
    ["wrong schema version", (value: ReturnType<typeof validOutput>) => ({ ...value, schemaVersion: 2 })],
    ["multiple transport rows", (value: ReturnType<typeof validOutput>) => ({ ...value, transportRow: [value.transportRow, value.transportRow] })],
    ["multiple execution runs", (value: ReturnType<typeof validOutput>) => ({ ...value, executionRun: [value.executionRun, value.executionRun] })],
  ])("rejects %s", (_label, mutate) => {
    expect(() => HistoricalQualityChildOutputSchema.parse(mutate(validOutput()))).toThrow();
  });
});
