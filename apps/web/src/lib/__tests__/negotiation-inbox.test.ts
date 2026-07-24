import { describe, expect, it } from 'vitest';

import { countNegotiationsRequiringAction, deriveNegotiationInbox } from '@/lib/negotiation-inbox';
import type { ConversationSummary } from '@/services/conversation';

const NOW = new Date('2026-07-24T12:00:00.000Z').getTime();

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
    via: [],
    unreadCount: 0,
    lastMessageAt: '2026-07-24T11:00:00.000Z',
    createdAt: '2026-07-24T10:00:00.000Z',
    negotiation: {
      taskId: `${id}-task`,
      state: input.state ?? 'working',
      statusTimestamp: '2026-07-24T11:00:00.000Z',
      opportunityId: `${id}-opportunity`,
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

describe('negotiations inbox presentation', () => {
  it('puts consultations before agent agreements in Your move', () => {
    const groups = deriveNegotiationInbox([
      conversation('agreement', { state: 'completed', opportunityStatus: 'pending', action: 'accept', outcome: { hasOpportunity: true, reason: null } }),
      conversation('question', { state: 'input_required', action: 'ask_user', senderId: 'agent:viewer' }),
    ], 'viewer', NOW);

    expect(groups.yourMove.map((item) => [item.conversationId, item.status])).toEqual([
      ['question', 'answer'],
      ['agreement', 'agreed'],
    ]);
    expect(countNegotiationsRequiringAction([
      conversation('question', { state: 'input_required', action: 'ask_user', senderId: 'agent:viewer' }),
      conversation('agreement', { state: 'completed', opportunityStatus: 'pending', action: 'accept' }),
    ], 'viewer')).toBe(2);
    expect(countNegotiationsRequiringAction([
      conversation('their-question', { state: 'input_required', action: 'ask_user' }),
    ], 'viewer')).toBe(0);
  });

  it('keeps agent agreement distinct from human acceptance', () => {
    const groups = deriveNegotiationInbox([
      conversation('pending', { state: 'completed', opportunityStatus: 'pending', action: 'accept' }),
      conversation('accepted', { state: 'completed', opportunityStatus: 'accepted', action: 'accept', acceptedByViewer: true }),
    ], 'viewer', NOW);

    expect(groups.yourMove[0]?.status).toBe('agreed');
    expect(groups.resolved[0]?.status).toBe('accepted');
    expect(groups.resolved[0]?.lastAction).toBe('you started the chat');

    const counterpartStarted = deriveNegotiationInbox([
      conversation('counterpart-started', { state: 'completed', opportunityStatus: 'accepted', action: 'accept' }),
    ], 'viewer', NOW);
    expect(counterpartStarted.resolved[0]?.status).toBe('started');
    expect(counterpartStarted.resolved[0]?.lastAction).toBe('the chat was started');
  });

  it('maps active and negative outcomes to calm lifecycle labels', () => {
    const groups = deriveNegotiationInbox([
      conversation('live', { turnCount: 3 }),
      conversation('waiting', { turnCount: 0 }),
      conversation('rejected', { state: 'completed', opportunityStatus: 'rejected', action: 'decline', outcome: { hasOpportunity: false, reason: null } }),
      conversation('stalled', { state: 'completed', opportunityStatus: 'stalled', outcome: { hasOpportunity: false, reason: 'turn_cap' } }),
    ], 'viewer', NOW);

    expect(groups.inProgress.map((item) => item.status).sort()).toEqual(['live', 'waiting']);
    expect(groups.resolved.map((item) => item.status).sort()).toEqual(['rejected', 'stalled']);
    expect(groups.resolved.find((item) => item.status === 'stalled')?.lastAction)
      .toBe('agents could not reach agreement within the turn limit');
    expect(groups.resolved.find((item) => item.status === 'rejected')?.lastAction)
      .toBe('agents did not recommend moving forward');
  });

  it('does not surface zero-turn private or abandoned rows', () => {
    const groups = deriveNegotiationInbox([
      conversation('screened', { state: 'completed', withMessage: false, outcome: { hasOpportunity: false, reason: 'screened_out' } }),
    ], 'viewer', NOW);

    expect(groups).toEqual({ yourMove: [], inProgress: [], resolved: [] });
  });
});
