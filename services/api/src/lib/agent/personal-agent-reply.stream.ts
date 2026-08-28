/**
 * Transport for the PersonalAgent's checked replies and safe activity labels.
 *
 * The turn runs on the signal's serialized lane, in-process with the chat
 * controller, so the reply's chunks cross back over an in-process
 * EventEmitter, on a channel keyed by the same message id as the turn
 * (prior art: `lib/conversation-events.ts` publishes conversation events on
 * user-scoped channels the same way). The controller subscribes BEFORE
 * running the turn and forwards chunks as SSE token events; if the
 * subscription yields nothing but the turn completes, it falls back to
 * emitting the completed reply in one token event — a turn is never lost to
 * a dropped subscription, because the channel is a latency optimization and
 * the turn result is the truth.
 *
 * Chunks are published only after each message passed its prose-safety check
 * and was persisted; nothing unchecked crosses this transport.
 */
import { EventEmitter } from 'events';

/** One ordered slice of a checked message. `seq` starts at 1 per turn. */
export interface PersonalAgentReplyChunk {
  seq: number;
  content: string;
}

export type PersonalAgentReplyStreamEvent =
  | { type: 'chunk'; seq: number; content: string }
  | { type: 'activity'; label: string };

export function personalAgentReplyChannel(messageId: string): string {
  return `personal-agent:reply:${messageId}`;
}

const bus = new EventEmitter();
bus.setMaxListeners(200);

/**
 * Publish one chunk toward whichever controller is streaming this turn.
 * Never throws — the turn result is the durable truth and a publish failure
 * must not fail the turn; the controller's fallback covers the gap.
 */
export async function publishPersonalAgentReplyChunk(
  messageId: string,
  chunk: PersonalAgentReplyChunk,
): Promise<void> {
  publishPersonalAgentReplyEvent(messageId, { type: 'chunk', ...chunk });
}

/** Publish only the user-safe label; protocol-internal activity state stays server-side. */
export async function publishPersonalAgentActivity(
  messageId: string,
  activity: { label: string },
): Promise<void> {
  publishPersonalAgentReplyEvent(messageId, { type: 'activity', label: activity.label });
}

function publishPersonalAgentReplyEvent(
  messageId: string,
  event: PersonalAgentReplyStreamEvent,
): void {
  bus.emit(personalAgentReplyChannel(messageId), event);
}

/**
 * Subscribe to a turn's reply chunks. Resolves once the subscription is
 * established (subscribe BEFORE running the turn); the returned cleanup is
 * idempotent and must run in the stream's finally.
 */
export async function subscribePersonalAgentReply(
  messageId: string,
  onEvent: (event: PersonalAgentReplyStreamEvent) => void,
): Promise<() => void> {
  const channel = personalAgentReplyChannel(messageId);
  bus.on(channel, onEvent);
  return () => bus.off(channel, onEvent);
}
