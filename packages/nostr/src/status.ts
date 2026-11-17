/**
 * Host status (kind 4645): the host's verdict, sent back so agents and
 * clients don't have to guess. One per accepted or refused turn, and one per
 * opportunity state change.
 */
import type { NostrEvent } from 'nostr-tools/pure';
import { z } from 'zod';

import { KIND } from './kinds.js';
import { isValidEvent, unixNow } from './tags.js';

export const hostStatusSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('turn'),
    negotiationId: z.string().uuid(),
    /** The turn event this answers. */
    ref: z.string(),
    accepted: z.boolean(),
    rejection: z.string().optional(),
    turnIndex: z.number().int().nonnegative().optional(),
    awaiting: z.string().nullable().optional(),
    outcome: z.literal('agreed').nullable().optional(),
    roundEnded: z.enum(['declined', 'turn_limit']).nullable().optional(),
    /** The id the next turn must name as previous. */
    headId: z.string().optional(),
    /** The accepted turn itself, still signed by its seat, so the counterparty receives it even if the seat only wrapped it to the host. */
    turn: z.object({ id: z.string(), pubkey: z.string(), created_at: z.number(), kind: z.number(), tags: z.array(z.array(z.string())), content: z.string(), sig: z.string() }).optional(),
  }),
  z.object({
    type: z.literal('opportunity'),
    opportunityId: z.string().uuid(),
    status: z.enum(['pending', 'accepted', 'declined', 'connected']),
    ref: z.string().optional(),
    rejection: z.string().optional(),
  }),
]);
export type HostStatus = z.infer<typeof hostStatusSchema>;

export function hostStatusTemplate(status: HostStatus, recipient: string, createdAt = unixNow()) {
  const value = hostStatusSchema.parse(status);
  const tags: string[][] = [['p', recipient], ['alt', 'Index host status']];
  if (value.type === 'turn') tags.push(['negotiation', value.negotiationId], ['e', value.ref, '', 'reply']);
  else tags.push(['opportunity', value.opportunityId]);
  return { kind: KIND.HOST_STATUS, created_at: createdAt, tags, content: JSON.stringify(value) };
}

export function parseHostStatus(event: NostrEvent, hostPubkey: string): HostStatus | null {
  if (event.kind !== KIND.HOST_STATUS || event.pubkey !== hostPubkey || !isValidEvent(event)) return null;
  try {
    return hostStatusSchema.parse(JSON.parse(event.content));
  } catch {
    return null;
  }
}
