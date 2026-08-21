/**
 * The IntentAgent inbox's actor property
 * (docs/plans/2026-08-21-holistic-intent-agent.md, "Serialization"): all
 * events for one intent execute strictly one-at-a-time — no two turns ever
 * interleave. Deterministic and harness-level: turns are scripted with real
 * async gaps, and the spans they record must never overlap. Hermetic BullMQ
 * double, no Redis, no database, no model.
 */
import { describe, expect, it } from 'bun:test';

import { IntentAgentQueue } from '../intent-agent.queue';
import type { IntentAgentHostDeps } from '../../lib/intent-agent/intent-agent.host';
import type { IntentAgentDecidedAct } from '../../lib/intent-agent/intent-agent.types';
import type { IntentAgentTurnContext } from '../../lib/intent-agent/intent-agent.context';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface Span {
  event: string;
  start: number;
  end: number;
}

function buildQueue(script: (context: IntentAgentTurnContext) => IntentAgentDecidedAct[] | Promise<IntentAgentDecidedAct[]>) {
  const spans: Span[] = [];
  let decideCalls = 0;
  const delivered: string[] = [];
  const deps: IntentAgentHostDeps = {
    context: {
      readParkedNegotiations: async () => [],
      readDossier: async () => [],
      readOpportunities: async () => [],
      readLedger: async () => [],
      findSession: async () => null,
      getSessionMessages: async () => [],
      getIntentText: async () => null,
    },
    turn: {
      decide: async (context) => {
        decideCalls += 1;
        const span: Span = {
          event: context.event.kind === 'user_message' ? context.event.messageId : context.event.opportunityId,
          start: performance.now(),
          end: 0,
        };
        // A real async gap: an interleaving second turn would start inside it.
        await sleep(25);
        span.end = performance.now();
        spans.push(span);
        return script(context);
      },
      // Phase 2: client-message turns end with the reply stage.
      reply: async () => ({ text: 'Right here.' }),
    },
    chatSessions: {
      resolveNegotiatorIntentSession: async () => ({ session: { id: 'session-1' } }),
      addMessage: async ({ content }) => {
        delivered.push(content);
        return `message-${delivered.length}`;
      },
    },
    dossier: { addEntry: async () => 'entry-1', retireEntry: async () => true },
    ledger: { append: async () => 'ledger-1' },
  };
  const queue = new IntentAgentQueue(deps);
  return { queue, spans, delivered, decideCalls: () => decideCalls };
}

/**
 * The hermetic broker is keyed by queue NAME and shared process-wide, so a
 * still-attached worker from an earlier test would consume a later test's
 * jobs. Every test runs its queue to completion and closes it before the
 * next one starts.
 */
async function withQueue<T>(
  built: ReturnType<typeof buildQueue>,
  run: (harness: ReturnType<typeof buildQueue>) => Promise<T>,
): Promise<T> {
  built.queue.startWorker();
  try {
    return await run(built);
  } finally {
    await built.queue.close();
  }
}

describe('IntentAgentQueue serialization', () => {
  it('two concurrent events for one intent execute serially — spans never overlap', async () => {
    await withQueue(buildQueue(() => [{ tool: 'wait' }]), async ({ queue, spans }) => {
      const [jobA, jobB, jobC] = await Promise.all([
        queue.addNeedsInputEvent({ kind: 'negotiation_needs_input', userId: 'user-1', intentId: 'intent-1', opportunityId: 'opp-a', taskId: 'task-a' }),
        queue.addNeedsInputEvent({ kind: 'negotiation_needs_input', userId: 'user-1', intentId: 'intent-1', opportunityId: 'opp-b', taskId: 'task-b' }),
        queue.addUserMessageEvent({ kind: 'user_message', userId: 'user-1', intentId: 'intent-1', sessionId: 'session-1', messageId: 'reply-1', text: 'hello' }),
      ]);
      await Promise.all([jobA, jobB, jobC].map((job) => job.waitUntilFinished(undefined as never, 10_000)));

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
    await withQueue(buildQueue(() => [{ tool: 'wait' }]), async ({ queue, decideCalls }) => {
      const event = { kind: 'user_message', userId: 'user-1', intentId: 'intent-1', sessionId: 'session-1', messageId: 'reply-dup', text: 'hello' } as const;
      const [first, second] = await Promise.all([queue.addUserMessageEvent(event), queue.addUserMessageEvent(event)]);
      expect(second.id).toBe(first.id);
      await first.waitUntilFinished(undefined as never, 10_000);
      expect(decideCalls()).toBe(1);
    });
  });

  it('runUserMessageTurn returns what the agent did, the reply-stage message included', async () => {
    // Phase 2: the reply is the streaming stage's delivery, not an
    // acts-stage message_user.
    await withQueue(buildQueue(() => [{ tool: 'wait', reason: 'Only conversation.' }]), async ({ queue, delivered }) => {
      const result = await queue.runUserMessageTurn({
        kind: 'user_message',
        userId: 'user-1',
        intentId: 'intent-1',
        sessionId: 'session-1',
        messageId: 'reply-2',
        text: 'where are we?',
      });

      expect(result.messages).toEqual(['Right here.']);
      expect(result.acts).toEqual([
        { tool: 'wait', reason: 'Only conversation.' },
        { tool: 'message_user', text: 'Right here.', sessionId: 'session-1', messageId: 'message-1', stage: 'reply' },
      ]);
      expect(delivered).toEqual(['Right here.']);
    });
  });

  it('a failed turn rejects the awaited lane while the job stays retryable', async () => {
    await withQueue(buildQueue(() => {
      throw new Error('provider down');
    }), async ({ queue }) => {
      await expect(queue.runUserMessageTurn({
        kind: 'user_message',
        userId: 'user-1',
        intentId: 'intent-1',
        sessionId: 'session-1',
        messageId: 'reply-3',
        text: 'hello',
      }, { timeoutMs: 500 })).rejects.toThrow();
    });
  });
});
