import { getRedisClient } from '../adapters/cache.adapter';

/** Wire event types for Hermes Desktop OS notifications. */
export type NotificationStreamEventType =
  | 'question.new'
  | 'opportunity.new';

/** User-scoped notification frame — composed on the server before publish. */
export interface NotificationStreamEvent {
  type: NotificationStreamEventType;
  id: string;
  title: string;
  body: string;
  /**
   * Absolute deep link to the surface that resolves the notification, when
   * the frame has one. Optional: `opportunity.new` frames are routed by the
   * client from (type, id), while `question.new` names the signal's DM
   * explicitly — the question lives in a conversation, not on a card.
   */
  link?: string;
}

/** Injectable delivery boundary shared by realtime publication and isolated tests. */
export type NotificationStreamPublisher = (
  userId: string,
  event: NotificationStreamEvent,
) => Promise<void>;

export function notificationStreamChannel(userId: string): string {
  return `notifications:user:${userId}`;
}

/**
 * Publishes a user-scoped notification event to Redis for SSE consumers.
 */
export async function publishNotificationStreamEvent(
  userId: string,
  event: NotificationStreamEvent,
): Promise<void> {
  if (!userId) return;
  const publisher = getRedisClient();
  await publisher.publish(notificationStreamChannel(userId), JSON.stringify(event));
}
