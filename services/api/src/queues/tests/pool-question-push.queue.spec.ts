import { describe, expect, it } from 'bun:test';

import type { PoolPushClaimResult } from '../../adapters/questioner.adapter';
import { PoolQuestionPushQueue, poolQuestionPushJobId } from '../pool/questionpush.queue';

function claim(): PoolPushClaimResult {
  return {
    kind: 'claimed',
    questionId: 'question-1',
    recipientId: 'user-1',
    intentId: 'intent-1',
    cycleKey: 'run:run-1',
    messageId: 'question-1',
    intentTitle: 'Find [AI] partners',
    questionPrompt: 'Which side matters?',
  };
}

function harness(overrides?: {
  enabled?: boolean;
  available?: boolean;
  claim?: PoolPushClaimResult;
  deliveryError?: Error;
}) {
  const claimed: string[] = [];
  const delivered: Array<Record<string, unknown>> = [];
  const sessionTitles: string[] = [];
  const queue = new PoolQuestionPushQueue({
    pushEnabled: () => overrides?.enabled ?? true,
    negotiatorAvailable: async () => overrides?.available ?? true,
    questioner: {
      claimPoolQuestionPush: async (questionId) => {
        claimed.push(questionId);
        return overrides?.claim ?? claim();
      },
      markPoolQuestionPushFailed: async () => {},
    },
    resolveSession: (async (_userId: string, title?: string) => {
      sessionTitles.push(title ?? '');
      return { session: { id: 'stable-unscoped-dm' }, created: false };
    }) as never,
    deliver: (async (input: Record<string, unknown>) => {
      if (overrides?.deliveryError) throw overrides.deliveryError;
      if (!delivered.some((row) => row.questionId === input.questionId)) delivered.push(input);
      return { status: 'delivered', inserted: delivered.length === 1 };
    }) as never,
  });
  return { queue, claimed, delivered, sessionTitles };
}

describe('PoolQuestionPushQueue', () => {
  it('uses a deterministic BullMQ-safe job id', () => {
    expect(poolQuestionPushJobId('abc')).toBe('pool-question-push-abc');
    expect(poolQuestionPushJobId('abc')).not.toContain(':');
  });

  it('settles without claiming when the push flag is off', async () => {
    const h = harness({ enabled: false });
    await h.queue.processJob({ questionId: 'question-1', userId: 'user-1' });
    expect(h.claimed).toEqual([]);
    expect(h.delivered).toEqual([]);
  });

  it('requires negotiator availability before consuming a claim', async () => {
    const h = harness({ available: false });
    await h.queue.processJob({ questionId: 'question-1', userId: 'user-1' });
    expect(h.claimed).toEqual([]);
  });

  it('delivers exactly one deterministic public template to the stable unscoped DM', async () => {
    const h = harness();
    const job = { questionId: 'question-1', userId: 'user-1' };
    await h.queue.processJob(job);
    await h.queue.processJob(job);

    expect(h.sessionTitles).toEqual(['Personal Agent', 'Personal Agent']);
    expect(h.delivered).toHaveLength(1);
    expect(h.delivered[0]).toMatchObject({
      questionId: 'question-1',
      recipientId: 'user-1',
      intentId: 'intent-1',
      cycleKey: 'run:run-1',
      conversationId: 'stable-unscoped-dm',
      messageText: 'Quick one about [Find \\[AI\\] partners](/i/intent-1): Which side matters?',
    });
    const serialized = JSON.stringify(h.delivered);
    expect(serialized).not.toContain('assignments');
    expect(serialized).not.toContain('embedding');
    expect(serialized).not.toContain('reasoning');
  });

  it('does not resolve a session for an ineligible or already-delivered claim', async () => {
    for (const result of [
      { kind: 'ineligible', reason: 'visited' } as const,
      { kind: 'delivered' } as const,
    ]) {
      const h = harness({ claim: result });
      await h.queue.processJob({ questionId: 'question-1', userId: 'user-1' });
      expect(h.sessionTitles).toEqual([]);
      expect(h.delivered).toEqual([]);
    }
  });

  it('fails loudly on deterministic delivery conflicts so BullMQ can retry', async () => {
    const error = new Error('deterministic message conflict');
    const h = harness({ deliveryError: error });
    await expect(h.queue.processJob({ questionId: 'question-1', userId: 'user-1' })).rejects.toThrow(error.message);
  });
});
