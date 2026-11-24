/**
 * Check what a Buzz relay lets the Index bot and a stranger do.
 *
 *   HOST_SECRET_KEY=… bun scripts/buzz-probe.ts wss://buzz.example [channel-uuid]
 *
 * Authenticates as the host, makes sure an open channel exists, then has a
 * fresh key join it, and prints the relay-signed member list.
 */
import { KIND, generateKeypair, joinNetworkTemplate, keypairFromSecret } from '@indexnetwork/nostr';
import { finalizeEvent } from 'nostr-tools/pure';

import { fetchRelayPubkey } from '../src/bridge/buzz.js';
import { connectAuthed } from '../src/client.js';

const url = process.argv[2] ?? process.env.BUZZ_RELAY_URL;
const channel = process.argv[3] ?? process.env.BUZZ_CHANNEL_ID ?? crypto.randomUUID();
if (!url || !process.env.HOST_SECRET_KEY) throw new Error('usage: HOST_SECRET_KEY=… bun scripts/buzz-probe.ts <buzz-url> [channel]');
const host = keypairFromSecret(process.env.HOST_SECRET_KEY);
const relayPubkey = await fetchRelayPubkey(url);
console.log('buzz relay key', relayPubkey, 'channel', channel);

const bot = await connectAuthed(url, host);
console.log('bot authenticated');
const create = finalizeEvent({ kind: KIND.GROUP_CREATE, created_at: Math.floor(Date.now() / 1000), tags: [['h', channel], ['name', `index-preview-${channel.slice(0, 4)}`], ['visibility', 'open'], ['about', 'Members here can be matched on Index.']], content: '' }, host.secretKey);
console.log('create channel:', await bot.publish(create).then((m) => `ok ${m}`, (e: Error) => `refused: ${e.message}`));

const stranger = generateKeypair();
const guest = await connectAuthed(url, stranger).then((relay) => relay, (e: Error) => { console.log('stranger auth refused:', e.message); return null; });
if (guest) console.log('stranger join:', await guest.publish(finalizeEvent(joinNetworkTemplate(channel), stranger.secretKey)).then((m) => `ok ${m}`, (e: Error) => `refused: ${e.message}`));

await new Promise<void>((resolve) => {
  bot.subscribe([{ kinds: [KIND.GROUP_MEMBERS], '#d': [channel] }], {
    onevent: (event) => console.log('39002 signed by relay:', event.pubkey === relayPubkey, 'members:', event.tags.filter((t) => t[0] === 'p').length),
    oneose: () => resolve(),
  });
});
process.exit(0);
