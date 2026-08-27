/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, expect, it } from 'bun:test';
import { deriveRolesFromCorpus, canUserSeeOpportunity, isActionableForViewer, validateOpportunityActors } from '../opportunity.utils.js';

describe('opportunity.utils', () => {
  describe('deriveRolesFromCorpus', () => {
    test('profiles corpus: source patient, candidate agent', () => {
      const r = deriveRolesFromCorpus('profiles');
      expect(r.sourceRole).toBe('patient');
      expect(r.candidateRole).toBe('agent');
    });

    test('intents corpus: source agent, candidate patient', () => {
      const r = deriveRolesFromCorpus('intents');
      expect(r.sourceRole).toBe('agent');
      expect(r.candidateRole).toBe('patient');
    });

    test('unknown corpus: both peer', () => {
      const r = deriveRolesFromCorpus('unknown' as any);
      expect(r.sourceRole).toBe('peer');
      expect(r.candidateRole).toBe('peer');
    });
  });

  // ─── canUserSeeOpportunity ───────────────────────────────────────────────
  // Tests the Compact Visibility Rule documented in opportunity-status-lifecycle.md:
  // - Introducer or peer: always see.

  describe('canUserSeeOpportunity', () => {
    const VIEWER = 'user-viewer';
    const actors = [
      { userId: VIEWER, role: 'party' },
      { userId: 'user-other', role: 'party' },
    ];

    // The old four-way rule keyed on role, pre-kickoff status, and vouching.
    // Neither `latent` nor the introducer role exists, so every branch
    // collapsed to the same answer.
    test('an actor may read the pairing, at any status and in any role', () => {
      for (const status of ['negotiating', 'pending', 'accepted', 'rejected', 'expired', 'stalled']) {
        expect(canUserSeeOpportunity(actors, status, VIEWER)).toBe(true);
      }
      for (const role of ['party', 'patient', 'agent', 'peer']) {
        expect(canUserSeeOpportunity([{ userId: VIEWER, role }], 'negotiating', VIEWER)).toBe(true);
      }
    });

    test('a non-actor may not', () => {
      expect(canUserSeeOpportunity(actors, 'negotiating', 'user-stranger')).toBe(false);
      expect(canUserSeeOpportunity([], 'negotiating', VIEWER)).toBe(false);
    });
  });

  describe('isActionableForViewer', () => {
    const VIEWER = 'user-viewer';
    const actors = (over: Record<string, unknown> = {}) => [
      { userId: VIEWER, role: 'party', ...over },
      { userId: 'user-other', role: 'party' },
    ];

    test('is actionable at pending while the viewer has not acted', () => {
      expect(isActionableForViewer(actors(), 'pending', VIEWER)).toBe(true);
    });

    test('is not actionable once the viewer has acted', () => {
      expect(isActionableForViewer(actors({ actedAt: '2026-08-01T00:00:00Z' }), 'pending', VIEWER)).toBe(false);
    });

    test('a negotiating pairing is the agents\' work, not the principal\'s', () => {
      expect(isActionableForViewer(actors(), 'negotiating', VIEWER)).toBe(false);
    });

    test('never actionable at a terminal status', () => {
      for (const status of ['accepted', 'rejected', 'expired', 'stalled']) {
        expect(isActionableForViewer(actors(), status, VIEWER)).toBe(false);
      }
    });

    test('acting is per-user: one stamped row settles every duplicate row', () => {
      // Re-detection can append a second actor row for the same user without
      // `actedAt`; a single stamped row still means the viewer has decided.
      const duplicated = [
        { userId: VIEWER, role: 'party', actedAt: '2026-08-01T00:00:00Z' },
        { userId: VIEWER, role: 'party' },
        { userId: 'user-other', role: 'party' },
      ];
      expect(isActionableForViewer(duplicated, 'pending', VIEWER)).toBe(false);
    });

    test('a non-actor is never actionable', () => {
      expect(isActionableForViewer(actors(), 'pending', 'user-stranger')).toBe(false);
    });
  });

  describe('validateOpportunityActors', () => {
    test('accepts 1 introducer + 1 party (1:1 intro e.g. "I want to connect with X")', () => {
      const actors = [
        { role: 'introducer' },
        { role: 'party' },
      ];
      expect(() => validateOpportunityActors(actors)).not.toThrow();
    });

    test('accepts three actors: two party + one introducer', () => {
      const actors = [
        { role: 'party' },
        { role: 'party' },
        { role: 'introducer' },
      ];
      expect(() => validateOpportunityActors(actors)).not.toThrow();
    });

    test('accepts two actors: two party (no introducer)', () => {
      const actors = [
        { role: 'party' },
        { role: 'agent' },
      ];
      expect(() => validateOpportunityActors(actors)).not.toThrow();
    });

    test('accepts actors with userId', () => {
      expect(() =>
        validateOpportunityActors([
          { userId: 'c2505011-2e45-426e-81dd-b9abb9b72023', role: 'patient' },
          { userId: 'a1234567-b234-c345-d456-e56789abcdef', role: 'agent' },
        ])
      ).not.toThrow();
    });

    test('accepts actors without userId field', () => {
      expect(() =>
        validateOpportunityActors([
          { role: 'patient' },
          { role: 'agent' },
        ])
      ).not.toThrow();
    });

    test('rejects a discovery self-match where all non-introducer rows are the same user', () => {
      const self = 'c2505011-2e45-426e-81dd-b9abb9b72023';
      expect(() =>
        validateOpportunityActors([
          { userId: self, role: 'agent' },
          { userId: self, role: 'patient' },
        ])
      ).toThrow(/match a user with themselves/);
    });

    test('accepts duplicate rows for one participant when another distinct participant is present', () => {
      expect(() =>
        validateOpportunityActors([
          { userId: 'c2505011-2e45-426e-81dd-b9abb9b72023', role: 'agent' },
          { userId: 'c2505011-2e45-426e-81dd-b9abb9b72023', role: 'patient' },
          { userId: 'a1234567-b234-c345-d456-e56789abcdef', role: 'party' },
        ])
      ).not.toThrow();
    });

    test('accepts a 1:1 intro where introducer and party are distinct users', () => {
      expect(() =>
        validateOpportunityActors([
          { userId: 'a1234567-b234-c345-d456-e56789abcdef', role: 'introducer' },
          { userId: 'c2505011-2e45-426e-81dd-b9abb9b72023', role: 'party' },
        ])
      ).not.toThrow();
    });

    test('accepts a 2-party intro where all three users are distinct', () => {
      expect(() =>
        validateOpportunityActors([
          { userId: 'a1234567-b234-c345-d456-e56789abcdef', role: 'party' },
          { userId: 'b2345678-c345-d456-e567-f6789abcdef0', role: 'party' },
          { userId: 'c2505011-2e45-426e-81dd-b9abb9b72023', role: 'introducer' },
        ])
      ).not.toThrow();
    });
  });
});

// ─── Introducer-related utility tests ────────────────────────────────────────

import { selectByComposition, classifyOpportunity } from '../opportunity.utils.js';

type TestOpp = {
  id: string;
  actors: Array<{ userId: string; role: string }>;
  status: string;
};

function makeConnectionOpp(id: string, viewerId: string, otherId: string, status = 'latent'): TestOpp {
  return {
    id,
    actors: [
      { userId: viewerId, role: 'party' },
      { userId: otherId, role: 'agent' },
    ],
    status,
  };
}

function makeConnectorFlowOpp(
  id: string,
  introducerId: string,
  partyA: string,
  partyB: string,
  status = 'latent',
): TestOpp {
  return {
    id,
    actors: [
      { userId: introducerId, role: 'introducer' },
      { userId: partyA, role: 'party' },
      { userId: partyB, role: 'party' },
    ],
    status,
  };
}

describe('classifyOpportunity', () => {
  it('classifies direct connection as connection', () => {
    const opp = makeConnectionOpp('conn-1', 'viewer', 'other');
    expect(classifyOpportunity(opp, 'viewer')).toBe('connection');
  });

  it('classifies expired opportunity as expired', () => {
    const opp = makeConnectionOpp('exp-1', 'viewer', 'other', 'expired');
    expect(classifyOpportunity(opp, 'viewer')).toBe('expired');
  });
});

describe('selectByComposition ordering', () => {
  it('returns connections before connector-flow before expired', () => {
    const viewerId = 'viewer';
    const opps: TestOpp[] = [
      makeConnectorFlowOpp('cf-1', viewerId, 'a', 'b'),
      makeConnectionOpp('conn-1', viewerId, 'c'),
      makeConnectionOpp('exp-1', viewerId, 'd', 'expired'),
      makeConnectorFlowOpp('cf-2', viewerId, 'e', 'f'),
      makeConnectionOpp('conn-2', viewerId, 'g'),
    ];

    const result = selectByComposition(opps, viewerId);
    const categories = result.map((o) => classifyOpportunity(o, viewerId));

    // All connections must come before all connector-flow, which must come before all expired
    const firstConnectorFlow = categories.indexOf('connector-flow');
    const lastConnection = categories.lastIndexOf('connection');
    const firstExpired = categories.indexOf('expired');
    const lastConnectorFlow = categories.lastIndexOf('connector-flow');

    if (lastConnection >= 0 && firstConnectorFlow >= 0) {
      expect(lastConnection).toBeLessThan(firstConnectorFlow);
    }
    if (lastConnectorFlow >= 0 && firstExpired >= 0) {
      expect(lastConnectorFlow).toBeLessThan(firstExpired);
    }
  });

  it('does not interleave categories even with mixed input order', () => {
    const viewerId = 'viewer';
    // Input deliberately interleaves categories
    const opps: TestOpp[] = [
      makeConnectorFlowOpp('cf-1', viewerId, 'a', 'b'),
      makeConnectionOpp('exp-1', viewerId, 'c', 'expired'),
      makeConnectionOpp('conn-1', viewerId, 'd'),
      makeConnectorFlowOpp('cf-2', viewerId, 'e', 'f'),
      makeConnectionOpp('conn-2', viewerId, 'g'),
      makeConnectionOpp('exp-2', viewerId, 'h', 'expired'),
    ];

    const result = selectByComposition(opps, viewerId);
    const categories = result.map((o) => classifyOpportunity(o, viewerId));

    // Verify no interleaving: once we see a later category, we shouldn't see an earlier one again
    const categoryOrder: string[] = [];
    for (const cat of categories) {
      if (categoryOrder.length === 0 || categoryOrder[categoryOrder.length - 1] !== cat) {
        categoryOrder.push(cat);
      }
    }
    // Valid orderings: just connections, connections then connector-flow, etc.
    const validOrder = ['connection', 'connector-flow', 'expired'];
    for (let i = 1; i < categoryOrder.length; i++) {
      const prevIdx = validOrder.indexOf(categoryOrder[i - 1]);
      const currIdx = validOrder.indexOf(categoryOrder[i]);
      expect(currIdx).toBeGreaterThan(prevIdx);
    }
  });
});
