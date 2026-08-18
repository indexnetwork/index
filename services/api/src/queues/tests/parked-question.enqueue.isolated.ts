/**
 * Unit tests for the park-path question enqueue — the one choke point every
 * composition site injects after the QuestionerAgent retirement. Park
 * payloads route to the question-message regeneration job; every retired
 * generator family is dropped without reaching any queue.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused';

import { afterAll, describe, expect, it, mock } from 'bun:test';

const regenerateJobs: Array<{ userId: string; intentId: string }> = [];

mock.module('../question-message.queue', () => ({
  routeParkedQuestionEnqueue: async (input: {
    mode?: string;
    purpose?: string;
    negotiation?: { recipientUserId?: string; recipientIntentId?: string };
  }) => {
    const isParkFamily =
      (input.mode === 'negotiation_inflight' && input.purpose === 'inflight_consultation')
      || (input.mode === 'negotiation' && input.purpose === 'stalled_followup');
    if (!isParkFamily || !input.negotiation?.recipientUserId || !input.negotiation.recipientIntentId) {
      return false;
    }
    regenerateJobs.push({
      userId: input.negotiation.recipientUserId,
      intentId: input.negotiation.recipientIntentId,
    });
    return true;
  },
}));

afterAll(() => {
  mock.restore();
});

const { enqueueParkedQuestion, parkedQuestionEnqueue } = await import('../parked-question.enqueue');

const negotiation = {
  recipientUserId: 'user-1',
  recipientIntentId: 'intent-1',
  opportunityId: 'opp-1',
  networkId: 'network-1',
};

describe('parkedQuestionEnqueue', () => {
  it('is always defined — the QUESTIONER_ENABLED master switch is retired', () => {
    delete process.env.QUESTIONER_ENABLED;
    expect(typeof parkedQuestionEnqueue()).toBe('function');
    process.env.QUESTIONER_ENABLED = 'false';
    expect(typeof parkedQuestionEnqueue()).toBe('function');
    delete process.env.QUESTIONER_ENABLED;
  });

  it('routes both park families to the regeneration job for the parked side', async () => {
    regenerateJobs.length = 0;
    await enqueueParkedQuestion({
      mode: 'negotiation_inflight',
      purpose: 'inflight_consultation',
      userId: 'user-1',
      sourceType: 'opportunity',
      sourceId: 'opp-1',
      negotiation: { ...negotiation, purpose: 'inflight_consultation', taskId: 'task-1' },
      context: {
        negotiationId: 'task-1',
        counterpartyHint: 'the other participant',
        indexContext: 'the selected network',
        consultationPolicyReason: 'unresolved_owner_constraint',
      },
    });
    await enqueueParkedQuestion({
      mode: 'negotiation',
      purpose: 'stalled_followup',
      userId: 'user-1',
      sourceType: 'opportunity',
      sourceId: 'opp-1',
      negotiation: { ...negotiation, purpose: 'stalled_followup', taskId: 'task-1' },
      context: {
        negotiationId: 'task-1',
        counterpartyHint: 'the other participant',
        indexContext: 'the selected network',
        outcomeReason: 'stalled',
        recipientIntent: 'Find a collaborator',
      },
    });
    expect(regenerateJobs).toEqual([
      { userId: 'user-1', intentId: 'intent-1' },
      { userId: 'user-1', intentId: 'intent-1' },
    ]);
  });

  it('drops every retired generator family without enqueuing anything', async () => {
    regenerateJobs.length = 0;
    // The five retired families, as their triggers used to shape them. The
    // QuestionerInput union no longer admits them, so they arrive only as
    // stale composition payloads — typed loosely on purpose.
    const retired = [
      { mode: 'negotiation', purpose: 'uptake', negotiation },
      { mode: 'pool_discovery', context: { intentId: 'intent-1' } },
      { mode: 'intent', context: { intentId: 'intent-1', payload: 'p' } },
      { mode: 'intent', purpose: 'recovery', context: { intentId: 'intent-1', payload: 'p', purpose: 'recovery' } },
      { mode: 'chat', context: { purpose: 'clarify something' } },
    ];
    for (const payload of retired) {
      await enqueueParkedQuestion({
        userId: 'user-1',
        sourceType: 'intent',
        sourceId: 'intent-1',
        ...payload,
      } as never);
    }
    expect(regenerateJobs).toEqual([]);
  });
});
