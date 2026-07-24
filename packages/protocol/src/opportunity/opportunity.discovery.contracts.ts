import type { Question, QuestionStrategy } from "../shared/schemas/question.schema.js";

/** One step for discovery debug visibility (subgraph/subtask). */
export interface DiscoverDebugStep {
  step: string;
  detail?: string;
  data?: Record<string, unknown>;
}

/** Neutral discovery result envelope shared with continuation finalization. */
export interface DiscoveryResultContract<TOpportunity> {
  found: boolean;
  count: number;
  message?: string;
  opportunities?: TOpportunity[];
  existingConnections?: Array<{ userId: string; name: string; status?: string; opportunityId?: string }>;
  existingConnectionsForMention?: Array<{ userId: string; name: string; status?: string; opportunityId?: string }>;
  alreadyAcceptedPairs?: Array<{ opportunityId: string; counterpartyUserId: string }>;
  createIntentSuggested?: boolean;
  suggestedIntentDescription?: string;
  debugSteps?: DiscoverDebugStep[];
  pagination?: { discoveryId: string; evaluated: number; remaining: number };
  questions?: Question[];
  discoveryQuestionsDebug?: {
    inputMode: "transcripts" | "insights";
    finalCount: number;
    strategies: QuestionStrategy[];
    durationMs: number;
  };
}
