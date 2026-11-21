/**
 * NIP-17 direct messages with every participant tagged.
 *
 * nostr-tools' `wrapManyEvents` tags each copy with only its own recipient,
 * so a three-way thread (the host introducing two people) looks like three
 * separate one-to-one threads. Here one rumor names everyone, and each
 * participant (the sender included) gets a wrapped copy of that same rumor.
 */
import { getEventHash, getPublicKey, type NostrEvent } from 'nostr-tools/pure';

import { KIND } from './kinds.js';
import { unixNow } from './tags.js';
import { sealAndWrap, type WrapOptions } from './wrap.js';

export function directMessage(senderSecretKey: Uint8Array, recipients: string[], text: string, options: WrapOptions & { subject?: string } = {}): NostrEvent[] {
  const pubkey = getPublicKey(senderSecretKey);
  const tags = [...new Set(recipients)].filter((recipient) => recipient !== pubkey).map((recipient) => ['p', recipient]);
  if (options.subject) tags.push(['subject', options.subject]);
  const unsigned = { kind: KIND.PRIVATE_DM, created_at: unixNow(), tags, content: text, pubkey };
  const rumor = { ...unsigned, id: getEventHash(unsigned) };
  return [...new Set([...recipients, pubkey])].map((recipient) => sealAndWrap(rumor, senderSecretKey, recipient, options));
}
