/** Portable result and dependency vocabulary for intent-to-network evaluation. */
export interface IntentIndexingResult {
  indexScore: number;
  memberScore: number;
  reasoning: string;
}

/** The narrow behavior needed to evaluate an intent for a network. */
export interface IntentNetworkIndexer {
  indexIntent(
    intent: string,
    indexPrompt: string | null,
    memberPrompt: string | null,
    sourceName?: string | null,
    networkContext?: string | null,
  ): Promise<IntentIndexingResult | null>;
}
