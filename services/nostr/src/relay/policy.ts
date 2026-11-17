/**
 * What the Index relay accepts and whom it shows what.
 *
 * Writes: every write needs NIP-42 AUTH. Only Index kinds and the standard
 * kinds Index relies on are accepted. Index's negotiation and opportunity
 * kinds are refused in the clear: they only travel gift-wrapped.
 *
 * Reads: gift wraps go only to their recipient; network-only intents only to
 * members of one of their networks; an invite-only network's member list
 * only to its members. Everything else is public.
 */
import { KIND, WRAPPED_ONLY_KINDS, isValidEvent, parseIntent, tagValue, tagValues } from '@indexnetwork/nostr';
import type { NostrEvent } from 'nostr-tools/pure';

import type { Groups } from './groups.js';

export const MAX_EVENT_BYTES = 128 * 1024;

const ACCEPTED_KINDS = new Set<number>([
  KIND.PROFILE, KIND.DELETION, KIND.GROUP_CHAT, KIND.GIFT_WRAP, KIND.RELAY_LIST, KIND.DM_RELAY_LIST, KIND.INTENT,
  KIND.GROUP_PUT_USER, KIND.GROUP_REMOVE_USER, KIND.GROUP_CREATE, KIND.GROUP_JOIN_REQUEST, KIND.GROUP_LEAVE_REQUEST,
]);
export const GROUP_REQUEST_KINDS = new Set<number>([KIND.GROUP_PUT_USER, KIND.GROUP_REMOVE_USER, KIND.GROUP_CREATE, KIND.GROUP_JOIN_REQUEST, KIND.GROUP_LEAVE_REQUEST]);

/** Who is on the other end of a connection. */
export interface Viewer {
  /** The key that answered the AUTH challenge. */
  pubkey: string | null;
  /** Whom it speaks for: its owner when it authenticated with a NIP-OA tag, else itself. */
  principal: string | null;
}

export type WriteVerdict = { ok: true } | { ok: false; reason: string };

export function checkWrite(event: NostrEvent, viewer: Viewer, groups: Groups): WriteVerdict {
  if (JSON.stringify(event).length > MAX_EVENT_BYTES) return { ok: false, reason: 'invalid: event too large' };
  if (!isValidEvent(event)) return { ok: false, reason: 'invalid: bad id or signature' };
  if (!viewer.pubkey || !viewer.principal) return { ok: false, reason: 'auth-required: authenticate to publish here' };
  if (WRAPPED_ONLY_KINDS.includes(event.kind)) return { ok: false, reason: 'invalid: this kind only travels inside a gift wrap' };
  if (!ACCEPTED_KINDS.has(event.kind)) return { ok: false, reason: `blocked: kind ${event.kind} is not accepted by this relay` };
  if (event.kind === KIND.GIFT_WRAP) {
    return tagValues(event, 'p').length === 1 ? { ok: true } : { ok: false, reason: 'invalid: a gift wrap names exactly one recipient' };
  }
  // Everything else is published by the authenticated key itself.
  if (event.pubkey !== viewer.pubkey) return { ok: false, reason: 'restricted: you can only publish your own events' };
  if (event.kind === KIND.INTENT) {
    const parsed = parseIntent(event);
    if (!parsed.ok) return { ok: false, reason: `invalid: ${parsed.reason}` };
    for (const network of parsed.intent.networks) {
      if (!groups.get(network)) return { ok: false, reason: `invalid: no such network ${network}` };
      if (!groups.isMember(network, parsed.intent.principal)) return { ok: false, reason: `restricted: not a member of ${network}` };
    }
  }
  if (event.kind === KIND.GROUP_CHAT) {
    const group = tagValue(event, 'h');
    if (!group || !groups.isMember(group, viewer.principal)) return { ok: false, reason: 'restricted: only members can post in this network' };
  }
  return { ok: true };
}

export function canRead(event: NostrEvent, viewer: Viewer, groups: Groups): boolean {
  switch (event.kind) {
    case KIND.GIFT_WRAP:
      return viewer.pubkey !== null && tagValue(event, 'p') === viewer.pubkey;
    case KIND.INTENT: {
      if (tagValue(event, 'visibility') !== 'network_only') return true;
      if (!viewer.principal) return false;
      return tagValues(event, 'h').some((network) => groups.isMember(network, viewer.principal!));
    }
    case KIND.GROUP_MEMBERS:
    case KIND.GROUP_CHAT:
    case KIND.GROUP_PUT_USER:
    case KIND.GROUP_REMOVE_USER:
    case KIND.GROUP_JOIN_REQUEST:
    case KIND.GROUP_LEAVE_REQUEST: {
      const id = event.kind === KIND.GROUP_MEMBERS ? tagValue(event, 'd') : tagValue(event, 'h');
      const group = id ? groups.get(id) : null;
      if (!group) return true;
      if (event.kind !== KIND.GROUP_CHAT && group.joinPolicy === 'anyone') return true;
      return viewer.principal !== null && groups.isMember(group.id, viewer.principal);
    }
    default:
      return true;
  }
}
