/**
 * Gift wraps that keep the inner event signed.
 *
 * NIP-59 wraps an *unsigned* rumor so the sender can deny it later. Index needs
 * the opposite for negotiation turns, opportunities and responses: whoever
 * holds the transcript must be able to prove who said what. So the sealed
 * payload here is a complete signed event. The envelope is otherwise standard
 * NIP-59 (kind 13 seal inside a kind 1059 wrap from a one-time key), so any
 * relay that stores gift wraps, Buzz included, carries it unchanged.
 */
import * as nip44 from 'nostr-tools/nip44';
import { finalizeEvent, generateSecretKey, getPublicKey, type EventTemplate, type NostrEvent } from 'nostr-tools/pure';

import { KIND } from './kinds.js';
import { isValidEvent } from './tags.js';

const TWO_DAYS = 2 * 24 * 60 * 60;
/** Wraps larger than this are refused before decrypting. */
export const MAX_WRAP_CONTENT = 128 * 1024;

const now = () => Math.floor(Date.now() / 1000);
const randomPast = () => now() - Math.floor(Math.random() * TWO_DAYS);

/**
 * How wrap and seal timestamps are set. `randomized` backdates them by up to
 * two days, as NIP-59 recommends, to blur timing. `now` uses the current
 * time: Buzz relays refuse events whose timestamp is far from server time, so
 * anything sent to a Buzz relay must use it.
 */
export type WrapTimestamps = 'randomized' | 'now';

export interface WrapOptions {
  timestamps?: WrapTimestamps;
}

/**
 * Sign `template` as the sender and wrap it for one recipient.
 *
 * @returns The signed inner event and its kind 1059 wrap.
 */
export function signAndWrap(template: EventTemplate, senderSecretKey: Uint8Array, recipientPubkey: string, options: WrapOptions = {}): { inner: NostrEvent; wrap: NostrEvent } {
  const inner = finalizeEvent(template, senderSecretKey);
  return { inner, wrap: wrapSigned(inner, senderSecretKey, recipientPubkey, options) };
}

/**
 * Wrap an already-signed event for one recipient. The seal is signed by the
 * same key that signed `inner`, so a recipient can check they match.
 */
export function wrapSigned(inner: NostrEvent, senderSecretKey: Uint8Array, recipientPubkey: string, options: WrapOptions = {}): NostrEvent {
  if (getPublicKey(senderSecretKey) !== inner.pubkey) throw new Error('the sealing key must be the inner event author');
  return sealAndWrap(inner, senderSecretKey, recipientPubkey, options);
}

/**
 * Seal any payload event (signed, or an unsigned NIP-17 rumor) from the
 * sender and wrap it for one recipient with a one-time key.
 */
export function sealAndWrap(payload: Omit<NostrEvent, 'sig'> & { sig?: string }, senderSecretKey: Uint8Array, recipientPubkey: string, options: WrapOptions = {}): NostrEvent {
  const stamp = options.timestamps === 'now' ? now : randomPast;
  const seal = finalizeEvent({
    kind: KIND.SEAL,
    created_at: stamp(),
    tags: [],
    content: nip44.encrypt(JSON.stringify(payload), nip44.getConversationKey(senderSecretKey, recipientPubkey)),
  }, senderSecretKey);
  const ephemeral = generateSecretKey();
  return finalizeEvent({
    kind: KIND.GIFT_WRAP,
    created_at: stamp(),
    tags: [['p', recipientPubkey]],
    content: nip44.encrypt(JSON.stringify(seal), nip44.getConversationKey(ephemeral, recipientPubkey)),
  }, ephemeral);
}

export type UnwrapFailure = 'not_a_wrap' | 'too_large' | 'undecryptable' | 'bad_seal' | 'bad_inner' | 'author_mismatch';

export type UnwrapResult = { ok: true; inner: NostrEvent; signed: true } | { ok: true; inner: NostrEvent; signed: false } | { ok: false; reason: UnwrapFailure };

function parseEvent(json: string): NostrEvent | null {
  try {
    const value: unknown = JSON.parse(json);
    if (!value || typeof value !== 'object') return null;
    const event = value as Partial<NostrEvent>;
    if (typeof event.kind !== 'number' || typeof event.pubkey !== 'string' || typeof event.content !== 'string'
      || typeof event.created_at !== 'number' || !Array.isArray(event.tags)) return null;
    return event as NostrEvent;
  } catch {
    return null;
  }
}

/**
 * Open a wrap addressed to `recipientSecretKey`.
 *
 * `signed: true` means the inner event carries a valid signature by the seal's
 * author. `signed: false` is an ordinary NIP-17/NIP-59 rumor (for example a
 * chat DM): readable, but not proof of authorship to a third party.
 */
export function unwrap(wrap: NostrEvent, recipientSecretKey: Uint8Array): UnwrapResult {
  if (wrap.kind !== KIND.GIFT_WRAP || !isValidEvent(wrap)) return { ok: false, reason: 'not_a_wrap' };
  if (wrap.content.length > MAX_WRAP_CONTENT) return { ok: false, reason: 'too_large' };
  let seal: NostrEvent | null;
  try {
    seal = parseEvent(nip44.decrypt(wrap.content, nip44.getConversationKey(recipientSecretKey, wrap.pubkey)));
  } catch {
    return { ok: false, reason: 'undecryptable' };
  }
  if (!seal || seal.kind !== KIND.SEAL || !isValidEvent(seal)) return { ok: false, reason: 'bad_seal' };
  let inner: NostrEvent | null;
  try {
    inner = parseEvent(nip44.decrypt(seal.content, nip44.getConversationKey(recipientSecretKey, seal.pubkey)));
  } catch {
    return { ok: false, reason: 'undecryptable' };
  }
  if (!inner) return { ok: false, reason: 'bad_inner' };
  if (inner.pubkey !== seal.pubkey) return { ok: false, reason: 'author_mismatch' };
  if (typeof inner.sig === 'string' && inner.sig.length > 0) {
    return isValidEvent(inner) ? { ok: true, inner, signed: true } : { ok: false, reason: 'bad_inner' };
  }
  return { ok: true, inner, signed: false };
}
