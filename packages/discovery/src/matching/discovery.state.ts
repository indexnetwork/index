import type { CandidateSearch, DiscoveryData, EmbeddingGenerator, Profile } from '../core/types.js';

/** Retrieved evidence for the caller to evaluate; similarity is not a match decision. */
export interface CandidateMatch {
  candidateUserId: string;
  candidateIntentId: string;
  networkId: string;
  similarity: number;
  candidatePayload: string;
  candidateSummary?: string;
  profile: Profile | null;
  networkContext?: string;
  recentlyRejected: boolean;
}

export interface DiscoveryInput {
  userId: string;
  triggerIntentId: string;
  searchQuery: string;
  networkId?: string;
  networkScope?: string[];
  minSimilarity?: number;
  options?: { limit?: number };
}

export interface DiscoveryState {
  searchQuery: string;
  networkIds: string[];
  candidates: CandidateMatch[];
  error?: string;
}

export interface DiscoveryDeps {
  database: DiscoveryData;
  search: CandidateSearch;
  embedder: EmbeddingGenerator;
  retrievalMinSimilarity?: number;
}
