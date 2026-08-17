import type { NegotiationOpportunityLifecycle, OpportunityStatus } from '../shared/interfaces/database.interface.js';

const DIRECT_CONVERSATION_EVIDENCE_UNAVAILABLE = 'not_provided' as const;

type NegotiationConnectionState =
  | 'potential_match_awaiting_owner_review'
  | 'owner_accepted'
  | 'accepted_without_owner_evidence'
  | 'rejected'
  | 'negotiation_stalled'
  | 'draft_not_sent'
  | 'expired'
  | 'agents_negotiating'
  | 'latent'
  | 'unknown';

export interface NegotiationLifecycleNarration {
  agentNegotiation: 'concluded' | 'in_progress' | 'awaiting_agent' | 'unknown';
  opportunityStatus: OpportunityStatus | null;
  connectionState: NegotiationConnectionState;
  ownerAction: 'accepted' | 'not_recorded';
  directConversationEvidence: typeof DIRECT_CONVERSATION_EVIDENCE_UNAVAILABLE;
  lifecycleLabel: string;
}

/**
 * Builds additive, lifecycle-explicit narration metadata. Task completion only
 * means the agents concluded; it never establishes owner acceptance or an H2H
 * conversation.
 */
export function buildLifecycleNarration(
  negotiationStatus: string,
  opportunity?: NegotiationOpportunityLifecycle,
): NegotiationLifecycleNarration {
  const agentNegotiation: NegotiationLifecycleNarration['agentNegotiation'] = negotiationStatus === 'completed'
    ? 'concluded'
    : negotiationStatus === 'active'
      ? 'in_progress'
      : negotiationStatus === 'waiting_for_agent'
        ? 'awaiting_agent'
        : 'unknown';
  const common = {
    agentNegotiation,
    opportunityStatus: opportunity?.status ?? null,
    ownerAction: opportunity?.acceptedByOwner ? 'accepted' as const : 'not_recorded' as const,
    directConversationEvidence: DIRECT_CONVERSATION_EVIDENCE_UNAVAILABLE,
  };

  switch (opportunity?.status) {
    case 'pending':
      return {
        ...common,
        connectionState: 'potential_match_awaiting_owner_review',
        lifecycleLabel: negotiationStatus === 'completed'
          ? "Agents concluded with a potential match; awaiting the owner's review."
          : "A potential match is awaiting the owner's review.",
      };
    case 'accepted':
      return opportunity.acceptedByOwner
        ? {
          ...common,
          connectionState: 'owner_accepted',
          lifecycleLabel: 'The owner explicitly accepted this opportunity.',
        }
        : {
          ...common,
          connectionState: 'accepted_without_owner_evidence',
          lifecycleLabel: 'The opportunity is accepted; this result does not record an owner acceptance.',
        };
    case 'rejected':
      return {
        ...common,
        connectionState: 'rejected',
        lifecycleLabel: 'The opportunity was rejected; no connection was established.',
      };
    case 'stalled':
      return {
        ...common,
        connectionState: 'negotiation_stalled',
        lifecycleLabel: 'The agent negotiation stalled; no connection was established.',
      };
    case 'draft':
      return {
        ...common,
        connectionState: 'draft_not_sent',
        lifecycleLabel: 'The opportunity is still a draft; it has not been sent or accepted.',
      };
    case 'expired':
      return {
        ...common,
        connectionState: 'expired',
        lifecycleLabel: 'The opportunity expired; no connection was established.',
      };
    case 'negotiating':
      return {
        ...common,
        connectionState: 'agents_negotiating',
        lifecycleLabel: 'The agents are still negotiating; no owner decision is recorded.',
      };
    case 'latent':
      return {
        ...common,
        connectionState: 'latent',
        lifecycleLabel: 'The potential match is latent; no owner decision is recorded.',
      };
    default:
      return {
        ...common,
        connectionState: 'unknown',
        lifecycleLabel: negotiationStatus === 'completed'
          ? 'The agent negotiation concluded; the current opportunity lifecycle is unavailable.'
          : 'The current opportunity lifecycle is unavailable.',
      };
  }
}
