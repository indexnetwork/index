import { describe, expect, test } from 'bun:test';

import type { OpportunityRow, UserIdentity } from '../../adapters/database.shared';
import type { AdapterPersistedQuestion } from '../../adapters/questioner.adapter';
import type { NotificationStreamEvent } from '../../lib/notification-stream-events';
import { NotificationDeliveryService } from '../notification-delivery.service';

const now = new Date('2026-08-10T12:00:00.000Z');

function identity(userId: string, name: string): UserIdentity {
  return {
    userId,
    identity: { name, bio: '', location: '' },
    context: '',
  };
}

function opportunity(input: {
  id: string;
  actors: OpportunityRow['actors'];
  status?: OpportunityRow['status'];
  reasoning?: string;
}): OpportunityRow {
  return {
    id: input.id,
    detection: { source: 'opportunity_graph', timestamp: now.toISOString() },
    actors: input.actors,
    interpretation: {
      category: 'Internal evaluator category',
      reasoning: input.reasoning ?? 'Casey builds privacy-preserving collaboration tools.',
      confidence: 0.9,
    },
    context: { networkId: 'network-1' },
    confidence: '0.9',
    status: input.status ?? 'pending',
    createdAt: now,
    updatedAt: now,
    expiresAt: null,
    metadata: {},
  };
}

function question(input: {
  id: string;
  mode?: AdapterPersistedQuestion['detection']['mode'];
  sourceType?: string;
  sourceId?: string;
  triggeredBy?: string;
  prompt?: string;
}): AdapterPersistedQuestion {
  const sourceType = input.sourceType ?? 'intent';
  const sourceId = input.sourceId ?? 'intent-1';
  return {
    id: input.id,
    detection: {
      mode: input.mode ?? 'intent',
      sourceType,
      sourceId,
      triggeredBy: input.triggeredBy ?? (sourceType === 'intent' ? sourceId : undefined),
      timestamp: now.toISOString(),
      ...(input.mode === 'negotiation_inflight'
        ? {
            purpose: 'inflight_consultation' as const,
            negotiation: {
              version: 1 as const,
              purpose: 'inflight_consultation' as const,
              recipientUserId: 'viewer',
              recipientIntentId: 'intent-1',
              opportunityId: sourceId,
              taskId: 'task-1',
              networkId: 'network-1',
              intentFingerprint: 'fingerprint',
              opportunityStatus: 'negotiating' as const,
              opportunityUpdatedAt: now.toISOString(),
              taskState: 'input_required' as const,
              taskUpdatedAt: now.toISOString(),
              questionOrdinal: 0,
            },
          }
        : {}),
    },
    actors: [{ userId: 'viewer', networkId: 'network-1', role: 'subject' }],
    payload: {
      title: 'Question',
      prompt: input.prompt ?? 'Would you like an introduction?',
      options: [],
      multiSelect: false,
    },
    status: 'pending',
    answer: null,
    expiresAt: '2026-08-17T12:00:00.000Z',
    createdAt: now.toISOString(),
    conversationId: null,
  };
}

function sortEvents(events: NotificationStreamEvent[]): NotificationStreamEvent[] {
  return [...events].sort((left, right) => `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`));
}

describe('NotificationDeliveryService persisted projection', () => {
  test('realtime and snapshot return identical safe copy and exclude pending opportunities the user acted on', async () => {
    const pendingQuestion = question({ id: 'question-1', prompt: 'Would a short intro be useful?' });
    const actionableOpportunity = opportunity({
      id: 'opportunity-actionable',
      actors: [
        { userId: 'viewer', networkId: 'network-1', role: 'patient' },
        { userId: 'peer', networkId: 'network-1', role: 'agent' },
      ],
      reasoning: 'Casey builds privacy tools. You both attended the same event according to internal scoring.',
    });
    const actedOpportunity = opportunity({
      id: 'opportunity-acted',
      actors: [
        { userId: 'viewer', networkId: 'network-1', role: 'patient', actedAt: now.toISOString() },
        { userId: 'other-peer', networkId: 'network-1', role: 'agent' },
      ],
    });
    const opportunitiesById = new Map([
      [actionableOpportunity.id, actionableOpportunity],
      [actedOpportunity.id, actedOpportunity],
    ]);
    const identities = new Map([
      ['viewer', identity('viewer', 'Viewer Name')],
      ['peer', identity('peer', 'Casey Counterpart')],
      ['other-peer', identity('other-peer', 'Other Peer')],
    ]);
    const published: Array<{ userId: string; event: NotificationStreamEvent }> = [];
    const service = new NotificationDeliveryService({
      questioner: {
        getById: async (id) => id === pendingQuestion.id ? pendingQuestion : null,
        findPending: async (userId) => userId === 'viewer' ? [pendingQuestion] : [],
      },
      opportunities: {
        getOpportunity: async (id) => opportunitiesById.get(id) ?? null,
        getOpportunitiesForUser: async (userId) => userId === 'viewer'
          ? [actionableOpportunity, actedOpportunity]
          : [],
      },
      getIdentity: async (userId) => identities.get(userId) ?? null,
      getIntentLabel: async (intentId) => intentId === 'intent-1' ? 'privacy collaboration' : undefined,
      publish: async (userId, event) => { published.push({ userId, event }); },
    });

    await service.publishQuestionCreated({
      questionId: pendingQuestion.id,
      userId: 'viewer',
      mode: 'intent',
      sourceType: 'intent',
      sourceId: 'intent-1',
    });
    await service.publishOpportunityActionable({ opportunity: { id: actionableOpportunity.id, status: 'pending' } });
    await service.publishOpportunityActionable({ opportunity: { id: actedOpportunity.id, status: 'pending' } });

    const realtimeForViewer = published
      .filter(({ userId }) => userId === 'viewer')
      .map(({ event }) => event);
    const snapshot = await service.snapshot('viewer');

    expect(sortEvents(snapshot)).toEqual(sortEvents(realtimeForViewer));
    expect(snapshot.map(({ id }) => id)).toEqual(['question-1', 'opportunity-actionable']);
    expect(snapshot.find(({ id }) => id === actionableOpportunity.id)?.body).not.toContain('internal scoring');
  });

  test('bounds intent and opportunity labels used in question titles', async () => {
    const longLabel = 'l'.repeat(100);
    const longName = 'n'.repeat(100);
    const intentQuestion = question({ id: 'question-intent' });
    const opportunityQuestion = question({
      id: 'question-opportunity',
      sourceType: 'opportunity',
      sourceId: 'opportunity-label',
      triggeredBy: 'intent-1',
    });
    const labelOpportunity = opportunity({
      id: 'opportunity-label',
      actors: [
        { userId: 'viewer', networkId: 'network-1', role: 'patient' },
        { userId: 'peer', networkId: 'network-1', role: 'agent' },
      ],
    });
    const published: NotificationStreamEvent[] = [];
    const service = new NotificationDeliveryService({
      questioner: {
        getById: async (id) => id === intentQuestion.id ? intentQuestion : opportunityQuestion,
        findPending: async () => [],
      },
      opportunities: {
        getOpportunity: async () => labelOpportunity,
        getOpportunitiesForUser: async () => [],
      },
      getIdentity: async (userId) => userId === 'peer' ? identity('peer', longName) : identity('viewer', 'Viewer'),
      getIntentLabel: async () => longLabel,
      publish: async (_userId, event) => { published.push(event); },
    });

    await service.publishQuestionCreated({
      questionId: intentQuestion.id,
      userId: 'viewer',
      mode: 'intent',
      sourceType: 'intent',
      sourceId: 'intent-1',
    });
    await service.publishQuestionCreated({
      questionId: opportunityQuestion.id,
      userId: 'viewer',
      mode: 'intent',
      sourceType: 'opportunity',
      sourceId: 'opportunity-label',
    });

    expect(published[0]?.title).toBe(`Your agent has a question about your ${'l'.repeat(80)}`);
    expect(published[1]?.title).toBe(`Your agent has a question about ${'n'.repeat(80)}'s fit`);
  });

  test('preserves inflight negotiation attention copy in the unified event shape', async () => {
    const pendingQuestion = question({
      id: 'question-attention',
      mode: 'negotiation_inflight',
      sourceType: 'opportunity',
      sourceId: 'opportunity-negotiating',
    });
    const negotiatingOpportunity = opportunity({
      id: 'opportunity-negotiating',
      status: 'negotiating',
      actors: [
        { userId: 'viewer', networkId: 'network-1', role: 'patient' },
        { userId: 'peer', networkId: 'network-1', role: 'agent' },
      ],
    });
    const published: NotificationStreamEvent[] = [];
    const service = new NotificationDeliveryService({
      questioner: {
        getById: async () => pendingQuestion,
        findPending: async () => [pendingQuestion],
      },
      opportunities: {
        getOpportunity: async () => negotiatingOpportunity,
        getOpportunitiesForUser: async () => [],
      },
      getIdentity: async (userId) => userId === 'peer'
        ? identity('peer', 'Casey Counterpart')
        : identity('viewer', 'Viewer'),
      getIntentLabel: async () => undefined,
      publish: async (_userId, event) => { published.push(event); },
    });

    await service.publishQuestionCreated({
      questionId: pendingQuestion.id,
      userId: 'viewer',
      mode: 'negotiation_inflight',
      sourceType: 'opportunity',
      sourceId: negotiatingOpportunity.id,
    });

    expect(published).toEqual([{
      type: 'question.new',
      id: 'question-attention',
      title: 'Your agent needs your input',
      body: 'A negotiation with Casey Counterpart is waiting for your answer.',
    }]);
    expect(await service.snapshot('viewer')).toEqual(published);
  });

  test('logs and swallows publish failures at lifecycle boundaries', async () => {
    const pendingQuestion = question({ id: 'question-failure' });
    const service = new NotificationDeliveryService({
      questioner: {
        getById: async () => pendingQuestion,
        findPending: async () => [],
      },
      opportunities: {
        getOpportunity: async () => null,
        getOpportunitiesForUser: async () => [],
      },
      getIdentity: async () => null,
      getIntentLabel: async () => undefined,
      publish: async () => { throw new Error('publisher unavailable'); },
    });

    await expect(service.publishQuestionCreated({
      questionId: pendingQuestion.id,
      userId: 'viewer',
      mode: 'intent',
      sourceType: 'intent',
      sourceId: 'intent-1',
    })).resolves.toBeUndefined();
  });
});
