/**
 * The radar's "asking you first" recognition, over task rows alone.
 *
 * Hermetic by design: this is the boundary that decides whether one agent's
 * private pre-contact doubt about a never-contacted counterparty is shown, and
 * to whom, so it must be provable without a database (the same reason
 * `negotiation-lifecycle.projection.ts` is a pure module).
 *
 * Everything the projection may claim comes from the park itself. The cases
 * below are the four ways a task can look like a park without being one:
 * a mid-flight consult (contact already happened), a resumed or expired park,
 * the counterparty's own park, and a park missing its binding.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it } from 'bun:test';

import { collectAskingFirstStates } from '../asking-first.projection';

const VIEWER = 'user-owner';
const COUNTERPARTY = 'user-counterparty';
const INTENT = 'intent-owner';
const OPPORTUNITY = 'opp-1';
const PARKED_AT = new Date('2026-08-18T09:30:00.000Z');

function binding(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    settlementId: 'settlement-1',
    recipientUserId: VIEWER,
    recipientIntentId: INTENT,
    opportunityId: OPPORTUNITY,
    networkId: 'net-1',
    intentFingerprint: 'fingerprint',
    opportunityStatus: 'negotiating',
    opportunityUpdatedAt: PARKED_AT.toISOString(),
    counterpartyUserId: COUNTERPARTY,
    counterpartyIntentId: 'intent-counterparty',
    ...overrides,
  };
}

/** A turn-0 park: the `preContactConsult` stamp is what makes it pre-contact. */
function preContactPark(overrides: {
  id?: string;
  state?: string;
  turnContext?: Record<string, unknown>;
  binding?: Record<string, unknown>;
} = {}) {
  return {
    id: overrides.id ?? 'task-1',
    state: overrides.state ?? 'input_required',
    metadata: {
      type: 'negotiation',
      opportunityId: OPPORTUNITY,
      turnContext: {
        preContactConsult: true,
        consultationPolicyReason: 'unresolved_owner_constraint',
        seedAssessment: {
          reasoning: 'Strong general AI depth, but the stated criterion reads academic.',
          valencyRole: 'peer',
        },
        askUserBinding: binding(overrides.binding),
        ...overrides.turnContext,
      },
    } as Record<string, unknown>,
    updatedAt: PARKED_AT,
  };
}

describe('collectAskingFirstStates — a pre-contact park', () => {
  it('projects the signal, the category, and what the agent saw', () => {
    const states = collectAskingFirstStates([preContactPark()], VIEWER);

    expect(states.get(OPPORTUNITY)).toEqual({
      intentId: INTENT,
      reason: 'unresolved_owner_constraint',
      whatFit: 'Strong general AI depth, but the stated criterion reads academic.',
      askedAt: PARKED_AT.toISOString(),
    });
  });

  it('carries the signal even when the park recorded no reason or assessment', () => {
    // The card degrades to headline + not-contacted line + link; the question
    // itself lives in the DM either way, so the deep link is the only field
    // the state cannot do without.
    const bare = preContactPark();
    bare.metadata.turnContext = { preContactConsult: true, askUserBinding: binding() };

    expect(collectAskingFirstStates([bare], VIEWER).get(OPPORTUNITY)).toEqual({
      intentId: INTENT,
      askedAt: PARKED_AT.toISOString(),
    });
  });

  it('bounds the what-fit line rather than shipping a whole assessment', () => {
    const long = preContactPark();
    (long.metadata.turnContext as Record<string, unknown>).seedAssessment = {
      reasoning: 'x'.repeat(2000),
      valencyRole: 'peer',
    };

    const whatFit = collectAskingFirstStates([long], VIEWER).get(OPPORTUNITY)?.whatFit ?? '';
    expect(whatFit.length).toBeLessThanOrEqual(244);
    expect(whatFit.length).toBeGreaterThan(0);
  });
});

describe('collectAskingFirstStates — what is not a pre-contact park', () => {
  it('excludes a mid-flight consult: the counterparty has already been contacted', () => {
    // Same park shape, no stamp. Claiming "not contacted" here would be a lie,
    // and #1445's cap does not count these either.
    const midFlight = preContactPark();
    midFlight.metadata.turnContext = {
      consultationPolicyReason: 'repeated_non_convergence',
      askUserBinding: binding(),
    };

    expect(collectAskingFirstStates([midFlight], VIEWER).size).toBe(0);
  });

  it('excludes a park that has already resumed, answered or expired', () => {
    // The park IS the state. `input_required` is the whole of it, so a task
    // the answer or the expiry moved on carries no card — this is the entire
    // lifecycle, with nothing stored and nothing to retire.
    for (const state of ['working', 'completed', 'failed', 'canceled']) {
      expect(collectAskingFirstStates([preContactPark({ state })], VIEWER).size).toBe(0);
    }
  });

  it('excludes the counterparty’s own park, and shows nobody else’s to anybody', () => {
    // A pre-contact park is one client's private doubt. The binding names the
    // only user entitled to it; every other viewer sees an ordinary card.
    const park = preContactPark();

    expect(collectAskingFirstStates([park], COUNTERPARTY).size).toBe(0);
    expect(collectAskingFirstStates([park], '').size).toBe(0);
    expect(collectAskingFirstStates(
      [preContactPark({ binding: { recipientUserId: COUNTERPARTY } })],
      VIEWER,
    ).size).toBe(0);
  });

  it('excludes a park whose binding is missing or malformed', () => {
    const noBinding = preContactPark();
    noBinding.metadata.turnContext = { preContactConsult: true };
    const noIntent = preContactPark({ binding: { recipientIntentId: '  ' } });
    const noOpportunity = preContactPark({ binding: { opportunityId: null } });

    expect(collectAskingFirstStates([noBinding, noIntent, noOpportunity], VIEWER).size).toBe(0);
  });

  it('keeps one state per opportunity when two parks name it', () => {
    const newer = preContactPark({ id: 'task-newer' });
    const older = preContactPark({ id: 'task-older', binding: { recipientIntentId: 'intent-other' } });

    // Tasks arrive newest-first; a card carries one question.
    const states = collectAskingFirstStates([newer, older], VIEWER);
    expect(states.size).toBe(1);
    expect(states.get(OPPORTUNITY)?.intentId).toBe(INTENT);
  });
});
