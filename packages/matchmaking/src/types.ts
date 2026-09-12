import type { z } from 'zod/v4';

export type HydeTargetCorpus = 'profiles' | 'intents';
export interface Lens { label: string; corpus: HydeTargetCorpus; reasoning: string }
export interface AgentTiming { name: string; durationMs: number }
export interface MatchEvidence {
  kind: 'query_intent' | 'query_context' | 'profile';
  networkId: string;
  score?: number;
  lens?: string;
  discoverySource?: 'query';
  matchedStrategies?: string[];
  candidateIntentId?: string;
  sourceContextId?: string;
  candidateContextId?: string;
  payload?: string;
  summary?: string;
}

export interface ModelRequest<T> {
  name: string;
  messages: Array<{ role: 'system' | 'user'; content: string }>;
  schema: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
}

/** Host-supplied structured model; callers validate even injected responses. */
export interface Model {
  complete<T>(request: ModelRequest<T>, options?: { signal?: AbortSignal }): Promise<T>;
}

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
export interface LensEmbedding { lens: string; corpus: HydeTargetCorpus; embedding: number[] }
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
export interface HydeCandidate extends IntentCandidate { matchedVia: string; matchedLenses?: string[] }

/** Search only real, active intent embeddings, with live broadcast and membership eligibility. */
export interface CandidateSearch {
  searchIntentCandidates(embedding: number[], options: SearchOptions): Promise<IntentCandidate[]>;
}

export interface ArtifactRecord {
  strategy: string;
  targetCorpus: string;
  hydeText: string;
  hydeEmbedding: number[];
  context: Record<string, unknown> | null;
}
export interface ArtifactStore {
  getHydeDocument(sourceType: 'intent' | 'query' | 'context', sourceId: string, strategy: string): Promise<ArtifactRecord | null>;
  saveHydeDocument(data: {
    sourceType: 'intent' | 'query' | 'context'; sourceId?: string; strategy: string;
    targetCorpus: string; hydeText: string; hydeEmbedding: number[]; context?: Record<string, unknown>;
  }): Promise<unknown>;
}
export interface ArtifactCache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: { ttl?: number }): Promise<void>;
}
export interface ActiveIntent { id: string; payload: string; summary?: string | null }
export interface Profile { identity?: { name?: string; bio?: string; location?: string }; context?: string }

/** Narrow read ports. Protocol/host resolves authorization and network-context permissions. */
export interface MatchmakingData {
  getNetworkMemberships(userId: string): Promise<Array<{ networkId: string }>>;
  getActiveIntents(userId: string): Promise<ActiveIntent[]>;
  getProfile(userId: string): Promise<Profile | null>;
  getIntent(intentId: string): Promise<ActiveIntent | null>;
  getNetworkIdsForIntent(intentId: string): Promise<string[]>;
  getDiscoveryScope(input: { userId: string; userNetworks: string[]; networkId?: string; networkScope?: string[]; triggerIntentId?: string }): Promise<{ networkIds: string[]; error?: string }>;
  getNetwork(networkId: string): Promise<{ title: string } | null>;
  getNetworkMemberCount(networkId: string): Promise<number>;
  getIntentNetworkScores(intentId: string): Promise<Array<{ networkId: string; relevancyScore: number | null }>>;
  getActiveNetworkMembershipPairs(pairs: Array<{ userId: string; networkId: string }>): Promise<Array<{ userId: string; networkId: string }>>;
  getNetworkContexts(networkIds: string[]): Promise<Record<string, string>>;
  getRecentlyRejectedOpportunityCounterparties(userId: string, candidateUserIds: string[], windowMs: number): Promise<string[]>;
}
