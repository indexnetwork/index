/**
 * The PersonalAgent inbox's actor property: every event for one signal
 * executes strictly one-at-a-time — a reflect turn can never interleave with
 * the principal's own message turn. Deterministic and harness-level: turns
 * are scripted with real async gaps, and the spans they record must never
 * overlap. Hermetic BullMQ double, no Redis, no database, no model.
 */
import { describe, expect, it } from 'bun:test';
import { requestContext, setRequestContextStore } from '@indexnetwork/protocol';
import type { PersonalAgentInput, PersonalAgentResult } from '@indexnetwork/protocol';
import { UnrecoverableError } from 'bullmq';

import { requestContext as hostRequestContext } from '../../lib/request-context';
import { PERSONAL_AGENT_BACKGROUND_EXECUTION_BUDGET_MS, PersonalAgentQueue } from '../personal-agent.queue';

setRequestContextStore(hostRequestContext);

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
        queue.addAllPausedEvent({ userId: 'user-1', intentId: 'intent-1', batchId: 'batch-3', dedupeKey: 'task-1.0' }),
      ]);
      await Promise.all([
        ...jobs.map((job) => job.waitUntilFinished(undefined as never, 10_000)),
        // user_message is not queued: it runs directly on the same
        // per-intent lane, alongside the two queued events above.
        queue.runUserMessageTurn({
          userId: 'user-1', intentId: 'intent-1', event: 'user_message',
          sessionId: 'session-1', messageId: 'reply-1', text: 'hello',
        }),
      ]);

      expect(spans).toHaveLength(3);
      const ordered = [...spans].sort((a, b) => a.start - b.start);
      for (let index = 1; index < ordered.length; index += 1) {
        // The actor property: the next turn starts only after the previous
        // one ended. An interleaving would put a start inside another span.
        expect(ordered[index]!.start).toBeGreaterThanOrEqual(ordered[index - 1]!.end);
      }
    });
  });

  it('events for different signals do not wait behind each other', async () => {
    await withQueue(buildQueue(() => idle), async ({ queue, spans }) => {
      const jobs = await Promise.all([
        queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-1' }),
        queue.addMatchesReadyEvent({ userId: 'user-2', intentId: 'intent-2' }),
      ]);
      await Promise.all(jobs.map((job) => job.waitUntilFinished(undefined as never, 10_000)));

      expect(spans).toHaveLength(2);
      const [first, second] = [...spans].sort((a, b) => a.start - b.start);
      expect(second!.start).toBeLessThan(first!.end);
    });
  });

  it('one durable drain reflects exactly once, while a reopened generation runs again', async () => {
    await withQueue(buildQueue(() => idle), async ({ queue, invocations }) => {
      const jobs = await Promise.all(Array.from({ length: 10 }, () =>
        queue.addAllPausedEvent({ userId: 'user-1', intentId: 'intent-1', batchId: 'batch-7', dedupeKey: 'task-1.0' })));
      expect(new Set(jobs.map((job) => job.id)).size).toBe(1);
      await jobs[0]!.waitUntilFinished(undefined as never, 10_000);
      expect(invocations()).toBe(1);

      const reopened = await queue.addAllPausedEvent({
        userId: 'user-1', intentId: 'intent-1', batchId: 'batch-7', dedupeKey: 'task-1.1',
      });
      expect(reopened.id).not.toBe(jobs[0]!.id);
      await reopened.waitUntilFinished(undefined as never, 10_000);
      expect(invocations()).toBe(2);
    });
  });

  it('delivers one retained counterpart-resolution notification per verdict', async () => {
    await withQueue(buildQueue(() => idle), async ({ queue, invocations }) => {
      const event = {
        userId: 'user-1', intentId: 'intent-1', event: 'counterparty_resolved' as const,
        negotiationId: 'task-1', verdict: 'pending' as const,
      };
      const [first, duplicate] = await Promise.all([
        queue.addCounterpartyResolvedEvent(event),
        queue.addCounterpartyResolvedEvent(event),
      ]);
      expect(duplicate.id).toBe(first.id);
      await first.waitUntilFinished(undefined as never, 10_000);
      expect(invocations()).toBe(1);
    });
  });

  it('delivers one retained needs-principal notification per pause generation', async () => {
    await withQueue(buildQueue(() => idle), async ({ queue, invocations }) => {
      const event = {
        userId: 'user-1', intentId: 'intent-1', event: 'needs_principal' as const,
        negotiationId: 'task-1', generation: 0,
      };
      const [first, duplicate] = await Promise.all([
        queue.addNeedsPrincipalEvent(event),
        queue.addNeedsPrincipalEvent(event),
      ]);
      expect(duplicate.id).toBe(first.id);
      expect(first.opts.lifo).toBe(true);
      await first.waitUntilFinished(undefined as never, 10_000);
      expect(invocations()).toBe(1);

      const reopened = await queue.addNeedsPrincipalEvent({ ...event, generation: 1 });
      await reopened.waitUntilFinished(undefined as never, 10_000);
      expect(invocations()).toBe(2);
    });
  });

  it('a matches_ready batch arriving while a turn is running is queued, never swallowed', async () => {
    // The coalescing that makes a burst of discovery batches one kickoff must
    // not eat a batch the running turn has already read past: BullMQ silently
    // returns the existing job for a duplicate id, so a second slot exists.
    let release: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { release = resolve; });
    let gate: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { gate = resolve; });
    const built = buildQueue(async () => {
      release?.();
      await held;
      return idle;
    });
    built.queue.startWorker();
    try {
      const first = await built.queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-1' });
      await started;
      // The turn is now ACTIVE and has read its match list; this batch is new.
      const second = await built.queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-1' });
      expect(second.id).not.toBe(first.id);
      // A concurrent worker may reserve this job, but the signal gate must
      // keep its graph invocation behind the first turn.
      expect(built.invocations()).toBe(1);
      // With parallel workers both reserved slots can already be active (the
      // per-signal gate still serializes their graph turns), so a third batch
      // takes the documented unkeyed follow-up path.
      const third = await built.queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-1' });
      expect(third.id).not.toBe(first.id);
      expect(third.id).not.toBe(second.id);
      gate?.();
      await Promise.all([first, second, third].map((job) => job.waitUntilFinished(undefined as never, 10_000)));
      expect(built.invocations()).toBe(3);
    } finally {
      gate?.();
      await built.queue.close();
    }
  });

  it('a failed matches_ready is retained, and its slot is not silently reused', async () => {
    // Deleting a terminally failed wake loses the persisted batch with no
    // trace and no other path back — the same silent loss `matchesReadyNode`
    // throws to prevent, one hop downstream. Retained, the slot is occupied,
    // so the next batch must take the follow-up slot instead of vanishing
    // into a job that will never run again.
    const built = buildQueue(() => { throw new Error('wake failed'); });
    built.queue.startWorker();
    try {
      const first = await built.queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-fail' });
      expect(first.opts.removeOnFail).not.toBe(true);
      const deadline = Date.now() + 15_000;
      let state = await first.getState();
      while (state !== 'failed' && Date.now() < deadline) {
        await sleep(100);
        state = await first.getState();
      }
      expect(state).toBe('failed');
      expect(await built.queue.queue.getJob(first.id!)).not.toBeNull();

      // A NEW batch for the same signal is a fresh wake for the same work, so
      // it reclaims the slot rather than being pushed onto the follow-up. Held
      // instead, both slots stay dead for the seven days BullMQ retains a
      // failure: coalescing stops and every batch becomes its own kickoff.
      const second = await built.queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-fail' });
      expect(second.id).toBe(first.id);
    } finally {
      await built.queue.close();
    }
  });

  it('a reflect job is retained on completion so one generation cannot reflect twice', async () => {
    await withQueue(buildQueue(() => idle), async ({ queue }) => {
      const job = await queue.addAllPausedEvent({ userId: 'user-1', intentId: 'intent-1', batchId: 'batch-4', dedupeKey: 'task-1.0' });
      // The queue default is removeOnComplete { age: 24h }, which would free
      // the id and let a late pause on a stale negotiation re-wake the agent
      // for a round it already closed out.
      expect(job.opts.removeOnComplete).toBe(false);
    });
  });

  it('runUserMessageTurn returns what the agent did', async () => {
    const result: PersonalAgentResult = {
      scope: 'intent',
      acts: [{ tool: 'message_user', text: 'Right here.', sessionId: 'session-1', messageId: 'message-1' }],
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

  it('publishes one owner-scoped completion signal only after a successful turn', async () => {
    const published: Array<{ userId: string; intentId: string }> = [];
    const queue = new PersonalAgentQueue(async () => idle, async (event) => { published.push(event); });
    try {
      await queue.processEvent({ userId: 'user-1', intentId: 'intent-1', event: 'matches_ready' });
      expect(published).toEqual([{ userId: 'user-1', intentId: 'intent-1' }]);
    } finally {
      await queue.close();
    }
  });

  it('a graph-level error fails the turn — the direct call rejects, with no retry', async () => {
    await withQueue(buildQueue(() => ({ scope: 'intent', acts: [], messages: [], error: 'provider down' })), async ({ queue, invocations }) => {
      await expect(queue.runUserMessageTurn({
        userId: 'user-1', intentId: 'intent-1', event: 'user_message',
        sessionId: 'session-1', messageId: 'reply-3', text: 'hello',
      })).rejects.toThrow('provider down');
      expect(invocations()).toBe(1);
    });
  });

  it("runUserMessageTurn's deadline rejects the caller and also aborts the graph invocation", async () => {
    let observedAbort = false;
    const queue = new PersonalAgentQueue(async () => {
      const signal = requestContext.getStore()?.abortSignal;
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => { observedAbort = true; resolve(); }, { once: true }));
      throw new Error('model aborted');
    });
    try {
      // The caller sees the deadline itself, not the invocation's own
      // eventual abort-throw — that happens at least a microtask later.
      await expect(queue.runUserMessageTurn({
        userId: 'user-1', intentId: 'intent-1', event: 'user_message',
        sessionId: 'session-1', messageId: 'reply-deadline', text: 'hello',
      }, { timeoutMs: 25 })).rejects.toThrow(/25ms deadline/);
      // The same signal still reaches the invocation, even though the
      // caller has already stopped waiting on it.
      await sleep(10);
      expect(observedAbort).toBe(true);
    } finally {
      await queue.close();
    }
  });

  it("a second same-intent turn queued behind a slow first is bounded by its own call-relative deadline", async () => {
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const queue = new PersonalAgentQueue(async (input) => {
      if ('messageId' in input && input.messageId === 'reply-first') await firstGate;
      return idle;
    });
    try {
      const first = queue.runUserMessageTurn({
        userId: 'user-1', intentId: 'intent-1', event: 'user_message',
        sessionId: 'session-1', messageId: 'reply-first', text: 'first',
      }, { timeoutMs: 10_000 });
      // Let the first turn claim the lane before the second is called.
      await sleep(10);

      const start = performance.now();
      const second = queue.runUserMessageTurn({
        userId: 'user-1', intentId: 'intent-1', event: 'user_message',
        sessionId: 'session-1', messageId: 'reply-second', text: 'second',
      }, { timeoutMs: 50 });

      // Bounded by the second call's OWN deadline, not a fresh budget that
      // only starts once the lane frees — the first turn is still gated and
      // would not free the lane for ~10s.
      await expect(second).rejects.toThrow(/50ms deadline/);
      expect(performance.now() - start).toBeLessThan(500);

      releaseFirst?.();
      await first;
    } finally {
      releaseFirst?.();
      await queue.close();
    }
  });

  it('a background job gets a fresh execution-relative budget and preserves request context', async () => {
    const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')!;
    let timeoutMs: number | undefined;
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      value: (ms: number) => {
        timeoutMs = ms;
        return new AbortController().signal;
      },
    });
    let captured: ReturnType<typeof requestContext.getStore>;
    const queue = new PersonalAgentQueue(async () => {
      captured = requestContext.getStore();
      return idle;
    });
    try {
      const job = await queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-background' });
      // A stale enqueue timestamp: the background budget is a fresh window
      // from pickup, not queue-wait-relative, so this must not shrink it.
      job.timestamp = Date.now() - 10 * 60_000;

      const result = await hostRequestContext.run(
        { originUrl: 'https://queue.example.test' },
        () => queue.processJob(job),
      );

      expect(result).toEqual(idle);
      expect(captured?.originUrl).toBe('https://queue.example.test');
      expect(captured?.abortSignal).toBeInstanceOf(AbortSignal);
      expect(captured?.abortSignal?.aborted).toBe(false);
      expect(timeoutMs).toBe(PERSONAL_AGENT_BACKGROUND_EXECUTION_BUDGET_MS);
    } finally {
      Object.defineProperty(AbortSignal, 'timeout', timeoutDescriptor);
      await queue.close();
    }
  });

  it('a background deadline failure stays retryable instead of becoming unrecoverable', async () => {
    const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout')!;
    const deadline = new AbortController();
    Object.defineProperty(AbortSignal, 'timeout', {
      configurable: true,
      value: () => deadline.signal,
    });
    const queue = new PersonalAgentQueue(async () => {
      const signal = requestContext.getStore()?.abortSignal;
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      throw new Error('background model aborted');
    });
    try {
      const job = await queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-background-deadline' });
      const processing = queue.processJob(job);
      deadline.abort(new DOMException('deadline', 'TimeoutError'));

      await expect(processing).rejects.toThrow('background model aborted');
      await expect(processing).rejects.not.toBeInstanceOf(UnrecoverableError);
    } finally {
      Object.defineProperty(AbortSignal, 'timeout', timeoutDescriptor);
      await queue.close();
    }
  });

  it('preserves inherited cancellation separately from the queue deadline', async () => {
    const inherited = new AbortController();
    const queue = new PersonalAgentQueue(async () => {
      const signal = requestContext.getStore()?.abortSignal;
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      throw new Error('caller cancelled');
    });
    try {
      const job = await queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-cancelled' });
      const processing = hostRequestContext.run(
        { abortSignal: inherited.signal },
        () => queue.processJob(job),
      );
      inherited.abort(new DOMException('caller cancelled', 'AbortError'));

      await expect(processing).rejects.toThrow('caller cancelled');
      await expect(processing).rejects.not.toBeInstanceOf(UnrecoverableError);
    } finally {
      await queue.close();
    }
  });
});
