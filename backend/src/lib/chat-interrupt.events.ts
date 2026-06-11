import { EventEmitter } from 'events';

/**
 * Payload emitted when a /chat/interrupt request resolves a steer-or-queue decision.
 */
export interface ChatInterruptPayload {
  decision: 'steer' | 'queue';
  messageId: string;
}

/**
 * Singleton event emitter for per-session chat interrupt signals.
 * A running /chat/stream handler subscribes once per session; the /chat/interrupt
 * handler emits when the classifier has resolved.
 *
 * Multi-instance note: this is in-memory only. A Redis pub/sub upgrade
 * would swap this module while preserving the emitChatInterrupt/onChatInterrupt API.
 */
const chatInterruptEmitter = new EventEmitter();
chatInterruptEmitter.setMaxListeners(200);

/**
 * Emit an interrupt decision to any active stream handler for the given session.
 *
 * @param sessionId - The chat session that received the interrupt
 * @param payload - The classifier decision and message ID
 */
export function emitChatInterrupt(sessionId: string, payload: ChatInterruptPayload): void {
  chatInterruptEmitter.emit(`interrupt:${sessionId}`, payload);
}

/**
 * Subscribe to interrupt events for a session.
 * Uses `.on()` so that multiple interrupts during the same stream are all
 * delivered to the handler (e.g. a first 'queue' decision followed by a
 * second 'steer' decision). The caller is responsible for unsubscribing
 * by invoking the returned function — the stream handler calls it in finally.
 *
 * @param sessionId - The chat session to subscribe to
 * @param handler - Called each time an interrupt is resolved for this session
 * @returns Unsubscribe function
 */
export function onChatInterrupt(
  sessionId: string,
  handler: (payload: ChatInterruptPayload) => void,
): () => void {
  chatInterruptEmitter.on(`interrupt:${sessionId}`, handler);
  return () => chatInterruptEmitter.off(`interrupt:${sessionId}`, handler);
}
