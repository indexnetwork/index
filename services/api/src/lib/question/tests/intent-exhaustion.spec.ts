/**
 * Own-intent exhaustion predicate: pure classification of every
 * `OpportunityStatus` value, so the concept "no negotiation on this intent is
 * ongoing" is pinned in code rather than living only in the plan
 * (docs/plans/2026-08-18-conversational-questions.md).
 */
import { describe, expect, it } from 'bun:test';

import type { OpportunityStatus } from '@indexnetwork/protocol';

import { isIntentExhausted, isOngoingNegotiationStatus } from '../intent-exhaustion';

const ALL_STATUSES: OpportunityStatus[] = [
  'latent', 'draft', 'negotiating', 'pending', 'stalled', 'accepted', 'rejected', 'expired',
];

describe('isOngoingNegotiationStatus', () => {
  const expected: Record<OpportunityStatus, boolean> = {
    // Discovery candidates: no agent turn is scheduled by state alone.
    latent: false,
    draft: false,
    // The only state in which an agent turn is scheduled or running.
    negotiating: true,
    // Owner-approval gate, not a running negotiation.
    pending: false,
    // Post-stall park or terminal stall; either way the agents' turns ended.
    stalled: false,
    // Terminal.
    accepted: false,
    rejected: false,
    expired: false,
  };

  for (const status of ALL_STATUSES) {
    it(`classifies '${status}' as ${expected[status] ? 'ongoing' : 'not ongoing'}`, () => {
      expect(isOngoingNegotiationStatus(status)).toBe(expected[status]);
    });
  }
});

describe('isIntentExhausted', () => {
  it('an intent with no opportunities is trivially exhausted', () => {
    expect(isIntentExhausted([])).toBe(true);
  });

  it('one ongoing negotiation holds exhaustion off', () => {
    expect(isIntentExhausted(['stalled', 'accepted', 'negotiating', 'expired'])).toBe(false);
  });

  it('parked and terminal states never hold the message hostage', () => {
    expect(isIntentExhausted(['stalled', 'stalled', 'pending', 'accepted', 'rejected', 'expired'])).toBe(true);
  });

  it('pool candidates alone leave the intent exhausted', () => {
    expect(isIntentExhausted(['latent', 'draft'])).toBe(true);
  });
});
