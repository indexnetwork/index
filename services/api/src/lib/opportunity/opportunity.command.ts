import { asc, eq, inArray } from 'drizzle-orm';

import { admitOpportunityEvent, type OpportunityLogEvent } from '@indexnetwork/protocol';

import db from '../drizzle/drizzle';
import { opportunities, opportunityEvents, type OpportunityActor } from '../../schemas/database.schema';

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface OpportunityCommandResult {
  ok: true;
  status: 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired';
  introduction: boolean;
  committedActorIds: string[];
}

/**
 * Append one opportunity event and set the projected status in the caller's transaction.
 *
 * @param tx - Open transaction. The opportunity row is locked.
 * @param opportunityId - Row to project.
 * @param event - Fact to append.
 * @returns The new projection, or why the fact is illegal.
 */
export async function applyOpportunityEvent(
  tx: Tx,
  opportunityId: string,
  event: OpportunityLogEvent,
): Promise<OpportunityCommandResult | { ok: false; error: string }> {
  const [locked] = await tx.select({ actors: opportunities.actors })
    .from(opportunities)
    .where(eq(opportunities.id, opportunityId))
    .for('update');
  if (!locked) return { ok: false, error: 'Opportunity not found' };

  const stored = await tx.select({ type: opportunityEvents.type, actorUserId: opportunityEvents.actorUserId })
    .from(opportunityEvents)
    .where(eq(opportunityEvents.opportunityId, opportunityId))
    .orderBy(asc(opportunityEvents.at), asc(opportunityEvents.id));
  const events: OpportunityLogEvent[] = stored.map((row) => ({
    type: row.type,
    actorUserId: row.actorUserId,
  }));
  const actorIds = [...new Set((locked.actors as OpportunityActor[]).map((actor) => actor.userId).filter(Boolean))];
  const admission = admitOpportunityEvent(events, actorIds, event);
  if (!admission.ok) return admission;

  await tx.insert(opportunityEvents).values({
    opportunityId,
    type: event.type,
    actorUserId: event.actorUserId,
  });
  await tx.update(opportunities).set({
    status: admission.projection.status,
    updatedAt: new Date(),
  }).where(eq(opportunities.id, opportunityId));

  return {
    ok: true,
    status: admission.projection.status,
    introduction: admission.introduction,
    committedActorIds: admission.projection.committedActorIds,
  };
}

/**
 * Append one opportunity event in its own transaction.
 *
 * @param opportunityId - Row to project.
 * @param event - Fact to append.
 * @returns The new projection, or why the fact is illegal.
 */
export async function recordOpportunityEvent(
  opportunityId: string,
  event: OpportunityLogEvent,
): Promise<OpportunityCommandResult | { ok: false; error: string }> {
  return db.transaction((tx) => applyOpportunityEvent(tx, opportunityId, event));
}

/** Actor ids that already have a `committed` event, grouped by opportunity. */
export async function committedActorIdsByOpportunity(opportunityIds: string[]): Promise<Map<string, string[]>> {
  const grouped = new Map<string, string[]>();
  if (opportunityIds.length === 0) return grouped;
  const rows = await db.select({
    opportunityId: opportunityEvents.opportunityId,
    actorUserId: opportunityEvents.actorUserId,
  }).from(opportunityEvents).where(andCommitted(opportunityIds));
  for (const row of rows) {
    if (!row.actorUserId) continue;
    const list = grouped.get(row.opportunityId) ?? [];
    list.push(row.actorUserId);
    grouped.set(row.opportunityId, list);
  }
  return grouped;
}

function andCommitted(opportunityIds: string[]) {
  return inArray(opportunityEvents.opportunityId, opportunityIds);
}

/**
 * Append the opening prefix for a row that was just inserted with `status`.
 *
 * @param tx - Transaction that inserted the row.
 * @param opportunityId - The new row.
 * @param status - Status the insert already stored.
 * @param actorIds - Named humans on the row.
 */
export async function seedOpportunityLog(
  tx: Tx,
  opportunityId: string,
  status: 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired',
  actorIds: string[],
): Promise<void> {
  const opened: OpportunityLogEvent = { type: 'opened', actorUserId: null };
  const events: OpportunityLogEvent[] = [opened];
  if (status === 'rejected') events.push({ type: 'declined', actorUserId: null });
  else if (status === 'expired') events.push({ type: 'expired', actorUserId: null });
  else if (status === 'pending' || status === 'accepted') {
    events.push({ type: 'agreed', actorUserId: null });
    if (status === 'accepted') {
      for (const actorUserId of [...new Set(actorIds)]) events.push({ type: 'committed', actorUserId });
    }
  }
  for (const event of events) {
    const applied = await applyOpportunityEvent(tx, opportunityId, event);
    if (!applied.ok) throw new Error(applied.error);
  }
}
