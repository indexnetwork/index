import type { OpportunityEventType } from '@indexnetwork/protocol';

/** Event types the status fold reads. Only accept, decline and expiry write them. */
export const LIFECYCLE_EVENT_TYPES = ['opened', 'agreed', 'committed', 'declined', 'expired'] as const satisfies readonly OpportunityEventType[];

const MAX_TYPE_LENGTH = 64;

export type ClientEvent = { type: string; data: Record<string, unknown> | null };

/**
 * Read a client event body: any type that isn't a lifecycle type, plus optional free-form context.
 *
 * @param body - Parsed JSON body.
 * @returns The event, or why it was refused.
 */
export function parseClientEvent(body: unknown): { ok: true; event: ClientEvent } | { ok: false; error: string } {
  if (!isPlainObject(body)) return { ok: false, error: 'Body must be an object' };
  const { type, data } = body;
  if (typeof type !== 'string' || type.trim().length === 0 || type.length > MAX_TYPE_LENGTH) {
    return { ok: false, error: `type must be a non-empty string of at most ${MAX_TYPE_LENGTH} characters` };
  }
  if ((LIFECYCLE_EVENT_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `type '${type}' is reserved for the opportunity lifecycle` };
  }
  // Research records are written server-side only; a client-forged exposure
  // would inflate the experiment's counts.
  if (type.startsWith('moralmod.')) {
    return { ok: false, error: `type '${type}' is reserved for research records` };
  }
  if (data !== undefined && data !== null && !isPlainObject(data)) {
    return { ok: false, error: 'data must be an object' };
  }
  return { ok: true, event: { type, data: data ?? null } };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
