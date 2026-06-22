import type { ConversationMessage } from '@/services/conversation';
import type { ChatContextOpportunity } from '@/services/opportunities';

/** A merged timeline item: either a single message or a (possibly grouped) opportunity divider. */
export type TimelineItem =
  | { type: 'message'; at: string; message: ConversationMessage }
  | { type: 'opportunity'; at: string; opportunities: ChatContextOpportunity[] };

/** Group opportunities accepted within this many ms with no message between them. */
const GROUP_WINDOW_MS = 5 * 60 * 1000;

/**
 * Merge messages and accepted opportunities into a single chronological timeline.
 *
 * Adjacent opportunity items are coalesced into a single grouped entry when the
 * incoming item's `acceptedAt` is within {@link GROUP_WINDOW_MS} of the *first*
 * opportunity in the running group (not of the previous one). A message between
 * two opportunities always breaks the group, regardless of timing.
 *
 * @param messages - Conversation messages in any order.
 * @param opportunities - Accepted opportunities; entries with `acceptedAt === null` are dropped.
 * @returns Timeline items sorted ascending by timestamp.
 */
export function buildChatTimeline(
  messages: ConversationMessage[],
  opportunities: ChatContextOpportunity[],
): TimelineItem[] {
  const messageItems: TimelineItem[] = messages.map((m) => ({
    type: 'message',
    at: m.createdAt,
    message: m,
  }));

  const opportunityItems: TimelineItem[] = opportunities
    .filter((o): o is ChatContextOpportunity & { acceptedAt: string } => !!o.acceptedAt)
    .map((o) => ({ type: 'opportunity' as const, at: o.acceptedAt, opportunities: [o] }));

  const merged = [...messageItems, ...opportunityItems].sort(
    (a, b) => new Date(a.at).getTime() - new Date(b.at).getTime(),
  );

  // Coalesce adjacent opportunity items within the grouping window.
  return merged.reduce<TimelineItem[]>((acc, item) => {
    const last = acc[acc.length - 1];
    if (
      item.type === 'opportunity' &&
      last?.type === 'opportunity' &&
      new Date(item.at).getTime() - new Date(last.at).getTime() <= GROUP_WINDOW_MS
    ) {
      acc[acc.length - 1] = {
        ...last,
        opportunities: [...last.opportunities, ...item.opportunities],
      };
      return acc;
    }
    acc.push(item);
    return acc;
  }, []);
}
