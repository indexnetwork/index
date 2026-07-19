import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq, inArray, or } from 'drizzle-orm';

import { FrameDriftDatabaseAdapter } from '../src/adapters/frame-drift.database.adapter';
import db from '../src/lib/drizzle/drizzle';
import { OPENROUTER_EMBEDDING_MODEL } from '../src/lib/embedding/embedding.config';
import { FrameDriftMonitoringService } from '../src/services/frame-drift-monitoring.service';
import { crossNetworkYieldSnapshots, frameCentroidSnapshots, frameDriftObservationRuns, intentNetworks, intents, networks, opportunities, premiseNetworks, premises, userContexts, users } from '../src/schemas/database.schema';

const BUCKET_START = new Date('2026-07-14T00:00:00.000Z');
const BUCKET_END = new Date('2026-07-15T00:00:00.000Z');
const PREVIOUS_START = new Date('2026-07-13T00:00:00.000Z');
const FIRST_CAPTURE = new Date('2026-07-15T00:15:00.000Z');
const SECOND_CAPTURE = new Date('2026-07-16T00:15:00.000Z');
const NEXT_BUCKET_END = new Date('2026-07-16T00:00:00.000Z');
const THIRD_CAPTURE = new Date('2026-07-17T00:15:00.000Z');
const vector = (first: number, second: number): number[] => [first, second, ...Array(1998).fill(0)];
const E1 = vector(1, 0);
const E2 = vector(0, 1);

const suffix = randomUUID();
const networkIds = {
  a: `!ind430-${suffix}-a`,
  b: `!ind430-${suffix}-b`,
  c: `!ind430-${suffix}-c`,
  later: `!ind430-${suffix}-later`,
};
const userIds = {
  one: `!ind430-${suffix}-u1`,
  two: `!ind430-${suffix}-u2`,
  three: `!ind430-${suffix}-u3`,
  deleted: `!ind430-${suffix}-deleted`,
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
  bNoEmbedding: `!ind430-${suffix}-b-no-embedding`,
  deletedOwner: `!ind430-${suffix}-deleted-owner`,
};
const premiseIds = {
  activeOne: `!ind430-${suffix}-premise-active-one`,
  activeTwo: `!ind430-${suffix}-premise-active-two`,
  retracted: `!ind430-${suffix}-premise-retracted`,
  deleted: `!ind430-${suffix}-premise-deleted`,
  deletedOwner: `!ind430-${suffix}-premise-deleted-owner`,
};
const opportunityIds = Array.from({ length: 7 }, (_, index) => `!ind430-${suffix}-opp-${index}`);
const priorRunId = `!ind430-${suffix}-prior-run`;

const originalEnv = {
  maxNetworks: process.env.FRAME_DRIFT_MONITORING_MAX_NETWORKS,
  maxPairs: process.env.FRAME_DRIFT_MONITORING_MAX_PAIRS,
  minUsers: process.env.FRAME_DRIFT_MONITORING_MIN_USERS,
};

async function insertOpportunity(
  id: string,
  createdAt: Date,
  source: 'manual' | 'opportunity_graph',
  actors: Array<Record<string, string>>,
): Promise<void> {
  await db.insert(opportunities).values({
    id,
    detection: { source, timestamp: createdAt.toISOString() },
    actors: actors as typeof opportunities.$inferInsert.actors,
    interpretation: { category: 'test', reasoning: 'integration test', confidence: 1 },
    context: { networkId: networkIds.c },
    confidence: '1',
    status: 'rejected',
    createdAt,
    updatedAt: createdAt,
  });
}

function restoreEnv(key: keyof typeof originalEnv, envName: string): void {
  const value = originalEnv[key];
  if (value === undefined) delete process.env[envName];
  else process.env[envName] = value;
}

describe('FrameDriftDatabaseAdapter PostgreSQL/pgvector integration', () => {
  beforeAll(async () => {
    process.env.FRAME_DRIFT_MONITORING_MAX_NETWORKS = '3';
    process.env.FRAME_DRIFT_MONITORING_MAX_PAIRS = '1';
    process.env.FRAME_DRIFT_MONITORING_MIN_USERS = '2';

    await db.insert(users).values([
      ...Object.entries(userIds).map(([name, id]) => ({
        id,
        email: `${name}-${suffix}@example.com`,
        name: `Frame Drift ${name}`,
        emailVerified: true,
        isGhost: false,
      })),
    ]);
    await db.update(users).set({ deletedAt: new Date('2026-07-01T00:00:00Z') })
      .where(eq(users.id, userIds.deleted));

    const cohortCreatedAt = new Date('1800-01-01T00:00:00Z');
    await db.insert(networks).values([
      { id: networkIds.a, title: 'Frame Drift A', isPersonal: false, createdAt: cohortCreatedAt },
      { id: networkIds.b, title: 'Frame Drift B', isPersonal: false, createdAt: cohortCreatedAt },
      { id: networkIds.c, title: 'Frame Drift C', isPersonal: false, createdAt: cohortCreatedAt },
    ]);

    await db.insert(intents).values([
      { id: intentIds.a1, userId: userIds.one, payload: 'a1', status: 'ACTIVE', embedding: E1 },
      { id: intentIds.a2, userId: userIds.one, payload: 'a2', status: 'ACTIVE', embedding: E1 },
      { id: intentIds.a3, userId: userIds.two, payload: 'a3 legacy', status: null, embedding: E2 },
      { id: intentIds.archived, userId: userIds.two, payload: 'archived', status: 'ACTIVE', archivedAt: BUCKET_START, embedding: E2 },
      { id: intentIds.paused, userId: userIds.two, payload: 'paused', status: 'PAUSED', embedding: E2 },
      { id: intentIds.b1, userId: userIds.one, payload: 'b1', status: 'ACTIVE', embedding: E1 },
      { id: intentIds.b2, userId: userIds.three, payload: 'b2', status: 'ACTIVE', embedding: E2 },
      { id: intentIds.bLate, userId: userIds.three, payload: 'b late', status: 'ACTIVE', embedding: E2 },
      { id: intentIds.bNoEmbedding, userId: userIds.three, payload: 'no embedding', status: 'ACTIVE', embedding: null },
      { id: intentIds.deletedOwner, userId: userIds.deleted, payload: 'deleted owner', status: 'ACTIVE', embedding: E1 },
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
      { intentId: intentIds.bNoEmbedding, networkId: networkIds.b, createdAt: new Date('2026-07-10T00:00:00Z') },
      { intentId: intentIds.deletedOwner, networkId: networkIds.c, createdAt: new Date('2026-07-10T00:00:00Z') },
    ]);

    const premiseBase = {
      assertion: { text: 'test', tier: 'assertive' as const },
      provenance: { source: 'explicit' as const, confidence: 1, timestamp: BUCKET_START.toISOString() },
      validity: { volatile: false },
    };
    await db.insert(premises).values([
      { ...premiseBase, id: premiseIds.activeOne, userId: userIds.one, embedding: E1, status: 'ACTIVE' },
      { ...premiseBase, id: premiseIds.activeTwo, userId: userIds.two, embedding: E2, status: 'ACTIVE' },
      { ...premiseBase, id: premiseIds.retracted, userId: userIds.one, embedding: E2, status: 'RETRACTED' },
      { ...premiseBase, id: premiseIds.deleted, userId: userIds.one, embedding: E2, status: 'ACTIVE', deletedAt: BUCKET_START },
      { ...premiseBase, id: premiseIds.deletedOwner, userId: userIds.deleted, embedding: E1, status: 'ACTIVE' },
    ]);
    await db.insert(premiseNetworks).values([
      { premiseId: premiseIds.activeOne, networkId: networkIds.a },
      { premiseId: premiseIds.activeTwo, networkId: networkIds.a },
      { premiseId: premiseIds.activeOne, networkId: networkIds.b },
      { premiseId: premiseIds.activeTwo, networkId: networkIds.b },
      { premiseId: premiseIds.retracted, networkId: networkIds.a },
      { premiseId: premiseIds.deleted, networkId: networkIds.a },
      { premiseId: premiseIds.deletedOwner, networkId: networkIds.c },
    ]);

    await db.insert(userContexts).values([
      { id: `!ind430-${suffix}-ctx-a1`, userId: userIds.one, networkId: networkIds.a, text: 'a1', embedding: E1 },
      { id: `!ind430-${suffix}-ctx-a2`, userId: userIds.two, networkId: networkIds.a, text: 'a2', embedding: E2 },
      { id: `!ind430-${suffix}-ctx-b-small`, userId: userIds.three, networkId: networkIds.b, text: 'small', embedding: E2 },
      { id: `!ind430-${suffix}-ctx-deleted`, userId: userIds.deleted, networkId: networkIds.c, text: 'deleted', embedding: E1 },
      { id: `!ind430-${suffix}-ctx-global`, userId: userIds.three, networkId: null, text: 'global', embedding: E2 },
    ]);

    await db.insert(frameDriftObservationRuns).values({
      id: priorRunId,
      bucketStart: PREVIOUS_START,
      bucketEnd: BUCKET_START,
      capturedAt: BUCKET_START,
      configuredEmbeddingModel: OPENROUTER_EMBEDDING_MODEL,
      maxNetworks: 3,
      maxPairs: 1,
      minUsers: 2,
      stableCohortHash: null,
      aggregateDiagnostics: {},
    });
    await db.insert(frameCentroidSnapshots).values({
      id: `!ind430-${suffix}-prior-centroid`,
      runId: priorRunId,
      networkId: networkIds.a,
      corpus: 'premise',
      centroid: E2,
      sampleCount: 2,
      configuredEmbeddingModel: OPENROUTER_EMBEDDING_MODEL,
      cosineDrift: null,
      priorBucketStart: null,
      bucketStart: PREVIOUS_START,
      bucketEnd: BUCKET_START,
      capturedAt: BUCKET_START,
    });
    await db.insert(crossNetworkYieldSnapshots).values({
      id: `!ind430-${suffix}-prior-yield`,
      runId: priorRunId,
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
    await insertOpportunity(opportunityIds[0], BUCKET_START, 'manual', validActors);
    await insertOpportunity(opportunityIds[1], BUCKET_START, 'opportunity_graph', validActors);
    await insertOpportunity(opportunityIds[2], new Date('2026-07-14T12:00:00Z'), 'opportunity_graph', [
      { userId: userIds.two, intent: intentIds.a3, networkId: networkIds.a, role: 'candidate' },
      { userId: userIds.three, intent: intentIds.bLate, networkId: networkIds.b, role: 'candidate' },
    ]);
    await insertOpportunity(opportunityIds[3], new Date('2026-07-14T12:00:00Z'), 'opportunity_graph', [
      { userId: userIds.two, intent: intentIds.a3, networkId: networkIds.a, role: 'candidate' },
      { userId: userIds.three, intent: intentIds.bNoEmbedding, networkId: networkIds.b, role: 'candidate' },
    ]);
    await insertOpportunity(opportunityIds[4], new Date('2026-07-14T12:00:00Z'), 'opportunity_graph', [
      { userId: userIds.two, intent: intentIds.a3, networkId: networkIds.a, role: 'candidate' },
      { userId: userIds.three, intent: `!ind430-${suffix}-missing`, networkId: networkIds.b, role: 'candidate' },
    ]);
    await insertOpportunity(opportunityIds[5], BUCKET_END, 'opportunity_graph', validActors);
    await insertOpportunity(opportunityIds[6], new Date(BUCKET_START.getTime() - 1), 'opportunity_graph', validActors);
  }, 60_000);

  afterAll(async () => {
    restoreEnv('maxNetworks', 'FRAME_DRIFT_MONITORING_MAX_NETWORKS');
    restoreEnv('maxPairs', 'FRAME_DRIFT_MONITORING_MAX_PAIRS');
    restoreEnv('minUsers', 'FRAME_DRIFT_MONITORING_MIN_USERS');

    const centroidRunRows = await db.select({ runId: frameCentroidSnapshots.runId })
      .from(frameCentroidSnapshots)
      .where(inArray(frameCentroidSnapshots.networkId, Object.values(networkIds)));
    const yieldRunRows = await db.select({ runId: crossNetworkYieldSnapshots.runId })
      .from(crossNetworkYieldSnapshots)
      .where(or(
        inArray(crossNetworkYieldSnapshots.networkAId, Object.values(networkIds)),
        inArray(crossNetworkYieldSnapshots.networkBId, Object.values(networkIds)),
      ));
    const runIds = [...new Set([
      priorRunId,
      ...centroidRunRows.map((row) => row.runId),
      ...yieldRunRows.map((row) => row.runId),
    ])];
    await db.delete(frameCentroidSnapshots).where(inArray(frameCentroidSnapshots.networkId, Object.values(networkIds)));
    await db.delete(crossNetworkYieldSnapshots).where(or(
      inArray(crossNetworkYieldSnapshots.networkAId, Object.values(networkIds)),
      inArray(crossNetworkYieldSnapshots.networkBId, Object.values(networkIds)),
    ));
    await db.delete(frameDriftObservationRuns).where(inArray(frameDriftObservationRuns.id, runIds));
    await db.delete(opportunities).where(inArray(opportunities.id, opportunityIds));
    await db.delete(userContexts).where(inArray(userContexts.userId, Object.values(userIds)));
    await db.delete(premiseNetworks).where(inArray(premiseNetworks.premiseId, Object.values(premiseIds)));
    await db.delete(premises).where(inArray(premises.id, Object.values(premiseIds)));
    await db.delete(intentNetworks).where(inArray(intentNetworks.intentId, Object.values(intentIds)));
    await db.delete(intents).where(inArray(intents.id, Object.values(intentIds)));
    await db.delete(networks).where(inArray(networks.id, Object.values(networkIds)));
    await db.delete(users).where(inArray(users.id, Object.values(userIds)));
  }, 60_000);

  it('captures a private stable cohort and never rewrites an immutable bucket', async () => {
    const adapter = new FrameDriftDatabaseAdapter(db);
    const firstService = new FrameDriftMonitoringService(adapter, () => FIRST_CAPTURE);

    const first = await firstService.captureDailyBucket(BUCKET_START, BUCKET_END);

    expect(first.observationStatus).toBe('inserted');
    expect(first.centroidSnapshotCount).toBe(5);
    expect(first.yieldProxySnapshotCount).toBe(1);
    expect(first.selectedNetworkCount).toBe(3);
    expect(first.eligibleNetworkCount).toBeGreaterThanOrEqual(3);
    expect(first.stableCohortHash).toHaveLength(64);
    expect(first.totalPossibleCohortPairCount).toBe(3);
    expect(first.selectedPairCount).toBe(1);
    expect(first.positiveMeasuredPairCount).toBe(1);
    expect(first.suppressedCentroidCount).toBe(1);
    expect(first.emptyCentroidCount).toBe(3);
    expect(first.graphOpportunityCount).toBe(4);
    expect(first.attributedGraphOpportunityCount).toBe(1);
    expect(first.unattributedGraphOpportunityCount).toBe(3);

    const centroidRowsBefore = await db.select().from(frameCentroidSnapshots).where(and(
      inArray(frameCentroidSnapshots.networkId, [networkIds.a, networkIds.b, networkIds.c]),
      eq(frameCentroidSnapshots.bucketStart, BUCKET_START),
    ));
    expect(centroidRowsBefore).toHaveLength(5);
    expect(centroidRowsBefore.some((row) => row.networkId === networkIds.c)).toBe(false);
    expect(centroidRowsBefore.some((row) => row.networkId === networkIds.b && row.corpus === 'user_context')).toBe(false);
    expect(centroidRowsBefore.every((row) => row.sampleCount >= 2)).toBe(true);

    const premiseA = centroidRowsBefore.find((row) => row.networkId === networkIds.a && row.corpus === 'premise');
    const intentA = centroidRowsBefore.find((row) => row.networkId === networkIds.a && row.corpus === 'intent');
    expect(premiseA?.sampleCount).toBe(2);
    expect(premiseA?.centroid[0]).toBeCloseTo(0.5);
    expect(premiseA?.centroid[1]).toBeCloseTo(0.5);
    expect(premiseA?.cosineDrift).toBeCloseTo(1 - Math.SQRT1_2);
    expect(premiseA?.priorBucketStart).toEqual(PREVIOUS_START);
    expect(intentA?.sampleCount).toBe(3);
    expect(intentA?.centroid[0]).toBeCloseTo(0.5, 5);
    expect(intentA?.centroid[1]).toBeCloseTo(0.5, 5);

    const yieldRowsBefore = await db.select().from(crossNetworkYieldSnapshots).where(and(
      eq(crossNetworkYieldSnapshots.networkAId, networkIds.a),
      eq(crossNetworkYieldSnapshots.bucketStart, BUCKET_START),
    ));
    expect(yieldRowsBefore).toHaveLength(1);
    expect(yieldRowsBefore[0].networkBId).toBe(networkIds.b);
    expect(yieldRowsBefore[0].potentialIntentPairCount).toBe(7);
    expect(yieldRowsBefore[0].opportunityCount).toBe(1);
    expect(yieldRowsBefore[0].yieldRate).toBeCloseTo(1 / 7);
    expect(yieldRowsBefore[0].yieldRateDelta).toBeCloseTo((1 / 7) - 0.5);
    expect(yieldRowsBefore[0].capturedAt).toEqual(FIRST_CAPTURE);

    const observationRunsBefore = await db.select().from(frameDriftObservationRuns).where(
      eq(frameDriftObservationRuns.bucketStart, BUCKET_START),
    );
    expect(observationRunsBefore).toHaveLength(1);
    expect(observationRunsBefore[0].capturedAt).toEqual(FIRST_CAPTURE);
    expect(observationRunsBefore[0].stableCohortHash).toBe(first.stableCohortHash);
    expect(observationRunsBefore[0].configuredEmbeddingModel).toBe(OPENROUTER_EMBEDDING_MODEL);

    await db.insert(userContexts).values({
      id: `!ind430-${suffix}-ctx-b-now-private`,
      userId: userIds.two,
      networkId: networkIds.b,
      text: 'second user makes this centroid eligible',
      embedding: E1,
    });
    await db.insert(networks).values({
      id: networkIds.later,
      title: 'Frame Drift later network',
      isPersonal: false,
      createdAt: SECOND_CAPTURE,
    });

    process.env.FRAME_DRIFT_MONITORING_MAX_NETWORKS = '4';
    const secondService = new FrameDriftMonitoringService(adapter, () => SECOND_CAPTURE);
    const second = await secondService.captureDailyBucket(BUCKET_START, BUCKET_END);

    expect(second.observationStatus).toBe('duplicate');
    expect(second.capturedAt).toEqual(FIRST_CAPTURE);
    expect(second.centroidSnapshotCount).toBe(0);
    expect(second.yieldProxySnapshotCount).toBe(0);

    const centroidRowsAfter = await db.select().from(frameCentroidSnapshots).where(and(
      inArray(frameCentroidSnapshots.networkId, [networkIds.a, networkIds.b, networkIds.c]),
      eq(frameCentroidSnapshots.bucketStart, BUCKET_START),
    ));
    const yieldRowsAfter = await db.select().from(crossNetworkYieldSnapshots).where(and(
      eq(crossNetworkYieldSnapshots.networkAId, networkIds.a),
      eq(crossNetworkYieldSnapshots.bucketStart, BUCKET_START),
    ));
    expect(centroidRowsAfter).toEqual(centroidRowsBefore);
    expect(yieldRowsAfter).toEqual(yieldRowsBefore);
    expect(centroidRowsAfter.some(
      (row) => row.networkId === networkIds.b && row.corpus === 'user_context',
    )).toBe(false);
    const observationRunsAfterDuplicate = await db.select().from(frameDriftObservationRuns).where(
      eq(frameDriftObservationRuns.bucketStart, BUCKET_START),
    );
    expect(observationRunsAfterDuplicate).toEqual(observationRunsBefore);

    const thirdService = new FrameDriftMonitoringService(adapter, () => THIRD_CAPTURE);
    const third = await thirdService.captureDailyBucket(BUCKET_END, NEXT_BUCKET_END);
    expect(third.observationStatus).toBe('inserted');

    const nextCentroids = await db.select().from(frameCentroidSnapshots).where(and(
      inArray(frameCentroidSnapshots.networkId, [networkIds.a, networkIds.b, networkIds.c]),
      eq(frameCentroidSnapshots.bucketStart, BUCKET_END),
    ));
    expect(nextCentroids.some(
      (row) => row.networkId === networkIds.b && row.corpus === 'user_context',
    )).toBe(true);

    const nextYieldRows = await db.select().from(crossNetworkYieldSnapshots).where(
      eq(crossNetworkYieldSnapshots.bucketStart, BUCKET_END),
    );
    expect(nextYieldRows).toHaveLength(1);
    expect([nextYieldRows[0].networkAId, nextYieldRows[0].networkBId]).toEqual([
      yieldRowsBefore[0].networkAId,
      yieldRowsBefore[0].networkBId,
    ]);

    const nextRuns = await db.select().from(frameDriftObservationRuns).where(
      eq(frameDriftObservationRuns.bucketStart, BUCKET_END),
    );
    expect(nextRuns).toHaveLength(1);
    expect(nextRuns[0].maxNetworks).toBe(4);
    expect(nextRuns[0].maxPairs).toBe(1);
  }, 60_000);
});
