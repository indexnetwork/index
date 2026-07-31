export interface ReconstructedIntent {
  text: string;
  kind: "existing" | "historically_grounded_reconstruction";
  /** Audit-only exact source excerpts; never included in matrixModelInput. */
  basis: string[];
}

export interface MatrixParticipant {
  id: string;
  profileText: string;
  location: string;
  interests: string[];
  skills: string[];
  intent: ReconstructedIntent;
}

export interface HistoricalMatrixCase {
  id: string;
  description: string;
  networkContext: string;
  sourceUserId: string;
  expectedUserId: string;
  excludedUserIds: string[];
  participants: MatrixParticipant[];
  reportNames?: Record<string, string>;
}

/** The only fixture shape permitted to cross a model boundary. */
export interface HistoricalMatrixModelInput {
  id: string;
  description: string;
  networkContext: string;
  sourceUserId: string;
  participants: Array<{
    id: string;
    profileText: string;
    location: string;
    interests: string[];
    skills: string[];
    intent: { text: string };
  }>;
}
