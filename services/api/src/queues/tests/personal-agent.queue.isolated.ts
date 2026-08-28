/**
 * The PersonalAgent inbox's actor property: every event for one signal
 * executes strictly one-at-a-time — a reflect turn can never interleave with
 * the principal's own message turn. Deterministic: turns are scripted with
 * real async gaps, and the spans they record must never overlap.
 *
 * background() is mocked to capture (name, fn) instead of auto-invoking, so
 * tests control exactly when a background-triggered event actually runs.
 */
import { describe, expect, it, mock, beforeEach } from 'bun:test';
import { requestContext, setRequestContextStore } from '@indexnetwork/protocol';
import type { PersonalAgentInput, PersonalAgentResult } from '@indexnetwork/protocol';

const backgroundCalls: Array<{ name: string; fn: () => Promise<void> }> = [];
const mockBackground = mock((name: string, fn: () => Promise<void>) => {
  backgroundCalls.push({ name, fn });
});
mock.module('../../lib/background', () => ({ background: mockBackground }));

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

/** Run every background() call captured so far and clear the list. */
function drainBackgroundCalls(): Promise<void>[] {
  return backgroundCalls.splice(0).map((c) => c.fn());
}

const idle: PersonalAgentResult = { scope: 'intent', acts: [], messages: [] };

describe('PersonalAgentQueue serialization', () => {
  beforeEach(() => {
    backgroundCalls.length = 0;
    mockBackground.mockClear();
  });

  it('three concurrent events for one signal execute serially — spans never overlap', async () => {
    const { queue, spans } = buildQueue(() => idle);
    await queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-1' });
    await queue.addAllPausedEvent({ userId: 'user-1', intentId: 'intent-1', batchId: 'batch-3', dedupeKey: 'task-1.0' });
    expect(backgroundCalls).toHaveLength(2);

    await Promise.all([
      ...drainBackgroundCalls(),
      // user_message is not backgrounded: it runs directly on the same
      // per-intent lane, alongside the two background events above.
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

  it('events for different signals do not wait behind each other', async () => {
    const { queue, spans } = buildQueue(() => idle);
    await queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-1' });
    await queue.addMatchesReadyEvent({ userId: 'user-2', intentId: 'intent-2' });
    expect(backgroundCalls).toHaveLength(2);

    await Promise.all(drainBackgroundCalls());

    expect(spans).toHaveLength(2);
    const [first, second] = [...spans].sort((a, b) => a.start - b.start);
    expect(second!.start).toBeLessThan(first!.end);
  });

  it('multiple matches_ready batches for one signal each get their own turn, serialized', async () => {
    // Coalescing (the old BullMQ duplicate-jobId slots) is gone: every batch
    // triggers its own turn, run one at a time on the signal's lane.
    const { queue, spans, invocations } = buildQueue(() => idle);
    await queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-1' });
    await queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-1' });
    await queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-1' });
    expect(backgroundCalls).toHaveLength(3);

    await Promise.all(drainBackgroundCalls());

    expect(invocations()).toBe(3);
    const ordered = [...spans].sort((a, b) => a.start - b.start);
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index]!.start).toBeGreaterThanOrEqual(ordered[index - 1]!.end);
    }
  });

  it('one durable drain reflects exactly once, while a reopened generation runs again', async () => {
    const { queue, invocations } = buildQueue(() => idle);
    await Promise.all(Array.from({ length: 10 }, () =>
      queue.addAllPausedEvent({ userId: 'user-1', intentId: 'intent-1', batchId: 'batch-7', dedupeKey: 'task-1.0' })));
    // Nine of the ten were deduped before ever reaching background().
    expect(backgroundCalls).toHaveLength(1);
    await Promise.all(drainBackgroundCalls());
    expect(invocations()).toBe(1);

    await queue.addAllPausedEvent({
      userId: 'user-1', intentId: 'intent-1', batchId: 'batch-7', dedupeKey: 'task-1.1',
    });
    expect(backgroundCalls).toHaveLength(1);
    await Promise.all(drainBackgroundCalls());
    expect(invocations()).toBe(2);
  });

  it('delivers one retained counterpart-resolution notification per verdict', async () => {
    const { queue, invocations } = buildQueue(() => idle);
    const event = {
      userId: 'user-1', intentId: 'intent-1', event: 'counterparty_resolved' as const,
      negotiationId: 'task-1', verdict: 'pending' as const,
    };
    await Promise.all([
      queue.addCounterpartyResolvedEvent(event),
      queue.addCounterpartyResolvedEvent(event),
    ]);
    expect(backgroundCalls).toHaveLength(1);
    await Promise.all(drainBackgroundCalls());
    expect(invocations()).toBe(1);
  });

  it('delivers one retained needs-principal notification per pause generation', async () => {
    const { queue, invocations } = buildQueue(() => idle);
    const event = {
      userId: 'user-1', intentId: 'intent-1', event: 'needs_principal' as const,
      negotiationId: 'task-1', generation: 0,
    };
    await Promise.all([
      queue.addNeedsPrincipalEvent(event),
      queue.addNeedsPrincipalEvent(event),
    ]);
    expect(backgroundCalls).toHaveLength(1);
    await Promise.all(drainBackgroundCalls());
    expect(invocations()).toBe(1);

    await queue.addNeedsPrincipalEvent({ ...event, generation: 1 });
    expect(backgroundCalls).toHaveLength(1);
    await Promise.all(drainBackgroundCalls());
    expect(invocations()).toBe(2);
  });

  it('runUserMessageTurn returns what the agent did', async () => {
    const result: PersonalAgentResult = {
      scope: 'intent',
      acts: [{ tool: 'message_user', text: 'Right here.', sessionId: 'session-1', messageId: 'message-1' }],
      messages: ['Right here.'],
    };
    const { queue } = buildQueue(() => result);
    const turn = await queue.runUserMessageTurn({
      userId: 'user-1', intentId: 'intent-1', event: 'user_message',
      sessionId: 'session-1', messageId: 'reply-2', text: 'where are we?',
    });
    expect(turn.messages).toEqual(['Right here.']);
    expect(turn.acts).toEqual(result.acts);
  });

  it('publishes one owner-scoped completion signal only after a successful turn', async () => {
    const published: Array<{ userId: string; intentId: string }> = [];
    const queue = new PersonalAgentQueue(async () => idle, async (event) => { published.push(event); });
    await queue.processEvent({ userId: 'user-1', intentId: 'intent-1', event: 'matches_ready' });
    expect(published).toEqual([{ userId: 'user-1', intentId: 'intent-1' }]);
  });

  it('a graph-level error fails the turn — the direct call rejects, with no retry', async () => {
    const { queue, invocations } = buildQueue(() => ({ scope: 'intent', acts: [], messages: [], error: 'provider down' }));
    await expect(queue.runUserMessageTurn({
      userId: 'user-1', intentId: 'intent-1', event: 'user_message',
      sessionId: 'session-1', messageId: 'reply-3', text: 'hello',
    })).rejects.toThrow('provider down');
    expect(invocations()).toBe(1);
  });

  it("runUserMessageTurn's deadline rejects the caller and also aborts the graph invocation", async () => {
    let observedAbort = false;
    const queue = new PersonalAgentQueue(async () => {
      const signal = requestContext.getStore()?.abortSignal;
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => { observedAbort = true; resolve(); }, { once: true }));
      throw new Error('model aborted');
    });
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
    }
  });

  it('a background event gets a fresh execution-relative budget and preserves request context', async () => {
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
      await queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-background' });
      expect(backgroundCalls).toHaveLength(1);

      const result = await hostRequestContext.run(
        { originUrl: 'https://queue.example.test' },
        () => backgroundCalls[0]!.fn(),
      );

      expect(result).toBeUndefined();
      expect(captured?.originUrl).toBe('https://queue.example.test');
      expect(captured?.abortSignal).toBeInstanceOf(AbortSignal);
      expect(captured?.abortSignal?.aborted).toBe(false);
      expect(timeoutMs).toBe(PERSONAL_AGENT_BACKGROUND_EXECUTION_BUDGET_MS);
    } finally {
      Object.defineProperty(AbortSignal, 'timeout', timeoutDescriptor);
    }
  });

  it('a background deadline failure is not swallowed — it surfaces to whatever awaits the captured fn', async () => {
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
      await queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-background-deadline' });
      expect(backgroundCalls).toHaveLength(1);
      const processing = backgroundCalls[0]!.fn();
      deadline.abort(new DOMException('deadline', 'TimeoutError'));

      await expect(processing).rejects.toThrow('background model aborted');
    } finally {
      Object.defineProperty(AbortSignal, 'timeout', timeoutDescriptor);
    }
  });

  it('preserves inherited cancellation separately from the background deadline', async () => {
    const inherited = new AbortController();
    const queue = new PersonalAgentQueue(async () => {
      const signal = requestContext.getStore()?.abortSignal;
      await new Promise<void>((resolve) => signal?.addEventListener('abort', () => resolve(), { once: true }));
      throw new Error('caller cancelled');
    });
    await queue.addMatchesReadyEvent({ userId: 'user-1', intentId: 'intent-cancelled' });
    expect(backgroundCalls).toHaveLength(1);
    const processing = hostRequestContext.run(
      { abortSignal: inherited.signal },
      () => backgroundCalls[0]!.fn(),
    );
    inherited.abort(new DOMException('caller cancelled', 'AbortError'));

    await expect(processing).rejects.toThrow('caller cancelled');
  });
});
