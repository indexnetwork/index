import { describe, expect, it } from 'vitest';
import { groupNegotiationOutline, opportunityStatusPresentation } from '@/lib/negotiation-outline';
import type { ConversationSummary } from '@/services/conversation';

const conversation: ConversationSummary = {
  id: 'conversation-1',
  participants: [
    { participantId: 'agent:viewer', participantType: 'agent', name: 'Helper', avatar: null, ownerName: 'Viewer' },
    { participantId: 'agent:peer', participantType: 'agent', name: 'Helper', avatar: null, ownerName: 'Peer' },
  ],
  lastMessage: null,
  metadata: null,
  via: [],
  unreadCount: 0,
  lastMessageAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  negotiationOpportunities: [
    { intentId: 'intent-a', opportunityId: 'opportunity-a', title: 'Find a design partner', taskId: 'task-a', state: 'working', opportunityStatus: 'negotiating', acceptedByViewer: false, turnCount: 2, maxTurns: 6, signalCount: 1, outcome: null, updatedAt: '2026-01-02T00:00:00.000Z' },
    { intentId: 'intent-b', opportunityId: 'opportunity-b', title: 'Discuss research collaboration', taskId: 'task-b', state: 'completed', opportunityStatus: 'accepted', acceptedByViewer: true, turnCount: 3, maxTurns: 6, signalCount: 1, outcome: { hasOpportunity: true, reason: null }, updatedAt: '2026-01-03T00:00:00.000Z' },
  ],
};

describe('groupNegotiationOutline', () => {
  it('groups multiple opportunity sessions under one counterparty and retains their task ids', () => {
    const groups = groupNegotiationOutline([conversation], 'viewer');

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'peer', name: 'Peer' });
    expect(groups[0]?.opportunities.map((opportunity) => [opportunity.opportunityId, opportunity.taskId]))
      .toEqual([['opportunity-b', 'task-b'], ['opportunity-a', 'task-a']]);
  });

  it('uses only supported lifecycle labels', () => {
    expect(opportunityStatusPresentation.accepted.label).toBe('Accepted');
    expect(opportunityStatusPresentation.negotiating.label).toBe('Negotiating');
    expect(Object.keys(opportunityStatusPresentation)).not.toContain('exploring');
  });
});
