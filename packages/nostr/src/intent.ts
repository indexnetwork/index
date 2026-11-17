/**
 * Intents (kind 31641).
 *
 * The content is the intent itself, in plain words. Metadata lives in tags so
 * generic clients can show it and relays can filter on it:
 *
 * - `d`: the intent id. Republishing the same `d` replaces the intent.
 * - `visibility`: `public` | `network_only` | `incognito` | `private`.
 * - `h`: a network the intent is shared into (one per network).
 * - `expiration`: optional NIP-40 expiry.
 * - `auth`: optional NIP-OA tag when an agent publishes for its owner.
 *
 * How it travels depends on visibility:
 *
 * | Visibility     | On the wire                                              |
 * |----------------|----------------------------------------------------------|
 * | `public`       | Plain event, readable by anyone.                         |
 * | `network_only` | Plain event with `h` tags; the relay serves it to members only. |
 * | `incognito`    | Gift-wrapped to the Index host's discovery key only.     |
 * | `private`      | Gift-wrapped to the owner's own negotiator keys; never discovered. |
 */
import { finalizeEvent, type NostrEvent } from 'nostr-tools/pure';
import { z } from 'zod';

import { principalOf, type AuthTag } from './attestation.js';
import { KIND } from './kinds.js';
import { isValidEvent, tagValue, tagValues, unixNow } from './tags.js';
import { wrapSigned } from './wrap.js';

export const INTENT_VISIBILITIES = ['public', 'network_only', 'incognito', 'private'] as const;
export type IntentVisibility = typeof INTENT_VISIBILITIES[number];

export const INTENT_TEXT_LIMIT = 2000;
const ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export const intentInputSchema = z.object({
  id: z.string().regex(ID_PATTERN),
  text: z.string().trim().min(1).max(INTENT_TEXT_LIMIT),
  visibility: z.enum(INTENT_VISIBILITIES),
  networks: z.array(z.string().regex(ID_PATTERN)).max(32).default([]),
  expiresAt: z.number().int().positive().optional(),
}).superRefine((value, ctx) => {
  if (value.visibility === 'network_only' && value.networks.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a network_only intent needs at least one network', path: ['networks'] });
  }
});
export type IntentInput = z.input<typeof intentInputSchema>;

/** A verified, parsed intent. */
export interface Intent {
  id: string;
  /** `31641:<author>:<id>`, the NIP-33 address. */
  address: string;
  eventId: string;
  author: string;
  /** Whom the intent speaks for: the owner when an agent published it with a valid NIP-OA tag. */
  principal: string;
  agent: string | null;
  text: string;
  visibility: IntentVisibility;
  networks: string[];
  expiresAt: number | null;
  createdAt: number;
}

export interface IntentPublication {
  /** The signed intent. For incognito and private intents this never goes on the wire in the clear. */
  intent: NostrEvent;
  /** What to send to the relay. */
  publish: NostrEvent[];
}

/**
 * Sign an intent and prepare it for the wire.
 *
 * @param input - The intent.
 * @param signerSecretKey - The owner's key, or an agent's key when `authTag` is given.
 * @param route.hostPubkey - The Index host's key; incognito intents are wrapped to it.
 * @param route.privateRecipients - Keys that may read a private intent (the owner's negotiators).
 * @param route.authTag - NIP-OA tag when an agent signs for its owner.
 */
export function createIntent(
  input: IntentInput,
  signerSecretKey: Uint8Array,
  route: { hostPubkey: string; privateRecipients?: string[]; authTag?: AuthTag; createdAt?: number },
): IntentPublication {
  const value = intentInputSchema.parse(input);
  const tags: string[][] = [
    ['d', value.id],
    ['visibility', value.visibility],
    ...value.networks.map((network) => ['h', network]),
    ['alt', 'Index intent'],
  ];
  if (value.expiresAt) tags.push(['expiration', String(value.expiresAt)]);
  if (route.authTag) tags.push([...route.authTag]);
  const intent = finalizeEvent({ kind: KIND.INTENT, created_at: route.createdAt ?? unixNow(), tags, content: value.text }, signerSecretKey);
  switch (value.visibility) {
    case 'public':
    case 'network_only':
      return { intent, publish: [intent] };
    case 'incognito':
      return { intent, publish: [wrapSigned(intent, signerSecretKey, route.hostPubkey)] };
    case 'private': {
      const recipients = route.privateRecipients ?? [];
      if (recipients.length === 0) throw new Error('a private intent needs at least one recipient (the owner\'s negotiator)');
      return { intent, publish: recipients.map((recipient) => wrapSigned(intent, signerSecretKey, recipient)) };
    }
  }
}

export type IntentParseResult = { ok: true; intent: Intent } | { ok: false; reason: string };

/**
 * Verify and parse an intent event, whether it arrived plain or unwrapped.
 *
 * @param event - A kind 31641 event.
 * @param options.wrapped - True when the event came out of a gift wrap. Incognito and private intents are only valid wrapped.
 */
export function parseIntent(event: NostrEvent, options: { wrapped?: boolean } = {}): IntentParseResult {
  if (event.kind !== KIND.INTENT) return { ok: false, reason: 'not an intent' };
  if (!isValidEvent(event)) return { ok: false, reason: 'invalid signature' };
  const id = tagValue(event, 'd');
  if (!id || !ID_PATTERN.test(id)) return { ok: false, reason: 'missing or malformed d tag' };
  const visibility = tagValue(event, 'visibility');
  if (!visibility || !(INTENT_VISIBILITIES as readonly string[]).includes(visibility)) return { ok: false, reason: 'missing or unknown visibility' };
  const networks = tagValues(event, 'h');
  if (networks.some((network) => !ID_PATTERN.test(network))) return { ok: false, reason: 'malformed h tag' };
  if (visibility === 'network_only' && networks.length === 0) return { ok: false, reason: 'network_only intent without a network' };
  if ((visibility === 'incognito' || visibility === 'private') && !options.wrapped) {
    return { ok: false, reason: `${visibility} intents must be gift-wrapped` };
  }
  const text = event.content.trim();
  if (text.length === 0 || text.length > INTENT_TEXT_LIMIT) return { ok: false, reason: 'intent text is empty or too long' };
  const expiration = tagValue(event, 'expiration');
  const expiresAt = expiration && /^[0-9]+$/.test(expiration) ? Number(expiration) : null;
  const { principal, agent } = principalOf(event);
  return {
    ok: true,
    intent: {
      id, address: `${KIND.INTENT}:${event.pubkey}:${id}`, eventId: event.id, author: event.pubkey, principal, agent,
      text, visibility: visibility as IntentVisibility, networks, expiresAt, createdAt: event.created_at,
    },
  };
}

/** @returns Whether the intent has expired at `at` (unix seconds). */
export function isIntentExpired(intent: Pick<Intent, 'expiresAt'>, at = unixNow()): boolean {
  return intent.expiresAt !== null && intent.expiresAt <= at;
}
