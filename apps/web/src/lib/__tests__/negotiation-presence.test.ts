import { describe, expect, it } from 'vitest';

import { deriveLiveNegotiations, formatLatestMove, liveNegotiationsByOpportunity } from '@/lib/negotiation-presence';
import type { ConversationSummary } from '@/services/conversation';

function conversation(
  id: string,
  input: {
    state?: NonNullable<ConversationSummary['negotiation']>['state'];
    opportunityStatus?: NonNullable<ConversationSummary['negotiation']>['opportunityStatus'];
    action?: string;
    senderId?: string;
    turnCount?: number;
    outcome?: NonNullable<ConversationSummary['negotiation']>['outcome'];
    acceptedByViewer?: boolean;
    opportunityId?: string | null;
    via?: ConversationSummary['via'];
    withMessage?: boolean;
  } = {},
): ConversationSummary {
  const action = input.action ?? 'counter';
  return {
    id,
    participants: [
      { participantId: 'agent:viewer', participantType: 'agent', name: 'Index Negotiator', avatar: null, ownerName: 'Viewer' },
      { participantId: `agent:${id}-peer`, participantType: 'agent', name: 'Index Negotiator', avatar: null, ownerName: `${id} person` },
    ],
    lastMessage: input.withMessage === false ? null : {
      parts: [{ kind: 'data', data: { action } }],
      senderId: input.senderId ?? `agent:${id}-peer`,
      createdAt: '2026-07-24T11:00:00.000Z',
    },
    metadata: null,
    via: input.via ?? [],
    unreadCount: 0,
    lastMessageAt: '2026-07-24T11:00:00.000Z',
    createdAt: '2026-07-24T10:00:00.000Z',
    negotiation: {
      taskId: `${id}-task`,
      state: input.state ?? 'working',
      statusTimestamp: '2026-07-24T11:00:00.000Z',
      opportunityId: input.opportunityId === undefined ? `${id}-opportunity` : input.opportunityId,
      opportunityStatus: input.opportunityStatus ?? 'negotiating',
      acceptedByViewer: input.acceptedByViewer ?? false,
      turnCount: input.turnCount ?? 1,
      maxTurns: 6,
      signalCount: 2,
      outcome: input.outcome ?? null,
      updatedAt: '2026-07-24T11:00:00.000Z',
    },
  };
}

describe('deriveLiveNegotiations', () => {
  it('keeps in-flight negotiations and drops agreed/resolved ones', () => {
    const live = deriveLiveNegotiations([
      conversation('live', { turnCount: 3 }),
      conversation('waiting', { turnCount: 0 }),
      conversation('answer', { state: 'input_required', action: 'ask_user', senderId: 'agent:viewer' }),
      conversation('agreed', { state: 'completed', opportunityStatus: 'pending', action: 'accept', outcome: { hasOpportunity: true, reason: null } }),
      conversation('rejected', { state: 'completed', opportunityStatus: 'rejected' }),
      conversation('stalled', { state: 'completed', opportunityStatus: 'stalled' }),
      conversation('accepted', { state: 'completed', opportunityStatus: 'accepted', acceptedByViewer: true }),
    ], 'viewer');

    expect(live.map((item) => [item.conversationId, item.status])).toEqual([
      ['answer', 'answer'],
      ['live', 'live'],
      ['waiting', 'waiting'],
    ]);
  });

  it('attaches opportunity and signal linkage from the conversation summary', () => {
    const via = [
      { intentId: 'intent-a', opportunityId: 'live-opportunity', title: 'Signal A' },
      { intentId: 'intent-b', opportunityId: 'live-opportunity', title: 'Signal B' },
    ];
    const [item] = deriveLiveNegotiations([conversation('live', { via })], 'viewer');

    expect(item?.opportunityId).toBe('live-opportunity');
    expect(item?.intentIds).toEqual(['intent-a', 'intent-b']);
  });

  it('tolerates a missing opportunity id and conversations without lifecycle', () => {
    const shell = conversation('shell', { opportunityId: null });
    const noLifecycle = { ...conversation('bare'), negotiation: null };
    const live = deriveLiveNegotiations([shell, noLifecycle], 'viewer');

    expect(live).toHaveLength(2);
    expect(live.find((item) => item.conversationId === 'shell')?.opportunityId).toBeNull();
    expect(live.find((item) => item.conversationId === 'bare')?.opportunityId).toBeNull();
  });
});

describe('liveNegotiationsByOpportunity', () => {
  it('indexes by opportunity id, skips null ids, and keeps the first entry', () => {
    const live = deriveLiveNegotiations([
      conversation('first', { opportunityId: 'shared-opportunity' }),
      conversation('second', { opportunityId: 'shared-opportunity' }),
      conversation('null-id', { opportunityId: null }),
    ], 'viewer');
    const byOpportunity = liveNegotiationsByOpportunity(live);

    expect([...byOpportunity.keys()]).toEqual(['shared-opportunity']);
    expect(byOpportunity.get('shared-opportunity')?.conversationId).toBe('first');
  });
});

describe('formatLatestMove', () => {
  it('capitalizes the move and appends the time', () => {
    expect(formatLatestMove('their agent countered', '12m ago')).toBe('Their agent countered · 12m ago');
  });
});
