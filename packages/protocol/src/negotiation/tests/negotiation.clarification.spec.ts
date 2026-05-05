/**
 * Tests for the clarification surfacing path added to negotiateCandidates.
 * When a candidate's negotiation rejects with a counterpart-authored
 * clarification question, that question rides out alongside the accepted
 * results so the orchestrator can render it as a chat card.
 */

import { describe, it, expect } from 'bun:test';
import {
  negotiateCandidates,
  type NegotiationCandidate,
} from '../negotiation.graph.js';
import type {
  NegotiationGraphLike,
  NegotiationOutcome,
  NegotiationTurn,
  UserNegotiationContext,
} from '../negotiation.state.js';

const sourceUser: UserNegotiationContext = {
  id: 'source-user',
  intents: [],
  profile: { name: 'Source User' },
};

function makeCandidate(userId: string, opportunityId: string, name = userId): NegotiationCandidate {
  return {
    userId,
    reasoning: `seed reasoning for ${userId}`,
    valencyRole: 'peer',
    networkId: 'net-1',
    opportunityId,
    candidateUser: {
      id: userId,
      intents: [],
      profile: { name },
    },
  };
}

function rejectTurn(opts: { question?: string }): NegotiationTurn {
  return {
    action: 'reject',
    assessment: {
      reasoning: 'cannot evaluate without more info',
      suggestedRoles: { ownUser: 'agent', otherUser: 'patient' },
      ...(opts.question && { clarificationQuestion: opts.question }),
    },
  };
}

function rejectOutcome(): NegotiationOutcome {
  return {
    hasOpportunity: false,
    agreedRoles: [],
    reasoning: 'rejected',
    turnCount: 2,
  };
}

function turnCapOutcome(): NegotiationOutcome {
  return {
    hasOpportunity: false,
    agreedRoles: [],
    reasoning: 'reached cap',
    turnCount: 6,
    reason: 'turn_cap',
  };
}

function makeGraph(
  perCandidate: Record<
    string,
    { outcome: NegotiationOutcome; lastTurn: NegotiationTurn }
  >,
): NegotiationGraphLike {
  return {
    invoke: async (input) => {
      const id = input.candidateUser.id;
      const cfg = perCandidate[id];
      if (!cfg) throw new Error(`no mock for ${id}`);
      const message = {
        id: `msg-${id}`,
        senderId: `agent:${id}`,
        role: 'agent' as const,
        parts: [{ kind: 'data' as const, data: cfg.lastTurn }],
        createdAt: new Date(),
      };
      return {
        outcome: cfg.outcome,
        messages: [message],
      } as unknown as Awaited<ReturnType<NegotiationGraphLike['invoke']>>;
    },
  };
}

describe('negotiateCandidates — clarification extraction', () => {
  it('surfaces a clarification when a reject turn carries a verbatim question', async () => {
    const graph = makeGraph({
      'user-a': {
        outcome: rejectOutcome(),
        lastTurn: rejectTurn({ question: 'What stage is your company at?' }),
      },
    });

    const result = await negotiateCandidates(
      graph,
      sourceUser,
      [makeCandidate('user-a', 'opp-a', 'Alex')],
      { networkId: '', prompt: '' },
    );

    expect(result.accepted).toHaveLength(0);
    expect(result.clarifications).toHaveLength(1);
    expect(result.clarifications[0]).toMatchObject({
      userId: 'user-a',
      opportunityId: 'opp-a',
      candidateName: 'Alex',
      networkId: 'net-1',
      question: 'What stage is your company at?',
    });
  });

  it('omits clarification when rejection has no question (hard mismatch)', async () => {
    const graph = makeGraph({
      'user-b': {
        outcome: rejectOutcome(),
        lastTurn: rejectTurn({}),
      },
    });

    const result = await negotiateCandidates(
      graph,
      sourceUser,
      [makeCandidate('user-b', 'opp-b')],
      { networkId: '', prompt: '' },
    );

    expect(result.clarifications).toHaveLength(0);
  });

  it('omits clarification when negotiation hit turn cap', async () => {
    const graph = makeGraph({
      'user-c': {
        outcome: turnCapOutcome(),
        lastTurn: rejectTurn({ question: 'Would have asked but capped out' }),
      },
    });

    const result = await negotiateCandidates(
      graph,
      sourceUser,
      [makeCandidate('user-c', 'opp-c')],
      { networkId: '', prompt: '' },
    );

    expect(result.clarifications).toHaveLength(0);
  });

  it('returns accepted and clarifications side-by-side when fan-out is mixed', async () => {
    const graph = makeGraph({
      'user-acc': {
        outcome: {
          hasOpportunity: true,
          agreedRoles: [
            { userId: 'source-user', role: 'patient' },
            { userId: 'user-acc', role: 'agent' },
          ],
          reasoning: 'accept',
          turnCount: 3,
        },
        lastTurn: {
          action: 'accept',
          assessment: {
            reasoning: 'looks good',
            suggestedRoles: { ownUser: 'agent', otherUser: 'patient' },
          },
        },
      },
      'user-rej': {
        outcome: rejectOutcome(),
        lastTurn: rejectTurn({ question: 'What sectors are you focused on?' }),
      },
    });

    const result = await negotiateCandidates(
      graph,
      sourceUser,
      [makeCandidate('user-acc', 'opp-acc'), makeCandidate('user-rej', 'opp-rej')],
      { networkId: '', prompt: '' },
    );

    expect(result.accepted.map((r) => r.userId)).toEqual(['user-acc']);
    expect(result.clarifications.map((c) => c.userId)).toEqual(['user-rej']);
  });
});
