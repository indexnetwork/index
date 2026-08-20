import { describe, expect, it } from 'vitest';

import { countNegotiationsRequiringAction, deriveNegotiationInbox, flattenNegotiationInbox } from '@/lib/negotiation-inbox';
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
    updatedAt?: string;
    screenDecision?: NonNullable<ConversationSummary['negotiation']>['screenDecision'];
    /** Which task session produced the conversation's last message; defaults to the represented one. */
    lastMessageTaskId?: string;
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
      taskId: input.lastMessageTaskId ?? `${id}-task`,
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
      updatedAt: input.updatedAt ?? '2026-07-24T11:00:00.000Z',
      ...(input.screenDecision ? { screenDecision: input.screenDecision } : {}),
    },
  };
}

/**
 * The API projects `screenDecision` ONLY to the negotiation's initiator, so a
 * fixture carrying it represents what the OWNER receives, and one without it
 * represents exactly what a counterparty receives for the same negotiation.
 */
const OWNER_GATE_DECISION = {
  source: 'screen' as const,
  decision: 'pass' as const,
  reasoning: 'Bob is not working on anything close to what Alice needs.',
  counterpartyPremiseFit: 'different domain',
  intentAlignment: 'no overlap',
  screenedAt: '2026-07-24T11:00:00.000Z',
};

describe('negotiations inbox presentation', () => {
  it('puts consultations before agent agreements in Your move', () => {
    const groups = deriveNegotiationInbox([
      conversation('agreement', { state: 'completed', opportunityStatus: 'pending', action: 'accept', outcome: { hasOpportunity: true, reason: null } }),
      conversation('question', { state: 'input_required', action: 'ask_user', senderId: 'agent:viewer' }),
    ], 'viewer', NOW);

    expect(groups.yourMove.map((item) => [item.conversationId, item.status])).toEqual([
      ['question', 'needs_input'],
      ['agreement', 'awaiting_review'],
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

    expect(groups.yourMove[0]?.status).toBe('awaiting_review');
    expect(groups.resolved[0]?.status).toBe('accepted_by_viewer');
    expect(groups.resolved[0]?.lastAction).toBe('you accepted the connection');

    const counterpartStarted = deriveNegotiationInbox([
      conversation('counterpart-started', { state: 'completed', opportunityStatus: 'accepted', action: 'accept' }),
    ], 'viewer', NOW);
    expect(counterpartStarted.resolved[0]?.status).toBe('connection_accepted');
    expect(counterpartStarted.resolved[0]?.lastAction).toBe('the connection was accepted');
  });

  it('maps active and negative outcomes to calm lifecycle labels', () => {
    const groups = deriveNegotiationInbox([
      conversation('live', { turnCount: 3 }),
      conversation('waiting', { turnCount: 0 }),
      conversation('rejected', { state: 'completed', opportunityStatus: 'rejected', action: 'decline', outcome: { hasOpportunity: false, reason: null } }),
      conversation('stalled', { state: 'completed', opportunityStatus: 'stalled', outcome: { hasOpportunity: false, reason: 'turn_cap' } }),
    ], 'viewer', NOW);

    expect(groups.inProgress.map((item) => item.status).sort()).toEqual(['negotiating', 'negotiating']);
    expect(groups.resolved.map((item) => item.status).sort()).toEqual(['no_agreement', 'no_match']);
    expect(groups.resolved.find((item) => item.status === 'no_agreement')?.lastAction)
      .toBe('agents could not reach agreement within the turn limit');
    expect(groups.resolved.find((item) => item.status === 'no_match')?.lastAction)
      .toBe('agents did not recommend moving forward');
  });

  it('does not surface zero-turn private or abandoned rows', () => {
    const groups = deriveNegotiationInbox([
      conversation('screened', { state: 'completed', withMessage: false, outcome: { hasOpportunity: false, reason: 'screened_out' } }),
    ], 'viewer', NOW);

    expect(groups).toEqual({ yourMove: [], inProgress: [], resolved: [] });
  });

  it('surfaces the owner-only gate decision as a resolved row (IND-610)', () => {
    const groups = deriveNegotiationInbox([
      conversation('gated', {
        state: 'completed',
        withMessage: false,
        outcome: { hasOpportunity: false, reason: 'screened_out' },
        screenDecision: OWNER_GATE_DECISION,
      }),
    ], 'viewer', NOW);

    expect(groups.resolved).toHaveLength(1);
    const [row] = groups.resolved;
    expect(row.conversationId).toBe('gated');
    expect(row.status).toBe('not_started');
    expect(row.lastAction).toBe('Your agent did not reach out');
    expect(row.turnCount).toBe(0);
    // The row is a link to the existing card; it must not leak the reasoning
    // itself into the list surface.
    expect(JSON.stringify(row)).not.toContain('not working on anything close');
  });

  it('gives a NON-OWNER viewer no gate row for the same negotiation', () => {
    // Identical negotiation, counterparty's view: the API withheld
    // screenDecision, so nothing here can reconstruct the row.
    const groups = deriveNegotiationInbox([
      conversation('gated', {
        state: 'completed',
        withMessage: false,
        outcome: { hasOpportunity: false, reason: 'screened_out' },
      }),
    ], 'counterparty', NOW);

    expect(groups).toEqual({ yourMove: [], inProgress: [], resolved: [] });
  });

  it('still hides a zero-turn shell that carries no gate decision', () => {
    const groups = deriveNegotiationInbox([
      conversation('abandoned', { state: 'working', withMessage: false }),
    ], 'viewer', NOW);

    expect(groups).toEqual({ yourMove: [], inProgress: [], resolved: [] });
  });

  // The API collapses a person's several task sessions into one represented
  // `negotiation` by liveness (awaiting approval › parked › in progress ›
  // resolved), so the row here only ever sees the most alive session. What the
  // web must guarantee is that nothing from a *different* session with the
  // same person — the conversation-wide last message — can caption or
  // reclassify that row.
  describe('person-row rollup (one row per counterparty)', () => {
    it('keeps an awaiting-you row awaiting you when a later dead pairing left the last message', () => {
      // Hye-jin ↔ Deniz: the represented session is the pending approval
      // (outreach → accept); the conversation's newest message is a decline
      // from a later session that was screened out.
      const groups = deriveNegotiationInbox([
        conversation('deniz', {
          state: 'completed',
          opportunityStatus: 'pending',
          outcome: { hasOpportunity: true, reason: null },
          action: 'decline',
          lastMessageTaskId: 'deniz-later-task',
          updatedAt: '2026-07-24T11:28:00.000Z',
        }),
      ], 'viewer', NOW);

      expect(groups.inProgress).toEqual([]);
      expect(groups.resolved).toEqual([]);
      expect(groups.yourMove).toHaveLength(1);
      const [row] = groups.yourMove;
      expect(row.status).toBe('awaiting_review');
      expect(row.lastAction).toBe('agents recommended moving forward');
      expect(row.lastAction).not.toMatch(/did not/);
      // The timestamp is the represented session's, not the dead one's.
      expect(row.timeAgo).toBe('32m ago');
      // …and the header counts it: "1 your move", matching Radar's "Awaiting you · 1".
      expect(countNegotiationsRequiringAction([conversation('deniz', {
        state: 'completed', opportunityStatus: 'pending', action: 'decline', lastMessageTaskId: 'deniz-later-task',
      })], 'viewer')).toBe(1);
    });

    it('captions a live row from its own session, not from another session of the same person', () => {
      const groups = deriveNegotiationInbox([
        conversation('live', { state: 'working', opportunityStatus: 'negotiating', action: 'decline', lastMessageTaskId: 'live-earlier-task' }),
        conversation('own', { state: 'working', opportunityStatus: 'negotiating', action: 'counter', senderId: 'agent:viewer' }),
      ], 'viewer', NOW);

      expect(groups.inProgress.map((item) => [item.conversationId, item.status, item.lastAction])).toEqual([
        ['live', 'negotiating', 'agents exchanged a turn'],
        ['own', 'negotiating', 'your agent countered'],
      ]);
    });

    it('leaves an all-resolved person on their most recent resolved pairing', () => {
      const groups = deriveNegotiationInbox([
        conversation('deniz', {
          state: 'completed',
          opportunityStatus: 'rejected',
          outcome: { hasOpportunity: false, reason: 'screened_out' },
          action: 'accept',
          lastMessageTaskId: 'deniz-earlier-task',
        }),
      ], 'viewer', NOW);

      expect(groups.yourMove).toEqual([]);
      expect(groups.resolved.map((item) => [item.status, item.lastAction])).toEqual([
        ['no_match', 'agents did not find enough mutual value to continue'],
      ]);
    });
  });

  describe('header — "your move" counts what the viewer must act on', () => {
    it('counts an opportunity pending the viewer\'s approval, exactly as the Radar\'s "Awaiting you" does', () => {
      // No agent question is parked; the only thing awaiting the viewer is the
      // owner-approval gate. That is a move of theirs.
      const pendingApproval = conversation('approval', {
        state: 'completed',
        opportunityStatus: 'pending',
        outcome: { hasOpportunity: true, reason: null },
        action: 'accept',
      });
      expect(countNegotiationsRequiringAction([pendingApproval], 'viewer')).toBe(1);
      expect(deriveNegotiationInbox([pendingApproval], 'viewer', NOW).yourMove[0]?.status).toBe('awaiting_review');
    });

    it('counts a parked question to the viewer and a pending approval as two moves, and nothing resolved', () => {
      expect(countNegotiationsRequiringAction([
        conversation('question', { state: 'input_required', action: 'ask_user', senderId: 'agent:viewer' }),
        conversation('approval', { state: 'completed', opportunityStatus: 'pending', action: 'accept' }),
        conversation('declined', { state: 'completed', opportunityStatus: 'rejected', action: 'decline', outcome: { hasOpportunity: false, reason: null } }),
        conversation('their-question', { state: 'input_required', action: 'ask_user' }),
      ], 'viewer')).toBe(2);
    });
  });

  it('flattens groups into a last-updated ordering across groups', () => {
    const groups = deriveNegotiationInbox([
      conversation('agreed', { state: 'completed', opportunityStatus: 'pending', action: 'accept', updatedAt: '2026-07-24T09:00:00.000Z' }),
      conversation('live', { turnCount: 2, updatedAt: '2026-07-24T11:30:00.000Z' }),
      conversation('resolved', { state: 'completed', opportunityStatus: 'rejected', action: 'decline', outcome: { hasOpportunity: false, reason: null }, updatedAt: '2026-07-24T10:30:00.000Z' }),
    ], 'viewer', NOW);

    expect(flattenNegotiationInbox(groups).map((item) => [item.conversationId, item.group])).toEqual([
      ['live', 'in_progress'],
      ['resolved', 'resolved'],
      ['agreed', 'your_move'],
    ]);
  });
});
