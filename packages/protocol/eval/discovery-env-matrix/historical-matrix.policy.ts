import type { CaseResultLike, ScorecardLike } from "../shared/index.js";
import type { HistoricalMatrixCase } from "./historical-matrix.types.js";

export const MATRIX_ROWS = [
  { id: "intent-only", allowedTypes: "intent", profileSource: "premise", allowedEvidence: ["intent"] },
  { id: "profile-premise", allowedTypes: "profile", profileSource: "premise", allowedEvidence: ["premise"] },
  { id: "profile-context", allowedTypes: "profile", profileSource: "user_context", allowedEvidence: ["user_context"] },
  { id: "both-premise", allowedTypes: "intent,profile", profileSource: "premise", allowedEvidence: ["intent", "premise"] },
  { id: "both-context", allowedTypes: "intent,profile", profileSource: "user_context", allowedEvidence: ["intent", "user_context"] },
] as const;

export type MatrixRow = typeof MATRIX_ROWS[number];
export type MatrixRowId = MatrixRow["id"];
export type MatrixEvidenceType = MatrixRow["allowedEvidence"][number];

export interface MatrixCandidateEvidenceIds {
  /** Concrete graph evidence IDs retained for run-artifact inspection. */
  candidateIntentId?: string;
  candidatePremiseId?: string;
  candidateContextId?: string;
}

export interface MatrixRetrievalCandidate {
  /** The database/user id returned by raw retrieval before evaluator approval. */
  id: string;
  /** One-based raw retrieval order. Diagnostic-only; never scored or judged. */
  retrievalRank: number;
  evidenceTypes: readonly MatrixEvidenceType[];
  evidenceIds: MatrixCandidateEvidenceIds;
  /** Run-artifact-only provider text; baseline artifacts must remove this field. */
  rawText?: string;
}

export interface MatrixCandidate {
  /** The database/user id in an evaluator-approved, graph-ranked opportunity. */
  id: string;
  /** One-based final evaluator/ranking order used by scorecard policy and judge. */
  finalRank: number;
  /** Evidence projected from raw retrieval for this final candidate. */
  evidenceTypes: readonly MatrixEvidenceType[];
  evidenceIds: MatrixCandidateEvidenceIds;
}

/** Sanitized evaluator observation for a raw candidate; never policy or baseline input. */
export interface MatrixEvaluatorTrace {
  id: string;
  retrievalRank: number;
  evaluatorReturned: boolean;
  evaluatorScore: number | null;
  finalIncluded: boolean;
  finalRank: number | null;
  evaluatorError?: {
    classification: "candidate_evaluation_failed" | "evaluation_fatal";
    message: string;
  };
}

export type MatrixAssertionKind =
  | "target_returned"
  | "excluded_absent"
  | "fixture_ownership"
  | "allowed_evidence"
  | "completion"
  | "judge";

export interface MatrixAssertion {
  kind: MatrixAssertionKind;
  passed: boolean;
  detail: string;
}

/** The exhaustive, model-safe data available to the relationship judge. */
export interface MatrixJudgeInput {
  sourceText: string;
  rowId: MatrixRowId;
  candidateIds: string[];
  evidenceTypes: MatrixEvidenceType[];
  caseDescription: string;
  expectedUserId: string;
  excludedUserIds: string[];
}

export interface MatrixJudgeResult {
  passed: boolean;
  detail?: string;
}

export interface MatrixConfigDelta {
  key: string;
  before: string | null;
  after: string | null;
}

export interface ScoreMatrixSlotInput {
  matrixCase: HistoricalMatrixCase;
  rowId: MatrixRowId;
  repetition: number;
  /** Evaluator-approved, graph-ranked candidates used by every policy assertion and judge. */
  candidates: readonly MatrixCandidate[];
  /** Raw retrieval diagnostics retained in run artifacts but never scored or judged. */
  rawCandidates?: readonly MatrixRetrievalCandidate[];
  /** Sanitized evaluator diagnostics retained in run artifacts but never scored or judged. */
  evaluatorTraces?: readonly MatrixEvaluatorTrace[];
  completed: boolean;
  configDeltas?: readonly MatrixConfigDelta[];
  /** Invoked only after every deterministic assertion passes. */
  judge?: (input: MatrixJudgeInput) => Promise<MatrixJudgeResult> | MatrixJudgeResult;
}

/** Complete, raw run evidence for one case/row/repetition slot. */
export interface MatrixSlotResult extends CaseResultLike {
  rowId: MatrixRowId;
  repetition: number;
  passed: boolean;
  targetRank: number | null;
  evidenceTypes: MatrixEvidenceType[];
  configDeltas: MatrixConfigDelta[];
  assertions: MatrixAssertion[];
  /** Final evaluator-approved candidates only. */
  candidates: MatrixCandidate[];
  /** Raw retrieval diagnostics only; these never enter deterministic assertions or the judge. */
  rawCandidates: MatrixRetrievalCandidate[];
  /** Sanitized evaluator diagnostics only; these never enter deterministic assertions or the judge. */
  evaluatorTraces: MatrixEvaluatorTrace[];
  judge: MatrixJudgeResult | null;
}

/** Run-report scorecard: may retain raw candidate text for operator inspection. */
export type MatrixScorecard = ScorecardLike<MatrixSlotResult>;

/** Baseline scorecard: deliberately excludes raw provider candidate text. */
export interface MatrixBaselineCandidate {
  id: string;
  finalRank: number;
  evidenceTypes: MatrixEvidenceType[];
  evidenceIds: MatrixCandidateEvidenceIds;
}

export interface MatrixBaselineRetrievalCandidate {
  id: string;
  retrievalRank: number;
  evidenceTypes: MatrixEvidenceType[];
  evidenceIds: MatrixCandidateEvidenceIds;
}

export interface MatrixBaselineSlotResult extends Omit<MatrixSlotResult, "candidates" | "rawCandidates" | "evaluatorTraces"> {
  candidates: MatrixBaselineCandidate[];
  rawCandidates: MatrixBaselineRetrievalCandidate[];
}

export type MatrixBaselineScorecard = ScorecardLike<MatrixBaselineSlotResult>;

/** The unchanged production configuration; its pass rate measures judge noise. */
export const MATRIX_CONTROL_ROW_ID: MatrixRowId = "intent-only";
/** A run whose control row falls below this floor is never baselineable. */
export const MATRIX_CONTROL_MINIMUM_PASS_RATE = 0.8;
/** Maximum allowed shortfall of a qualification row below the control pass rate. */
export const MATRIX_CONTROL_CALIBRATION_MARGIN = 0.2;
/**
 * Rows that must beat the control-calibrated threshold before a baseline write:
 * the user_context arms this matrix exists to qualify. Premise arms are
 * comparison evidence and are recorded but non-blocking.
 */
export const MATRIX_QUALIFICATION_ROW_IDS: readonly MatrixRowId[] = ["profile-context", "both-context"];

export interface MatrixRowRateSlot {
  caseId: string;
  rowId: MatrixRowId;
  runs: number;
  passes: number;
}

export interface MatrixRowRateVerdict {
  rowId: MatrixRowId;
  slots: number;
  runs: number;
  passes: number;
  passRate: number;
  /** Control-calibrated pass-rate threshold; null for the control row itself. */
  threshold: number | null;
  blocking: boolean;
  passed: boolean;
}

export interface MatrixControlCalibratedGate {
  passed: boolean;
  controlPassRate: number;
  minimumControlPassRate: number;
  calibrationMargin: number;
  failures: string[];
  rows: MatrixRowRateVerdict[];
}

/**
 * Governed baseline gate calibrated against the stochastic judge's noise floor:
 * the control row must clear an absolute floor, every slot must have completed,
 * and each qualification row's pass rate must stay within the calibration
 * margin of the control row's pass rate. Comparison rows receive verdicts for
 * reporting but never block.
 */
export function evaluateControlCalibratedGate(slots: readonly MatrixRowRateSlot[]): MatrixControlCalibratedGate {
  const failures: string[] = [];
  const incomplete = slots.filter((slot) => slot.runs < 1);
  if (incomplete.length > 0) {
    failures.push(`incomplete slots: ${incomplete.map((slot) => slot.caseId).join(", ")}`);
  }
  const byRow = new Map<MatrixRowId, MatrixRowRateSlot[]>();
  for (const slot of slots) byRow.set(slot.rowId, [...byRow.get(slot.rowId) ?? [], slot]);
  const missing = MATRIX_ROWS.filter((row) => !byRow.has(row.id));
  if (missing.length > 0) {
    failures.push(`missing rows: ${missing.map((row) => row.id).join(", ")}`);
  }
  const rate = (rowSlots: readonly MatrixRowRateSlot[]): { runs: number; passes: number; passRate: number } => {
    const runs = rowSlots.reduce((sum, slot) => sum + slot.runs, 0);
    const passes = rowSlots.reduce((sum, slot) => sum + slot.passes, 0);
    return { runs, passes, passRate: runs > 0 ? passes / runs : 0 };
  };
  const controlPassRate = rate(byRow.get(MATRIX_CONTROL_ROW_ID) ?? []).passRate;
  if (byRow.has(MATRIX_CONTROL_ROW_ID) && controlPassRate < MATRIX_CONTROL_MINIMUM_PASS_RATE) {
    failures.push(`control row ${MATRIX_CONTROL_ROW_ID} pass rate ${controlPassRate.toFixed(3)} below floor ${MATRIX_CONTROL_MINIMUM_PASS_RATE}`);
  }
  const threshold = Math.max(0, controlPassRate - MATRIX_CONTROL_CALIBRATION_MARGIN);
  const rows: MatrixRowRateVerdict[] = MATRIX_ROWS.filter((row) => byRow.has(row.id)).map((row) => {
    const rowSlots = byRow.get(row.id)!;
    const { runs, passes, passRate } = rate(rowSlots);
    const control = row.id === MATRIX_CONTROL_ROW_ID;
    const blocking = control || MATRIX_QUALIFICATION_ROW_IDS.includes(row.id);
    const passed = control ? passRate >= MATRIX_CONTROL_MINIMUM_PASS_RATE : passRate >= threshold;
    if (!control && blocking && !passed) {
      failures.push(`qualification row ${row.id} pass rate ${passRate.toFixed(3)} below control-calibrated threshold ${threshold.toFixed(3)}`);
    }
    return { rowId: row.id, slots: rowSlots.length, runs, passes, passRate, threshold: control ? null : threshold, blocking, passed };
  });
  return {
    passed: failures.length === 0,
    controlPassRate,
    minimumControlPassRate: MATRIX_CONTROL_MINIMUM_PASS_RATE,
    calibrationMargin: MATRIX_CONTROL_CALIBRATION_MARGIN,
    failures,
    rows,
  };
}

function rowFor(rowId: MatrixRowId): MatrixRow {
  const row = MATRIX_ROWS.find((candidate) => candidate.id === rowId);
  if (!row) throw new Error(`Unknown discovery environment matrix row: ${rowId}`);
  return row;
}

/** Checks that a returned candidate only cites evidence allowed by this row. */
export function assertAllowedEvidence(
  rowId: MatrixRowId,
  evidenceTypes: readonly MatrixEvidenceType[],
): { passed: true } | { passed: false; detail: string } {
  const row = rowFor(rowId);
  if (evidenceTypes.length === 0) return { passed: false, detail: "missing_evidence" };
  const allowedEvidence: readonly MatrixEvidenceType[] = row.allowedEvidence;
  const unexpected = evidenceTypes.filter((evidenceType) => !allowedEvidence.includes(evidenceType));
  return unexpected.length === 0
    ? { passed: true }
    : { passed: false, detail: `disallowed_evidence: ${unexpected.join(", ")}` };
}

/**
 * Builds the sole prompt boundary for judging a matrix slot. It intentionally
 * accepts no fixture audit data, report names, or raw candidate text.
 */
export function buildJudgePrompt(input: MatrixJudgeInput): string {
  return [
    "Assess whether the returned discovery candidates support the documented historical relationship.",
    `Case: ${input.caseDescription}`,
    `Matrix row: ${input.rowId}`,
    `Source text: ${input.sourceText}`,
    `Returned candidate IDs: ${input.candidateIds.join(", ") || "none"}`,
    `Returned evidence types: ${input.evidenceTypes.join(", ") || "none"}`,
    `Expected target ID: ${input.expectedUserId}`,
    `Excluded candidate IDs: ${input.excludedUserIds.join(", ") || "none"}`,
    "Approve only when the returned target and cited evidence support the case without relying on excluded candidates.",
  ].join("\n");
}

function deterministicAssertions(input: ScoreMatrixSlotInput): {
  assertions: MatrixAssertion[];
  targetRank: number | null;
  evidenceTypes: MatrixEvidenceType[];
} {
  const fixtureIds = new Set(input.matrixCase.participants.map((participant) => participant.id));
  const candidateIds = input.candidates.map((candidate) => candidate.id);
  const target = input.candidates.find((candidate) => candidate.id === input.matrixCase.expectedUserId);
  const targetRank = target?.finalRank ?? null;
  const unknownCandidate = candidateIds.find((candidateId) => !fixtureIds.has(candidateId));
  const excludedCandidate = candidateIds.find((candidateId) => input.matrixCase.excludedUserIds.includes(candidateId));
  const evidenceTypes = [...new Set(input.candidates.flatMap((candidate) => candidate.evidenceTypes))];
  const evidenceFailure = input.candidates
    .map((candidate) => ({ id: candidate.id, result: assertAllowedEvidence(input.rowId, candidate.evidenceTypes) }))
    .find(({ result }) => !result.passed);

  return {
    targetRank,
    evidenceTypes,
    assertions: [
      {
        kind: "target_returned",
        passed: targetRank !== null,
        detail: targetRank === null ? `expected_target_not_returned: ${input.matrixCase.expectedUserId}` : `expected target returned at rank ${targetRank}`,
      },
      {
        kind: "excluded_absent",
        passed: excludedCandidate === undefined,
        detail: excludedCandidate === undefined ? "excluded targets absent" : `excluded_candidate_returned: ${excludedCandidate}`,
      },
      {
        kind: "fixture_ownership",
        passed: unknownCandidate === undefined,
        detail: unknownCandidate === undefined ? "all candidates are fixture-owned" : `unknown_candidate: ${unknownCandidate}`,
      },
      {
        kind: "allowed_evidence",
        passed: evidenceFailure === undefined,
        detail: evidenceFailure === undefined
          ? "all evidence types are allowed"
          : `${evidenceFailure.id}: ${(evidenceFailure.result as { detail: string }).detail}`,
      },
      {
        kind: "completion",
        passed: input.completed,
        detail: input.completed ? "slot completed" : "slot_incomplete",
      },
    ],
  };
}

/**
 * Scores all six required slot checks. The judge is deliberately skipped when
 * deterministic checks fail, so an unknown/non-fixture candidate cannot spend
 * provider budget or be mistaken for a judged failure.
 */
export async function scoreMatrixSlot(input: ScoreMatrixSlotInput): Promise<MatrixSlotResult> {
  const deterministic = deterministicAssertions(input);
  const judgeInput: MatrixJudgeInput = {
    sourceText: input.matrixCase.participants.find((participant) => participant.id === input.matrixCase.sourceUserId)?.intent.text ?? "",
    rowId: input.rowId,
    candidateIds: input.candidates.map((candidate) => candidate.id),
    evidenceTypes: deterministic.evidenceTypes,
    caseDescription: input.matrixCase.description,
    expectedUserId: input.matrixCase.expectedUserId,
    excludedUserIds: [...input.matrixCase.excludedUserIds],
  };
  const deterministicPassed = deterministic.assertions.every((assertion) => assertion.passed);
  const judge = deterministicPassed && input.judge ? await input.judge(judgeInput) : null;
  const judgeAssertion: MatrixAssertion = judge
    ? { kind: "judge", passed: judge.passed, detail: judge.detail ?? (judge.passed ? "judge approved" : "judge rejected") }
    : {
      kind: "judge",
      passed: false,
      detail: deterministicPassed ? "not_run: judge unavailable" : "not_run: deterministic assertions failed",
    };
  const assertions = [...deterministic.assertions, judgeAssertion];

  return {
    caseId: input.matrixCase.id,
    rule: input.rowId,
    rowId: input.rowId,
    repetition: input.repetition,
    runs: 1,
    passes: assertions.every((assertion) => assertion.passed) ? 1 : 0,
    passRate: assertions.every((assertion) => assertion.passed) ? 1 : 0,
    flaky: false,
    passed: assertions.every((assertion) => assertion.passed),
    targetRank: deterministic.targetRank,
    evidenceTypes: deterministic.evidenceTypes,
    configDeltas: input.configDeltas ? input.configDeltas.map((delta) => ({ ...delta })) : [],
    assertions,
    candidates: input.candidates.map((candidate) => ({
      ...candidate,
      evidenceTypes: [...candidate.evidenceTypes],
      evidenceIds: { ...candidate.evidenceIds },
    })),
    rawCandidates: (input.rawCandidates ?? []).map((candidate) => ({
      ...candidate,
      evidenceTypes: [...candidate.evidenceTypes],
      evidenceIds: { ...candidate.evidenceIds },
    })),
    evaluatorTraces: (input.evaluatorTraces ?? []).map((trace) => ({
      ...trace,
      ...(trace.evaluatorError ? { evaluatorError: { ...trace.evaluatorError } } : {}),
    })),
    judge,
  };
}
