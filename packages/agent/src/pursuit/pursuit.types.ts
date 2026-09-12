/** Current authorized assignments and their durable revision, supplied by the host. */
export interface PursuitScope { version: string; networkIds: string[] }
export interface Candidate {
  candidateUserId: string;
  candidateIntentId: string;
  networkId: string;
  similarity: number;
  candidatePayload: string;
  candidateSummary?: string;
  profile: { identity?: { name?: string; bio?: string; location?: string }; context?: string } | null;
  networkContext?: string;
  recentlyRejected: boolean;
}
export interface CandidateQuery { query: string; minSimilarity: number; networkIds: string[] }

/** Host operations; search and opening do not decide whom the personal agent should pursue. */
export interface PursuitClient {
  discoverCounterparties(input: CandidateQuery, signal: AbortSignal): Promise<{ networkIds: string[]; candidates: Candidate[] }>;
  openNegotiation(candidate: Candidate, reasoning: string, signal: AbortSignal): Promise<{ opportunityId: string } | null>;
}

export interface SearchRecord extends CandidateQuery {
  id: string;
  status: 'searching' | 'complete' | 'failed';
  candidates: Candidate[];
  error?: string;
  selections: {
    candidateIntentId: string; networkId: string; reasoning: string;
    status: 'opening' | 'opened' | 'unavailable' | 'failed'; opportunityId?: string;
  }[];
}

/** Private search evidence and decisions survive session restarts alongside negotiations and H2A. */
export interface PursuitState {
  version: string | null;
  status: 'idle' | 'running' | 'done' | 'failed';
  searches: SearchRecord[];
  summary?: string;
}
