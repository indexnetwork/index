import { describe, expect, it } from "bun:test";

import { HISTORICAL_MATRIX_CASES } from "../historical-matrix.cases.js";
import { MATRIX_ROWS, assertAllowedEvidence, buildJudgePrompt, scoreMatrixSlot } from "../historical-matrix.policy.js";

describe("historical discovery environment matrix policy", () => {
  it("defines exactly the five supported discovery environment rows", () => {
    expect(MATRIX_ROWS.map((row) => row.id)).toEqual([
      "intent-only",
      "profile-premise",
      "profile-context",
      "both-premise",
      "both-context",
    ]);
    expect(assertAllowedEvidence("intent-only", ["intent"])).toEqual({ passed: true });
    expect(assertAllowedEvidence("intent-only", ["premise"])).toMatchObject({ passed: false });
    expect(assertAllowedEvidence("profile-premise", ["premise"])).toEqual({ passed: true });
    expect(assertAllowedEvidence("profile-context", ["user_context"])).toEqual({ passed: true });
    expect(assertAllowedEvidence("both-premise", ["intent", "premise"])).toEqual({ passed: true });
    expect(assertAllowedEvidence("both-context", ["premise"])).toMatchObject({ passed: false });
  });

  it("fails unknown candidates before invoking the judge while scoring every required assertion", async () => {
    const matrixCase = HISTORICAL_MATRIX_CASES[0]!;
    let judgeCalls = 0;
    const result = await scoreMatrixSlot({
      matrixCase,
      rowId: "both-premise",
      repetition: 0,
      completed: true,
      candidates: [
        { id: matrixCase.expectedUserId, finalRank: 1, evidenceTypes: ["intent", "premise"], evidenceIds: { candidateIntentId: "intent-expected", candidatePremiseId: "premise-expected" } },
        { id: matrixCase.excludedUserIds[0]!, finalRank: 2, evidenceTypes: ["intent"], evidenceIds: { candidateIntentId: "intent-excluded" } },
        { id: "unknown-candidate", finalRank: 3, evidenceTypes: ["intent"], evidenceIds: { candidateIntentId: "intent-unknown" } },
      ],
      judge: async () => {
        judgeCalls += 1;
        return { passed: true };
      },
    });

    expect(judgeCalls).toBe(0);
    expect(result.passed).toBe(false);
    expect(result.targetRank).toBe(1);
    expect(result.assertions.map((assertion) => assertion.kind)).toEqual([
      "target_returned",
      "excluded_absent",
      "fixture_ownership",
      "allowed_evidence",
      "completion",
      "judge",
    ]);
    expect(result.assertions.find((assertion) => assertion.kind === "fixture_ownership")).toMatchObject({
      passed: false,
      detail: "unknown_candidate: unknown-candidate",
    });
    expect(result.assertions.find((assertion) => assertion.kind === "judge")).toMatchObject({
      passed: false,
      detail: "not_run: deterministic assertions failed",
    });
    expect(result.candidates[0]!.evidenceIds).toEqual({
      candidateIntentId: "intent-expected",
      candidatePremiseId: "premise-expected",
    });
  });

  it("scores only final evaluator candidates when raw retrieval contains an excluded candidate", async () => {
    const matrixCase = HISTORICAL_MATRIX_CASES[0]!;
    const judgeInputs: string[][] = [];
    const result = await scoreMatrixSlot({
      matrixCase,
      rowId: "intent-only",
      repetition: 0,
      completed: true,
      candidates: [{
        id: matrixCase.expectedUserId,
        finalRank: 1,
        evidenceTypes: ["intent"],
        evidenceIds: { candidateIntentId: "intent-target" },
      }],
      rawCandidates: [{
        id: matrixCase.expectedUserId,
        retrievalRank: 2,
        evidenceTypes: ["intent"],
        evidenceIds: { candidateIntentId: "intent-target" },
      }, {
        id: matrixCase.excludedUserIds[0]!,
        retrievalRank: 1,
        evidenceTypes: ["intent"],
        evidenceIds: { candidateIntentId: "intent-excluded" },
      }],
      judge: async (input) => {
        judgeInputs.push(input.candidateIds);
        return { passed: true };
      },
    });

    expect(result.passed).toBe(true);
    expect(result.targetRank).toBe(1);
    expect(result.candidates.map((candidate) => candidate.id)).toEqual([matrixCase.expectedUserId]);
    expect(result.rawCandidates.map((candidate) => candidate.id)).toEqual([
      matrixCase.expectedUserId,
      matrixCase.excludedUserIds[0]!,
    ]);
    expect(result.assertions.find((assertion) => assertion.kind === "excluded_absent")).toMatchObject({ passed: true });
    expect(judgeInputs).toEqual([[matrixCase.expectedUserId]]);
  });

  it("constructs judge prompts from the explicit model-safe boundary only", () => {
    const prompt = buildJudgePrompt({
      sourceText: "Need a collaborator for a circuit-board design project.",
      rowId: "both-premise",
      candidateIds: ["candidate-a"],
      evidenceTypes: ["intent", "premise"],
      caseDescription: "A historical collaboration with a known target.",
      expectedUserId: "candidate-a",
      excludedUserIds: ["candidate-b"],
    });

    expect(prompt).toContain("candidate-a");
    expect(prompt).not.toContain("basis");
    expect(prompt).not.toContain("reportNames");
  });
});
