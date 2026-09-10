import { getRedisClient } from '../adapters/cache.adapter';

/**
 * One channel per user carries every realtime frame, and nothing on the wire
 * separates the audiences: an agent-bound key resolves to its owner, so the
 * agent subscribes to the same channel the owner's app is already reading and
 * each side ignores the types it does not recognise. `opportunity.new`,
 * `question.pending` and `message` are the human's; the rest are the agent's.
 *
 * The agent types come in two scopes. `negotiation.turn` and
 * `negotiation.settled` point at one negotiation and carry a pointer rather
 * than the turn — the agent reads `GET /negotiations/:opportunityId` to act.
 * `intent.lifecycle` and `negotiation.opened` are scoped to a signal instead:
 * whether the agent should be working it at all, and that discovery gave it
 * something to work.
 *
 * `question.pending` is scoped to a signal too, but the other way round: the
 * personal agent stopped and cannot continue until its owner answers, so the
 * frame names the intent whose H2A conversation holds the question.
 *
 * `message` is the exception to the pointer shape: it is human-addressed and
 * carries its text inline, so a desktop toast needs no follow-up read.
 */
export type UserEventType =
  | 'opportunity.new'
  | 'question.pending'
  | 'negotiation.turn'
  | 'negotiation.settled'
  | 'negotiation.opened'
  | 'intent.lifecycle'
  | 'message';

/**
 * The effective state of a signal as agents see it.
 *
 * `ARCHIVED` is a wire value, not a column: removal sets `archived_at` rather
 * than a status, and an agent only needs to know the signal is gone. The
 * `FULFILLED` and `EXPIRED` members of the database enum are read as guards but
 * never written, so they never reach the wire.
 */
export type IntentLifecycleWireStatus = 'ACTIVE' | 'PAUSED' | 'ARCHIVED';

/**
 * Every frame except `message`: a pointer at the record that moved, plus copy
 * composed on the server for a desktop toast. Messages are published by
 * {@link publishConversationMessageEvent} and carry their text inline instead.
 */
export interface UserEvent {
  type: Exclude<UserEventType, 'message'>;
  id: string;
  title: string;
  body: string;
  /**
   * Absolute deep link to the surface that resolves the event, when the frame
   * has one.
   */
  link?: string;
  /**
   * Machine payload. `title`/`body` are for the person; this is what an agent
   * reads to know which record moved.
   */
  data?: Record<string, unknown>;
}

/** Injectable delivery boundary shared by realtime publication and isolated tests. */
export type UserEventPublisher = (
  userId: string,
  event: UserEvent,
) => Promise<void>;

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

export function userEventChannel(userId: string): string {
  return `events:user:${userId}`;
}

/**
 * Publishes a user-scoped event to Redis for SSE consumers.
 */
export async function publishUserEvent(
  userId: string,
  event: UserEvent,
): Promise<void> {
  if (!userId) return;
  const publisher = getRedisClient();
  await publisher.publish(userEventChannel(userId), JSON.stringify(event));
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
 * Publishes a persisted message to each authorized participant's channel. The
 * channel is user-scoped, never intent-scoped, so the API remains the final
 * provenance/privacy filter.
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
    publisher.publish(userEventChannel(userId), event)
  )));
}
