import { describe, expect, it } from 'bun:test';

import type { PoolPushClaimResult, RecoverablePoolPushRequest } from '../../adapters/questioner.adapter';
import { PoolQuestionPushQueue, poolQuestionPushJobId, requestPoolQuestionPush } from '../pool/questionpush.queue';

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
  recoverable?: RecoverablePoolPushRequest[];
}) {
  const claims: Array<{ questionId: string; allowNewClaim: boolean }> = [];
  const delivered: Array<Record<string, unknown>> = [];
  const enqueued: Array<{ questionId: string; userId: string }> = [];
  const sessionTitles: string[] = [];
  const queue = new PoolQuestionPushQueue({
    pushEnabled: () => overrides?.enabled ?? true,
    negotiatorAvailable: async () => overrides?.available ?? true,
    questioner: {
      claimPoolQuestionPush: async (questionId, _userId, options) => {
        claims.push({ questionId, allowNewClaim: options.allowNewClaim });
        return overrides?.claim ?? claim();
      },
      markPoolQuestionPushFailed: async () => {},
      markPoolQuestionPushRequested: async () => true,
      listRecoverablePoolQuestionPushRequests: async () => overrides?.recoverable ?? [],
    },
    enqueuePush: async (data) => {
      enqueued.push(data);
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
  return { queue, claims, delivered, enqueued, sessionTitles };
}

describe('PoolQuestionPushQueue', () => {
  it('uses a deterministic BullMQ-safe job id', () => {
    expect(poolQuestionPushJobId('abc')).toBe('pool-question-push-abc');
    expect(poolQuestionPushJobId('abc')).not.toContain(':');
  });

  it('always reaches the claim gate but disallows new claims when flags are off', async () => {
    const h = harness({ enabled: false, claim: { kind: 'ineligible', reason: 'new_claim_disabled' } });
    await h.queue.processJob({ questionId: 'question-1', userId: 'user-1' });
    expect(h.claims).toEqual([{ questionId: 'question-1', allowNewClaim: false }]);
    expect(h.delivered).toEqual([]);
  });

  it('always reaches the claim gate but disallows new claims without a negotiator', async () => {
    const h = harness({ available: false, claim: { kind: 'ineligible', reason: 'new_claim_disabled' } });
    await h.queue.processJob({ questionId: 'question-1', userId: 'user-1' });
    expect(h.claims[0]?.allowNewClaim).toBe(false);
  });

  it('resumes and delivers an existing claim while current flags are off', async () => {
    const h = harness({ enabled: false, claim: claim() });
    await h.queue.processJob({ questionId: 'question-1', userId: 'user-1' });
    expect(h.claims[0]?.allowNewClaim).toBe(false);
    expect(h.delivered).toHaveLength(1);
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

  it('retains the durable request marker when Redis enqueue fails', async () => {
    const calls: string[] = [];
    await expect(requestPoolQuestionPush('question-1', 'user-1', {
      pushEnabled: () => true,
      markRequested: async () => {
        calls.push('marked');
        return true;
      },
      enqueue: async () => {
        calls.push('enqueue');
        throw new Error('redis unavailable');
      },
    })).rejects.toThrow('redis unavailable');
    expect(calls).toEqual(['marked', 'enqueue']);
  });

  it('writes no request marker when push creation is disabled', async () => {
    const calls: string[] = [];
    await requestPoolQuestionPush('question-1', 'user-1', {
      pushEnabled: () => false,
      markRequested: async () => {
        calls.push('marked');
        return true;
      },
      enqueue: async () => calls.push('enqueue'),
    });
    expect(calls).toEqual([]);
  });

  it('recovers requested rows and only existing claims while flags are off', async () => {
    const recoverable: RecoverablePoolPushRequest[] = [
      { questionId: 'unclaimed', userId: 'user-1', claimed: false },
      { questionId: 'claimed', userId: 'user-1', claimed: true },
    ];
    const enabled = harness({ enabled: true, recoverable });
    expect(await enabled.queue.recoverRequestedPushes()).toBe(2);
    expect(enabled.enqueued.map((row) => row.questionId)).toEqual(['unclaimed', 'claimed']);

    const disabled = harness({ enabled: false, recoverable });
    expect(await disabled.queue.recoverRequestedPushes()).toBe(1);
    expect(disabled.enqueued.map((row) => row.questionId)).toEqual(['claimed']);
  });

  it('fails loudly on deterministic delivery conflicts so BullMQ can retry', async () => {
    const error = new Error('deterministic message conflict');
    const h = harness({ deliveryError: error });
    await expect(h.queue.processJob({ questionId: 'question-1', userId: 'user-1' })).rejects.toThrow(error.message);
  });
});
