/**
 * NIP-OA owner attestation (Buzz `docs/nips/NIP-OA.md`).
 *
 * An owner key authorizes an agent key to act for it with an `auth` tag:
 * `["auth", <owner-pubkey>, <conditions>, <sig>]`. The event stays authored by
 * the agent; the tag is evidence that the owner stands behind it. Index uses it
 * so a person's agent can publish intents and negotiate in their seat, and so
 * any Buzz agent is an Index agent without re-keying.
 */
import { schnorr } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { getPublicKey, type NostrEvent } from 'nostr-tools/pure';

import { isHexPubkey } from './keys.js';
import { isValidEvent } from './tags.js';

const DOMAIN = 'nostr:agent-auth:';
const MAX_KIND = 65535;
const MAX_TIMESTAMP = 4294967295;

export type AuthTag = ['auth', string, string, string];

export type AttestationFailure =
  | 'no_auth_tag' | 'multiple_auth_tags' | 'malformed_tag' | 'invalid_owner'
  | 'owner_is_author' | 'malformed_conditions' | 'conditions_not_met' | 'invalid_signature';

export type AttestationResult = { ok: true; owner: string } | { ok: false; reason: AttestationFailure };

/** @returns The message an owner signs to authorize `agentPubkey` under `conditions`. */
export function attestationMessage(agentPubkey: string, conditions: string): Uint8Array {
  return sha256(utf8ToBytes(`${DOMAIN}${agentPubkey}:${conditions}`));
}

/**
 * Issue an `auth` tag that lets `agentPubkey` act for the owner.
 *
 * @param ownerSecretKey - The owner's secret key.
 * @param agentPubkey - The agent's hex public key.
 * @param conditions - `&`-joined clauses (`kind=N`, `created_at<T`, `created_at>T`); empty for none.
 */
export function createAuthTag(ownerSecretKey: Uint8Array, agentPubkey: string, conditions = ''): AuthTag {
  if (!isHexPubkey(agentPubkey)) throw new Error('agent pubkey must be 64 lowercase hex characters');
  if (parseConditions(conditions) === null) throw new Error(`malformed conditions: ${conditions}`);
  const owner = getPublicKey(ownerSecretKey);
  if (owner === agentPubkey) throw new Error('owner and agent must be different keys');
  const sig = schnorr.sign(attestationMessage(agentPubkey, conditions), ownerSecretKey);
  return ['auth', owner, conditions, bytesToHex(sig)];
}

type Clause = { name: 'kind'; value: number } | { name: 'created_at<' | 'created_at>'; value: number };

const DECIMAL = /^(0|[1-9][0-9]*)$/;

/** @returns The parsed clauses, or null when the string breaks NIP-OA's grammar. */
export function parseConditions(conditions: string): Clause[] | null {
  if (conditions === '') return [];
  if (!/^[\x21-\x7e]+$/.test(conditions)) return null;
  const clauses: Clause[] = [];
  for (const clause of conditions.split('&')) {
    let match: RegExpMatchArray | null;
    if ((match = clause.match(/^kind=(.*)$/))) {
      const raw = match[1] ?? '';
      if (!DECIMAL.test(raw)) return null;
      const value = Number(raw);
      if (value > MAX_KIND) return null;
      clauses.push({ name: 'kind', value });
    } else if ((match = clause.match(/^created_at([<>])(.*)$/))) {
      const raw = match[2] ?? '';
      if (!DECIMAL.test(raw)) return null;
      const value = Number(raw);
      if (value > MAX_TIMESTAMP) return null;
      clauses.push({ name: match[1] === '<' ? 'created_at<' : 'created_at>', value });
    } else {
      return null;
    }
  }
  return clauses;
}

/**
 * Verify an event's NIP-OA `auth` tag.
 *
 * Checks the event's own signature first: a valid tag on an invalid event
 * proves nothing. Never consults the local clock.
 *
 * @returns The owner pubkey when the tag verifies, or why it does not.
 */
export function verifyAttestation(event: NostrEvent): AttestationResult {
  const tags = event.tags.filter((tag) => tag[0] === 'auth');
  if (tags.length === 0) return { ok: false, reason: 'no_auth_tag' };
  if (tags.length > 1) return { ok: false, reason: 'multiple_auth_tags' };
  const tag = tags[0]!;
  if (tag.length !== 4) return { ok: false, reason: 'malformed_tag' };
  const [, owner, conditions, sig] = tag as AuthTag;
  if (!isHexPubkey(owner)) return { ok: false, reason: 'invalid_owner' };
  if (owner === event.pubkey) return { ok: false, reason: 'owner_is_author' };
  const clauses = parseConditions(conditions);
  if (clauses === null) return { ok: false, reason: 'malformed_conditions' };
  if (!/^[0-9a-f]{128}$/.test(sig)) return { ok: false, reason: 'invalid_signature' };
  if (!isValidEvent(event)) return { ok: false, reason: 'invalid_signature' };
  for (const clause of clauses) {
    const met = clause.name === 'kind' ? event.kind === clause.value
      : clause.name === 'created_at<' ? event.created_at < clause.value
        : event.created_at > clause.value;
    if (!met) return { ok: false, reason: 'conditions_not_met' };
  }
  return verifyOwnerSignature(sig, event.pubkey, conditions, owner) ? { ok: true, owner } : { ok: false, reason: 'invalid_signature' };
}

function verifyOwnerSignature(sig: string, agentPubkey: string, conditions: string, owner: string): boolean {
  try {
    return schnorr.verify(hexToBytes(sig), attestationMessage(agentPubkey, conditions), hexToBytes(owner));
  } catch {
    return false;
  }
}

/**
 * Who an event speaks for: the owner named by a valid `auth` tag, otherwise
 * the author. An invalid tag is ignored, as NIP-OA requires, so the author
 * still speaks for itself.
 */
export function principalOf(event: NostrEvent): { principal: string; agent: string | null } {
  const result = verifyAttestation(event);
  return result.ok ? { principal: result.owner, agent: event.pubkey } : { principal: event.pubkey, agent: null };
}
