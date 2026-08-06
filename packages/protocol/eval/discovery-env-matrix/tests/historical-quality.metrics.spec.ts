import { describe, expect, it } from "bun:test";
import { classifyHistoricalFailureStage, dedupeHistoricalRetrieval, executionCompletenessFields } from "../historical-quality.metrics.js";

describe("historical quality metrics", () => {
  it("deduplicates evidence rows by participant using best score and stable-id ties", () => {
    expect(dedupeHistoricalRetrieval([
      { participantId: "b", score: 0.8, evidenceType: "premise", evidenceId: "p-2" },
      { participantId: "a", score: 0.8, evidenceType: "intent", evidenceId: "i-1" },
      { participantId: "b", score: 0.9, evidenceType: "user_context", evidenceId: "c-1" },
      { participantId: "a", score: 0.7, evidenceType: "premise", evidenceId: "p-1" },
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
  });

  it("classifies the first failed stage without calling unevaluated targets rejected", () => {
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

  it("maps scorecard transport fields to completeness only", () => {
    expect(executionCompletenessFields(true)).toEqual({ runs: 1, passes: 1, passRate: 1, flaky: false });
    expect(executionCompletenessFields(false)).toEqual({ runs: 1, passes: 0, passRate: 0, flaky: false });
  });
});
