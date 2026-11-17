import { describe, expect, test } from 'bun:test';
import { finalizeEvent, type NostrEvent } from 'nostr-tools/pure';

import { createAuthTag } from '../src/attestation.js';
import { generateKeypair, type Keypair } from '../src/keys.js';
import { KIND } from '../src/kinds.js';
import { NegotiationLedger, negotiationOpenTemplate, replayNegotiation, signTurn, type TurnContent } from '../src/negotiation.js';

const host = generateKeypair();
const alice = generateKeypair();
const bob = generateKeypair();
const bobAgent = generateKeypair();
const NEGOTIATION = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b';

function opening(): NostrEvent {
  return finalizeEvent(negotiationOpenTemplate({
    negotiationId: NEGOTIATION,
    networkId: 'goa',
    seats: [
      { principal: alice.pubkey, negotiator: alice.pubkey, intent: { address: `31641:${alice.pubkey}:a`, text: 'Need a Rust engineer', visibility: 'network_only' } },
      { principal: bob.pubkey, negotiator: bobAgent.pubkey, intent: { address: `31641:${bobAgent.pubkey}:b`, text: null, visibility: 'incognito' } },
    ],
    maxTurns: 12,
    messageLimit: 4000,
  }), host.secretKey);
}

function turn(ledger: NegotiationLedger, by: Keypair, counterparty: string, content: TurnContent, extra: { previousId?: string; owner?: Keypair } = {}) {
  return signTurn({
    negotiationId: NEGOTIATION,
    previousId: extra.previousId ?? ledger.headId,
    counterparty,
    turn: content,
    authTag: extra.owner ? createAuthTag(extra.owner.secretKey, by.pubkey, `kind=${KIND.NEGOTIATION_TURN}`) : undefined,
  }, by.secretKey);
}

describe('NegotiationLedger', () => {
  test('propose then accept by an attested agent settles as agreed', () => {
    const ledger = new NegotiationLedger(opening(), host.pubkey);
    const propose = turn(ledger, alice, bob.pubkey, { action: 'propose', message: 'Intro to talk Rust relays?' });
    expect(ledger.apply(propose)).toMatchObject({ ok: true, turnIndex: 0, awaiting: bob.pubkey });
    const accept = turn(ledger, bobAgent, alice.pubkey, { action: 'accept', message: 'Yes' }, { owner: bob });
    expect(ledger.apply(accept)).toMatchObject({ ok: true, outcome: 'agreed', awaiting: null });
    expect(ledger.settled).toBe(true);
    expect(ledger.agreedProposal()).toEqual({ proposer: alice.pubkey, message: 'Intro to talk Rust relays?', acceptTurnId: accept.id });

    const replay = replayNegotiation(ledger.openEvent, [propose, accept], host.pubkey);
    expect(replay.refused).toBeNull();
    expect(replay.ledger.outcome).toBe('agreed');
  });

  test('applies Index rules: turn order, offers, races and seat keys', () => {
    const ledger = new NegotiationLedger(opening(), host.pubkey);
    expect(ledger.apply(turn(ledger, bob, alice.pubkey, { action: 'propose', message: 'me first' }))).toEqual({ ok: false, rejection: 'not_your_turn' });
    expect(ledger.apply(turn(ledger, alice, bob.pubkey, { action: 'counter', message: 'hm' }))).toEqual({ ok: false, rejection: 'counter_is_first' });
    expect(ledger.apply(turn(ledger, alice, bob.pubkey, { action: 'accept', message: 'ok' }))).toEqual({ ok: false, rejection: 'accept_without_offer' });
    expect(ledger.apply(turn(ledger, alice, bob.pubkey, { action: 'propose', message: '' }))).toEqual({ ok: false, rejection: 'invalid_turn' });
    const stranger = generateKeypair();
    expect(ledger.apply(turn(ledger, stranger, bob.pubkey, { action: 'propose', message: 'hi' }))).toEqual({ ok: false, rejection: 'not_a_seat' });
    // An agent Bob attested, but not the negotiator the host addressed.
    const otherAgent = generateKeypair();
    const first = turn(ledger, alice, bob.pubkey, { action: 'propose', message: 'hi' });
    expect(ledger.apply(first).ok).toBe(true);
    expect(ledger.apply(turn(ledger, otherAgent, alice.pubkey, { action: 'accept', message: 'y' }, { owner: bob }))).toEqual({ ok: false, rejection: 'not_a_seat_key' });
    // A turn that names a stale head lost a race.
    expect(ledger.apply(turn(ledger, bob, alice.pubkey, { action: 'accept', message: 'y' }, { previousId: ledger.openEvent.id }))).toEqual({ ok: false, rejection: 'raced' });
    expect(ledger.apply(first)).toMatchObject({ ok: true, replayed: true, turnIndex: 0 });
    // Tampering breaks the signature.
    const tampered = { ...turn(ledger, bob, alice.pubkey, { action: 'accept', message: 'y' }), content: '{"action":"decline","message":"n"}' };
    expect(ledger.apply(tampered)).toEqual({ ok: false, rejection: 'bad_signature' });
  });

  test('a decline pauses the pair until a seat resumes it', () => {
    const ledger = new NegotiationLedger(opening(), host.pubkey);
    expect(ledger.apply(turn(ledger, alice, bob.pubkey, { action: 'propose', message: 'offer' })).ok).toBe(true);
    expect(ledger.apply(turn(ledger, bob, alice.pubkey, { action: 'decline', message: 'not now' }))).toMatchObject({ ok: true, roundEnded: 'declined', awaiting: null });
    expect(ledger.settled).toBe(false);
    expect(ledger.apply(turn(ledger, bob, alice.pubkey, { action: 'propose', message: 'actually, yes' }))).toMatchObject({ ok: true, awaiting: alice.pubkey });
    expect(ledger.apply(turn(ledger, alice, bob.pubkey, { action: 'accept', message: 'great' }))).toMatchObject({ ok: true, outcome: 'agreed' });
  });

  test('a retried clientTurnId replays instead of failing', () => {
    const ledger = new NegotiationLedger(opening(), host.pubkey);
    const clientTurnId = '0b9e1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d';
    expect(ledger.apply(turn(ledger, alice, bob.pubkey, { action: 'propose', message: 'offer', clientTurnId })).ok).toBe(true);
    const retry = signTurn({ negotiationId: NEGOTIATION, previousId: ledger.openEvent.id, counterparty: bob.pubkey, turn: { action: 'propose', message: 'offer', clientTurnId }, createdAt: 1 }, alice.secretKey);
    expect(ledger.apply(retry)).toMatchObject({ ok: true, replayed: true, turnIndex: 0 });
  });

  test('refuses openings not signed by the host', () => {
    const forged = finalizeEvent(negotiationOpenTemplate(JSON.parse(opening().content)), alice.secretKey);
    expect(() => new NegotiationLedger(forged, host.pubkey)).toThrow('not signed by the host');
  });
});
