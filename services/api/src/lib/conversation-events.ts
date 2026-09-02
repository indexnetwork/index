import { getRedisClient } from '../adapters/cache.adapter';

interface ConversationEventParticipant {
  participantId: string;
}

interface ConversationEventMessage {
  conversationId: string;
  id: string;
  senderId: string;
  /** Display name for OS/inbox previews; omitted when unresolved. */
  senderName?: string;
  /**
   * Sender avatar for OS notification attachments: either a full URL (legacy
   * OAuth photos) or an S3 object key served at `{base}/storage/<key>`.
   * Omitted when the sender has none.
   */
  senderAvatar?: string;
  role: 'user' | 'agent';
  parts: unknown;
  taskId?: string | null;
  createdAt: Date;
}

/**
 * Resolves the authenticated user channels entitled to receive an event for a
 * conversation. Agent participants represent their owner as `agent:<userId>`.
 *
 * @param participants - Persisted conversation participants.
 * @returns Unique authenticated user IDs authorized for the conversation.
 */
export function conversationEventRecipientUserIds(
  participants: ConversationEventParticipant[],
): string[] {
  return [...new Set(participants
    .map(({ participantId }) => participantId.startsWith('agent:')
      ? participantId.slice('agent:'.length)
      : participantId)
    .filter(Boolean))];
}

/**
 * Publishes a persisted message to each authorized participant's existing
 * conversation SSE channel. The channel is user-scoped, never intent-scoped,
 * so the API remains the final provenance/privacy filter.
 *
 * @param message - Persisted conversation message.
 * @param participants - Persisted conversation participants.
 */
export async function publishConversationMessageEvent(
  message: ConversationEventMessage,
  participants: ConversationEventParticipant[],
): Promise<void> {
  const event = JSON.stringify({
    type: 'message',
    conversationId: message.conversationId,
    message,
  });
  const publisher = getRedisClient();
  await Promise.all(conversationEventRecipientUserIds(participants).map((userId) => (
    publisher.publish(`conversations:user:${userId}`, event)
  )));
}

/**
 * Publishes an owner-scoped invalidation after the durable discovery-progress
 * snapshot changes. The client re-fetches its authoritative intent response;
 * no progress data crosses the shared SSE channel.
 */
export async function publishIntentDiscoveryProgressEvent(input: {
  userId: string;
  intentId: string;
}): Promise<void> {
  await getRedisClient().publish(
    `conversations:user:${input.userId}`,
    JSON.stringify({ type: 'intent_discovery_progress', intentId: input.intentId }),
  );
}

/** Publishes an owner-scoped invalidation after another intent-owned view changes. */
export async function publishIntentInvalidationEvent(input: {
  userId: string;
  intentId: string;
}): Promise<void> {
  await getRedisClient().publish(
    `conversations:user:${input.userId}`,
    JSON.stringify({ type: 'intent_invalidated', intentId: input.intentId }),
  );
}
