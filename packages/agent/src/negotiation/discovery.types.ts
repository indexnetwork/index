/**
 * Authorized active assignments, refreshed by the host for a principal activation.
 */
export interface DiscoveryScope {
  version: string;
  networkIds: string[];
}

export interface DiscoveryCandidateProfile {
  identity?: {
    name?: string;
    bio?: string;
    location?: string;
  };
  context?: string;
}

export interface DiscoveryCandidate {
  candidateUserId: string;
  candidateIntentId: string;
  networkId: string;
  similarity: number;
  candidatePayload: string;
  candidateSummary?: string;
  profile: DiscoveryCandidateProfile | null;
  networkContext?: string;
  recentlyRejected: boolean;
}

export interface CandidateQuery {
  query: string;
  minSimilarity: number;
  networkIds: string[];
}

/**
 * Completed retrieval evidence.
 * Maintained in-memory only and never persisted or reused across activations.
 */
export interface SearchRecord extends CandidateQuery {
  id: string;
  scopeVersion: string;
  candidates: DiscoveryCandidate[];
  status: 'complete';
}

export interface OpenNegotiationInput {
  searchId: string;
  candidateIntentId: string;
  networkId: string;
  reasoning: string;
  brief: string;
}

export interface OpenNegotiationResult {
  status: 'opened' | 'unavailable';
  opportunityId?: string;
}

/**
 * Host-bound identity and authorization port for counterparty discovery and opening.
 */
export interface DiscoveryClient {
  scope(signal: AbortSignal): Promise<DiscoveryScope>;
  discoverCounterparties(
    input: CandidateQuery,
    scopeVersion: string,
    signal: AbortSignal,
  ): Promise<{ candidates: DiscoveryCandidate[] }>;
  openNegotiation?(
    candidate: DiscoveryCandidate,
    reasoning: string,
    brief: string,
    signal: AbortSignal,
  ): Promise<OpenNegotiationResult>;
}
