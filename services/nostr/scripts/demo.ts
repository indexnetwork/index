/**
 * Walk the whole Index-on-Nostr loop against a running relay, narrating each step.
 *
 *   bun scripts/demo.ts wss://your-relay.example
 *
 * With a Buzz bridge configured on the node, add `--buzz <buzz-url> <channel>`
 * and run it with the node's HOST_SECRET_KEY (for example via `railway run`):
 * the Index bot admits Alice and Bob to the Buzz community and channel, the
 * match happens in the mirrored network, and the demo checks the opportunity
 * card and the private introduction channel on Buzz.
 *
 * Creates throwaway keys for Alice, Bob and Bob's agent, an open network,
 * two intents (one network-only, one incognito), lets the host match them,
 * negotiates, and has both people accept. Everything it sends is signed
 * Nostr; the printed ids can be fetched from the relay.
 */
import { KIND, addMembersTemplate, createAuthTag, keypairFromSecret, createIntent, createNetworkTemplate, generateKeypair, joinNetworkTemplate, npub, opportunityResponseTemplate, parseNegotiationOpen, parseOpportunity, replayNegotiation, signAndWrap, signTurn } from '@indexnetwork/nostr';
import { finalizeEvent } from 'nostr-tools/pure';

import { connectAuthed } from '../src/client.js';
import { Inbox } from '../src/inbox.js';

const args = process.argv.slice(2);
const buzzAt = args.indexOf('--buzz');
const buzz = buzzAt === -1 ? null : { url: args[buzzAt + 1]!, channel: args[buzzAt + 2]! };
const url = args.find((arg, index) => !arg.startsWith('--') && (buzzAt === -1 || index < buzzAt)) ?? process.env.RELAY_URL ?? 'ws://localhost:3000';
const info = await fetch(url.replace(/^ws/, 'http'), { headers: { Accept: 'application/nostr+json' } }).then((response) => response.json()) as { name: string; index: { host_pubkey: string } };
const hostPubkey = info.index.host_pubkey;
const step = (text: string) => console.log(`\n▸ ${text}`);
const short = (pubkey: string) => `${npub(pubkey).slice(0, 14)}…`;

// A per-run word both intents share, so this run's pair outranks intents left by earlier runs.
const runTag = `run${Date.now().toString(36)}`;
const alice = generateKeypair();
const bob = generateKeypair();
const bobAgent = generateKeypair();
step(`Connected to ${info.name} at ${url}. Host ${short(hostPubkey)}`);
console.log(`  Alice ${short(alice.pubkey)}, Bob ${short(bob.pubkey)}, Bob's agent ${short(bobAgent.pubkey)}`);

const aliceInbox = await Inbox.open(url, alice);
const bobInbox = await Inbox.open(url, bob);
const agentInbox = await Inbox.open(url, bobAgent, createAuthTag(bob.secretKey, bobAgent.pubkey));

let networkId = `demo-${Date.now().toString(36)}`;
let aliceBuzz: Inbox | null = null;
if (buzz) {
  if (!process.env.HOST_SECRET_KEY) throw new Error('--buzz needs HOST_SECRET_KEY (the Index bot admits the demo people to Buzz)');
  const bot = await connectAuthed(buzz.url, keypairFromSecret(process.env.HOST_SECRET_KEY));
  step('On Buzz, the Index bot admits Alice and Bob to the community (kind 9030) and the bridged channel (kind 9000)');
  for (const person of [alice, bob]) await bot.publish(finalizeEvent({ kind: 9030, created_at: Math.floor(Date.now() / 1000), tags: [['p', person.pubkey], ['role', 'member']], content: '' }, keypairFromSecret(process.env.HOST_SECRET_KEY).secretKey));
  // One person per event: older Buzz relays add only the first p tag.
  for (const person of [alice, bob]) await bot.publish(finalizeEvent(addMembersTemplate(buzz.channel, [person.pubkey]), keypairFromSecret(process.env.HOST_SECRET_KEY).secretKey));
  bot.close();
  const networks = await fetch(url.replace(/^ws/, 'http') + '/health').then((response) => response.json()) as { buzz: { networkId: string } | null };
  if (!networks.buzz) throw new Error('this node has no Buzz bridge configured');
  networkId = networks.buzz.networkId;
  step(`The bridge mirrors the channel's relay-signed member list into the Index network "${networkId}"`);
  const deadline = Date.now() + 40000;
  while (Date.now() < deadline) {
    const members = await new Promise<string[]>((resolve) => {
      const sub = aliceInbox.relay.subscribe([{ kinds: [KIND.GROUP_MEMBERS], '#d': [networkId] }], {
        onevent: (event) => { sub.close(); resolve(event.tags.filter((tag) => tag[0] === 'p').map((tag) => tag[1]!)); },
        oneose: () => resolve([]),
      });
    });
    if (members.includes(alice.pubkey) && members.includes(bob.pubkey)) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (Date.now() >= deadline) throw new Error(`the bridge did not mirror Alice and Bob into ${networkId} in time`);
  aliceBuzz = await Inbox.open(buzz.url, alice);
} else {
  step(`Alice creates the open network "${networkId}" (NIP-29 kind 9007); Bob joins (kind 9021)`);
  await aliceInbox.relay.publish(finalizeEvent(createNetworkTemplate({ id: networkId, name: 'Demo network', joinPolicy: 'anyone' }), alice.secretKey));
  await bobInbox.relay.publish(finalizeEvent(joinNetworkTemplate(networkId), bob.secretKey));
}

step('Alice publishes a network-only intent (kind 31641, readable by members only)');
const aliceIntent = createIntent({ id: `${networkId}-alice`, text: `Looking for a designer to shape onboarding for a Nostr client (${runTag})`, visibility: 'network_only', networks: [networkId] }, alice.secretKey, { hostPubkey });
await aliceInbox.relay.publish(aliceIntent.publish[0]!);

step('Bob\'s agent publishes an incognito intent for Bob: gift-wrapped to the host, signed by the agent with Bob\'s NIP-OA attestation');
const bobIntent = createIntent({ id: `${networkId}-bob`, text: `Product designer who loves onboarding flows for Nostr apps (${runTag})`, visibility: 'incognito', networks: [networkId] }, bobAgent.secretKey, {
  hostPubkey, authTag: createAuthTag(bob.secretKey, bobAgent.pubkey, `kind=${KIND.INTENT}`),
});
await agentInbox.relay.publish(bobIntent.publish[0]!);

step('The host matches them and opens a negotiation (kind 4641, wrapped to each negotiator)');
// Other people's intents in the same network may match too; wait for the Alice–Bob pair.
const isOurPair = (event: { kind: number; content: string }) => event.kind === KIND.NEGOTIATION_OPEN && event.content.includes(alice.pubkey) && event.content.includes(bob.pubkey);
const openEvent = await agentInbox.waitFor(isOurPair, 'negotiation opening', 15000);
const open = parseNegotiationOpen(openEvent, hostPubkey);
if (!open.ok) throw new Error(open.reason);
console.log(`  negotiation ${open.open.negotiationId}; first move: ${open.open.seats[0].principal === bob.pubkey ? 'Bob' : 'Alice'}`);
console.log(`  Alice sees Bob's intent as: ${JSON.stringify(open.open.seats.find((seat) => seat.principal === bob.pubkey)!.intent.text)}`);

const [first, second] = open.open.seats[0].principal === bob.pubkey
  ? [{ key: bobAgent, counterparty: alice.pubkey, owner: bob, inbox: agentInbox }, { key: alice, counterparty: bob.pubkey, owner: null, inbox: aliceInbox }]
  : [{ key: alice, counterparty: bob.pubkey, owner: null, inbox: aliceInbox }, { key: bobAgent, counterparty: alice.pubkey, owner: bob, inbox: agentInbox }];
const auth = (side: typeof first) => (side.owner ? createAuthTag(side.owner.secretKey, side.key.pubkey, `kind=${KIND.NEGOTIATION_TURN}`) : undefined);

step('Turn 1: propose (kind 4642, signed by the seat, wrapped to the host)');
const propose = signTurn({ negotiationId: open.open.negotiationId, previousId: openEvent.id, counterparty: first.counterparty, turn: { action: 'propose', message: 'Strong overlap on Nostr onboarding. Suggest a 20-minute call.' }, authTag: auth(first) }, first.key.secretKey);
await first.inbox.relay.publish(signAndWrap(propose, first.key.secretKey, hostPubkey).wrap);
await second.inbox.waitForStatus(hostPubkey, (status) => status.type === 'turn' && status.negotiationId === open.open.negotiationId && status.accepted && status.turnIndex === 0, 'turn 1 relayed');
console.log('  host accepted it and relayed the signed turn to the other seat');

step('Turn 2: accept');
const accept = signTurn({ negotiationId: open.open.negotiationId, previousId: propose.id, counterparty: second.counterparty, turn: { action: 'accept', message: 'Agreed.' }, authTag: auth(second) }, second.key.secretKey);
await second.inbox.relay.publish(signAndWrap(accept, second.key.secretKey, hostPubkey).wrap);

const replay = replayNegotiation(openEvent, [propose, accept], hostPubkey);
console.log(`  independent replay against Index's rules: ${replay.refused ? `refused (${replay.refused.rejection})` : replay.ledger.outcome}`);

step('The host writes one opportunity per person (kind 4643, wrapped to each person\'s own key)');
const ours = (event: { kind: number; content: string }) => event.kind === KIND.OPPORTUNITY && event.content.includes(open.open.negotiationId);
const aliceOpp = parseOpportunity(await aliceInbox.waitFor(ours, 'Alice\'s opportunity', 15000), hostPubkey);
const bobOpp = parseOpportunity(await bobInbox.waitFor(ours, 'Bob\'s opportunity', 15000), hostPubkey);
if (!aliceOpp.ok || !bobOpp.ok) throw new Error('could not read the opportunities');
console.log(`  Alice sees: ${aliceOpp.opportunity.headline}`);
console.log(`  Bob sees:   ${bobOpp.opportunity.headline}`);

step('Both people accept with their own keys (kind 4644)');
for (const [person, inbox, opp] of [[alice, aliceInbox, aliceOpp], [bob, bobInbox, bobOpp]] as const) {
  const answer = finalizeEvent(opportunityResponseTemplate({ opportunityId: opp.opportunity.opportunityId, opportunityEventId: opp.event.id, decision: 'accept' }), person.secretKey);
  await inbox.relay.publish(signAndWrap(answer, person.secretKey, hostPubkey).wrap);
}
const intro = await aliceInbox.waitFor((event) => event.kind === KIND.PRIVATE_DM, 'introduction DM', 15000);
step(`Connected. The host's NIP-17 introduction: "${intro.content}"`);

if (aliceBuzz && buzz) {
  const card = await aliceBuzz.waitFor((event) => event.kind === KIND.PRIVATE_DM, 'Buzz card', 15000);
  step(`On Buzz, Alice got a card from the Index bot: "${card.content.split('\n')[0]}"`);
  const deadline = Date.now() + 15000;
  let channel: string | null = null;
  while (!channel && Date.now() < deadline) {
    channel = await new Promise<string | null>((resolve) => {
      aliceBuzz!.relay.subscribe([{ kinds: [KIND.GROUP_METADATA] }], {
        onevent: (event) => { const name = event.tags.find((tag) => tag[0] === 'name')?.[1]; if (name?.startsWith('index-intro-')) resolve(name); },
        oneose: () => resolve(null),
      });
    });
    if (!channel) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  step(channel ? `On Buzz, a private channel "${channel}" now holds Alice and Bob` : 'On Buzz, no introduction channel showed up (check the bridge status at /health)');
  aliceBuzz.close();
}
step('Cleaning up: both intents are withdrawn with NIP-09 deletions');
await aliceInbox.relay.publish(finalizeEvent({ kind: KIND.DELETION, created_at: Math.floor(Date.now() / 1000), tags: [['a', `${KIND.INTENT}:${alice.pubkey}:${networkId}-alice`]], content: 'demo finished' }, alice.secretKey));
// Bob's incognito intent was never public; withdrawing it is a deletion by the agent that signed it.
await agentInbox.relay.publish(finalizeEvent({ kind: KIND.DELETION, created_at: Math.floor(Date.now() / 1000), tags: [['a', `${KIND.INTENT}:${bobAgent.pubkey}:${networkId}-bob`]], content: 'demo finished' }, bobAgent.secretKey));
for (const inbox of [aliceInbox, bobInbox, agentInbox]) inbox.close();
process.exit(0);
