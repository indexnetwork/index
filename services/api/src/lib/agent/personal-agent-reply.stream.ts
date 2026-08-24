/**
 * Token transport for the PersonalAgent's completed conversational messages.
 *
 * The turn runs on the inbox worker — serialization stays THE inbox — so the
 * reply's chunks cross back to the waiting chat controller over Redis
 * pub/sub, on a channel keyed by the same message id that keys the inbox
 * job (prior art: `lib/conversation-events.ts` publishes conversation events
 * on user-scoped channels the same way). The controller subscribes BEFORE
 * enqueueing and forwards chunks as SSE token events; if the subscription
 * yields nothing but the job completes, it falls back to emitting the
 * completed reply in one token event — a turn is never lost to a dropped
 * channel, because the channel is a latency optimization and the job result
 * is the truth.
 *
 * Chunks are published only after each message passed its prose-safety check
 * and was persisted; nothing unchecked crosses this transport.
 *
 * In hermetic test mode (the same `useHermeticRedis()` guard the queue
 * factory applies) the transport is an in-process emitter, so controller and
 * worker specs exercise the real subscribe→publish→relay path without Redis.
 */
import { EventEmitter } from 'events';

import { useHermeticRedis } from '../bullmq/bullmq';
import { log } from '../log';

const logger = log.lib.from('personal-agent-reply.stream');

/** One ordered slice of a checked message. `seq` starts at 1 per turn. */
export interface PersonalAgentReplyChunk {
  seq: number;
  content: string;
}

export function personalAgentReplyChannel(messageId: string): string {
  return `personal-agent:reply:${messageId}`;
}

const hermeticBus = new EventEmitter();
hermeticBus.setMaxListeners(200);

/**
 * Publish one chunk toward whichever controller is streaming this turn.
 * Never throws — the job result is the durable truth and a publish failure
 * must not fail the turn; the controller's fallback covers the gap.
 */
export async function publishPersonalAgentReplyChunk(
  messageId: string,
  chunk: PersonalAgentReplyChunk,
): Promise<void> {
  const channel = personalAgentReplyChannel(messageId);
  try {
    if (useHermeticRedis()) {
      hermeticBus.emit(channel, JSON.stringify(chunk));
      return;
    }
    const { getRedisClient } = await import('../../adapters/cache.adapter');
    await getRedisClient().publish(channel, JSON.stringify(chunk));
  } catch (err) {
    logger.warn('personal_agent_reply_publish_failed', {
      messageId,
      seq: chunk.seq,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Subscribe to a turn's reply chunks. Resolves once the subscription is
 * established (subscribe BEFORE enqueueing the turn); the returned cleanup
 * is idempotent and must run in the stream's finally. Malformed payloads are
 * dropped — the fallback path owns completeness, this path owns latency.
 */
export async function subscribePersonalAgentReply(
  messageId: string,
  onChunk: (chunk: PersonalAgentReplyChunk) => void,
): Promise<() => void> {
  const channel = personalAgentReplyChannel(messageId);
  const handle = (data: string) => {
    try {
      const parsed = JSON.parse(data) as PersonalAgentReplyChunk;
      if (typeof parsed?.seq === 'number' && typeof parsed?.content === 'string') onChunk(parsed);
    } catch {
      // Malformed chunk: drop; the job-result fallback delivers the reply.
    }
  };

  if (useHermeticRedis()) {
    hermeticBus.on(channel, handle);
    return () => hermeticBus.off(channel, handle);
  }

  const { createRedisClient } = await import('../../adapters/cache.adapter');
  const subscriber = createRedisClient();
  let cancelled = false;
  subscriber.on('message', (incoming: string, data: string) => {
    if (!cancelled && incoming === channel) handle(data);
  });
  try {
    await subscriber.subscribe(channel);
  } catch (err) {
    // A failed subscribe is a degraded turn, not a lost one: the caller's
    // fallback emits the completed reply from the job result.
    logger.warn('personal_agent_reply_subscribe_failed', {
      messageId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return () => {
    if (cancelled) return;
    cancelled = true;
    subscriber.unsubscribe(channel).then(() => subscriber.disconnect()).catch(() => subscriber.disconnect());
  };
}
