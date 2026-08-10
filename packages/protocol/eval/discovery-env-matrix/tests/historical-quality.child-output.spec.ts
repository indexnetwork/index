import { describe, expect, it } from "bun:test";

import { buildHistoricalParticipantMetrics } from "../historical-quality.metrics.js";
import { HISTORICAL_QUALITY_CHILD_OUTPUT_SCHEMA_VERSION, HistoricalQualityChildOutputSchema, parseHistoricalQualityChildOutput } from "../historical-quality.child-output.js";

const fingerprint = "a".repeat(64);
const logicalCaseId = "historical/case-a";
const executionCaseId = `${logicalCaseId}/intent/r1`;
const executionRunId = `${encodeURIComponent(executionCaseId)}::run:1`;

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

const validOutput = () => ({
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
      outcome: "success" as const,
      retryable: false as const,
      backoffMs: 0 as const,
    }],
  },
});

describe("HistoricalQualityChildOutputSchema", () => {
  it("strictly accepts exactly one PR A transport row and one execution run", () => {
    const output = validOutput();
    expect(HistoricalQualityChildOutputSchema.parse(output)).toEqual(output);
  });

  it("validates exact dispatch and planned slot identities", () => {
    const output = validOutput();
    expect(parseHistoricalQualityChildOutput(output, {
      runId: output.runId,
      slotId: output.slotId,
      configurationId: "a",
      configurationFingerprint: fingerprint,
      logicalCaseId,
      trigger: "intent",
      repetition: 0,
    })).toEqual(output);

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
        runId: output.runId,
        slotId: output.slotId,
        configurationId: "a",
        configurationFingerprint: fingerprint,
        logicalCaseId,
        trigger: "intent",
        repetition: 0,
        ...expected,
      } as never)).toThrow(/identity/);
    }
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
