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

function missedTargetInput(): HistoricalParticipantMetricsInput {
  const input = completeInput();
  return {
    ...input,
    retrievalEvidence: input.retrievalEvidence.filter((row) => row.participantId !== "target"),
    evaluatorTraces: input.evaluatorTraces.map((trace) => trace.participantId === "target"
      ? { participantId: trace.participantId, eligible: false, submitted: false, returned: false, score: null }
      : trace),
    evaluatedOpportunities: input.evaluatedOpportunities.filter((participantId) => participantId !== "target"),
  };
}

function runSlot(
  logicalCaseId: string,
  trigger: "intent" | "enrichment",
  repetition: number,
  input: HistoricalParticipantMetricsInput = completeInput(),
  passes = 1,
) {
  return {
    logicalCaseId,
    trigger,
    repetition,
    slotSummary: summarizeHistoricalQualitySlot({
      completed: true,
      participantMetrics: buildHistoricalParticipantMetrics(input),
      passes,
    }),
  };
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

  it("suppresses every group when any requested slot is missing, incomplete, malformed, or duplicated", () => {
    const complete = runSlot("historical/case-a", "intent", 0);
    const incomplete = {
      ...runSlot("historical/case-a", "intent", 1),
      slotSummary: summarizeHistoricalQualitySlot({ completed: false, participantMetrics: [] }),
    };
    const malformed = structuredClone(runSlot("historical/case-a", "intent", 1));
    if (malformed.slotSummary.summary !== null) malformed.slotSummary.summary.target.finalIncluded = 0;

    for (const { slots, completedSlots } of [
      { slots: [complete, incomplete], completedSlots: 1 },
      { slots: [complete, undefined], completedSlots: 1 },
      { slots: [complete, malformed], completedSlots: 1 },
      { slots: [complete, { ...complete }], completedSlots: 2 },
      { slots: [complete, { ...runSlot("historical/case-a", "intent", 1), repetition: -1 }], completedSlots: 2 },
      { slots: [complete, { ...runSlot("historical/case-a", "intent", 1), repetition: 0.5 }], completedSlots: 2 },
    ]) {
      expect(summarizeHistoricalQualityRun(slots, 2, 2)).toEqual({
        qualityVerdictAvailable: false,
        completedSlots,
        requestedSlots: 2,
        groups: null,
        message: "no quality verdict",
      });
    }
    expect(summarizeHistoricalQualityRun([complete], 2, 2)).toEqual({
      qualityVerdictAvailable: false,
      completedSlots: 1,
      requestedSlots: 2,
      groups: null,
      message: "no quality verdict",
    });
  });

  it("suppresses a run when forged target ranks exceed retrieved or final-included populations", () => {
    const complete = runSlot("historical/case-a", "intent", 0, transitionInput());
    const forgedRetrievalRank = structuredClone(complete);
    const forgedFinalRank = structuredClone(complete);
    if (forgedRetrievalRank.slotSummary.summary !== null) {
      forgedRetrievalRank.slotSummary.summary.targetRetrievalRank = { count: 1, sum: 24, mean: 24 };
    }
    if (forgedFinalRank.slotSummary.summary !== null) {
      forgedFinalRank.slotSummary.summary.targetFinalRank = { count: 1, sum: 24, mean: 24 };
    }

    for (const slot of [forgedRetrievalRank, forgedFinalRank]) {
      expect(summarizeHistoricalQualityRun([slot], 1, 1)).toEqual({
        qualityVerdictAvailable: false,
        completedSlots: 0,
        requestedSlots: 1,
        groups: null,
        message: "no quality verdict",
      });
    }
  });

  it("groups valid three-repetition subsets deterministically with additive counts and aligned ranks", () => {
    const slots = [
      runSlot("historical/case-b", "intent", 2, missedTargetInput()),
      runSlot("historical/case-a", "intent", 1, transitionInput()),
      runSlot("historical/case-a", "intent", 2, missedTargetInput()),
      runSlot("historical/case-a", "intent", 0),
      runSlot("historical/case-b", "intent", 1, transitionInput()),
      runSlot("historical/case-b", "intent", 0),
    ];

    const run = summarizeHistoricalQualityRun(slots, 6, 3);
    expect(run.qualityVerdictAvailable).toBe(true);
    if (!run.qualityVerdictAvailable) throw new Error("expected quality evidence");
    expect(run.completedSlots).toBe(6);
    expect(run.requestedSlots).toBe(6);
    expect(run.groups.map(({ logicalCaseId, trigger }) => `${logicalCaseId}:${trigger}`)).toEqual([
      "historical/case-a:intent",
      "historical/case-b:intent",
    ]);
    for (const group of run.groups) {
      expect(group).toMatchObject({
        repetitions: [0, 1, 2],
        completedRepetitions: 3,
        requestedRepetitions: 3,
        targetRetrievalRanks: [1, 1, null],
        targetFinalRanks: [1, 2, null],
        stageFunnel: {
          slots: 3,
          participants: 72,
          target: { total: 3, retrieved: 2, finalIncluded: 2 },
          failureStages: { retrieval: 2, evaluation_admission: 2, evaluation_rejection: 1, finalization: 1, none: 66 },
        },
      });
    }
  });

  it("suppresses holes, uneven groups, count-preserving replacements, and requested-slot math mismatches", () => {
    const invalidRuns = [
      { slots: [runSlot("historical/a", "intent", 0), runSlot("historical/a", "intent", 2)], requestedSlots: 2, repetitions: 2 },
      { slots: [runSlot("historical/a", "intent", 0), runSlot("historical/b", "intent", 0)], requestedSlots: 2, repetitions: 2 },
      {
        slots: [
          runSlot("historical/a", "intent", 0),
          runSlot("historical/b", "intent", 0),
          runSlot("historical/b", "intent", 1),
          runSlot("historical/safe-replacement", "intent", 0),
        ],
        requestedSlots: 4,
        repetitions: 2,
      },
      {
        slots: [runSlot("historical/a", "intent", 0), runSlot("historical/a", "intent", 1), runSlot("historical/b", "intent", 0)],
        requestedSlots: 3,
        repetitions: 2,
      },
    ];

    for (const { slots, requestedSlots, repetitions } of invalidRuns) {
      expect(summarizeHistoricalQualityRun(slots, requestedSlots, repetitions)).toEqual({
        qualityVerdictAvailable: false,
        completedSlots: slots.length,
        requestedSlots,
        groups: null,
        message: "no quality verdict",
      });
    }
  });

  it("requires explicit positive requested slots and repetitions", () => {
    const complete = runSlot("historical/a", "intent", 0);
    expect(() => summarizeHistoricalQualityRun([complete], 0, 1)).toThrow(/positive requested slot count/);
    expect(() => summarizeHistoricalQualityRun([complete], 1, 0)).toThrow(/positive requested repetition count/);
    expect(() => (summarizeHistoricalQualityRun as unknown as (slots: unknown[]) => unknown)([complete])).toThrow();
  });

  it("isolates triggers and ignores transport passes in grouped quality evidence", () => {
    const passingTransport = runSlot("historical/case-a", "intent", 0, completeInput(), 1);
    const failingTransport = runSlot("historical/case-a", "enrichment", 0, completeInput(), 0);
    expect(failingTransport.slotSummary).toEqual(passingTransport.slotSummary);

    const run = summarizeHistoricalQualityRun([failingTransport, passingTransport], 2, 1);
    expect(run.qualityVerdictAvailable).toBe(true);
    if (!run.qualityVerdictAvailable) throw new Error("expected quality evidence");
    expect(run.groups).toHaveLength(2);
    expect(run.groups.map((group) => group.trigger)).toEqual(["enrichment", "intent"]);
    expect(run.groups.every((group) => group.stageFunnel.slots === 1)).toBe(true);
  });

  it("rejects coercible safe-ID and error-class objects instead of copying their enumerable secrets", () => {
    const input = transitionInput();
    const coercible = (value: string, secret: string): unknown => ({
      secret,
      toString: () => value,
    });
    const candidateIdInput = structuredClone(input) as HistoricalParticipantMetricsInput;
    candidateIdInput.candidates[0]!.participantId = coercible("target", "candidate-secret") as string;
    expect(() => buildHistoricalParticipantMetrics(candidateIdInput)).toThrow(/stable ID/);

    const evidenceIdInput = structuredClone(input) as HistoricalParticipantMetricsInput;
    evidenceIdInput.retrievalEvidence[0]!.evidenceId = coercible("evidence-1", "evidence-secret") as string;
    expect(() => buildHistoricalParticipantMetrics(evidenceIdInput)).toThrow(/stable ID/);

    const errorClassInput = structuredClone(input) as HistoricalParticipantMetricsInput;
    errorClassInput.evaluatorTraces[3]!.errorClass = coercible("evaluator_timeout", "provider-credential") as string;
    expect(() => buildHistoricalParticipantMetrics(errorClassInput)).toThrow(/safe error class/);

    const metrics = buildHistoricalParticipantMetrics(input);
    metrics[0]!.participantId = coercible(metrics[0]!.participantId, "summary-secret") as string;
    expect(summarizeHistoricalQualitySlot({ completed: true, participantMetrics: metrics })).toEqual({
      qualityVerdictAvailable: false,
      completed: false,
      summary: null,
      message: "no quality verdict",
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
