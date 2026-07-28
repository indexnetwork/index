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

export interface MatrixCandidate {
  /** The database/user id returned by the live discovery graph. */
  id: string;
  /** Evidence source labels retained from the graph result. */
  evidenceTypes: readonly MatrixEvidenceType[];
  /** Run-artifact-only provider text; baseline artifacts must remove this field. */
  rawText?: string;
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
  candidates: readonly MatrixCandidate[];
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
  candidates: MatrixCandidate[];
  judge: MatrixJudgeResult | null;
}

/** Run-report scorecard: may retain raw candidate text for operator inspection. */
export type MatrixScorecard = ScorecardLike<MatrixSlotResult>;

/** Baseline scorecard: deliberately excludes raw provider candidate text. */
export interface MatrixBaselineCandidate {
  id: string;
  evidenceTypes: MatrixEvidenceType[];
}

export interface MatrixBaselineSlotResult extends Omit<MatrixSlotResult, "candidates"> {
  candidates: MatrixBaselineCandidate[];
}

export type MatrixBaselineScorecard = ScorecardLike<MatrixBaselineSlotResult>;

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
  const targetIndex = candidateIds.indexOf(input.matrixCase.expectedUserId);
  const targetRank = targetIndex < 0 ? null : targetIndex + 1;
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
    candidates: input.candidates.map((candidate) => ({ ...candidate, evidenceTypes: [...candidate.evidenceTypes] })),
    judge,
  };
}
