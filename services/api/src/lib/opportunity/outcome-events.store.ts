/**
 * Append-only READ store for Lens B outcome feedback events (IND-434).
 *
 * Writes are NOT performed here: outcome events are inserted atomically inside
 * the winning owner-action transition via the `OutcomeOutbox` threaded through
 * the opportunity adapter (see `applyOutcomeOutbox`). This module is the
 * read-side used by shadow mining; keeping writes out of it prevents any
 * non-atomic capture path from existing.
 */
import { and, asc, eq } from 'drizzle-orm/sql';

import db from '../drizzle/drizzle';
import { opportunityOutcomeEvents, type OpportunityOutcomeEvent } from '../../schemas/database.schema';

/** Minimal DB surface used by the store — injectable for hermetic tests. */
export interface OutcomeEventsDb {
  select: typeof db.select;
}

/**
 * Read every outcome event for exactly one recipient + intent + fingerprint
 * scope, oldest first. The fingerprint is part of the predicate so a materially
 * changed intent starts a fresh scope rather than mixing incomparable pools.
 */
export async function getOutcomeEventsForScope(
  recipientUserId: string,
  intentId: string,
  intentFingerprint: string,
  database: OutcomeEventsDb = db,
): Promise<OpportunityOutcomeEvent[]> {
  return database
    .select()
    .from(opportunityOutcomeEvents)
    .where(
      and(
        eq(opportunityOutcomeEvents.recipientUserId, recipientUserId),
        eq(opportunityOutcomeEvents.intentId, intentId),
        eq(opportunityOutcomeEvents.intentFingerprint, intentFingerprint),
      ),
    )
    .orderBy(asc(opportunityOutcomeEvents.createdAt));
}
