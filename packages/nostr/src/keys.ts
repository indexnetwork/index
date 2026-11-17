import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import * as nip19 from 'nostr-tools/nip19';
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure';

/** A Nostr keypair: the 32-byte secret key and its x-only public key in hex. */
export interface Keypair {
  secretKey: Uint8Array;
  pubkey: string;
}

/** @returns A fresh random keypair. */
export function generateKeypair(): Keypair {
  const secretKey = generateSecretKey();
  return { secretKey, pubkey: getPublicKey(secretKey) };
}

/**
 * @param secret - A 64-char hex secret key or an `nsec1…` string.
 * @returns The keypair for that secret.
 */
export function keypairFromSecret(secret: string): Keypair {
  const trimmed = secret.trim();
  let secretKey: Uint8Array;
  if (trimmed.startsWith('nsec1')) {
    const decoded = nip19.decode(trimmed);
    if (decoded.type !== 'nsec') throw new Error('expected an nsec');
    secretKey = decoded.data;
  } else {
    if (!/^[0-9a-f]{64}$/i.test(trimmed)) throw new Error('secret key must be 64 hex characters or an nsec');
    secretKey = hexToBytes(trimmed.toLowerCase());
  }
  return { secretKey, pubkey: getPublicKey(secretKey) };
}

/** @returns The secret key as lowercase hex. */
export function secretToHex(secretKey: Uint8Array): string {
  return bytesToHex(secretKey);
}

/** @returns The `npub1…` form of a hex public key. */
export function npub(pubkey: string): string {
  return nip19.npubEncode(pubkey);
}

/** @returns Whether the value is a 64-char lowercase hex public key. */
export function isHexPubkey(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}
