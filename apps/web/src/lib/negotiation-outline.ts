import { isVisibleNegotiationConversation, resolveNegotiationCounterpart, sessionScopedLastTurn } from '@/lib/negotiation-inbox';
import { deriveNegotiationPresentation, type NegotiationPresentation } from '@/lib/negotiation-presentation';
import type { ConversationSummary } from '@/services/conversation';

export interface NegotiationOutlineOpportunity {
  conversationId: string;
  counterpartId: string;
  /** Null when the API projected no opportunity for this conversation. */
  opportunityId: string | null;
  /** Null when no task session is addressable; the row then opens the latest one. */
  taskId: string | null;
  title: string;
  presentation: NegotiationPresentation;
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

function fallbackSignalTitle(conversation: ConversationSummary): string {
  const title = conversation.via[0]?.title ?? conversation.metadata?.title?.trim();
  return title && title.toLowerCase() !== 'negotiation' ? title : 'Signal';
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
  viewerUserId: string | undefined,
): NegotiationOutlineOpportunity {
  const lifecycle = conversation.negotiation ?? null;
  // `negotiation` is the latest task projection; the message is eligible only
  // when its task id confirms it is from that same session.
  const lastTurn = sessionScopedLastTurn(conversation, lifecycle?.taskId);
  return {
    conversationId: conversation.id,
    counterpartId,
    opportunityId: lifecycle?.opportunityId ?? null,
    taskId: lifecycle?.taskId ?? null,
    title: fallbackSignalTitle(conversation),
    presentation: deriveNegotiationPresentation({
      lifecycle,
      latestAction: lastTurn.action,
      latestSenderId: lastTurn.senderId,
      viewerUserId,
    }),
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
      group.opportunities.push(buildFallbackOpportunity(conversation, counterpart.id, viewerUserId));
    } else {
      for (const opportunity of projected) {
        // Do not leak the conversation's latest turn across task sessions.
        const lastTurn = sessionScopedLastTurn(conversation, opportunity.taskId);
        group.opportunities.push({
          conversationId: conversation.id,
          counterpartId: counterpart.id,
          opportunityId: opportunity.opportunityId,
          taskId: opportunity.taskId,
          title: opportunity.title,
          presentation: deriveNegotiationPresentation({
            lifecycle: opportunity,
            latestAction: lastTurn.action,
            latestSenderId: lastTurn.senderId,
            viewerUserId,
          }),
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
