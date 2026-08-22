/**
 * Unit tests for the park-path question enqueue — the one choke point every
 * composition site injects. Since the intent-agent collapse
 * (docs/plans/2026-08-21-holistic-intent-agent.md) a park payload wakes the
 * parked side's IntentAgent with a `negotiation_needs_input` event; every
 * retired generator family is dropped without reaching any queue.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused';

import { afterAll, describe, expect, it, mock } from 'bun:test';

import type { IntentAgentNeedsInputEvent } from '../../lib/intent-agent/intent-agent.types';

const events: IntentAgentNeedsInputEvent[] = [];

mock.module('../intent-agent.queue', () => ({
  intentAgentQueue: {
    addNeedsInputEvent: async (event: IntentAgentNeedsInputEvent) => {
      events.push(event);
      return { id: 'job-1' };
    },
  },
}));

afterAll(() => {
  mock.restore();
});

const { enqueueParkedQuestion, parkedQuestionEnqueue, parkedNeedsInputEvent } = await import('../parked-question.enqueue');

const negotiation = {
  recipientUserId: 'user-1',
  recipientIntentId: 'intent-1',
  opportunityId: 'opp-1',
  networkId: 'network-1',
};

const inflightPayload = {
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
} as const;

const postStallPayload = {
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
} as const;

describe('parkedQuestionEnqueue', () => {
  it('wakes the parked side agent for both park families, task id included', async () => {
    events.length = 0;
    await enqueueParkedQuestion(inflightPayload as never);
    await enqueueParkedQuestion(postStallPayload as never);
    expect(events).toEqual([
      { kind: 'negotiation_needs_input', userId: 'user-1', intentId: 'intent-1', opportunityId: 'opp-1', taskId: 'task-1' },
      { kind: 'negotiation_needs_input', userId: 'user-1', intentId: 'intent-1', opportunityId: 'opp-1', taskId: 'task-1' },
    ]);
  });

  it('drops every retired generator family without enqueuing anything', async () => {
    events.length = 0;
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
    expect(events).toEqual([]);
  });
});

describe('parkedNeedsInputEvent', () => {
  it('requires the full recipient binding and the opportunity', () => {
    expect(parkedNeedsInputEvent({
      ...inflightPayload,
      negotiation: { ...inflightPayload.negotiation, opportunityId: '' },
    } as never)).toBeNull();
    expect(parkedNeedsInputEvent({
      ...inflightPayload,
      negotiation: { ...inflightPayload.negotiation, recipientIntentId: '' },
    } as never)).toBeNull();
  });
});
