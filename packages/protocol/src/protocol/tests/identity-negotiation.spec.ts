import { describe, expect, test } from 'bun:test';
import { decideNegotiationOpening, decideNegotiationTurn, decideNegotiationResume, type NegotiationState } from '../negotiation.rules.js';
import { identityPairKeyOf, pairKeyOf } from '../../internal/opportunities/opportunity.counterparties.js';
import { admitOpportunityEvent, type OpportunityLogEvent } from '../../internal/opportunities/opportunity.events.js';

describe('intent-to-identity protocol compatibility', () => {
  test('identity introductions deduplicate without colliding with intent pairs or reversed roles', () => {
    expect(identityPairKeyOf('n', 'a', 'b')).toBe(identityPairKeyOf('n', 'a', 'b'));
    expect(identityPairKeyOf('n', 'a', 'b')).not.toBe(pairKeyOf('n', 'a', 'b'));
    expect(identityPairKeyOf('n', 'a', 'b')).not.toBe(identityPairKeyOf('n', 'b', 'a'));
    expect(identityPairKeyOf('n', 'a:b', 'c')).not.toBe(identityPairKeyOf('n', 'a', 'b:c'));
  });

  test('opening needs eligible distinct people, but no recipient intent', () => {
    const pair = { userA: 'a', userB: 'b', intentA: 'intent', intentB: null, eligible: true };
    expect(decideNegotiationOpening(pair)).toEqual({ awaitingUserId: 'a', opportunityStatus: 'negotiating' });
    expect(decideNegotiationOpening({ ...pair, eligible: false })).toBeNull();
    expect(decideNegotiationOpening({ ...pair, userB: 'a' })).toBeNull();
  });

  test('the same proposal, counter, acceptance and human commitment rules apply', () => {
    const state: NegotiationState = { initiatorUserId: 'a', responderUserId: 'b', awaitingUserId: 'a', outcome: null, settled: false, eligible: true, turns: [] };
    const offer = { action: 'propose' as const, message: 'Would discussing this be useful?' };
    expect(decideNegotiationTurn(state, 'a', offer)).toMatchObject({ ok: true, awaitingUserId: 'b' });
    state.turns.push({ seatUserId: 'a', ...offer }); state.awaitingUserId = 'b';
    expect(decideNegotiationTurn(state, 'intruder', { action: 'accept', message: 'Yes' })).toEqual({ ok: false, rejection: 'not_a_seat' });
    expect(decideNegotiationTurn(state, 'b', { action: 'accept', message: 'Worth discussing.' })).toMatchObject({ ok: true, outcome: 'agreed', opportunityStatus: 'pending' });
    const events: OpportunityLogEvent[] = [{ type: 'opened', actorUserId: null }, { type: 'agreed', actorUserId: null }];
    expect(admitOpportunityEvent(events, ['a', 'b'], { type: 'committed', actorUserId: 'b' })).toMatchObject({ ok: true, projection: { status: 'pending' } });
    events.push({ type: 'committed', actorUserId: 'b' });
    expect(admitOpportunityEvent(events, ['a', 'b'], { type: 'committed', actorUserId: 'a' })).toMatchObject({ ok: true, projection: { status: 'accepted' } });
  });

  test('decline pauses; an inactive initiating intent blocks resumption; rejection and expiry remain terminal', () => {
    const state: NegotiationState = { initiatorUserId: 'a', responderUserId: 'b', awaitingUserId: 'b', outcome: null, settled: false, eligible: true, turns: [{ seatUserId: 'a', action: 'propose', message: 'Meet?' }] };
    expect(decideNegotiationTurn(state, 'b', { action: 'decline', message: 'Not now.' })).toMatchObject({ ok: true, roundEnded: 'declined', outcome: null });
    state.awaitingUserId = null;
    expect(decideNegotiationResume(state, 'b')).toEqual({ ok: true, awaitingUserId: 'b' });
    state.eligible = false;
    expect(decideNegotiationResume(state, 'b')).toEqual({ ok: false, rejection: 'intent_inactive' });
    for (const type of ['declined', 'expired'] as const) {
      expect(admitOpportunityEvent([{ type: 'opened', actorUserId: null }, { type, actorUserId: null }], ['a', 'b'], { type: 'committed', actorUserId: 'b' }).ok).toBe(false);
    }
  });
});
