import { describe, expect, it } from "bun:test";
import { buildHistoricalParticipantMetrics, classifyHistoricalFailureStage, dedupeHistoricalRetrieval, executionCompletenessFields, summarizeHistoricalQualityRun, summarizeHistoricalQualitySlot, type HistoricalCandidateMetricInput, type HistoricalEvaluatorTrace, type HistoricalParticipantMetric, type HistoricalParticipantMetricsInput } from "../historical-quality.metrics.js";

function candidates(): HistoricalCandidateMetricInput[] {
  return [
    { participantId: "target", role: "target" },
    ...Array.from({ length: 3 }, (_, index) => ({
      participantId: `negative-${index + 1}`,
      role: "semantic-negative" as const,
    })),
    ...Array.from({ length: 20 }, (_, index) => ({
      participantId: `background-${String(index + 1).padStart(2, "0")}`,
      role: "background" as const,
    })),
  ];
}

function completeInput(): HistoricalParticipantMetricsInput {
  const candidateRows = candidates();
  const retrievalEvidence = candidateRows.flatMap((candidate, index) => [
    {
      participantId: candidate.participantId,
      score: 1 - index / 100,
      evidenceType: index % 2 === 0 ? "intent" as const : "premise" as const,
      evidenceId: `evidence-${index + 1}`,
    },
  ]);
  const evaluatorTraces: HistoricalEvaluatorTrace[] = candidateRows.map(({ participantId }, index) => ({
    participantId,
    eligible: true,
    submitted: true,
    returned: true,
    score: 90 - index,
  }));
  return {
    completed: true,
    candidates: candidateRows,
    retrievalEvidence,
    evaluatorTraces,
    evaluatedOpportunities: candidateRows.map(({ participantId }) => participantId),
  };
}

function transitionInput(): HistoricalParticipantMetricsInput {
  const input = completeInput();
  const retrievalMissing = "background-01";
  const ineligible = "background-02";
  const unsubmitted = "negative-2";
  const rejected = "negative-3";
  const returnedNotFinal = "negative-1";

  return {
    ...input,
    retrievalEvidence: input.retrievalEvidence.filter((row) => row.participantId !== retrievalMissing),
    evaluatorTraces: input.evaluatorTraces.map((trace) => {
      if (trace.participantId === retrievalMissing || trace.participantId === ineligible) {
        return { participantId: trace.participantId, eligible: false, submitted: false, returned: false, score: null };
      }
      if (trace.participantId === unsubmitted) {
        return { participantId: trace.participantId, eligible: true, submitted: false, returned: false, score: null };
      }
      if (trace.participantId === rejected) {
        return {
          participantId: trace.participantId,
          eligible: true,
          submitted: true,
          returned: false,
          score: null,
          errorClass: "evaluator_timeout",
        };
      }
      return trace;
    }),
    evaluatedOpportunities: [
      "background-20",
      "target",
      ...input.evaluatedOpportunities.filter((participantId) => ![
        "background-20",
        "target",
        retrievalMissing,
        ineligible,
        unsubmitted,
        rejected,
        returnedNotFinal,
      ].includes(participantId)),
    ],
  };
}

function metric(metrics: readonly HistoricalParticipantMetric[], participantId: string): HistoricalParticipantMetric {
  const found = metrics.find((candidate) => candidate.participantId === participantId);
  if (!found) throw new Error(`Missing metric ${participantId}`);
  return found;
}

function cloneMetrics(metrics: readonly HistoricalParticipantMetric[]): HistoricalParticipantMetric[] {
  return structuredClone(metrics) as HistoricalParticipantMetric[];
}

describe("historical quality metrics", () => {
  it("deduplicates evidence rows by participant using best score, evidence union, descending rank, and stable-id ties", () => {
    expect(dedupeHistoricalRetrieval([
      { participantId: "b", score: 0.8, evidenceType: "premise", evidenceId: "p-2" },
      { participantId: "a", score: 0.8, evidenceType: "intent", evidenceId: "i-1" },
      { participantId: "b", score: 0.9, evidenceType: "user_context", evidenceId: "c-1" },
      { participantId: "a", score: 0.7, evidenceType: "premise", evidenceId: "p-1" },
      { participantId: "b", score: 0.85, evidenceType: "premise", evidenceId: "p-2" },
    ])).toEqual([
      { participantId: "b", retrievalRank: 1, bestScore: 0.9, evidenceTypes: ["premise", "user_context"], evidenceIds: ["c-1", "p-2"] },
      { participantId: "a", retrievalRank: 2, bestScore: 0.8, evidenceTypes: ["intent", "premise"], evidenceIds: ["i-1", "p-1"] },
    ]);

    expect(dedupeHistoricalRetrieval([
      { participantId: "b", score: 0.8, evidenceType: "premise", evidenceId: "p-2" },
      { participantId: "a", score: 0.8, evidenceType: "premise", evidenceId: "p-1" },
    ]).map((row) => row.participantId)).toEqual(["a", "b"]);
  });

  it("rejects invalid retrieval observations", () => {
    expect(() => dedupeHistoricalRetrieval([
      { participantId: "a", score: Number.NaN, evidenceType: "intent", evidenceId: "i-1" },
    ])).toThrow(/finite score/);
    expect(() => dedupeHistoricalRetrieval([
      { participantId: "", score: 0.5, evidenceType: "intent", evidenceId: "i-1" },
    ])).toThrow(/participantId/);
    expect(() => dedupeHistoricalRetrieval([
      { participantId: "a", score: 0.5, evidenceType: "intent", evidenceId: "" },
    ])).toThrow(/evidenceId/);
  });

  it("classifies every state transition without calling unsubmitted participants rejected", () => {
    const base = {
      completed: true,
      targetId: "target",
      retrievedParticipantIds: ["target"],
      evaluator: { eligible: true, submitted: true, returned: true, finalIncluded: true },
    } as const;
    expect(classifyHistoricalFailureStage({ ...base, completed: false })).toBe("execution");
    expect(classifyHistoricalFailureStage({ ...base, retrievedParticipantIds: [] })).toBe("retrieval");
    expect(classifyHistoricalFailureStage({ ...base, evaluator: { eligible: false, submitted: false, returned: false, finalIncluded: false } })).toBe("evaluation_admission");
    expect(classifyHistoricalFailureStage({ ...base, evaluator: { eligible: true, submitted: false, returned: false, finalIncluded: false } })).toBe("evaluation_admission");
    expect(classifyHistoricalFailureStage({ ...base, evaluator: { eligible: true, submitted: true, returned: false, finalIncluded: false } })).toBe("evaluation_rejection");
    expect(classifyHistoricalFailureStage({ ...base, evaluator: { eligible: true, submitted: true, returned: true, finalIncluded: false } })).toBe("finalization");
    expect(classifyHistoricalFailureStage(base)).toBe("none");
  });

  it("builds exact target, semantic-negative, and background metrics for every evaluator state", () => {
    const metrics = buildHistoricalParticipantMetrics(transitionInput());

    expect(metrics).toHaveLength(24);
    expect(metrics.filter(({ role }) => role === "target")).toHaveLength(1);
    expect(metrics.filter(({ role }) => role === "semantic-negative")).toHaveLength(3);
    expect(metrics.filter(({ role }) => role === "background")).toHaveLength(20);

    expect(metric(metrics, "target")).toMatchObject({
      role: "target",
      evaluator: { eligible: true, submitted: true, returned: true, score: 90 },
      finalRank: 2,
      failureStage: "none",
    });
    expect(metric(metrics, "negative-2")).toMatchObject({
      role: "semantic-negative",
      evaluator: { eligible: true, submitted: false, returned: false, score: null },
      finalRank: null,
      failureStage: "evaluation_admission",
    });
    expect(metric(metrics, "negative-3")).toMatchObject({
      evaluator: { eligible: true, submitted: true, returned: false, score: null, errorClass: "evaluator_timeout" },
      finalRank: null,
      failureStage: "evaluation_rejection",
    });
    expect(metric(metrics, "negative-1")).toMatchObject({
      evaluator: { eligible: true, submitted: true, returned: true, score: 89 },
      finalRank: null,
      failureStage: "finalization",
    });
    expect(metric(metrics, "background-01")).toMatchObject({ retrieval: null, failureStage: "retrieval" });
    expect(metric(metrics, "background-02")).toMatchObject({
      role: "background",
      evaluator: { eligible: false, submitted: false, returned: false, score: null },
      failureStage: "evaluation_admission",
    });
  });

  it("derives final rank only from thresholded evaluator order, never retrieval or persistence order", () => {
    const input = completeInput();
    const operationalInput = {
      ...input,
      evaluatedOpportunities: ["background-20", "target"],
      persistenceOrder: ["target", "background-20"],
      duplicateSuppressionOrder: ["target"],
      conflictSuppressionOrder: ["target"],
    };
    const metrics = buildHistoricalParticipantMetrics(operationalInput);

    expect(metric(metrics, "background-20").retrieval?.rank).toBe(24);
    expect(metric(metrics, "background-20").finalRank).toBe(1);
    expect(metric(metrics, "target").retrieval?.rank).toBe(1);
    expect(metric(metrics, "target").finalRank).toBe(2);
    expect(metric(metrics, "background-01").finalRank).toBeNull();
  });

  it("requires exact 1/3/20 candidate roles, unique complete traces, coherent transitions, and finite scores", () => {
    const input = completeInput();
    expect(() => buildHistoricalParticipantMetrics({ ...input, candidates: input.candidates.slice(0, 23) })).toThrow(/exactly 24/);
    expect(() => buildHistoricalParticipantMetrics({ ...input, candidates: [...input.candidates.slice(0, 23), input.candidates[0]!] })).toThrow(/duplicate participant/);
    expect(() => buildHistoricalParticipantMetrics({
      ...input,
      candidates: input.candidates.map((candidate) => candidate.role === "target" ? { ...candidate, role: "background" as const } : candidate),
    })).toThrow(/1 target, 3 semantic-negative, and 20 background/);
    expect(() => buildHistoricalParticipantMetrics({ ...input, evaluatorTraces: input.evaluatorTraces.slice(0, 23) })).toThrow(/one evaluator trace/);
    expect(() => buildHistoricalParticipantMetrics({
      ...input,
      evaluatorTraces: input.evaluatorTraces.map((trace) => trace.participantId === "target"
        ? { ...trace, submitted: false, returned: true }
        : trace),
    })).toThrow(/returned without submission/);
    expect(() => buildHistoricalParticipantMetrics({
      ...input,
      evaluatorTraces: input.evaluatorTraces.map((trace) => trace.participantId === "target"
        ? { ...trace, score: Number.POSITIVE_INFINITY }
        : trace),
    })).toThrow(/finite score/);
    expect(() => buildHistoricalParticipantMetrics({ ...input, evaluatedOpportunities: ["target", "target"] })).toThrow(/duplicate thresholded/);
    expect(() => buildHistoricalParticipantMetrics({
      ...input,
      retrievalEvidence: input.retrievalEvidence.map((row) => row.participantId === "target"
        ? { ...row, evidenceId: "raw corpus text is not an ID" }
        : row),
    })).toThrow(/stable ID/);
    expect(() => buildHistoricalParticipantMetrics({
      ...input,
      evaluatorTraces: input.evaluatorTraces.map((trace) => trace.participantId === "target"
        ? { participantId: "target", eligible: true, submitted: true, returned: false, score: null }
        : trace),
      evaluatedOpportunities: ["target"],
    })).toThrow(/thresholded participant must have returned/);
  });

  it("marks all participant failures execution when a slot did not complete", () => {
    const metrics = buildHistoricalParticipantMetrics({ ...completeInput(), completed: false });
    expect(new Set(metrics.map(({ failureStage }) => failureStage))).toEqual(new Set(["execution"]));
    expect(metrics.every(({ finalRank }) => finalRank === null)).toBe(true);
  });

  it("builds a complete, additive slot funnel with ranks and every failure stage", () => {
    const summary = summarizeHistoricalQualitySlot({
      completed: true,
      participantMetrics: buildHistoricalParticipantMetrics(transitionInput()),
      passes: 0,
    });

    expect(summary.qualityVerdictAvailable).toBe(true);
    expect(summary.summary).toEqual({
      slots: 1,
      participants: 24,
      target: { total: 1, retrieved: 1, evaluatorEligible: 1, evaluatorSubmitted: 1, evaluatorReturned: 1, finalIncluded: 1 },
      semanticNegatives: { total: 3, retrieved: 3, evaluatorEligible: 3, evaluatorSubmitted: 2, evaluatorReturned: 1, finalIncluded: 0 },
      backgrounds: { total: 20, retrieved: 19, evaluatorEligible: 18, evaluatorSubmitted: 18, evaluatorReturned: 18, finalIncluded: 18 },
      targetRetrievalRank: { count: 1, sum: 1, mean: 1 },
      targetFinalRank: { count: 1, sum: 2, mean: 2 },
      failureStages: {
        execution: 0,
        retrieval: 1,
        evaluation_admission: 2,
        evaluation_rejection: 1,
        finalization: 1,
        none: 19,
      },
    });
  });

  it("suppresses slot funnels for every incomplete or malformed 24-metric subset", () => {
    const valid = buildHistoricalParticipantMetrics(completeInput());
    const duplicate = cloneMetrics(valid);
    duplicate[23] = structuredClone(duplicate[0]!);
    const malformedScore = cloneMetrics(valid);
    malformedScore[0]!.evaluator.score = Number.NaN;
    const malformedTransition = cloneMetrics(valid);
    malformedTransition[0]!.evaluator.submitted = false;
    const malformedRank = cloneMetrics(valid);
    malformedRank[0]!.finalRank = null;
    const malformedFailure = cloneMetrics(valid);
    malformedFailure[0]!.failureStage = "finalization";

    for (const participantMetrics of [
      undefined,
      valid.slice(0, 23),
      duplicate,
      malformedScore,
      malformedTransition,
      malformedRank,
      malformedFailure,
    ]) {
      expect(summarizeHistoricalQualitySlot({ completed: true, participantMetrics })).toEqual({
        qualityVerdictAvailable: false,
        completed: false,
        summary: null,
        message: "no quality verdict",
      });
    }

    expect(summarizeHistoricalQualitySlot({ completed: false, participantMetrics: valid, passes: 1 })).toEqual({
      qualityVerdictAvailable: false,
      completed: false,
      summary: null,
      message: "no quality verdict",
    });
  });

  it("suppresses the whole run when any requested slot is missing, incomplete, or malformed", () => {
    const complete = summarizeHistoricalQualitySlot({
      completed: true,
      participantMetrics: buildHistoricalParticipantMetrics(completeInput()),
    });
    const incomplete = summarizeHistoricalQualitySlot({ completed: false, participantMetrics: [] });
    const malformed = summarizeHistoricalQualitySlot({
      completed: true,
      participantMetrics: buildHistoricalParticipantMetrics(completeInput()).slice(0, 23),
    });

    const forged = structuredClone(complete);
    if (forged.summary !== null) forged.summary.target.finalIncluded = 0;

    for (const slots of [[complete, incomplete], [complete, undefined], [complete, malformed], [complete, forged]]) {
      expect(summarizeHistoricalQualityRun(slots)).toEqual({
        qualityVerdictAvailable: false,
        completedSlots: 1,
        requestedSlots: 2,
        summary: null,
        message: "no quality verdict",
      });
    }
    expect(summarizeHistoricalQualityRun([complete], 2)).toEqual({
      qualityVerdictAvailable: false,
      completedSlots: 1,
      requestedSlots: 2,
      summary: null,
      message: "no quality verdict",
    });
  });

  it("aggregates only quality funnels and never transport passes", () => {
    const metrics = buildHistoricalParticipantMetrics(completeInput());
    const passingTransport = summarizeHistoricalQualitySlot({ completed: true, participantMetrics: metrics, passes: 1 });
    const failingTransport = summarizeHistoricalQualitySlot({ completed: true, participantMetrics: metrics, passes: 0 });
    expect(failingTransport).toEqual(passingTransport);

    const run = summarizeHistoricalQualityRun([passingTransport, failingTransport]);
    expect(run.qualityVerdictAvailable).toBe(true);
    expect(run.completedSlots).toBe(2);
    expect(run.requestedSlots).toBe(2);
    expect(run.summary).toMatchObject({
      slots: 2,
      participants: 48,
      target: { total: 2, finalIncluded: 2 },
      semanticNegatives: { total: 6, finalIncluded: 6 },
      backgrounds: { total: 40, finalIncluded: 40 },
      targetRetrievalRank: { count: 2, sum: 2, mean: 1 },
      targetFinalRank: { count: 2, sum: 2, mean: 1 },
      failureStages: { none: 48 },
    });
  });

  it("serializes only stable IDs, scalars, evidence IDs/types, roles, and safe error classes", () => {
    const input = transitionInput();
    const unsafeInput = {
      ...input,
      prompt: "SECRET CORPUS TEXT",
      citations: ["https://private.example/citation"],
      semanticNegativeReasons: ["audit reason"],
      reviewer: { email: "reviewer@example.com" },
      providerError: "Bearer provider-secret",
      credentials: { apiKey: "credential-secret" },
    };
    const serialized = JSON.stringify(buildHistoricalParticipantMetrics(unsafeInput));
    for (const forbidden of [
      "SECRET CORPUS TEXT",
      "private.example",
      "audit reason",
      "reviewer@example.com",
      "provider-secret",
      "credential-secret",
      "prompt",
      "citations",
      "reviewer",
      "providerError",
      "credentials",
    ]) expect(serialized).not.toContain(forbidden);

    expect(() => buildHistoricalParticipantMetrics({
      ...input,
      evaluatorTraces: input.evaluatorTraces.map((trace) => trace.participantId === "negative-3"
        ? { ...trace, errorClass: "Provider 401: Bearer credential-secret" }
        : trace),
    })).toThrow(/safe error class/);
  });

  it("maps scorecard transport fields to completeness only", () => {
    expect(executionCompletenessFields(true)).toEqual({ runs: 1, passes: 1, passRate: 1, flaky: false });
    expect(executionCompletenessFields(false)).toEqual({ runs: 1, passes: 0, passRate: 0, flaky: false });
  });
});
