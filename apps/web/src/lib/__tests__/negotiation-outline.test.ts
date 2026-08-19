import { describe, expect, it } from 'vitest';
import { countNegotiationsRequiringAction } from '@/lib/negotiation-inbox';
import { groupNegotiationOutline } from '@/lib/negotiation-outline';
import { presentationForStatus } from '@/lib/negotiation-presentation';
import type { ConversationSummary } from '@/services/conversation';

const lastMessage: NonNullable<ConversationSummary['lastMessage']> = {
  parts: [{ kind: 'data', data: { action: 'counter' } }],
  senderId: 'agent:peer',
  createdAt: '2026-01-03T00:00:00.000Z',
};

const conversation: ConversationSummary = {
  id: 'conversation-1',
  participants: [
    { participantId: 'agent:viewer', participantType: 'agent', name: 'Helper', avatar: null, ownerName: 'Viewer' },
    { participantId: 'agent:peer', participantType: 'agent', name: 'Helper', avatar: null, ownerName: 'Peer' },
  ],
  lastMessage,
  metadata: null,
  via: [],
  unreadCount: 0,
  lastMessageAt: '2026-01-03T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  negotiationOpportunities: [
    { intentId: 'intent-a', opportunityId: 'opportunity-a', title: 'Find a design partner', taskId: 'task-a', state: 'working', opportunityStatus: 'negotiating', acceptedByViewer: false, turnCount: 2, maxTurns: 6, signalCount: 1, outcome: null, updatedAt: '2026-01-02T00:00:00.000Z' },
    { intentId: 'intent-b', opportunityId: 'opportunity-b', title: 'Discuss research collaboration', taskId: 'task-b', state: 'completed', opportunityStatus: 'accepted', acceptedByViewer: true, turnCount: 3, maxTurns: 6, signalCount: 1, outcome: { hasOpportunity: true, reason: null }, updatedAt: '2026-01-03T00:00:00.000Z' },
  ],
};

/**
 * The dev shape behind the badge/list disagreement after #1444: a live
 * negotiation whose conversation carries no `matchProvenance`, so the API
 * projects `negotiationOpportunities: []` while `negotiation` still describes a
 * pending opportunity the badge counts.
 */
const ungroupableConversation: ConversationSummary = {
  id: '93c58ea7-71f5-4a63-b5e4-23aee8b9d7bf',
  participants: [
    { participantId: 'agent:viewer', participantType: 'agent', name: 'Helper', avatar: null, ownerName: 'Viewer' },
    { participantId: 'agent:peer-2', participantType: 'agent', name: 'Helper', avatar: null, ownerName: 'Dana' },
  ],
  lastMessage: { ...lastMessage, senderId: 'agent:peer-2' },
  metadata: null,
  via: [],
  unreadCount: 0,
  lastMessageAt: '2026-01-04T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  negotiation: {
    taskId: '07979837-5e29-4dd9-83dc-26f593972ca6',
    state: 'completed',
    statusTimestamp: '2026-01-04T00:00:00.000Z',
    opportunityId: '6426226c-9d63-42a9-8aea-764bbe0c5b8b',
    opportunityStatus: 'pending',
    acceptedByViewer: false,
    turnCount: 2,
    maxTurns: 6,
    signalCount: 1,
    outcome: null,
    updatedAt: '2026-01-04T00:00:00.000Z',
  },
  negotiationOpportunities: [],
};

/** The screened-out sibling: no messages, no opportunities, viewer is the initiator. */
const screenedOutConversation: ConversationSummary = {
  id: 'c5e8a825-ddcb-479c-b8dc-a8ad05690d71',
  participants: [
    { participantId: 'agent:viewer', participantType: 'agent', name: 'Helper', avatar: null, ownerName: 'Viewer' },
    { participantId: 'agent:peer-3', participantType: 'agent', name: 'Helper', avatar: null, ownerName: 'Ilya' },
  ],
  lastMessage: null,
  metadata: null,
  via: [],
  unreadCount: 0,
  lastMessageAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  negotiation: {
    taskId: '7bfba641-245c-4a92-9269-a798eba5c9e7',
    state: 'completed',
    statusTimestamp: '2026-01-05T00:00:00.000Z',
    opportunityId: '08b143c0-6f01-4c61-9fe9-08718744e86a',
    opportunityStatus: 'rejected',
    acceptedByViewer: false,
    turnCount: 0,
    maxTurns: 6,
    signalCount: 1,
    outcome: null,
    updatedAt: '2026-01-05T00:00:00.000Z',
    screenDecision: {
      source: 'screen',
      decision: 'pass',
      reasoning: 'no mutual value',
      counterpartyPremiseFit: null,
      intentAlignment: null,
      screenedAt: '2026-01-05T00:00:00.000Z',
    },
  },
  negotiationOpportunities: [],
};

describe('groupNegotiationOutline', () => {
  it('groups multiple opportunity sessions under one counterparty and retains their task ids', () => {
    const groups = groupNegotiationOutline([conversation], 'viewer');

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ id: 'peer', name: 'Peer' });
    expect(groups[0]?.opportunities.map((opportunity) => [opportunity.opportunityId, opportunity.taskId]))
      .toEqual([['opportunity-b', 'task-b'], ['opportunity-a', 'task-a']]);
    expect(groups[0]?.opportunities.every((opportunity) => !opportunity.ungrouped)).toBe(true);
  });

  it('lists an ungroupable negotiation as a fallback row instead of dropping it', () => {
    const groups = groupNegotiationOutline([ungroupableConversation], 'viewer');

    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe('Dana');
    expect(groups[0]?.opportunities).toEqual([{
      conversationId: '93c58ea7-71f5-4a63-b5e4-23aee8b9d7bf',
      counterpartId: 'peer-2',
      opportunityId: '6426226c-9d63-42a9-8aea-764bbe0c5b8b',
      taskId: '07979837-5e29-4dd9-83dc-26f593972ca6',
      title: 'Negotiation',
      presentation: expect.objectContaining({ label: 'Awaiting your review', status: 'awaiting_review' }),
      updatedAt: '2026-01-04T00:00:00.000Z',
      ungrouped: true,
    }]);
  });

  it('titles a fallback row from provenance or conversation metadata when either exists', () => {
    const viaTitled = groupNegotiationOutline(
      [{ ...ungroupableConversation, via: [{ intentId: 'i', opportunityId: 'o', title: 'Find a co-founder' }] }],
      'viewer',
    );
    expect(viaTitled[0]?.opportunities[0]?.title).toBe('Find a co-founder');

    const metadataTitled = groupNegotiationOutline(
      [{ ...ungroupableConversation, metadata: { title: 'Dana and Viewer' } }],
      'viewer',
    );
    expect(metadataTitled[0]?.opportunities[0]?.title).toBe('Dana and Viewer');
  });

  it('lists the owner-visible zero-message screened-out negotiation but not the counterparty view', () => {
    const asOwner = groupNegotiationOutline([screenedOutConversation], 'viewer');
    expect(asOwner[0]?.opportunities).toMatchObject([{
      conversationId: 'c5e8a825-ddcb-479c-b8dc-a8ad05690d71',
      taskId: '7bfba641-245c-4a92-9269-a798eba5c9e7',
      presentation: expect.objectContaining({ label: 'No match', status: 'no_match' }),
      ungrouped: true,
    }]);

    // The API never projects `screenDecision` to the counterparty, so the same
    // zero-message shell stays invisible on their rail — the outreach gate is
    // private to the seat that ran it.
    const asCounterparty = groupNegotiationOutline(
      [{ ...screenedOutConversation, negotiation: { ...screenedOutConversation.negotiation!, screenDecision: null } }],
      'peer-3',
    );
    expect(asCounterparty).toEqual([]);
  });

  it('never shows fewer negotiations than the your-move badge counts', () => {
    const negotiations = [conversation, ungroupableConversation, screenedOutConversation];
    const listed = groupNegotiationOutline(negotiations, 'viewer')
      .flatMap((group) => group.opportunities.map((opportunity) => opportunity.conversationId));

    expect(countNegotiationsRequiringAction(negotiations, 'viewer')).toBe(1);
    // The pending negotiation the badge counts is exactly the one #1444 dropped.
    expect(listed).toContain(ungroupableConversation.id);
  });

  it('uses only agreed user-facing lifecycle labels', () => {
    expect(presentationForStatus('awaiting_review').label).toBe('Awaiting your review');
    expect(presentationForStatus('negotiating').label).toBe('Negotiating');
    expect(presentationForStatus('no_match').label).toBe('No match');
  });
});
