import { getRedisClient } from '../adapters/cache.adapter';

/**
 * Wire event types on a user's channel.
 *
 * One channel serves both audiences. `opportunity.new` and `message.new` are
 * for the human; `negotiation.turn` and `negotiation.settled` are for the
 * owner's agent, which connects with its agent-bound key — that key resolves
 * to the owner, so it lands here and filters by type.
 */
export type NotificationStreamEventType =
  | 'opportunity.new'
  | 'negotiation.turn'
  | 'negotiation.settled'
  | 'message.new';

/** User-scoped notification frame — composed on the server before publish. */
export interface NotificationStreamEvent {
  type: NotificationStreamEventType;
  id: string;
  title: string;
  body: string;
  /**
   * Absolute deep link to the surface that resolves the notification, when
   * the frame has one.
   */
  link?: string;
  /**
   * Machine payload. `title`/`body` are for the person; this is what an agent
   * reads to know which record moved.
   */
  data?: Record<string, unknown>;
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
