/**
 * Token transport for the IntentAgent's streaming reply stage (phase 2 of
 * docs/plans/2026-08-21-holistic-intent-agent.md).
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
 * Chunks are published only AFTER the reply passed the prose-safety check
 * and was persisted (check-then-stream — see intent-agent.turn.ts `reply`):
 * nothing unchecked ever crosses this transport.
 *
 * In hermetic test mode (the same `useHermeticRedis()` guard the queue
 * factory applies) the transport is an in-process emitter, so controller and
 * worker specs exercise the real subscribe→publish→relay path without Redis.
 */
import { EventEmitter } from 'events';

import { useHermeticRedis } from '../bullmq/bullmq';
import { log } from '../log';

const logger = log.lib.from('intent-agent-reply.stream');

/** One ordered slice of the checked reply. `seq` starts at 1 per turn. */
export interface IntentAgentReplyChunk {
  seq: number;
  content: string;
}

export function intentAgentReplyChannel(messageId: string): string {
  return `intent-agent:reply:${messageId}`;
}

const hermeticBus = new EventEmitter();
hermeticBus.setMaxListeners(200);

/**
 * Publish one chunk toward whichever controller is streaming this turn.
 * Never throws — the job result is the durable truth and a publish failure
 * must not fail the turn; the controller's fallback covers the gap.
 */
export async function publishIntentAgentReplyChunk(
  messageId: string,
  chunk: IntentAgentReplyChunk,
): Promise<void> {
  const channel = intentAgentReplyChannel(messageId);
  try {
    if (useHermeticRedis()) {
      hermeticBus.emit(channel, JSON.stringify(chunk));
      return;
    }
    const { getRedisClient } = await import('../../adapters/cache.adapter');
    await getRedisClient().publish(channel, JSON.stringify(chunk));
  } catch (err) {
    logger.warn('intent_agent_reply_publish_failed', {
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
export async function subscribeIntentAgentReply(
  messageId: string,
  onChunk: (chunk: IntentAgentReplyChunk) => void,
): Promise<() => void> {
  const channel = intentAgentReplyChannel(messageId);
  const handle = (data: string) => {
    try {
      const parsed = JSON.parse(data) as IntentAgentReplyChunk;
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
    logger.warn('intent_agent_reply_subscribe_failed', {
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

/**
 * Split a checked reply into sentence-sized chunks for progressive rendering.
 * Purely presentational: the text is already complete, checked, and
 * persisted when this runs (check-then-stream), so the split can never
 * change what the client ultimately reads.
 */
export function chunkReplyText(text: string): string[] {
  const chunks = text.match(/[^.!?\n]*[.!?\n]+[)"'”’]*\s*|[^.!?\n]+$/g);
  return chunks && chunks.length > 0 ? chunks : [text];
}
