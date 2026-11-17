/**
 * Buzz interop.
 *
 * Buzz (block/buzz) is a Nostr relay that speaks NIP-29 and NIP-17 and
 * refuses kinds it doesn't know. So Index never posts its own kinds to a Buzz
 * relay. What crosses over:
 *
 * - **Members**: a Buzz channel's relay-signed 39002 list mirrors into an Index network.
 * - **Negotiation turns and opportunities**: gift wraps (kind 1059), which Buzz stores without reading.
 * - **Opportunity cards**: NIP-17 DMs from the Index bot.
 * - **Conversations**: a private Buzz channel (kind 9007 with `p` tags) once both people accept.
 *
 * Buzz channel ids are UUIDs.
 */
import { getEventHash, getPublicKey, type NostrEvent } from 'nostr-tools/pure';

import { KIND } from './kinds.js';
import { unixNow } from './tags.js';
import { sealAndWrap } from './wrap.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A private Buzz channel that starts with `members` in it (Buzz adds a 9007's `p` tags as members). */
export function buzzPrivateChannelTemplate(params: { channelId: string; name: string; about?: string; members: string[]; createdAt?: number }) {
  if (!UUID.test(params.channelId)) throw new Error('Buzz channel ids are UUIDs');
  const tags: string[][] = [['h', params.channelId], ['name', params.name], ['visibility', 'private']];
  if (params.about) tags.push(['about', params.about]);
  for (const member of params.members) tags.push(['p', member]);
  return { kind: KIND.GROUP_CREATE, created_at: params.createdAt ?? unixNow(), tags, content: '' };
}

/** A plain message in a Buzz channel (NIP-29 kind 9). */
export function buzzChannelMessageTemplate(channelId: string, text: string, createdAt = unixNow()) {
  return { kind: KIND.GROUP_CHAT, created_at: createdAt, tags: [['h', channelId]], content: text };
}

/**
 * NIP-17 DM copies for each recipient and the sender, ready to publish to a
 * Buzz relay. Timestamps are current: Buzz refuses the backdated timestamps
 * NIP-59 otherwise recommends.
 */
export function buzzDirectMessage(senderSecretKey: Uint8Array, recipients: string[], text: string): NostrEvent[] {
  const pubkey = getPublicKey(senderSecretKey);
  const unsigned = { kind: KIND.PRIVATE_DM, created_at: unixNow(), tags: recipients.map((recipient) => ['p', recipient]), content: text, pubkey };
  const rumor = { ...unsigned, id: getEventHash(unsigned) };
  return [...new Set([...recipients, pubkey])].map((recipient) => sealAndWrap(rumor, senderSecretKey, recipient, { timestamps: 'now' }));
}
