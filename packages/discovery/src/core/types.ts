export interface Logger {
  verbose(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}
export interface TraceEvent {
  type: 'agent_start' | 'agent_end';
  name: string;
  durationMs?: number;
  summary?: string;
}
export interface RunOptions {
  signal?: AbortSignal;
  traceEmitter?: (event: TraceEvent) => void;
  logger?: Logger;
}
export interface EmbeddingGenerator {
  generate(text: string | string[], dimensions?: number, options?: { signal?: AbortSignal }): Promise<number[] | number[][]>;
}
export interface SearchOptions {
  networkScope: string[];
  excludeUserId?: string;
  limit: number;
  minScore: number;
  signal?: AbortSignal;
}
export interface IntentCandidate {
  type: 'intent';
  id: string;
  userId: string;
  networkId: string;
  score: number;
}

/** Search real, active intent embeddings within authorized networks. */
export interface CandidateSearch {
  searchIntentCandidates(embedding: number[], options: SearchOptions): Promise<IntentCandidate[]>;
}
export interface ActiveIntent { id: string; payload: string; summary?: string | null }
export interface Profile { identity?: { name?: string; bio?: string; location?: string }; context?: string }

/** Read ports; the host supplies protocol scope and context permission rules. */
export interface DiscoveryData {
  getNetworkMemberships(userId: string): Promise<Array<{ networkId: string }>>;
  getActiveIntents(userId: string): Promise<ActiveIntent[]>;
  getProfile(userId: string): Promise<Profile | null>;
  getNetworkIdsForIntent(intentId: string): Promise<string[]>;
  getDiscoveryScope(input: { userId: string; userNetworks: string[]; networkId?: string; networkScope?: string[]; triggerIntentId: string }): Promise<{ networkIds: string[]; error?: string }>;
  getActiveNetworkMembershipPairs(pairs: Array<{ userId: string; networkId: string }>): Promise<Array<{ userId: string; networkId: string }>>;
  getNetworkContexts(networkIds: string[]): Promise<Record<string, string>>;
  getRecentlyRejectedOpportunityCounterparties(userId: string, candidateUserIds: string[], windowMs: number): Promise<string[]>;
}
