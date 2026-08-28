import { inArray, sql } from 'drizzle-orm/sql';

import { opportunities } from '../schemas/database.schema';

/** Statuses in the exact mutable recipient+intent pool. */
export const POOL_LIVE_STATUSES = ['pending', 'negotiating'] as const;

/**
 * Terminal statuses added ONLY to the Lens C evidence pool (IND-465):
 * negotiation evidence lives on decided negotiations, so the shadow pass must
 * see them. Lens A discriminator mining stays on {@link POOL_LIVE_STATUSES}.
 */
export const POOL_TERMINAL_STATUSES = ['stalled', 'accepted', 'rejected', 'expired'] as const;

/**
 * Recipient visibility guard shared by the live-pool and evidence-pool
 * predicates. Extracting it keeps the two predicates drift-free.
 */
function recipientPoolVisibilityGuard(recipientUserId: string) {
  // The actors on a pairing may see it. This used to be a four-way rule keyed
  // on role and pre-kickoff statuses; none of
  // those exist any more, and every branch collapsed to the same answer.
  return sql`(
    EXISTS (
      SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS actor
      WHERE actor->>'userId' = ${recipientUserId}
    )
  )`;
}

/**
 * Canonical exact live-pool predicate shared by selectors and freshness gates.
 * Provenance is detection.triggeredBy; broad actors[].intent Radar fallback is
 * deliberately excluded.
 */
export function exactLivePoolWhere(recipientUserId: string, intentId: string) {
  return sql`${recipientPoolVisibilityGuard(recipientUserId)}
    AND ${opportunities.detection}->>'triggeredBy' = ${intentId}
    AND ${inArray(opportunities.status, [...POOL_LIVE_STATUSES])}`;
}

/**
 * Lens-C-only evidence-pool predicate (IND-465): same visibility guard and
 * exact-trigger provenance as {@link exactLivePoolWhere}, but ALSO includes
 * {@link POOL_TERMINAL_STATUSES} because negotiation evidence lives on decided
 * negotiations. Lens A selection (selectPoolForMining and every freshness
 * gate) must keep using {@link exactLivePoolWhere}.
 */
export function exactEvidencePoolWhere(recipientUserId: string, intentId: string) {
  return sql`${recipientPoolVisibilityGuard(recipientUserId)}
    AND ${opportunities.detection}->>'triggeredBy' = ${intentId}
    AND ${inArray(opportunities.status, [...POOL_LIVE_STATUSES, ...POOL_TERMINAL_STATUSES])}`;
}
