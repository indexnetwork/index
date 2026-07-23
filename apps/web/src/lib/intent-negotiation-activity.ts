import type { ConversationSummary } from '@/services/conversation';

/**
 * Derives a stable revision from negotiation conversations that the API has
 * already proven belong to the current viewer's intent. Keeping this filter at
 * the boundary prevents unrelated negotiation activity from refreshing Radar.
 *
 * @param conversations - Authenticated viewer's negotiation summaries.
 * @param intentId - The viewer-owned intent displayed by Radar.
 * @returns Stable revision or an empty string when no conversation is in scope.
 */
export function intentNegotiationActivityRevision(
  conversations: ConversationSummary[],
  intentId: string | undefined,
): string {
  if (!intentId) return '';
  return conversations
    .filter((conversation) => conversation.via.some((entry) => entry.intentId === intentId))
    .map((conversation) => `${conversation.id}:${conversation.lastMessageAt ?? ''}`)
    .sort()
    .join('|');
}
