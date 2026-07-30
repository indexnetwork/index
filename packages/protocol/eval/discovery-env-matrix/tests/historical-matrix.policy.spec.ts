import { describe, expect, it } from "bun:test";

import { HISTORICAL_MATRIX_CASES } from "../historical-matrix.cases.js";
import { MATRIX_CONTROL_CALIBRATION_MARGIN, MATRIX_CONTROL_MINIMUM_PASS_RATE, MATRIX_CONTROL_ROW_ID, MATRIX_QUALIFICATION_ROW_IDS, MATRIX_ROWS, assertAllowedEvidence, buildJudgePrompt, evaluateControlCalibratedGate, scoreMatrixSlot, type MatrixRowId, type MatrixRowRateSlot } from "../historical-matrix.policy.js";

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

  it("retains evaluator traces only as diagnostics and keeps them out of judge input", async () => {
    const matrixCase = HISTORICAL_MATRIX_CASES[0]!;
    const judgeInputs: string[][] = [];
    const result = await scoreMatrixSlot({
      matrixCase,
      rowId: "intent-only",
      repetition: 0,
      completed: true,
      candidates: [{ id: matrixCase.expectedUserId, finalRank: 1, evidenceTypes: ["intent"], evidenceIds: {} }],
      evaluatorTraces: [{
        id: matrixCase.expectedUserId,
        retrievalRank: 1,
        evaluatorReturned: true,
        evaluatorScore: 51,
        finalIncluded: true,
        finalRank: 1,
        evaluatorError: { classification: "candidate_evaluation_failed", message: "Evaluator failed for this candidate." },
      }],
      judge: async (input) => {
        judgeInputs.push(input.candidateIds);
        return { passed: true };
      },
    });

    expect(result.evaluatorTraces).toEqual([expect.objectContaining({ evaluatorScore: 51, finalRank: 1 })]);
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

  describe("control-calibrated baseline gate", () => {
    const slotsFor = (passesByRow: Partial<Record<MatrixRowId, number>>): MatrixRowRateSlot[] =>
      Object.entries(passesByRow).flatMap(([rowId, passes]) =>
        Array.from({ length: 15 }, (_, index) => ({
          caseId: `historical/case-${index % 5}/${rowId}/r${Math.floor(index / 5) + 1}`,
          rowId: rowId as MatrixRowId,
          runs: 1,
          passes: index < (passes ?? 0) ? 1 : 0,
        })));
    const fullMatrix = (overrides: Partial<Record<MatrixRowId, number>> = {}): MatrixRowRateSlot[] =>
      slotsFor({ "intent-only": 15, "profile-premise": 15, "profile-context": 15, "both-premise": 15, "both-context": 15, ...overrides });

    it("qualifies exactly the user_context arms against the intent-only control", () => {
      expect(MATRIX_CONTROL_ROW_ID).toBe("intent-only");
      expect(MATRIX_QUALIFICATION_ROW_IDS).toEqual(["profile-context", "both-context"]);
      expect(MATRIX_CONTROL_MINIMUM_PASS_RATE).toBe(0.8);
      expect(MATRIX_CONTROL_CALIBRATION_MARGIN).toBe(0.2);
    });

    it("passes a perfect run and reports every row verdict", () => {
      const gate = evaluateControlCalibratedGate(fullMatrix());
      expect(gate.passed).toBe(true);
      expect(gate.failures).toEqual([]);
      expect(gate.rows).toHaveLength(5);
      expect(gate.rows.every((row) => row.passed)).toBe(true);
    });

    it("fails when the control row is below its absolute floor even if other rows are perfect", () => {
      const gate = evaluateControlCalibratedGate(fullMatrix({ "intent-only": 11 }));
      expect(gate.passed).toBe(false);
      expect(gate.failures.join(" ")).toContain("below floor");
    });

    it("fails a qualification row below the control-calibrated threshold", () => {
      // Control 1.0 -> threshold 0.8; both-context 11/15 = 0.733 fails.
      const gate = evaluateControlCalibratedGate(fullMatrix({ "both-context": 11 }));
      expect(gate.passed).toBe(false);
      expect(gate.failures.join(" ")).toContain("both-context");
    });

    it("calibrates the threshold to the observed control noise floor", () => {
      // Control 13/15 = 0.867 -> threshold 0.667; both-context 11/15 = 0.733 passes.
      const gate = evaluateControlCalibratedGate(fullMatrix({ "intent-only": 13, "both-context": 11 }));
      expect(gate.passed).toBe(true);
      expect(gate.rows.find((row) => row.rowId === "both-context")).toMatchObject({ passed: true, blocking: true });
    });

    it("records lagging comparison premise arms as non-blocking findings", () => {
      const gate = evaluateControlCalibratedGate(fullMatrix({ "intent-only": 13, "profile-premise": 5, "both-premise": 14, "profile-context": 12, "both-context": 11 }));
      expect(gate.passed).toBe(true);
      expect(gate.rows.find((row) => row.rowId === "profile-premise")).toMatchObject({ passed: false, blocking: false });
    });

    it("fails rows with unexpected slot counts and unknown row ids", () => {
      const short = evaluateControlCalibratedGate(fullMatrix().slice(0, 74));
      expect(short.passed).toBe(false);
      expect(short.failures.join(" ")).toContain("rows without 15 slots");

      const unknown = evaluateControlCalibratedGate([
        ...fullMatrix(),
        { caseId: "historical/rogue/made-up/r1", rowId: "made-up" as MatrixRowId, runs: 1, passes: 1 },
      ]);
      expect(unknown.passed).toBe(false);
      expect(unknown.failures.join(" ")).toContain("unknown rows");

      const canary = evaluateControlCalibratedGate(
        MATRIX_ROWS.map((row) => ({ caseId: `historical/case-0/${row.id}/r1`, rowId: row.id, runs: 1, passes: 1 })),
        { expectedSlotsPerRow: 1 },
      );
      expect(canary.passed).toBe(true);
    });

    it("fails incomplete slots and missing rows", () => {
      const missing = evaluateControlCalibratedGate(slotsFor({ "intent-only": 15 }));
      expect(missing.passed).toBe(false);
      expect(missing.failures.join(" ")).toContain("missing rows");

      const incomplete = fullMatrix();
      (incomplete[0] as { runs: number }).runs = 0;
      const gate = evaluateControlCalibratedGate(incomplete);
      expect(gate.passed).toBe(false);
      expect(gate.failures.join(" ")).toContain("incomplete slots");
    });
  });
});
