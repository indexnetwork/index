/**
 * Networks are NIP-29 relay-based groups.
 *
 * The group id is the network id. `anyone` networks are open (a join request
 * is granted); `invite_only` networks are closed (an admin adds members).
 * The relay signs the group state (39000 metadata, 39001 admins, 39002
 * members), and that state is what decides who may read a network's
 * intents. Buzz communities speak the same NIP, which is what lets the Buzz
 * bridge mirror a community's members into an Index network.
 */
import type { NostrEvent } from 'nostr-tools/pure';

import { KIND } from './kinds.js';
import { isValidEvent, tagValue, tagValues, unixNow } from './tags.js';

export type JoinPolicy = 'anyone' | 'invite_only';

export function createNetworkTemplate(params: { id: string; name: string; about?: string; joinPolicy: JoinPolicy; createdAt?: number }) {
  const tags: string[][] = [['h', params.id], ['name', params.name]];
  if (params.about) tags.push(['about', params.about]);
  tags.push(params.joinPolicy === 'invite_only' ? ['closed'] : ['open']);
  return { kind: KIND.GROUP_CREATE, created_at: params.createdAt ?? unixNow(), tags, content: '' };
}

export function joinNetworkTemplate(networkId: string, createdAt = unixNow()) {
  return { kind: KIND.GROUP_JOIN_REQUEST, created_at: createdAt, tags: [['h', networkId]], content: '' };
}

export function leaveNetworkTemplate(networkId: string, createdAt = unixNow()) {
  return { kind: KIND.GROUP_LEAVE_REQUEST, created_at: createdAt, tags: [['h', networkId]], content: '' };
}

export function addMembersTemplate(networkId: string, members: string[], createdAt = unixNow()) {
  return { kind: KIND.GROUP_PUT_USER, created_at: createdAt, tags: [['h', networkId], ...members.map((member) => ['p', member])], content: '' };
}

export function removeMembersTemplate(networkId: string, members: string[], createdAt = unixNow()) {
  return { kind: KIND.GROUP_REMOVE_USER, created_at: createdAt, tags: [['h', networkId], ...members.map((member) => ['p', member])], content: '' };
}

/** Group state signed by a relay. */
export interface GroupMembers {
  groupId: string;
  members: string[];
  relayPubkey: string;
  createdAt: number;
}

/**
 * Read a relay-signed member list (kind 39002).
 *
 * @param relayPubkey - The relay's key from its NIP-11 `self`/`pubkey`. Member lists signed by anyone else are refused.
 */
export function parseGroupMembers(event: NostrEvent, relayPubkey: string): GroupMembers | null {
  if (event.kind !== KIND.GROUP_MEMBERS || event.pubkey !== relayPubkey || !isValidEvent(event)) return null;
  const groupId = tagValue(event, 'd');
  if (!groupId) return null;
  return { groupId, members: tagValues(event, 'p'), relayPubkey, createdAt: event.created_at };
}
