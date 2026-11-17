import { verifyEvent, type NostrEvent } from 'nostr-tools/pure';

/** @returns The first value of tag `name`, or undefined. */
export function tagValue(event: Pick<NostrEvent, 'tags'>, name: string): string | undefined {
  return event.tags.find((tag) => tag[0] === name)?.[1];
}

/** @returns Every value of tag `name`, in order. */
export function tagValues(event: Pick<NostrEvent, 'tags'>, name: string): string[] {
  return event.tags.filter((tag) => tag[0] === name && typeof tag[1] === 'string').map((tag) => tag[1]!);
}

/** @returns The current unix time in seconds. */
export function unixNow(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Check an event's id and signature from scratch.
 *
 * nostr-tools caches a passed verification on the event object under a
 * symbol, and object spread copies that symbol, so `{ ...event, content }`
 * would still "verify". Every check in this package goes through here, on a
 * fresh copy of the wire fields, so the cache can never vouch for edited data.
 */
export function isValidEvent(event: NostrEvent): boolean {
  if (!event || typeof event.id !== 'string' || typeof event.sig !== 'string') return false;
  return verifyEvent({ id: event.id, pubkey: event.pubkey, created_at: event.created_at, kind: event.kind, tags: event.tags, content: event.content, sig: event.sig });
}
