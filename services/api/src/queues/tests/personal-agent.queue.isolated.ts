/**
 * The PersonalAgent inbox's actor property: every event for one signal
 * executes strictly one-at-a-time — a reflect turn can never interleave with
 * the principal's own message turn. Deterministic and harness-level: turns
 * are scripted with real async gaps, and the spans they record must never
 * overlap. Hermetic BullMQ double, no Redis, no database, no model.
 */
import { describe, expect, it } from 'bun:test';
import type { PersonalAgentInput, PersonalAgentResult } from '@indexnetwork/protocol';

import { PersonalAgentQueue } from '../personal-agent.queue';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Span {
  event: string;
  start: number;
  end: number;
}

function buildQueue(run: (input: PersonalAgentInput) => PersonalAgentResult | Promise<PersonalAgentResult>) {
  const spans: Span[] = [];
  let invocations = 0;
  const queue = new PersonalAgentQueue(async (input) => {
    invocations += 1;
    const span: Span = {
      event: 'messageId' in input ? input.messageId : JSON.stringify(input),
      start: performance.now(),
      end: 0,
    };
    // A real async gap: an interleaving second turn would start inside it.
    await sleep(25);
    span.end = performance.now();
    spans.push(span);
    return run(input);
  });
  return { queue, spans, invocations: () => invocations };
}

/**
 * The hermetic broker is keyed by queue NAME and shared process-wide, so a
 * still-attached worker from an earlier test would consume a later test's
 * jobs. Every test runs its queue to completion and closes it first.
 */
async function withQueue<T>(
  built: ReturnType<typeof buildQueue>,
  body: (harness: ReturnType<typeof buildQueue>) => Promise<T>,
): Promise<T> {
  built.queue.startWorker();
  try {
    return await body(built);
  } finally {
    await built.queue.close();
  }
}

const idle: PersonalAgentResult = { scope: 'intent', acts: [], messages: [] };

describe('PersonalAgentQueue serialization', () => {
  it('three concurrent events for one signal execute serially — spans never overlap', async () => {
    await withQueue(buildQueue(() => idle), async ({ queue, spans }) => {
      const jobs = await Promise.all([
        queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-1' }),
        queue.addAllPausedEvent({ userId: 'user-1', intentId: 'intent-1', round: 3 }),
        queue.addUserMessageEvent({
          userId: 'user-1', intentId: 'intent-1', event: 'user_message',
          sessionId: 'session-1', messageId: 'reply-1', text: 'hello',
        }),
      ]);
      await Promise.all(jobs.map((job) => job.waitUntilFinished(undefined as never, 10_000)));

      expect(spans).toHaveLength(3);
      const ordered = [...spans].sort((a, b) => a.start - b.start);
      for (let index = 1; index < ordered.length; index += 1) {
        // The actor property: the next turn starts only after the previous
        // one ended. An interleaving would put a start inside another span.
        expect(ordered[index]!.start).toBeGreaterThanOrEqual(ordered[index - 1]!.end);
      }
    });
  });

  it('a redelivered user message coalesces on its message id — one turn, not two', async () => {
    await withQueue(buildQueue(() => idle), async ({ queue, invocations }) => {
      const event = {
        userId: 'user-1', intentId: 'intent-1', event: 'user_message',
        sessionId: 'session-1', messageId: 'reply-dup', text: 'hello',
      } as const;
      const [first, second] = await Promise.all([queue.addUserMessageEvent(event), queue.addUserMessageEvent(event)]);
      expect(second.id).toBe(first.id);
      await first.waitUntilFinished(undefined as never, 10_000);
      expect(invocations()).toBe(1);
    });
  });

  it('a round reflects exactly once — ten pauses of one round collapse to one job', async () => {
    await withQueue(buildQueue(() => idle), async ({ queue, invocations }) => {
      const jobs = await Promise.all(Array.from({ length: 10 }, () =>
        queue.addAllPausedEvent({ userId: 'user-1', intentId: 'intent-1', round: 7 })));
      expect(new Set(jobs.map((job) => job.id)).size).toBe(1);
      await jobs[0]!.waitUntilFinished(undefined as never, 10_000);
      expect(invocations()).toBe(1);
    });
  });

  it('runUserMessageTurn returns what the agent did', async () => {
    const result: PersonalAgentResult = {
      scope: 'intent',
      acts: [{ tool: 'message_user', text: 'Right here.', sessionId: 'session-1', messageId: 'message-1', stage: 'reply' }],
      messages: ['Right here.'],
    };
    await withQueue(buildQueue(() => result), async ({ queue }) => {
      const turn = await queue.runUserMessageTurn({
        userId: 'user-1', intentId: 'intent-1', event: 'user_message',
        sessionId: 'session-1', messageId: 'reply-2', text: 'where are we?',
      });
      expect(turn.messages).toEqual(['Right here.']);
      expect(turn.acts).toEqual(result.acts);
    });
  });

  it('a graph-level error fails the turn — the awaited lane rejects and the job stays retryable', async () => {
    await withQueue(buildQueue(() => ({ scope: 'intent', acts: [], messages: [], error: 'provider down' })), async ({ queue }) => {
      await expect(queue.runUserMessageTurn({
        userId: 'user-1', intentId: 'intent-1', event: 'user_message',
        sessionId: 'session-1', messageId: 'reply-3', text: 'hello',
      }, { timeoutMs: 500 })).rejects.toThrow();
    });
  });
});
