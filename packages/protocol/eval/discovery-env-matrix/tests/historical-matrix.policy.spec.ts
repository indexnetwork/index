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
        { id: matrixCase.expectedUserId, evidenceTypes: ["intent", "premise"], rawText: "expected raw candidate evidence" },
        { id: matrixCase.excludedUserIds[0]!, evidenceTypes: ["intent"], rawText: "excluded raw candidate evidence" },
        { id: "unknown-candidate", evidenceTypes: ["intent"], rawText: "unknown raw candidate evidence" },
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
