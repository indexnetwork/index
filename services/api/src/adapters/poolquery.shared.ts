import { inArray, sql } from 'drizzle-orm/sql';

import { opportunities } from '../schemas/database.schema';

/** Statuses in the exact mutable recipient+intent pool. */
export const POOL_LIVE_STATUSES = ['draft', 'latent', 'pending', 'negotiating'] as const;

/**
 * Canonical exact live-pool predicate shared by selectors and freshness gates.
 * Provenance is detection.triggeredBy; broad actors[].intent Radar fallback is
 * deliberately excluded.
 */
export function exactLivePoolWhere(recipientUserId: string, intentId: string) {
  const visibilityGuard = sql`(
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
  return sql`${visibilityGuard}
    AND ${opportunities.detection}->>'triggeredBy' = ${intentId}
    AND ${inArray(opportunities.status, [...POOL_LIVE_STATUSES])}`;
}
