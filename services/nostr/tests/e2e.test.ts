import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { KIND, addMembersTemplate, createAuthTag, createIntent, createNetworkTemplate, generateKeypair, joinNetworkTemplate, opportunityResponseTemplate, parseNegotiationOpen, parseOpportunity, replayNegotiation, signAndWrap, signTurn, type Keypair } from '@indexnetwork/nostr';
import { finalizeEvent, type NostrEvent } from 'nostr-tools/pure';
import type { Relay as NostrRelay } from 'nostr-tools/relay';

import { startApp, type App } from '../src/app.js';
import { connectAuthed } from '../src/client.js';
import type { Config } from '../src/config.js';
import { Inbox } from '../src/inbox.js';

const BUZZ_CHANNEL = '0e7a8f3c-1d2b-4c5e-9f60-718293a4b5c6';

function config(overrides: Partial<Config> = {}): Config {
  return {
    port: 0, dataDir: ':memory:', publicUrl: null, relayName: 'test', relayKey: generateKeypair(), hostKey: generateKeypair(),
    discovery: 'lexical', discoveryThreshold: 0.2, buzz: null, ...overrides,
  };
}

async function publish(relay: NostrRelay, event: NostrEvent): Promise<string> {
  return relay.publish(event);
}

const alice = generateKeypair();
const bob = generateKeypair();
const bobAgent = generateKeypair();
const carol = generateKeypair();

let buzz: App;
let index: App;
let host: Keypair;

beforeAll(async () => {
  buzz = await startApp(config({ discovery: 'off' }));
  host = generateKeypair();
  // Alice starts a Buzz channel and invites Bob and the Index bot, like a community admin would.
  const aliceOnBuzz = await connectAuthed(buzz.url, alice);
  await publish(aliceOnBuzz, finalizeEvent(createNetworkTemplate({ id: BUZZ_CHANNEL, name: 'rustaceans', joinPolicy: 'invite_only' }), alice.secretKey));
  await publish(aliceOnBuzz, finalizeEvent(addMembersTemplate(BUZZ_CHANNEL, [bob.pubkey, host.pubkey]), alice.secretKey));
  aliceOnBuzz.close();
  index = await startApp(config({
    hostKey: host,
    buzz: { relayUrl: buzz.url, channelId: BUZZ_CHANNEL, networkId: 'buzz-rust', relayPubkey: null },
  }));
});

afterAll(async () => {
  await index?.stop();
  await buzz?.stop();
});

describe('Index on Nostr, end to end', () => {
  test('relay basics: NIP-11, AUTH, and refusals', async () => {
    const info = await fetch(index.url.replace('ws', 'http'), { headers: { Accept: 'application/nostr+json' } }).then((r) => r.json()) as { index: { host_pubkey: string } };
    expect(info.index.host_pubkey).toBe(host.pubkey);

    const carolRelay = await connectAuthed(index.url, carol);
    // Index negotiation kinds never travel in the clear.
    const clearTurn = signTurn({ negotiationId: crypto.randomUUID(), previousId: 'a'.repeat(64), counterparty: alice.pubkey, turn: { action: 'propose', message: 'x' } }, carol.secretKey);
    await expect(publish(carolRelay, clearTurn)).rejects.toThrow('only travels inside a gift wrap');
    // Unknown kinds are refused.
    await expect(publish(carolRelay, finalizeEvent({ kind: 1, created_at: Math.floor(Date.now() / 1000), tags: [], content: 'hi' }, carol.secretKey))).rejects.toThrow('not accepted');
    // You can't post into a network you're not in.
    const stray = createIntent({ id: 'stray', text: 'x', visibility: 'network_only', networks: ['buzz-rust'] }, carol.secretKey, { hostPubkey: host.pubkey });
    await expect(publish(carolRelay, stray.intent)).rejects.toThrow('not a member');
    carolRelay.close();
  });

  test('the Buzz bridge mirrors the channel into an Index network', async () => {
    const deadline = Date.now() + 5000;
    while (index.relay.groups.members('buzz-rust').length < 3 && Date.now() < deadline) await Bun.sleep(25);
    expect(index.relay.groups.members('buzz-rust').sort()).toEqual([alice.pubkey, bob.pubkey, host.pubkey].sort());
    expect(index.bridge?.status.connected).toBe(true);
  });

  test('intents → negotiation → opportunity → introduction, across Index and Buzz', async () => {
    const aliceInbox = await Inbox.open(index.url, alice);
    const bobInbox = await Inbox.open(index.url, bob);
    const bobAgentAuth = createAuthTag(bob.secretKey, bobAgent.pubkey);
    const agentInbox = await Inbox.open(index.url, bobAgent, bobAgentAuth);
    const aliceBuzz = await Inbox.open(buzz.url, alice);
    const bobBuzz = await Inbox.open(buzz.url, bob);

    // An open Index network too, to check join rules.
    await publish(aliceInbox.relay, finalizeEvent(createNetworkTemplate({ id: 'goa', name: 'Goa', joinPolicy: 'anyone' }), alice.secretKey));
    await publish(bobInbox.relay, finalizeEvent(joinNetworkTemplate('goa'), bob.secretKey));
    expect(index.relay.groups.isMember('goa', bob.pubkey)).toBe(true);

    // Alice: network-only intent in the Buzz-mirrored network.
    const aliceIntent = createIntent({ id: 'alice-rust', text: 'Hiring a Rust engineer to build a Nostr relay', visibility: 'network_only', networks: ['buzz-rust'] }, alice.secretKey, { hostPubkey: host.pubkey });
    await publish(aliceInbox.relay, aliceIntent.publish[0]!);

    // Carol can't read it; Bob's agent, authenticated as acting for Bob, can.
    const carolRelay = await connectAuthed(index.url, carol);
    const carolSees = await new Promise<number>((resolve) => {
      let count = 0;
      carolRelay.subscribe([{ kinds: [KIND.INTENT] }], { onevent: () => { count += 1; }, oneose: () => resolve(count) });
    });
    expect(carolSees).toBe(0);
    carolRelay.close();
    const agentSees = await new Promise<number>((resolve) => {
      let count = 0;
      agentInbox.relay.subscribe([{ kinds: [KIND.INTENT], '#h': ['buzz-rust'] }], { onevent: () => { count += 1; }, oneose: () => resolve(count) });
    });
    expect(agentSees).toBe(1);

    // Bob's agent: incognito intent, wrapped to the host only.
    const bobIntent = createIntent({ id: 'bob-rust', text: 'Rust engineer open to building Nostr relay infrastructure', visibility: 'incognito', networks: ['buzz-rust'] }, bobAgent.secretKey, {
      hostPubkey: host.pubkey, authTag: createAuthTag(bob.secretKey, bobAgent.pubkey, `kind=${KIND.INTENT}`),
    });
    await publish(agentInbox.relay, bobIntent.publish[0]!);

    // The host opens a negotiation; Bob's newer intent moves first.
    const openForAgent = await agentInbox.waitFor((e) => e.kind === KIND.NEGOTIATION_OPEN, 'opening (agent)');
    const openForAlice = await aliceInbox.waitFor((e) => e.kind === KIND.NEGOTIATION_OPEN, 'opening (alice)');
    expect(openForAlice.id).toBe(openForAgent.id);
    const open = parseNegotiationOpen(openForAgent, host.pubkey);
    if (!open.ok) throw new Error(open.reason);
    expect(open.open.seats[0].principal).toBe(bob.pubkey);
    expect(open.open.seats[0].intent.text).toBeNull(); // incognito stays hidden from Alice
    expect(open.open.seats[1].intent.text).toBe('Hiring a Rust engineer to build a Nostr relay');

    const negotiationId = open.open.negotiationId;
    // Bob's agent proposes, wrapping the turn to the host only.
    const propose = signTurn({ negotiationId, previousId: openForAgent.id, counterparty: alice.pubkey, turn: { action: 'propose', message: 'Bob has shipped two relays; worth a call.' }, authTag: createAuthTag(bob.secretKey, bobAgent.pubkey, `kind=${KIND.NEGOTIATION_TURN}`) }, bobAgent.secretKey);
    await publish(agentInbox.relay, signAndWrap(propose, bobAgent.secretKey, host.pubkey).wrap);
    // An out-of-turn move from Alice is refused with a reason.
    const early = signTurn({ negotiationId, previousId: openForAgent.id, counterparty: bob.pubkey, turn: { action: 'propose', message: 'me too' } }, alice.secretKey);
    // Alice receives Bob's signed turn through the host, then accepts.
    const relayed = await aliceInbox.waitForStatus(host.pubkey, (s) => s.type === 'turn' && s.accepted && s.turnIndex === 0, 'relayed turn');
    expect(relayed.type === 'turn' && relayed.turn?.id).toBe(propose.id);
    await publish(aliceInbox.relay, signAndWrap(early, alice.secretKey, host.pubkey).wrap);
    const refused = await aliceInbox.waitForStatus(host.pubkey, (s) => s.type === 'turn' && !s.accepted, 'refusal');
    expect(refused.type === 'turn' && refused.rejection).toBe('raced');
    const accept = signTurn({ negotiationId, previousId: propose.id, counterparty: bob.pubkey, turn: { action: 'accept', message: 'Yes, intro please.' } }, alice.secretKey);
    await publish(aliceInbox.relay, signAndWrap(accept, alice.secretKey, host.pubkey).wrap);

    // Anyone holding the transcript can check it against Index's rules.
    const replay = replayNegotiation(openForAgent, [propose, accept], host.pubkey);
    expect(replay.refused).toBeNull();
    expect(replay.ledger.outcome).toBe('agreed');

    // Each person gets their own copy of the opportunity, on their own key.
    const aliceOpp = parseOpportunity(await aliceInbox.waitFor((e) => e.kind === KIND.OPPORTUNITY, 'alice opportunity'), host.pubkey);
    const bobOpp = parseOpportunity(await bobInbox.waitFor((e) => e.kind === KIND.OPPORTUNITY, 'bob opportunity'), host.pubkey);
    if (!aliceOpp.ok || !bobOpp.ok) throw new Error('bad opportunity');
    expect(aliceOpp.opportunity.headline).toContain('incognito');
    expect(bobOpp.opportunity.headline).toContain('Hiring a Rust engineer');

    // And a card in Buzz.
    const card = await aliceBuzz.waitFor((e) => e.kind === KIND.PRIVATE_DM, 'buzz card');
    expect(card.content).toContain('New opportunity on Index');

    // Bob's agent can't accept for him.
    const agentAnswer = finalizeEvent(opportunityResponseTemplate({ opportunityId: bobOpp.opportunity.opportunityId, opportunityEventId: bobOpp.event.id, decision: 'accept' }), bobAgent.secretKey);
    await publish(agentInbox.relay, signAndWrap(agentAnswer, bobAgent.secretKey, host.pubkey).wrap);
    const notParty = await agentInbox.waitForStatus(host.pubkey, (s) => s.type === 'opportunity' && s.rejection === 'not_a_party', 'agent refused');
    expect(notParty.type).toBe('opportunity');

    for (const [person, inbox, opp] of [[alice, aliceInbox, aliceOpp], [bob, bobInbox, bobOpp]] as const) {
      const answer = finalizeEvent(opportunityResponseTemplate({ opportunityId: opp.opportunity.opportunityId, opportunityEventId: opp.event.id, decision: 'accept' }), person.secretKey);
      await publish(inbox.relay, signAndWrap(answer, person.secretKey, host.pubkey).wrap);
    }
    await aliceInbox.waitForStatus(host.pubkey, (s) => s.type === 'opportunity' && s.status === 'connected', 'connected');
    const intro = await bobInbox.waitFor((e) => e.kind === KIND.PRIVATE_DM, 'intro DM');
    expect(intro.content).toContain('You both said yes');

    // On Buzz, a private channel now holds the two of them.
    const deadline = Date.now() + 5000;
    let channel = buzz.relay.groups.list().find((group) => group.name.startsWith('index-intro-'));
    while (!channel && Date.now() < deadline) {
      await Bun.sleep(25);
      channel = buzz.relay.groups.list().find((group) => group.name.startsWith('index-intro-'));
    }
    expect(channel?.joinPolicy).toBe('invite_only');
    expect(buzz.relay.groups.members(channel!.id).sort()).toEqual([alice.pubkey, bob.pubkey, host.pubkey].sort());
    expect(index.host.state.counts()).toMatchObject({ negotiations: 1, turns: 2, opportunities: 1, connected: 1 });

    for (const inbox of [aliceInbox, bobInbox, agentInbox, aliceBuzz, bobBuzz]) inbox.close();
  }, 20_000);
});
