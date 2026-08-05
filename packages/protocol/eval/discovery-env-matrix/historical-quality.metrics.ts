import type { CaseResultLike } from "../shared/index.js";

export type HistoricalEvidenceType = "intent" | "premise" | "user_context";

export interface HistoricalRetrievalEvidenceRow {
  participantId: string;
  score: number;
  evidenceType: HistoricalEvidenceType;
  evidenceId: string;
}

export interface HistoricalRetrievedUser {
  participantId: string;
  retrievalRank: number;
  bestScore: number;
  evidenceTypes: HistoricalEvidenceType[];
  evidenceIds: string[];
}

export function dedupeHistoricalRetrieval(rows: readonly HistoricalRetrievalEvidenceRow[]): HistoricalRetrievedUser[] {
  const grouped = new Map<string, { bestScore: number; evidenceTypes: Set<HistoricalEvidenceType>; evidenceIds: Set<string> }>();
  for (const row of rows) {
    if (row.participantId.trim() === "") throw new Error("Historical retrieval participantId must be non-empty");
    if (!Number.isFinite(row.score)) throw new Error(`Historical retrieval ${row.participantId} requires a finite score`);
    if (row.evidenceId.trim() === "") throw new Error(`Historical retrieval ${row.participantId} evidenceId must be non-empty`);
    const current = grouped.get(row.participantId) ?? {
      bestScore: Number.NEGATIVE_INFINITY,
      evidenceTypes: new Set<HistoricalEvidenceType>(),
      evidenceIds: new Set<string>(),
    };
    current.bestScore = Math.max(current.bestScore, row.score);
    current.evidenceTypes.add(row.evidenceType);
    current.evidenceIds.add(row.evidenceId);
    grouped.set(row.participantId, current);
  }
  return [...grouped.entries()]
    .sort(([aId, a], [bId, b]) => b.bestScore - a.bestScore || aId.localeCompare(bId))
    .map(([participantId, value], index) => ({
      participantId,
      retrievalRank: index + 1,
      bestScore: value.bestScore,
      evidenceTypes: [...value.evidenceTypes].sort(),
      evidenceIds: [...value.evidenceIds].sort(),
    }));
}

export type HistoricalFailureStage =
  | "execution"
  | "retrieval"
  | "evaluation_admission"
  | "evaluation_rejection"
  | "finalization"
  | "none";

export interface HistoricalFailureInput {
  completed: boolean;
  targetId: string;
  retrievedParticipantIds: readonly string[];
  evaluator: {
    eligible: boolean;
    submitted: boolean;
    returned: boolean;
    finalIncluded: boolean;
  };
}

export function classifyHistoricalFailureStage(input: HistoricalFailureInput): HistoricalFailureStage {
  if (!input.completed) return "execution";
  if (!input.retrievedParticipantIds.includes(input.targetId)) return "retrieval";
  if (!input.evaluator.eligible || !input.evaluator.submitted) return "evaluation_admission";
  if (!input.evaluator.returned) return "evaluation_rejection";
  if (!input.evaluator.finalIncluded) return "finalization";
  return "none";
}

export function executionCompletenessFields(
  completed: boolean,
): Pick<CaseResultLike, "runs" | "passes" | "passRate" | "flaky"> {
  return { runs: 1, passes: completed ? 1 : 0, passRate: completed ? 1 : 0, flaky: false };
}
