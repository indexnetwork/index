/**
 * Unit tests for `canActorSeeOpportunity` — the access-control predicate that
 * gates which actor may see an opportunity card by their role(s), the
 * opportunity status, and whether an introducer is involved.
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

  describe('introducer & peer always see, regardless of status', () => {
    it('introducer sees at every status', () => {
      for (const status of ALL_STATUSES) {
        expect(canActorSeeOpportunity([as('introducer')], status, ME)).toBe(true);
      }
    });

    it('peer sees at every status (with or without an introducer present)', () => {
      for (const status of ALL_STATUSES) {
        expect(canActorSeeOpportunity([as('peer'), as('peer', OTHER)], status, ME)).toBe(true);
        expect(canActorSeeOpportunity(withIntroducer(as('peer')), status, ME)).toBe(true);
      }
    });
  });

  describe('patient / party', () => {
    it('sees a latent opportunity when there is no introducer', () => {
      expect(canActorSeeOpportunity([as('patient'), as('agent', OTHER)], 'latent', ME)).toBe(true);
      expect(canActorSeeOpportunity([as('party'), as('party', OTHER)], 'latent', ME)).toBe(true);
    });

    it('is hidden from a latent opportunity once an introducer is involved', () => {
      expect(canActorSeeOpportunity(withIntroducer(as('patient')), 'latent', ME)).toBe(false);
      expect(canActorSeeOpportunity(withIntroducer(as('party')), 'latent', ME)).toBe(false);
    });

    it('sees every non-latent status even with an introducer involved', () => {
      for (const status of ['pending', 'accepted', 'rejected', 'expired']) {
        expect(canActorSeeOpportunity(withIntroducer(as('patient')), status, ME)).toBe(true);
        expect(canActorSeeOpportunity(withIntroducer(as('party')), status, ME)).toBe(true);
      }
    });
  });

  describe('agent', () => {
    it('is hidden from a latent opportunity (introducer or not)', () => {
      expect(canActorSeeOpportunity([as('agent'), as('patient', OTHER)], 'latent', ME)).toBe(false);
      expect(canActorSeeOpportunity(withIntroducer(as('agent')), 'latent', ME)).toBe(false);
    });

    it('sees a pending opportunity only when there is no introducer', () => {
      expect(canActorSeeOpportunity([as('agent'), as('patient', OTHER)], 'pending', ME)).toBe(true);
      expect(canActorSeeOpportunity(withIntroducer(as('agent')), 'pending', ME)).toBe(false);
    });

    it('sees terminal statuses (accepted/rejected/expired) even with an introducer', () => {
      for (const status of ['accepted', 'rejected', 'expired']) {
        expect(canActorSeeOpportunity(withIntroducer(as('agent')), status, ME)).toBe(true);
      }
    });
  });

  describe('multiple roles for the same user', () => {
    it('sees if ANY of the user\'s roles grants visibility', () => {
      // agent alone would be hidden from a latent+introducer card, but peer always sees.
      const actors = withIntroducer(as('agent'), as('peer'));
      expect(canActorSeeOpportunity(actors, 'latent', ME)).toBe(true);
    });
  });
});
