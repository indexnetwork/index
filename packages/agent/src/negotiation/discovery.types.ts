import type { Negotiation } from './negotiation.types.ts';

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

/** Five complementary queries sharing one similarity floor and authorized intent-network scope. */
export interface CandidateQuery {
  queries: string[];
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

export type NegotiationSelection = {
  reasoning: string;
  brief: string;
} & ({ searchId: string; candidateIntentId: string; networkId: string; negotiationId?: never }
  | { negotiationId: string; searchId?: never; candidateIntentId?: never; networkId?: never });

/** A deliberate non-selection, retained in owner-visible activity rather than treated as an opening. */
export interface SkippedCounterparty {
  searchId: string;
  candidateIntentId: string;
  networkId: string;
  reason: string;
}

/** Every candidate in the pending search must be opened or explicitly skipped exactly once. */
export interface OpenNegotiationsInput {
  negotiations: NegotiationSelection[];
  skipped: SkippedCounterparty[];
}

/** A deliberate selection bound to its source records, authorized scope and observed latest session. */
export interface NegotiationOpeningRequest {
  id: string;
  target: { userId: string; intentId: string; networkId: string; payload: string };
  source: { kind: 'search'; searchId: string; similarity: number } | { kind: 'negotiation'; negotiationId: string };
  expectedLatestNegotiationId: string | null;
  expectedLatestOutcome: Negotiation['outcome'];
  expectedLatestOpportunityStatus: Negotiation['opportunityStatus'] | null;
  reasoning: string;
  brief: string;
  sourceMessageId: string;
  contextVersion: string;
  scopeVersion: string;
}

export type OpenNegotiationResult =
  | { status: 'opened'; opportunityId: string; contextVersion: string; delegationId?: string }
  | { status: 'unavailable' };

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
    request: NegotiationOpeningRequest,
    signal: AbortSignal,
  ): Promise<OpenNegotiationResult>;
}
