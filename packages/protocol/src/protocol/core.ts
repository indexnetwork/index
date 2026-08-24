/** Portable vocabulary for a request's focused protocol scope. */
export type ToolScopeType = "network" | "intent";

export interface ScopeMembership {
  networkId: string;
}

/** A corpus that can be searched through inferred semantic lenses. */
export type HydeTargetCorpus = "profiles" | "intents" | "premises";

export interface Lens {
  label: string;
  corpus: HydeTargetCorpus;
  reasoning: string;
}

/** One model-backed operation recorded within a graph invocation. */
export interface DebugMetaAgent {
  name: string;
  durationMs: number;
}

export interface IntentIndexingResult {
  indexScore: number;
  memberScore: number;
  reasoning: string;
}

export interface IntentNetworkIndexer {
  indexIntent(intent: string, indexPrompt: string | null, memberPrompt: string | null, sourceName?: string | null, networkContext?: string | null): Promise<IntentIndexingResult | null>;
}

export const NEGOTIATION_MAX_TURNS_CHAT = 4;
export const NEGOTIATION_MAX_TURNS_AMBIENT = 6;
