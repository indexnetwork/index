import { getRedisClient } from '../adapters/cache.adapter';

/**
 * Wire event types on a user's channel.
 *
 * One channel serves both audiences, and nothing on the wire separates them: an
 * agent-bound key resolves to its owner, so the agent subscribes to the same
 * channel the owner's app is already reading and each side ignores the types it
 * does not recognise. `opportunity.new` is the human's; `negotiation.turn` and
 * `negotiation.settled` are the agent's, and carry a pointer rather than the
 * turn — the agent reads `GET /negotiations/:opportunityId` to act.
 *
 * Messages are not here. They are human-addressed and the conversation channel
 * already delivers them with their text inline.
 */
export type NotificationStreamEventType =
  | 'opportunity.new'
  | 'negotiation.turn'
  | 'negotiation.settled';

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
