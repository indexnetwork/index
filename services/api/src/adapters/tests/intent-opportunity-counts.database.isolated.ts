import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { eq, inArray } from 'drizzle-orm/sql';

import { IntentDatabaseAdapter } from '../database.adapter';
import db from '../../lib/drizzle/drizzle';
import { intents, opportunities, users } from '../../schemas/database.schema';

const ownerId = crypto.randomUUID();
const counterpartyId = crypto.randomUUID();
const foreignOwnerId = crypto.randomUUID();
const intentAId = crypto.randomUUID();
const intentBId = crypto.randomUUID();
const foreignIntentId = crypto.randomUUID();
const opportunityIds = Array.from({ length: 17 }, () => crypto.randomUUID());
const [
  triggeredOnlyId,
  actorOnlyId,
  matchedByBothSignalsId,
  duplicateActorRowsId,
  recentSignalId,
  viewerActedId,
  counterpartyActedId,
  counterpartyIntentId,
  viewerIntroducerId,
  nonActorId,
  foreignIntentIdOpportunity,
  pendingTransitionId,
  latentId,
  draftId,
  negotiatingId,
  stalledId,
  terminalId,
] = opportunityIds;

const adapter = new IntentDatabaseAdapter();
const now = new Date();

function opportunity(
  id: string,
  actors: typeof opportunities.$inferInsert.actors,
  detection: typeof opportunities.$inferInsert.detection,
  status: typeof opportunities.$inferInsert.status = 'pending',
) {
  return {
    id,
    actors,
    detection,
    interpretation: { category: 'test', reasoning: 'IND-499 count fixture', confidence: 0.8 },
    context: {},
    confidence: '0.8',
    status,
    createdAt: now,
    updatedAt: now,
  };
}

beforeAll(async () => {
  await db.insert(users).values([
    { id: ownerId, email: `ind499-owner-${ownerId}@example.com`, name: 'IND-499 owner' },
    { id: counterpartyId, email: `ind499-counterparty-${counterpartyId}@example.com`, name: 'IND-499 counterparty' },
    { id: foreignOwnerId, email: `ind499-foreign-${foreignOwnerId}@example.com`, name: 'IND-499 foreign owner' },
  ]);
  await db.insert(intents).values([
    { id: intentAId, userId: ownerId, payload: 'Signal A', status: 'ACTIVE' },
    { id: intentBId, userId: ownerId, payload: 'Signal B', status: 'ACTIVE' },
    { id: foreignIntentId, userId: foreignOwnerId, payload: 'Foreign signal', status: 'ACTIVE' },
  ]);
  const timestamp = now.toISOString();
  const ownerA = { userId: ownerId, networkId: crypto.randomUUID(), role: 'peer', intent: intentAId };
  const ownerB = { userId: ownerId, networkId: crypto.randomUUID(), role: 'peer', intent: intentBId };
  const counterparty = { userId: counterpartyId, networkId: crypto.randomUUID(), role: 'peer' };

  await db.insert(opportunities).values([
    // Attribution through detection alone.
    opportunity(triggeredOnlyId, [{ userId: ownerId, networkId: crypto.randomUUID(), role: 'peer' }, counterparty], { source: 'opportunity_graph', triggeredBy: intentAId, timestamp }),
    // Attribution through the viewer's actor intent alone.
    opportunity(actorOnlyId, [ownerB, counterparty], { source: 'opportunity_graph', timestamp }),
    // One row is allowed under each matching signal, but only once within either.
    opportunity(matchedByBothSignalsId, [ownerB, counterparty], { source: 'opportunity_graph', triggeredBy: intentAId, timestamp }),
    opportunity(duplicateActorRowsId, [ownerA, { ...ownerA }, counterparty], { source: 'opportunity_graph', timestamp }),
    // Created just now: count semantics have no age window.
    opportunity(recentSignalId, [ownerA, counterparty], { source: 'opportunity_graph', timestamp }),
    // A viewer who already acted is awaiting the counterparty, not a home count.
    opportunity(viewerActedId, [{ ...ownerA, actedAt: timestamp }, counterparty], { source: 'opportunity_graph', timestamp }),
    // A counterparty acting must not hide the viewer's pending card.
    opportunity(counterpartyActedId, [ownerA, { ...counterparty, actedAt: timestamp }], { source: 'opportunity_graph', timestamp }),
    // A counterparty's intent cannot be attributed to the viewer's signal.
    opportunity(counterpartyIntentId, [{ ...counterparty, intent: intentAId }, { userId: ownerId, networkId: crypto.randomUUID(), role: 'peer' }], { source: 'opportunity_graph', timestamp }),
    opportunity(viewerIntroducerId, [{ ...ownerA, role: 'introducer' }, counterparty], { source: 'opportunity_graph', triggeredBy: intentAId, timestamp }),
    opportunity(nonActorId, [counterparty], { source: 'opportunity_graph', triggeredBy: intentAId, timestamp }),
    // The caller only lists owner-scoped signal IDs, so foreign provenance fails closed.
    opportunity(foreignIntentIdOpportunity, [{ userId: ownerId, networkId: crypto.randomUUID(), role: 'peer', intent: foreignIntentId }, counterparty], { source: 'opportunity_graph', triggeredBy: foreignIntentId, timestamp }),
    opportunity(pendingTransitionId, [ownerA, counterparty], { source: 'opportunity_graph', timestamp }),
    ...(['latent', 'draft', 'negotiating', 'stalled'] as const).map((status, index) =>
      opportunity([latentId, draftId, negotiatingId, stalledId][index], [ownerA, counterparty], { source: 'opportunity_graph', triggeredBy: intentAId, timestamp }, status),
    ),
    opportunity(terminalId, [ownerA, counterparty], { source: 'opportunity_graph', triggeredBy: intentAId, timestamp }, 'accepted'),
  ]);
});

afterAll(async () => {
  await db.delete(opportunities).where(inArray(opportunities.id, opportunityIds));
  await db.delete(intents).where(inArray(intents.id, [intentAId, intentBId, foreignIntentId]));
  await db.delete(users).where(inArray(users.id, [ownerId, counterpartyId, foreignOwnerId]));
});

describe('IntentDatabaseAdapter pending opportunity counts', () => {
  test('counts only recipient-awaiting pending rows with owner-scoped dual attribution', async () => {
    const result = await adapter.listIntents(ownerId, { page: 1, limit: 20, archived: false });
    const counts = new Map(result.rows.map((row) => [row.id, row.waitingOpportunityCount]));

    expect(counts.get(intentAId)).toBe(6);
    expect(counts.get(intentBId)).toBe(2);
    expect(result.totalWaitingOpportunities).toBe(7);
    expect(result.rows.some((row) => row.id === foreignIntentId)).toBe(false);

    await db.update(opportunities)
      .set({ status: 'accepted' })
      .where(eq(opportunities.id, pendingTransitionId));

    const afterTransition = await adapter.listIntents(ownerId, { page: 1, limit: 20, archived: false });
    const transitionedCounts = new Map(afterTransition.rows.map((row) => [row.id, row.waitingOpportunityCount]));
    expect(transitionedCounts.get(intentAId)).toBe(5);
    expect(transitionedCounts.get(intentBId)).toBe(2);
    expect(afterTransition.totalWaitingOpportunities).toBe(6);
  });
});
