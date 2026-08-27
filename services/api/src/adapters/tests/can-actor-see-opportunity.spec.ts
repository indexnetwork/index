/**
 * Unit tests for `canActorSeeOpportunity` — the access-control predicate that
 * gates which actor may see an opportunity card. Role- and status-based
 * staggered visibility (agent-last/patient-first) was a function of the
 * evaluator's valency judgment; now that the evaluator is gone, only actor
 * membership gates visibility.
 *
 * Pure function, no DB. Pins the security chokepoint surfaced in the PR #1029
 * review after the adapter split moved it into `database.shared.ts`.
 */
import { describe, expect, it } from 'bun:test';

import { canActorSeeOpportunity } from '../opportunity.visibility';

const ME = 'user-me';
const OTHER = 'user-other';
const INTRODUCER = 'user-introducer';

const as = (role: string, userId = ME) => ({ userId, role });
const withIntroducer = (...actors: Array<{ userId: string; role: string }>) => [
  ...actors,
  as('introducer', INTRODUCER),
];

const ALL_STATUSES = ['latent', 'pending', 'accepted', 'rejected', 'expired'];

describe('canActorSeeOpportunity', () => {
  describe('non-actor', () => {
    it('returns false when the user is not one of the actors', () => {
      const actors = [as('patient', OTHER), as('agent', 'user-x')];
      for (const status of ALL_STATUSES) {
        expect(canActorSeeOpportunity(actors, status, ME)).toBe(false);
      }
    });

    it('returns false for an empty actor list', () => {
      expect(canActorSeeOpportunity([], 'accepted', ME)).toBe(false);
    });
  });

  describe('any actor sees immediately, regardless of role or status', () => {
    for (const role of ['introducer', 'peer', 'patient', 'party', 'agent']) {
      it(`${role} sees at every status`, () => {
        for (const status of ALL_STATUSES) {
          expect(canActorSeeOpportunity([as(role)], status, ME)).toBe(true);
          expect(canActorSeeOpportunity(withIntroducer(as(role)), status, ME)).toBe(true);
        }
      });
    }
  });

  describe('multiple roles for the same user', () => {
    it('sees regardless of which of the user\'s roles is checked', () => {
      const actors = withIntroducer(as('agent'), as('peer'));
      expect(canActorSeeOpportunity(actors, 'latent', ME)).toBe(true);
    });
  });
});
