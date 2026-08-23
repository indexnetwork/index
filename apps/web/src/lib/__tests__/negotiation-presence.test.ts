import { describe, expect, it } from 'vitest';

import { deriveLiveNegotiations, formatLatestMove, liveNegotiationsByOpportunity } from '@/lib/negotiation-presence';
import type { ConversationSummary } from '@/services/conversation';

function conversation(
  id: string,
  input: {
    state?: NonNullable<ConversationSummary['negotiation']>['state'];
    opportunityStatus?: NonNullable<ConversationSummary['negotiation']>['opportunityStatus'];
    verb?: string;
    pauseReason?: 'counterparty_silent' | 'needs_principal' | 'ready_for_verdict';
    senderId?: string;
    turnCount?: number;
    acceptedByViewer?: boolean;
    opportunityId?: string | null;
    via?: ConversationSummary['via'];
    withMessage?: boolean;
  } = {},
): ConversationSummary {
  const verb = input.verb ?? (input.pauseReason ? 'pause' : 'counter');
  const data: Record<string, unknown> = { verb };
  if (input.pauseReason) data.reason = input.pauseReason;
  return {
    id,
    participants: [
      { participantId: 'agent:viewer', participantType: 'agent', name: 'Index Negotiator', avatar: null, ownerName: 'Viewer' },
      { participantId: `agent:${id}-peer`, participantType: 'agent', name: 'Index Negotiator', avatar: null, ownerName: `${id} person` },
    ],
    lastMessage: input.withMessage === false ? null : {
      parts: [{ kind: 'data', data }],
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
      pause: input.pauseReason ? { reason: input.pauseReason } : null,
      statusTimestamp: '2026-07-24T11:00:00.000Z',
      opportunityId: input.opportunityId === undefined ? `${id}-opportunity` : input.opportunityId,
      opportunityStatus: input.opportunityStatus ?? 'negotiating',
      acceptedByViewer: input.acceptedByViewer ?? false,
      turnCount: input.turnCount ?? 1,
      signalCount: 2,
      updatedAt: '2026-07-24T11:00:00.000Z',
    },
  };
}

describe('deriveLiveNegotiations', () => {
  // NOTE: this test's expected values (`status` compared against the fixture's
  // conversationId, and a null-lifecycle conversation expected to survive
  // IN_FLIGHT_STATUSES filtering) do not match negotiation-presence.ts's
  // actual behavior on `dev` either — confirmed pre-existing and unrelated to
  // the negotiation-graph rewrite; left as-is per scope (only the wire-shape
  // fixture fields were migrated here, not the assertions' own correctness).
  it('keeps in-flight negotiations and drops agreed/resolved ones', () => {
    const live = deriveLiveNegotiations([
      conversation('live', { turnCount: 3 }),
      conversation('waiting', { turnCount: 0 }),
      conversation('answer', { state: 'paused', pauseReason: 'needs_principal', senderId: 'agent:viewer' }),
      conversation('agreed', { state: 'completed', opportunityStatus: 'pending' }),
      conversation('rejected', { state: 'completed', opportunityStatus: 'rejected' }),
      conversation('stalled', { state: 'completed', opportunityStatus: 'stalled' }),
      conversation('accepted', { state: 'completed', opportunityStatus: 'accepted', acceptedByViewer: true }),
    ], 'viewer');

    expect(live.map((item) => item.conversationId).sort()).toEqual(['answer', 'live', 'waiting']);
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

  it('tolerates a missing opportunity id', () => {
    const shell = conversation('shell', { opportunityId: null });
    const live = deriveLiveNegotiations([shell], 'viewer');

    expect(live).toHaveLength(1);
    expect(live.find((item) => item.conversationId === 'shell')?.opportunityId).toBeNull();
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
