import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, or } from 'drizzle-orm';

import { FrameDriftDatabaseAdapter } from '../src/adapters/frame-drift.database.adapter';
import db from '../src/lib/drizzle/drizzle';
import { OPENROUTER_EMBEDDING_MODEL } from '../src/lib/embedding/embedding.config';
import { FrameDriftMonitoringService } from '../src/services/frame-drift-monitoring.service';
import { crossNetworkYieldSnapshots, frameCentroidSnapshots, intentNetworks, intents, networks, opportunities, premiseNetworks, premises, userContexts, users } from '../src/schemas/database.schema';

const BUCKET_START = new Date('2026-07-14T00:00:00.000Z');
const BUCKET_END = new Date('2026-07-15T00:00:00.000Z');
const PREVIOUS_START = new Date('2026-07-13T00:00:00.000Z');
const NOW = new Date('2026-07-16T00:00:00.000Z');
const vector = (first: number, second: number): number[] => [first, second, ...Array(1998).fill(0)];
const E1 = vector(1, 0);
const E2 = vector(0, 1);

const suffix = randomUUID();
const networkIds = {
  a: `!ind430-${suffix}-a`,
  b: `!ind430-${suffix}-b`,
  c: `!ind430-${suffix}-c`,
};
const userIds = {
  one: `!ind430-${suffix}-u1`,
  two: `!ind430-${suffix}-u2`,
  three: `!ind430-${suffix}-u3`,
  four: `!ind430-${suffix}-u4`,
};
const intentIds = {
  a1: `!ind430-${suffix}-a1`,
  a2: `!ind430-${suffix}-a2`,
  a3: `!ind430-${suffix}-a3`,
  archived: `!ind430-${suffix}-archived`,
  paused: `!ind430-${suffix}-paused`,
  b1: `!ind430-${suffix}-b1`,
  b2: `!ind430-${suffix}-b2`,
  bLate: `!ind430-${suffix}-b-late`,
  c1: `!ind430-${suffix}-c1`,
};
const premiseIds = {
  active: `!ind430-${suffix}-premise-active`,
  retracted: `!ind430-${suffix}-premise-retracted`,
  deleted: `!ind430-${suffix}-premise-deleted`,
};
const opportunityIds = Array.from({ length: 6 }, (_, index) => `!ind430-${suffix}-opp-${index}`);

const originalMaxNetworks = process.env.FRAME_DRIFT_MONITORING_MAX_NETWORKS;
const originalMaxPairs = process.env.FRAME_DRIFT_MONITORING_MAX_PAIRS;

async function insertOpportunity(
  id: string,
  createdAt: Date,
  actors: Array<Record<string, string>>,
  status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired' = 'rejected',
): Promise<void> {
  await db.insert(opportunities).values({
    id,
    detection: { source: 'manual', timestamp: createdAt.toISOString() },
    actors: actors as typeof opportunities.$inferInsert.actors,
    interpretation: { category: 'test', reasoning: 'integration test', confidence: 1 },
    context: { networkId: networkIds.c },
    confidence: '1',
    status,
    createdAt,
    updatedAt: createdAt,
  });
}

describe('FrameDriftDatabaseAdapter PostgreSQL/pgvector integration', () => {
  beforeAll(async () => {
    process.env.FRAME_DRIFT_MONITORING_MAX_NETWORKS = '3';
    process.env.FRAME_DRIFT_MONITORING_MAX_PAIRS = '10';

    await db.insert(users).values(Object.entries(userIds).map(([name, id]) => ({
      id,
      email: `${name}-${suffix}@example.com`,
      name: `Frame Drift ${name}`,
      emailVerified: true,
      isGhost: false,
    })));
    await db.insert(networks).values(Object.entries(networkIds).map(([title, id]) => ({
      id,
      title: `Frame Drift ${title}`,
      isPersonal: false,
    })));

    await db.insert(intents).values([
      { id: intentIds.a1, userId: userIds.one, payload: 'a1', status: 'ACTIVE', embedding: E1 },
      { id: intentIds.a2, userId: userIds.one, payload: 'a2', status: 'ACTIVE', embedding: E1 },
      { id: intentIds.a3, userId: userIds.two, payload: 'a3 legacy', status: null, embedding: E2 },
      { id: intentIds.archived, userId: userIds.two, payload: 'archived', status: 'ACTIVE', archivedAt: BUCKET_START, embedding: E2 },
      { id: intentIds.paused, userId: userIds.two, payload: 'paused', status: 'PAUSED', embedding: E2 },
      { id: intentIds.b1, userId: userIds.one, payload: 'b1', status: 'ACTIVE', embedding: E1 },
      { id: intentIds.b2, userId: userIds.three, payload: 'b2', status: 'ACTIVE', embedding: E2 },
      { id: intentIds.bLate, userId: userIds.three, payload: 'b late', status: 'ACTIVE', embedding: E2 },
      { id: intentIds.c1, userId: userIds.four, payload: 'c1', status: 'ACTIVE', embedding: E1 },
    ]);
    await db.insert(intentNetworks).values([
      { intentId: intentIds.a1, networkId: networkIds.a, createdAt: new Date('2026-07-10T00:00:00Z') },
      { intentId: intentIds.a2, networkId: networkIds.a, createdAt: new Date('2026-07-10T00:00:00Z') },
      { intentId: intentIds.a3, networkId: networkIds.a, createdAt: new Date('2026-07-10T00:00:00Z') },
      { intentId: intentIds.archived, networkId: networkIds.a, createdAt: new Date('2026-07-10T00:00:00Z') },
      { intentId: intentIds.paused, networkId: networkIds.a, createdAt: new Date('2026-07-10T00:00:00Z') },
      { intentId: intentIds.b1, networkId: networkIds.b, createdAt: new Date('2026-07-10T00:00:00Z') },
      { intentId: intentIds.b2, networkId: networkIds.b, createdAt: new Date('2026-07-10T00:00:00Z') },
      { intentId: intentIds.bLate, networkId: networkIds.b, createdAt: new Date('2026-07-14T13:00:00Z') },
      { intentId: intentIds.c1, networkId: networkIds.c, createdAt: new Date('2026-07-10T00:00:00Z') },
    ]);

    const premiseBase = {
      userId: userIds.one,
      assertion: { text: 'test', tier: 'assertive' as const },
      provenance: { source: 'explicit' as const, confidence: 1, timestamp: BUCKET_START.toISOString() },
      validity: { volatile: false },
    };
    await db.insert(premises).values([
      { ...premiseBase, id: premiseIds.active, embedding: E1, status: 'ACTIVE' },
      { ...premiseBase, id: premiseIds.retracted, embedding: E2, status: 'RETRACTED' },
      { ...premiseBase, id: premiseIds.deleted, embedding: E2, status: 'ACTIVE', deletedAt: BUCKET_START },
    ]);
    await db.insert(premiseNetworks).values([
      { premiseId: premiseIds.active, networkId: networkIds.a },
      { premiseId: premiseIds.active, networkId: networkIds.b },
      { premiseId: premiseIds.retracted, networkId: networkIds.a },
      { premiseId: premiseIds.deleted, networkId: networkIds.a },
    ]);

    await db.insert(userContexts).values([
      { id: `!ind430-${suffix}-ctx-a1`, userId: userIds.one, networkId: networkIds.a, text: 'a1', embedding: E1 },
      { id: `!ind430-${suffix}-ctx-a2`, userId: userIds.two, networkId: networkIds.a, text: 'a2', embedding: E2 },
      { id: `!ind430-${suffix}-ctx-global`, userId: userIds.three, networkId: null, text: 'global', embedding: E2 },
    ]);

    await db.insert(frameCentroidSnapshots).values({
      id: `!ind430-${suffix}-prior-centroid`,
      networkId: networkIds.a,
      corpus: 'premise',
      centroid: E2,
      sampleCount: 1,
      embeddingModel: OPENROUTER_EMBEDDING_MODEL,
      cosineDrift: null,
      priorBucketStart: null,
      bucketStart: PREVIOUS_START,
      bucketEnd: BUCKET_START,
      capturedAt: BUCKET_START,
    });
    await db.insert(crossNetworkYieldSnapshots).values({
      id: `!ind430-${suffix}-prior-yield`,
      networkAId: networkIds.a,
      networkBId: networkIds.b,
      opportunityCount: 1,
      potentialIntentPairCount: 2,
      yieldRate: 0.5,
      yieldRateDelta: null,
      priorBucketStart: null,
      bucketStart: PREVIOUS_START,
      bucketEnd: BUCKET_START,
      capturedAt: BUCKET_START,
    });

    const validActors = [
      { userId: userIds.two, intent: intentIds.a3, networkId: networkIds.c, role: 'candidate' },
      { userId: userIds.three, intent: intentIds.b2, networkId: networkIds.c, role: 'candidate' },
      { userId: userIds.three, intent: intentIds.b2, networkId: networkIds.c, role: 'candidate' },
    ];
    await insertOpportunity(opportunityIds[0], BUCKET_START, validActors, 'rejected');
    await insertOpportunity(opportunityIds[1], BUCKET_END, validActors, 'accepted');
    await insertOpportunity(opportunityIds[2], new Date(BUCKET_START.getTime() - 1), validActors);
    await insertOpportunity(opportunityIds[3], new Date('2026-07-14T12:00:00Z'), [
      { userId: userIds.two, intent: intentIds.a3, networkId: networkIds.a, role: 'candidate' },
      { userId: userIds.three, intent: intentIds.bLate, networkId: networkIds.b, role: 'candidate' },
    ]);
    await insertOpportunity(opportunityIds[4], new Date('2026-07-14T12:00:00Z'), [
      { userId: userIds.two, intent: intentIds.a3, networkId: networkIds.a, role: 'candidate' },
      { userId: userIds.three, intent: intentIds.b2, networkId: networkIds.b, role: 'introducer' },
    ]);
    await insertOpportunity(opportunityIds[5], new Date('2026-07-14T12:00:00Z'), [
      { userId: userIds.two, intent: intentIds.a3, networkId: networkIds.a, role: 'candidate' },
      { userId: userIds.four, intent: intentIds.b2, networkId: networkIds.b, role: 'candidate' },
    ]);
  }, 60_000);

  afterAll(async () => {
    if (originalMaxNetworks === undefined) delete process.env.FRAME_DRIFT_MONITORING_MAX_NETWORKS;
    else process.env.FRAME_DRIFT_MONITORING_MAX_NETWORKS = originalMaxNetworks;
    if (originalMaxPairs === undefined) delete process.env.FRAME_DRIFT_MONITORING_MAX_PAIRS;
    else process.env.FRAME_DRIFT_MONITORING_MAX_PAIRS = originalMaxPairs;

    await db.delete(frameCentroidSnapshots).where(inArray(frameCentroidSnapshots.networkId, Object.values(networkIds)));
    await db.delete(crossNetworkYieldSnapshots).where(or(
      inArray(crossNetworkYieldSnapshots.networkAId, Object.values(networkIds)),
      inArray(crossNetworkYieldSnapshots.networkBId, Object.values(networkIds)),
    ));
    await db.delete(opportunities).where(inArray(opportunities.id, opportunityIds));
    await db.delete(userContexts).where(inArray(userContexts.userId, Object.values(userIds)));
    await db.delete(premiseNetworks).where(inArray(premiseNetworks.premiseId, Object.values(premiseIds)));
    await db.delete(premises).where(inArray(premises.id, Object.values(premiseIds)));
    await db.delete(intentNetworks).where(inArray(intentNetworks.intentId, Object.values(intentIds)));
    await db.delete(intents).where(inArray(intents.id, Object.values(intentIds)));
    await db.delete(networks).where(inArray(networks.id, Object.values(networkIds)));
    await db.delete(users).where(inArray(users.id, Object.values(userIds)));
  }, 60_000);

  it('captures filtered normalized centroids, corrected pair yields, exact priors, and idempotent rows', async () => {
    const adapter = new FrameDriftDatabaseAdapter(db);
    const service = new FrameDriftMonitoringService(adapter, () => NOW);

    await service.captureDailyBucket(BUCKET_START, BUCKET_END);
    await service.captureDailyBucket(BUCKET_START, BUCKET_END);

    const centroidRows = await db.select().from(frameCentroidSnapshots).where(and(
      inArray(frameCentroidSnapshots.networkId, Object.values(networkIds)),
      eq(frameCentroidSnapshots.bucketStart, BUCKET_START),
    ));
    const premiseA = centroidRows.find((row) => row.networkId === networkIds.a && row.corpus === 'premise');
    const premiseB = centroidRows.find((row) => row.networkId === networkIds.b && row.corpus === 'premise');
    const intentA = centroidRows.find((row) => row.networkId === networkIds.a && row.corpus === 'intent');
    const contextA = centroidRows.find((row) => row.networkId === networkIds.a && row.corpus === 'user_context');

    expect(premiseA?.sampleCount).toBe(1);
    expect(premiseA?.centroid[0]).toBeCloseTo(1);
    expect(premiseA?.centroid[1]).toBeCloseTo(0);
    expect(premiseA?.cosineDrift).toBeCloseTo(1);
    expect(premiseA?.priorBucketStart).toEqual(PREVIOUS_START);
    expect(premiseB?.sampleCount).toBe(1);
    expect(intentA?.sampleCount).toBe(3);
    expect(intentA?.centroid[0]).toBeCloseTo(2 / 3, 5);
    expect(intentA?.centroid[1]).toBeCloseTo(1 / 3, 5);
    expect(contextA?.sampleCount).toBe(2);
    expect(contextA?.centroid[0]).toBeCloseTo(0.5, 5);
    expect(contextA?.centroid[1]).toBeCloseTo(0.5, 5);

    const yieldRows = await db.select().from(crossNetworkYieldSnapshots).where(and(
      inArray(crossNetworkYieldSnapshots.networkAId, Object.values(networkIds)),
      eq(crossNetworkYieldSnapshots.bucketStart, BUCKET_START),
    ));
    expect(yieldRows).toHaveLength(3);
    const ab = yieldRows.find((row) => row.networkAId === networkIds.a && row.networkBId === networkIds.b);
    const ac = yieldRows.find((row) => row.networkAId === networkIds.a && row.networkBId === networkIds.c);
    const bc = yieldRows.find((row) => row.networkAId === networkIds.b && row.networkBId === networkIds.c);

    expect(ab?.potentialIntentPairCount).toBe(7);
    expect(ab?.opportunityCount).toBe(1);
    expect(ab?.yieldRate).toBeCloseTo(1 / 7);
    expect(ab?.yieldRateDelta).toBeCloseTo((1 / 7) - 0.5);
    expect(ab?.priorBucketStart).toEqual(PREVIOUS_START);
    expect(ac?.potentialIntentPairCount).toBe(3);
    expect(ac?.opportunityCount).toBe(0);
    expect(ac?.yieldRate).toBe(0);
    expect(bc?.potentialIntentPairCount).toBe(3);
    expect(bc?.opportunityCount).toBe(0);
  });
});
