import crypto from 'crypto';

/** Minimal premise shape needed to synthesize contexts and compute the staleness hash. */
export interface ContextPremise {
  id: string;
  updatedAt: Date;
  assertion: { text: string };
}

/**
 * Deterministic short hash over a user's active premises. Used as the per-row
 * staleness key for `user_contexts`: a row whose stored hash equals this value
 * is considered fresh and skipped during regeneration.
 *
 * @param premises - The user's ACTIVE premises (id + updatedAt are the only inputs).
 * @returns A 16-char hex digest stable across orderings.
 */
export function computePremiseHash(premises: ContextPremise[]): string {
  return crypto
    .createHash('sha256')
    .update(premises.map((p) => `${p.id}:${p.updatedAt.toISOString()}`).sort().join('|'))
    .digest('hex')
    .slice(0, 16);
}
