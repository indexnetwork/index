import type { NegotiationOpportunityLifecycle, OpportunityStatus } from '../../platform/database.js';
import type { NegotiationPauseReason } from './negotiation.turn.js';

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
  | 'paused_counterparty_silent'
  | 'paused_needs_principal'
  | 'paused_ready_for_verdict'
  | 'paused_turn_cap'
  | 'unknown';

/** How a negotiation task reads when it is currently paused. */
export interface NegotiationParkNarration {
  reason: NegotiationPauseReason;
  payload?: unknown;
}

export interface NegotiationLifecycleNarration {
  agentNegotiation: 'working' | 'paused' | 'completed';
  opportunityStatus: OpportunityStatus | null;
  connectionState: NegotiationConnectionState;
  ownerAction: 'accepted' | 'not_recorded';
  directConversationEvidence: typeof DIRECT_CONVERSATION_EVIDENCE_UNAVAILABLE;
  lifecycleLabel: string;
  /** Present only while the negotiation actually holds a pause. */
  pause?: NegotiationParkNarration;
}

/** The one line a pause is allowed to render as; supersedes the opportunity status label. */
export function parkLifecycleLabel(pause: NegotiationParkNarration): string {
  switch (pause.reason) {
    case 'counterparty_silent':
      return 'PAUSED — the counterparty has not responded within the window. Nobody is currently exchanging turns.';
    case 'needs_principal':
      return 'PAUSED — the negotiator needs something only the principal knows before it can continue.';
    case 'ready_for_verdict':
      return 'PAUSED — the negotiator believes a decision is possible and is waiting on its principal to act on its recommendation.';
    case 'turn_cap':
      return 'PAUSED — the negotiation reached its turn cap and cannot continue without review.';
  }
}

/**
 * Builds additive, lifecycle-explicit narration metadata. Task completion only
 * means the negotiation was resolved; it never establishes owner acceptance or
 * an H2H conversation.
 */
export function buildLifecycleNarration(
  taskState: 'working' | 'paused' | 'completed',
  opportunity?: NegotiationOpportunityLifecycle,
  pause?: NegotiationParkNarration,
): NegotiationLifecycleNarration {
  const common = {
    agentNegotiation: taskState,
    opportunityStatus: opportunity?.status ?? null,
    ownerAction: opportunity?.acceptedByOwner ? 'accepted' as const : 'not_recorded' as const,
    directConversationEvidence: DIRECT_CONVERSATION_EVIDENCE_UNAVAILABLE,
  };

  if (pause) {
    const connectionState: NegotiationConnectionState =
      pause.reason === 'counterparty_silent' ? 'paused_counterparty_silent'
      : pause.reason === 'needs_principal' ? 'paused_needs_principal'
      : pause.reason === 'turn_cap' ? 'paused_turn_cap'
      : 'paused_ready_for_verdict';
    return { ...common, connectionState, lifecycleLabel: parkLifecycleLabel(pause), pause };
  }

  switch (opportunity?.status) {
    case 'pending':
      return {
        ...common,
        connectionState: 'potential_match_awaiting_owner_review',
        lifecycleLabel: "A potential match is awaiting the owner's review.",
      };
    case 'accepted':
      return opportunity.acceptedByOwner
        ? { ...common, connectionState: 'owner_accepted', lifecycleLabel: 'The owner explicitly accepted this opportunity.' }
        : { ...common, connectionState: 'accepted_without_owner_evidence', lifecycleLabel: 'The opportunity is accepted; this result does not record an owner acceptance.' };
    case 'rejected':
      return { ...common, connectionState: 'rejected', lifecycleLabel: 'The opportunity was rejected; no connection was established.' };
    case 'stalled':
      return { ...common, connectionState: 'negotiation_stalled', lifecycleLabel: 'The agent negotiation stalled; no connection was established.' };
    case 'draft':
      return { ...common, connectionState: 'draft_not_sent', lifecycleLabel: 'The opportunity is still a draft; it has not been sent or accepted.' };
    case 'expired':
      return { ...common, connectionState: 'expired', lifecycleLabel: 'The opportunity expired; no connection was established.' };
    case 'negotiating':
      return { ...common, connectionState: 'agents_negotiating', lifecycleLabel: 'The agents are still negotiating; no owner decision is recorded.' };
    case 'latent':
      return { ...common, connectionState: 'latent', lifecycleLabel: 'The potential match is latent; no owner decision is recorded.' };
    default:
      return {
        ...common,
        connectionState: 'unknown',
        lifecycleLabel: taskState === 'completed'
          ? 'The agent negotiation concluded; the current opportunity lifecycle is unavailable.'
          : 'The current opportunity lifecycle is unavailable.',
      };
  }
}
