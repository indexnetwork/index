import { inArray, sql } from 'drizzle-orm/sql';

import { opportunities } from '../schemas/database.schema';

/** Statuses in the exact mutable recipient+intent pool. */
export const POOL_LIVE_STATUSES = ['pending', 'negotiating'] as const;

/** The actors on a pairing may see it. */
function recipientPoolVisibilityGuard(recipientUserId: string) {
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
