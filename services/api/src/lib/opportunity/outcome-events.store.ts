/**
 * Append-only store for Lens B outcome feedback events (IND-434).
 *
 * Thin, testable data-access layer over `opportunity_outcome_events`. All
 * writes are idempotent on `idempotencyKey` (one row per recipient +
 * opportunity + action), so retries collapse to a single logical event and a
 * rolled-back owner action leaves no trace (the insert runs only after the
 * status write returns).
 */
import { and, asc, eq } from 'drizzle-orm/sql';

import db from '../drizzle/drizzle';
import { opportunityOutcomeEvents, type NewOpportunityOutcomeEvent, type OpportunityOutcomeEvent } from '../../schemas/database.schema';

/** Minimal DB surface used by the store — injectable for hermetic tests. */
export interface OutcomeEventsDb {
  insert: typeof db.insert;
  select: typeof db.select;
}

/**
 * Idempotently append one outcome event. Returns true when a NEW row was
 * written, false when the idempotency key already existed (duplicate retry).
 */
export async function appendOutcomeEvent(
  event: NewOpportunityOutcomeEvent,
  database: OutcomeEventsDb = db,
): Promise<boolean> {
  const inserted = await database
    .insert(opportunityOutcomeEvents)
    .values(event)
    .onConflictDoNothing({ target: opportunityOutcomeEvents.idempotencyKey })
    .returning({ id: opportunityOutcomeEvents.id });
  return inserted.length > 0;
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
