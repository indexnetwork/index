import type { WakeTiming } from '../core/timing.ts';

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
  matchProbability: number;
  reasoning: string;
  candidatePayload: string;
  candidateSummary?: string;
  profile: DiscoveryCandidateProfile | null;
  networkContext?: string;

}

/** All currently authorized intent networks, scanned once after a completed H2A review. */
export interface DiscoveryInput {
  networkIds: string[];
}

/** A scored match or deliberate reopening bound to source records, authorized scope and the latest session. */
export interface NegotiationOpeningRequest {
  id: string;
  target: { userId: string; intentId: string; networkId: string; payload: string };
  source: { kind: 'match'; matchId: string; probability: number } | { kind: 'negotiation'; negotiationId: string };
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
  /** Return every eligible scored intent/network pair in descending matchProbability order, without a score cutoff, with public match reasoning. */
  discoverCounterparties(
    input: DiscoveryInput,
    scopeVersion: string,
    signal: AbortSignal,
    timing?: WakeTiming,
  ): Promise<{ candidates: DiscoveryCandidate[] }>;
  /** Atomically open with an initial brief. Match sources never reopen terminal pairs; existing sessions keep their briefs. */
  openNegotiation(
    request: NegotiationOpeningRequest,
    signal: AbortSignal,
  ): Promise<OpenNegotiationResult>;
}
