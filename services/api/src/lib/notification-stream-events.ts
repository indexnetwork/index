import { getRedisClient } from '../adapters/cache.adapter';

/** Wire event types for Hermes Desktop OS notifications. */
export type NotificationStreamEventType =
  | 'question.new'
  | 'question.attention'
  | 'opportunity.new';

export interface NotificationStreamEventBase {
  type: NotificationStreamEventType;
}

export interface QuestionNewNotificationEvent extends NotificationStreamEventBase {
  type: 'question.new';
  questionId: string;
  prompt: string;
  intentLabel?: string;
  opportunityLabel?: string;
}

export interface QuestionAttentionNotificationEvent extends NotificationStreamEventBase {
  type: 'question.attention';
  questionId: string;
  peerName: string;
  negotiationId?: string;
}

export interface OpportunityNewNotificationEvent extends NotificationStreamEventBase {
  type: 'opportunity.new';
  opportunityId: string;
  headline: string;
  summary: string;
  counterpartyName?: string;
}

export type NotificationStreamEvent =
  | QuestionNewNotificationEvent
  | QuestionAttentionNotificationEvent
  | OpportunityNewNotificationEvent;

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
