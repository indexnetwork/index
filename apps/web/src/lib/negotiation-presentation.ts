import type { ConversationNegotiationLifecycle, ConversationNegotiationOpportunity } from '@/services/conversation';

export type NegotiationPresentationStatus =
  | 'needs_input'
  | 'awaiting_review'
  | 'negotiating'
  | 'accepted_by_viewer'
  | 'connection_accepted'
  | 'no_match'
  | 'no_agreement'
  | 'expired'
  | 'couldnt_complete'
  | 'not_started';

export type NegotiationPresentationGroup = 'your_move' | 'in_progress' | 'resolved';

export interface NegotiationPresentation {
  status: NegotiationPresentationStatus;
  group: NegotiationPresentationGroup;
  label: string;
  /** Shared by the compact rail dot and the inbox chip. */
  dotClass: string;
  chipClass: string;
}

type Lifecycle = ConversationNegotiationLifecycle | ConversationNegotiationOpportunity | null | undefined;

const PRESENTATIONS: Record<NegotiationPresentationStatus, NegotiationPresentation> = {
  needs_input: { status: 'needs_input', group: 'your_move', label: 'Needs your input', dotClass: 'bg-[#041729]', chipClass: 'border-[#041729] bg-[#041729] text-white' },
  awaiting_review: { status: 'awaiting_review', group: 'your_move', label: 'Awaiting your review', dotClass: 'bg-amber-500', chipClass: 'border-amber-200 bg-amber-50 text-amber-700' },
  negotiating: { status: 'negotiating', group: 'in_progress', label: 'Negotiating', dotClass: 'bg-amber-500', chipClass: 'border-amber-200 bg-amber-50 text-amber-700' },
  accepted_by_viewer: { status: 'accepted_by_viewer', group: 'resolved', label: 'Accepted by you', dotClass: 'bg-emerald-600', chipClass: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  connection_accepted: { status: 'connection_accepted', group: 'resolved', label: 'Connection accepted', dotClass: 'bg-emerald-600', chipClass: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  no_match: { status: 'no_match', group: 'resolved', label: 'No match', dotClass: 'bg-red-600', chipClass: 'border-red-200 bg-red-50 text-red-700' },
  no_agreement: { status: 'no_agreement', group: 'resolved', label: 'No agreement', dotClass: 'bg-gray-400', chipClass: 'border-gray-200 bg-gray-100 text-gray-600' },
  expired: { status: 'expired', group: 'resolved', label: 'Expired', dotClass: 'bg-gray-400', chipClass: 'border-gray-200 bg-gray-100 text-gray-600' },
  couldnt_complete: { status: 'couldnt_complete', group: 'resolved', label: 'Couldn\'t complete', dotClass: 'bg-gray-400', chipClass: 'border-gray-200 bg-gray-100 text-gray-600' },
  not_started: { status: 'not_started', group: 'in_progress', label: 'Not started', dotClass: 'bg-gray-400', chipClass: 'border-gray-200 bg-gray-100 text-gray-600' },
};

export function presentationForStatus(status: NegotiationPresentationStatus): NegotiationPresentation {
  return PRESENTATIONS[status];
}

const REJECT_ACTIONS = new Set(['reject', 'decline', 'withdraw']);
const STALL_REASONS = new Set(['turn_cap', 'timeout']);

/**
 * Converts database lifecycle fields into the single state a viewer needs to
 * understand. This is deliberately the only presentation path for the inbox
 * and chat rail: neither surface should expose a raw task or opportunity state.
 */
export function deriveNegotiationPresentation(input: {
  lifecycle: Lifecycle;
  latestAction?: string | null;
  latestSenderId?: string | null;
  viewerUserId?: string;
}): NegotiationPresentation {
  const { lifecycle, latestAction } = input;
  if (!lifecycle) return PRESENTATIONS.not_started;

  const isViewerAgent = input.latestSenderId === `agent:${input.viewerUserId}`;
  const opportunityStatus = lifecycle.opportunityStatus;
  const outcome = lifecycle.outcome;

  // An opportunity's completed human decision is authoritative over stale task
  // snapshots. The rest is ordered by the negotiation's latest known outcome.
  if (opportunityStatus === 'accepted') {
    return lifecycle.acceptedByViewer ? PRESENTATIONS.accepted_by_viewer : PRESENTATIONS.connection_accepted;
  }
  if (opportunityStatus === 'rejected') return PRESENTATIONS.no_match;
  if (opportunityStatus === 'expired') return PRESENTATIONS.expired;
  if (lifecycle.state === 'input_required' && latestAction === 'ask_user' && isViewerAgent) {
    return PRESENTATIONS.needs_input;
  }
  if (opportunityStatus === 'pending' || outcome?.hasOpportunity === true || latestAction === 'accept') {
    return PRESENTATIONS.awaiting_review;
  }
  if (opportunityStatus === 'stalled' || STALL_REASONS.has(outcome?.reason ?? '')) return PRESENTATIONS.no_agreement;
  if (['failed', 'canceled', 'auth_required'].includes(lifecycle.state)) return PRESENTATIONS.couldnt_complete;
  if (lifecycle.state === 'rejected' || outcome?.hasOpportunity === false || (latestAction && REJECT_ACTIONS.has(latestAction))) {
    return PRESENTATIONS.no_match;
  }
  if (opportunityStatus === 'latent' || opportunityStatus === 'draft') return PRESENTATIONS.not_started;
  if (lifecycle.state === 'completed') return PRESENTATIONS.no_agreement;
  if (['submitted', 'working', 'waiting_for_agent', 'claimed', 'input_required'].includes(lifecycle.state) || opportunityStatus === 'negotiating') {
    return PRESENTATIONS.negotiating;
  }
  return PRESENTATIONS.not_started;
}
