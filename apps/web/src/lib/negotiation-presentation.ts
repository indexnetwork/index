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

/**
 * Converts database lifecycle fields into the single state a viewer needs to
 * understand. This is deliberately the only presentation path for the inbox
 * and chat rail: neither surface should expose a raw task or opportunity state.
 *
 * A negotiation task's lifecycle is now exactly `working | paused | completed`
 * (negotiation-graph rewrite, #1494); a turn can only continue or pause, never
 * decide — `resolve` (writing `opportunityStatus` to `pending`/`rejected`) is
 * the only terminal write, so opportunity status stays authoritative over the
 * task snapshot the same way it always was. There is no more `outcome`
 * object, no `turn_cap`/`agent_error`/`timeout` stall reason, and no
 * `ask_user`/`accept`/`reject`/`decline`/`withdraw` turn action — the nearest
 * equivalents are the task's own `pause.reason`.
 */
export function deriveNegotiationPresentation(input: {
  lifecycle: Lifecycle;
  latestSenderId?: string | null;
  viewerUserId?: string;
}): NegotiationPresentation {
  const { lifecycle } = input;
  if (!lifecycle) return PRESENTATIONS.not_started;

  const isViewerAgent = input.latestSenderId === `agent:${input.viewerUserId}`;
  const opportunityStatus = lifecycle.opportunityStatus;
  const pauseReason = 'pause' in lifecycle ? lifecycle.pause?.reason ?? null : null;

  // Opportunity terminal states are authoritative over stale task snapshots
  // and turns. Draft/latent rows likewise cannot be promoted by a turn from
  // another session.
  if (opportunityStatus === 'accepted') {
    return lifecycle.acceptedByViewer ? PRESENTATIONS.accepted_by_viewer : PRESENTATIONS.connection_accepted;
  }
  if (opportunityStatus === 'rejected') return PRESENTATIONS.no_match;
  if (opportunityStatus === 'stalled') return PRESENTATIONS.no_agreement;
  if (opportunityStatus === 'expired') return PRESENTATIONS.expired;
  if (opportunityStatus === 'latent' || opportunityStatus === 'draft') return PRESENTATIONS.not_started;
  if (opportunityStatus === 'pending') return PRESENTATIONS.awaiting_review;
  if (pauseReason === 'needs_principal' && isViewerAgent) return PRESENTATIONS.needs_input;
  // ready_for_verdict is a recommendation to that side's own principal agent,
  // not a decision — surfaced the same as an already-pending opportunity: it
  // needs review before anything is final.
  if (pauseReason === 'ready_for_verdict') return PRESENTATIONS.awaiting_review;
  if (lifecycle.state === 'completed') return PRESENTATIONS.no_agreement;
  if (lifecycle.state === 'working' || lifecycle.state === 'paused' || opportunityStatus === 'negotiating') {
    return PRESENTATIONS.negotiating;
  }
  return PRESENTATIONS.not_started;
}
