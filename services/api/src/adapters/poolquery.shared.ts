import { inArray, sql } from 'drizzle-orm/sql';

import { opportunities } from '../schemas/database.schema';

/** Statuses in the exact mutable recipient+intent pool. */
export const POOL_LIVE_STATUSES = ['draft', 'latent', 'pending', 'negotiating'] as const;

/**
 * Terminal statuses added ONLY to the Lens C evidence pool (IND-465):
 * negotiation evidence lives on decided negotiations, so the shadow pass must
 * see them. Lens A discriminator mining stays on {@link POOL_LIVE_STATUSES}.
 */
export const POOL_TERMINAL_STATUSES = ['stalled', 'accepted', 'rejected', 'expired'] as const;

/**
 * Recipient visibility guard shared by the live-pool and evidence-pool
 * predicates. Extracting it keeps the two predicates drift-free; the SQL
 * emitted by {@link exactLivePoolWhere} is byte-identical to before.
 */
function recipientPoolVisibilityGuard(recipientUserId: string) {
  return sql`(
    ${opportunities.actors} @> ${JSON.stringify([{ userId: recipientUserId, role: 'introducer' }])}::jsonb
    OR ${opportunities.actors} @> ${JSON.stringify([{ userId: recipientUserId, role: 'peer' }])}::jsonb
    OR (
      ${opportunities.actors} @> ${JSON.stringify([{ userId: recipientUserId, role: 'patient' }])}::jsonb
      AND (${opportunities.status} NOT IN ('latent', 'draft') OR NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
    )
    OR (
      ${opportunities.actors} @> ${JSON.stringify([{ userId: recipientUserId, role: 'agent' }])}::jsonb
      AND (
        ${opportunities.status} IN ('accepted', 'rejected', 'expired')
        OR (${opportunities.status} NOT IN ('latent', 'draft') AND NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
      )
    )
    OR (
      ${opportunities.actors} @> ${JSON.stringify([{ userId: recipientUserId, role: 'party' }])}::jsonb
      AND (${opportunities.status} NOT IN ('latent', 'draft') OR NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
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
