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
 * Publishes a question-message regeneration flip for one signal scope to the
 * owner's existing conversation SSE channel. `pending: true` means the
 * scope's regeneration job was just enqueued; `pending: false` means it
 * finished and the conversation content is current — the web client shows the
 * regeneration indicator on true and reloads the negotiator session on false,
 * so a delivered message never changes under a viewer without a signal.
 *
 * @param userId - Owner of the signal's negotiator DM.
 * @param event - The scope (intentId) and the new pending state.
 */
export async function publishQuestionRegenerationEvent(
  userId: string,
  event: { intentId: string; pending: boolean },
): Promise<void> {
  const publisher = getRedisClient();
  await publisher.publish(
    `conversations:user:${userId}`,
    JSON.stringify({ type: 'question_regeneration', ...event }),
  );
}
