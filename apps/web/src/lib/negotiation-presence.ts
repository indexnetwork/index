import { deriveNegotiationInbox, type NegotiationInboxItem, type NegotiationInboxStatus } from '@/lib/negotiation-inbox';
import type { ConversationSummary } from '@/services/conversation';

/**
 * In-flight statuses: the agents are still talking (the negotiation has not
 * resolved and is not waiting on a human accept). 'answer' is in-flight too —
 * the negotiation continues once the viewer replies.
 */
const IN_FLIGHT_STATUSES: ReadonlySet<NegotiationInboxStatus> = new Set(['answer', 'live', 'waiting']);

export interface LiveNegotiation extends NegotiationInboxItem {
  /** Opportunity this negotiation is about (null for pre-opportunity dialogues). */
  opportunityId: string | null;
  /** Signals (intents) that surfaced this negotiation for the viewer. */
  intentIds: string[];
}

/**
 * Live (in-flight) negotiations enriched with opportunity/signal linkage from
 * the raw conversation summaries. Read-only composition over
 * `deriveNegotiationInbox` — no LLM, no extra fetches.
 */
export function deriveLiveNegotiations(
  negotiations: ConversationSummary[],
  viewerUserId: string | undefined,
): LiveNegotiation[] {
  const inbox = deriveNegotiationInbox(negotiations, viewerUserId);
  const byId = new Map(negotiations.map((conversation) => [conversation.id, conversation]));
  return [...inbox.yourMove, ...inbox.inProgress].flatMap((item) => {
    if (!IN_FLIGHT_STATUSES.has(item.status)) return [];
    const conversation = byId.get(item.conversationId);
    if (!conversation) return [];
    return [{
      ...item,
      opportunityId: conversation.negotiation?.opportunityId ?? null,
      intentIds: conversation.via.map((via) => via.intentId),
    }];
  });
}

/** Index live negotiations by opportunity id for card-level lookup (first wins). */
export function liveNegotiationsByOpportunity(live: LiveNegotiation[]): Map<string, LiveNegotiation> {
  const byOpportunity = new Map<string, LiveNegotiation>();
  for (const item of live) {
    if (item.opportunityId && !byOpportunity.has(item.opportunityId)) {
      byOpportunity.set(item.opportunityId, item);
    }
  }
  return byOpportunity;
}

/** One-line latest move for the ambient chip, e.g. "Their agent countered · 12m ago". */
export function formatLatestMove(lastAction: string, timeAgo: string): string {
  const move = lastAction.charAt(0).toUpperCase() + lastAction.slice(1);
  return `${move} · ${timeAgo}`;
}
