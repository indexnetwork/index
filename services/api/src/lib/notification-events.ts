import { EventEmitter } from 'events';

/**
 * Payload emitted when a new opportunity notification is broadcast (e.g. for WebSocket).
 */
export interface OpportunityNotificationPayload {
  opportunityId: string;
  recipientId: string;
}

/**
 * Singleton event emitter for real-time notification broadcasts.
 * A WebSocket server or SSE endpoint can subscribe to 'opportunity' to push to clients.
 */
const notificationEmitter = new EventEmitter();
notificationEmitter.setMaxListeners(100);

export function emitOpportunityNotification(payload: OpportunityNotificationPayload): void {
  notificationEmitter.emit('opportunity', payload);
}

export function onOpportunityNotification(
  handler: (payload: OpportunityNotificationPayload) => void
): () => void {
  notificationEmitter.on('opportunity', handler);
  return () => notificationEmitter.off('opportunity', handler);
}
