/**
 * Opportunities (kind 4643) and the humans' answers (kind 4644).
 *
 * When two negotiators agree, the host writes one opportunity per party,
 * framed for that party, and wraps each to that person's own key. The
 * protocol never connects two people unless both humans commit, so a
 * response counts only when the person's own key signed it: an agent's
 * NIP-OA attestation is not enough here.
 */
import type { NostrEvent } from 'nostr-tools/pure';
import { z } from 'zod';

import { isHexPubkey } from './keys.js';
import { KIND } from './kinds.js';
import { isValidEvent, tagValue, unixNow } from './tags.js';

const pubkey = z.string().refine(isHexPubkey, 'expected a 64-char hex pubkey');

export const opportunityContentSchema = z.object({
  opportunityId: z.string().uuid(),
  negotiationId: z.string().uuid(),
  networkId: z.string().min(1),
  /** Who this copy is for. */
  recipient: pubkey,
  counterparty: pubkey,
  headline: z.string().min(1).max(280),
  reasoning: z.string().min(1).max(4000),
  /** The accept turn that settled the negotiation. */
  agreedTurnId: z.string().regex(/^[0-9a-f]{64}$/),
});
export type OpportunityContent = z.infer<typeof opportunityContentSchema>;

export const OPPORTUNITY_DECISIONS = ['accept', 'decline'] as const;
export type OpportunityDecision = typeof OPPORTUNITY_DECISIONS[number];

export const opportunityResponseSchema = z.object({
  opportunityId: z.string().uuid(),
  decision: z.enum(OPPORTUNITY_DECISIONS),
});
export type OpportunityResponse = z.infer<typeof opportunityResponseSchema>;

/** Build one party's copy of an opportunity. The host signs it and wraps it to `recipient`. */
export function opportunityTemplate(content: OpportunityContent, createdAt = unixNow()) {
  const value = opportunityContentSchema.parse(content);
  return {
    kind: KIND.OPPORTUNITY,
    created_at: createdAt,
    tags: [
      ['opportunity', value.opportunityId],
      ['negotiation', value.negotiationId],
      ['e', value.agreedTurnId, '', 'root'],
      ['p', value.recipient],
      ['alt', `Index opportunity: ${value.headline}`],
    ],
    content: JSON.stringify(value),
  };
}

/** Build a person's answer to an opportunity. Sign it with their own key and wrap it to the host. */
export function opportunityResponseTemplate(params: { opportunityId: string; opportunityEventId: string; decision: OpportunityDecision; createdAt?: number }) {
  const value = opportunityResponseSchema.parse({ opportunityId: params.opportunityId, decision: params.decision });
  return {
    kind: KIND.OPPORTUNITY_RESPONSE,
    created_at: params.createdAt ?? unixNow(),
    tags: [
      ['opportunity', value.opportunityId],
      ['e', params.opportunityEventId, '', 'reply'],
      ['alt', `Index opportunity ${value.decision}`],
    ],
    content: JSON.stringify(value),
  };
}

export type ParsedOpportunity = { ok: true; opportunity: OpportunityContent; event: NostrEvent } | { ok: false; reason: string };

/** Verify a host-signed opportunity copy. */
export function parseOpportunity(event: NostrEvent, hostPubkey: string): ParsedOpportunity {
  if (event.kind !== KIND.OPPORTUNITY) return { ok: false, reason: 'not an opportunity' };
  if (event.pubkey !== hostPubkey) return { ok: false, reason: 'not signed by the host' };
  if (!isValidEvent(event)) return { ok: false, reason: 'invalid signature' };
  try {
    const opportunity = opportunityContentSchema.parse(JSON.parse(event.content));
    if (tagValue(event, 'opportunity') !== opportunity.opportunityId) return { ok: false, reason: 'opportunity tag does not match content' };
    return { ok: true, opportunity, event };
  } catch {
    return { ok: false, reason: 'malformed opportunity' };
  }
}

export type ParsedResponse = { ok: true; response: OpportunityResponse; person: string; event: NostrEvent } | { ok: false; reason: string };

/** Verify a response. `person` is the signer; callers must check it is a party. */
export function parseOpportunityResponse(event: NostrEvent): ParsedResponse {
  if (event.kind !== KIND.OPPORTUNITY_RESPONSE) return { ok: false, reason: 'not an opportunity response' };
  if (!isValidEvent(event)) return { ok: false, reason: 'invalid signature' };
  try {
    const response = opportunityResponseSchema.parse(JSON.parse(event.content));
    if (tagValue(event, 'opportunity') !== response.opportunityId) return { ok: false, reason: 'opportunity tag does not match content' };
    return { ok: true, response, person: event.pubkey, event };
  } catch {
    return { ok: false, reason: 'malformed response' };
  }
}
