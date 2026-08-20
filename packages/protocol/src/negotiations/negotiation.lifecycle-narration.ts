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
  /** Parked on THIS user: the negotiation is waiting on their answer. */
  | 'parked_awaiting_your_answer'
  /** Parked on the other side: nothing here is waiting on this user. */
  | 'parked_awaiting_counterparty'
  | 'unknown';

/**
 * A live park on a listed negotiation, as the listing must narrate it (#1472).
 *
 * `question`/`questionLabel` are present only for a park on THIS user's side
 * whose question the host could name, and the number is the one the
 * open-questions prompt section shows and `answer_pending_question` takes —
 * they come from the same record, never from a second enumeration. A park on
 * the counterparty's side carries no question content: it is not this client's
 * to read.
 */
export interface NegotiationParkNarration {
  waitingOn: 'you' | 'counterparty';
  kind: 'mid_flight' | 'post_stall';
  question?: number;
  questionLabel?: string;
}

export interface NegotiationLifecycleNarration {
  agentNegotiation: 'concluded' | 'in_progress' | 'awaiting_agent' | 'unknown';
  opportunityStatus: OpportunityStatus | null;
  connectionState: NegotiationConnectionState;
  ownerAction: 'accepted' | 'not_recorded';
  directConversationEvidence: typeof DIRECT_CONVERSATION_EVIDENCE_UNAVAILABLE;
  lifecycleLabel: string;
  /** Present only while the negotiation actually holds a park. */
  park?: NegotiationParkNarration;
}

/**
 * The one line a park is allowed to render as. Opportunity status is the wrong
 * question here — a parked pairing is legitimately `negotiating` — so the park
 * SUPERSEDES the status label rather than sitting beside it: the persona is
 * told to take `lifecycleLabel` as its user-facing wording, and "the agents
 * are still negotiating" is exactly the sentence that became a false "nothing
 * for you to decide".
 */
export function parkLifecycleLabel(park: NegotiationParkNarration): string {
  if (park.waitingOn === 'counterparty') {
    return 'PARKED — waiting on the counterparty’s side. Nothing on this pairing is waiting on the client, and the agents are not exchanging turns until the other side answers.';
  }
  const named = park.question !== undefined && park.questionLabel
    ? ` waiting on YOUR client’s answer to open question ${park.question}, “${park.questionLabel}”`
    : " waiting on YOUR client’s answer";
  return `PARKED —${named}. The agents are NOT exchanging turns and will not until the client answers; this is something for them to decide.`;
}

/**
 * Builds additive, lifecycle-explicit narration metadata. Task completion only
 * means the agents concluded; it never establishes owner acceptance or an H2H
 * conversation.
 */
export function buildLifecycleNarration(
  negotiationStatus: string,
  opportunity?: NegotiationOpportunityLifecycle,
  park?: NegotiationParkNarration,
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

  // A live park outranks the opportunity status for narration. The status is
  // still reported in `opportunityStatus`; what it may not do is supply the
  // sentence, because `negotiating` is a true status and "still negotiating"
  // is a false answer to "is anything waiting on me?".
  if (park) {
    return {
      ...common,
      connectionState: park.waitingOn === 'you'
        ? 'parked_awaiting_your_answer'
        : 'parked_awaiting_counterparty',
      lifecycleLabel: parkLifecycleLabel(park),
      park,
    };
  }

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
