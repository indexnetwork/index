/**
 * Tests for the onCandidateResolved callback added to negotiateCandidates in
 * Plan B Task 5. The orchestrator branch of OpportunityGraph uses this hook
 * to progressively stream `opportunity_draft_ready` events as each per-
 * candidate negotiation resolves, rather than waiting for the whole fan-out
 * to settle.
 */

import { describe, it, expect } from 'bun:test';
import { negotiateCandidates, type NegotiationCandidate, type OnNegotiationResolved } from '../negotiation.graph.js';
import type { NegotiationGraphLike, UserNegotiationContext } from '../negotiation.state.js';
import type { NegotiationOutcome } from '../../shared/interfaces/database.interface.js';

function makeCandidate(userId: string, opportunityId: string): NegotiationCandidate {
  return {
    userId,
    reasoning: `seed reasoning for ${userId}`,
    valencyRole: 'peer',
    networkId: 'net-1',
    opportunityId,
    candidateUser: {
      id: userId,
      intents: [],
      profile: { name: userId },
    },
  };
}

const sourceUser: UserNegotiationContext = {
  id: 'source-user',
  intents: [],
  profile: { name: 'Source User' },
};

function makeAcceptedOutcome(userId: string): NegotiationOutcome {
  return {
    hasOpportunity: true,
    agreedRoles: [
      { userId: 'source-user', role: 'patient' },
      { userId, role: 'agent' },
    ],
    reasoning: `accepted for ${userId}`,
    turnCount: 2,
  };
}

function makeRejectedOutcome(): NegotiationOutcome {
  return {
    hasOpportunity: false,
    agreedRoles: [],
    reasoning: 'rejected',
    turnCount: 1,
  };
}

function makeGraphMock(
  outcomes: Record<string, NegotiationOutcome>,
): NegotiationGraphLike {
  return {
    invoke: async (input) => {
      const candidateId = input.candidateUser.id;
      const outcome = outcomes[candidateId];
      return {
        outcome,
        messages: [],
        status: 'completed',
      } as unknown as Awaited<ReturnType<NegotiationGraphLike['invoke']>>;
    },
  };
}

describe('negotiateCandidates — onCandidateResolved hook', () => {
  it('invokes the hook for each candidate with accepted=result or accepted=null', async () => {
    const graph = makeGraphMock({
      'user-a': makeAcceptedOutcome('user-a'),
      'user-b': makeRejectedOutcome(),
    });

    const received: Array<{ userId: string; acceptedUserId: string | null }> = [];
    const hook: OnNegotiationResolved = async ({ candidate, accepted }) => {
      received.push({
        userId: candidate.userId,
        acceptedUserId: accepted?.userId ?? null,
      });
    };

    const results = await negotiateCandidates(
      graph,
      sourceUser,
      [makeCandidate('user-a', 'opp-a'), makeCandidate('user-b', 'opp-b')],
      { networkId: '', prompt: '' },
      { onCandidateResolved: hook },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.userId).toBe('user-a');

    const byUser = new Map(received.map((r) => [r.userId, r.acceptedUserId]));
    expect(byUser.get('user-a')).toBe('user-a');
    expect(byUser.get('user-b')).toBe(null);
  });

  it('is optional — omitting it preserves the original negotiateCandidates behavior', async () => {
    const graph = makeGraphMock({
      'user-a': makeAcceptedOutcome('user-a'),
    });

    const results = await negotiateCandidates(
      graph,
      sourceUser,
      [makeCandidate('user-a', 'opp-a')],
      { networkId: '', prompt: '' },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.userId).toBe('user-a');
  });

  it('does not drop the accepted result when the hook throws', async () => {
    const graph = makeGraphMock({
      'user-a': makeAcceptedOutcome('user-a'),
    });

    const hook: OnNegotiationResolved = async () => {
      throw new Error('hook failed');
    };

    const results = await negotiateCandidates(
      graph,
      sourceUser,
      [makeCandidate('user-a', 'opp-a')],
      { networkId: '', prompt: '' },
      { onCandidateResolved: hook },
    );

    expect(results).toHaveLength(1);
    expect(results[0]?.userId).toBe('user-a');
  });

  it('fires the hook with accepted=null when negotiation invocation throws', async () => {
    const graph: NegotiationGraphLike = {
      invoke: async () => {
        throw new Error('negotiation blew up');
      },
    };

    const received: Array<{ userId: string; acceptedUserId: string | null }> = [];
    const hook: OnNegotiationResolved = async ({ candidate, accepted }) => {
      received.push({
        userId: candidate.userId,
        acceptedUserId: accepted?.userId ?? null,
      });
    };

    const results = await negotiateCandidates(
      graph,
      sourceUser,
      [makeCandidate('user-a', 'opp-a')],
      { networkId: '', prompt: '' },
      { onCandidateResolved: hook },
    );

    expect(results).toHaveLength(0);
    expect(received).toEqual([{ userId: 'user-a', acceptedUserId: null }]);
  });
});
