import { isVisibleNegotiationConversation, resolveNegotiationCounterpart } from '@/lib/negotiation-inbox';
import type { ConversationSummary, NegotiationOpportunityStatus } from '@/services/conversation';

export interface NegotiationOutlineOpportunity {
  conversationId: string;
  counterpartId: string;
  /** Null when the API projected no opportunity for this conversation. */
  opportunityId: string | null;
  /** Null when no task session is addressable; the row then opens the latest one. */
  taskId: string | null;
  title: string;
  status: NegotiationOpportunityStatus | null;
  updatedAt: string;
  /**
   * True for a fallback row standing in for a conversation the opportunity
   * projection could not group. Such a row is deliberately coarse, but it is
   * never omitted — see `buildFallbackOpportunity`.
   */
  ungrouped: boolean;
}

export interface NegotiationOutlineCounterparty {
  id: string;
  name: string;
  avatar: string | null;
  opportunities: NegotiationOutlineOpportunity[];
}

function timestampOf(value: string | null | undefined): number {
  const parsed = new Date(value ?? 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The rail row for a conversation with no viewer-visible opportunity projection.
 *
 * `negotiationOpportunities` is gated on match provenance: the API only
 * projects an opportunity the viewer can already see through a `via` entry
 * naming one of their own intents (conversation.database.adapter.ts). A
 * negotiation whose conversation metadata carries no `matchProvenance` — or
 * whose provenance intent no longer resolves to the viewer — projects an empty
 * array while `negotiation` still carries a full lifecycle. Dropping those left
 * the your-move badge counting a negotiation the list refused to render.
 *
 * The lifecycle summary supplies the session target, so this row still opens
 * the right transcript; only the opportunity title is unavailable.
 */
function buildFallbackOpportunity(
  conversation: ConversationSummary,
  counterpartId: string,
): NegotiationOutlineOpportunity {
  const lifecycle = conversation.negotiation ?? null;
  return {
    conversationId: conversation.id,
    counterpartId,
    opportunityId: lifecycle?.opportunityId ?? null,
    taskId: lifecycle?.taskId ?? null,
    title: conversation.via[0]?.title ?? conversation.metadata?.title ?? 'Negotiation',
    status: lifecycle?.opportunityStatus ?? null,
    updatedAt: lifecycle?.updatedAt ?? conversation.lastMessageAt ?? conversation.createdAt,
    ungrouped: true,
  };
}

/**
 * Groups the chat rail's negotiation conversations by counterparty.
 *
 * Membership is decided by `isVisibleNegotiationConversation`, the same
 * predicate the inbox uses for the your-move badge, so the badge and this list
 * can never disagree about what a negotiation is. Within a visible
 * conversation, viewer-visible opportunity projections become one row each; a
 * conversation with none still gets a single fallback row.
 */
export function groupNegotiationOutline(
  negotiations: ConversationSummary[],
  viewerUserId: string | undefined,
): NegotiationOutlineCounterparty[] {
  const groups = new Map<string, NegotiationOutlineCounterparty>();

  for (const conversation of negotiations) {
    if (!isVisibleNegotiationConversation(conversation, viewerUserId)) continue;
    const counterpart = resolveNegotiationCounterpart(conversation, viewerUserId);
    if (!counterpart) continue;

    const group = groups.get(counterpart.id) ?? {
      id: counterpart.id,
      name: counterpart.name,
      avatar: counterpart.avatar,
      opportunities: [],
    };
    const projected = conversation.negotiationOpportunities ?? [];
    if (projected.length === 0) {
      group.opportunities.push(buildFallbackOpportunity(conversation, counterpart.id));
    } else {
      for (const opportunity of projected) {
        group.opportunities.push({
          conversationId: conversation.id,
          counterpartId: counterpart.id,
          opportunityId: opportunity.opportunityId,
          taskId: opportunity.taskId,
          title: opportunity.title,
          status: opportunity.opportunityStatus,
          updatedAt: opportunity.updatedAt,
          ungrouped: false,
        });
      }
    }
    groups.set(counterpart.id, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      opportunities: group.opportunities.sort((left, right) => (
        timestampOf(right.updatedAt) - timestampOf(left.updatedAt)
      )),
    }))
    .sort((left, right) => (
      timestampOf(right.opportunities[0]?.updatedAt) - timestampOf(left.opportunities[0]?.updatedAt)
    ));
}

export const opportunityStatusPresentation: Record<NegotiationOpportunityStatus, { label: string; dotClass: string }> = {
  latent: { label: 'Latent', dotClass: 'bg-gray-400' },
  draft: { label: 'Draft', dotClass: 'bg-gray-400' },
  negotiating: { label: 'Negotiating', dotClass: 'bg-amber-500' },
  pending: { label: 'Pending', dotClass: 'bg-amber-500' },
  stalled: { label: 'Stalled', dotClass: 'bg-amber-500' },
  accepted: { label: 'Accepted', dotClass: 'bg-emerald-600' },
  rejected: { label: 'Rejected', dotClass: 'bg-red-600' },
  expired: { label: 'Expired', dotClass: 'bg-gray-400' },
};
