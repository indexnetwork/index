export interface MatrixIntent {
  text: string;
}

export interface MatrixParticipant {
  id: string;
  profileText: string;
  location: string;
  interests: string[];
  skills: string[];
  intent: MatrixIntent;
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
  description: string;
  networkContext: string;
  sourceUserId: string;
  participants: Array<{
    id: string;
    profileText: string;
    location: string;
    interests: string[];
    skills: string[];
    intent: MatrixIntent;
  }>;
}
