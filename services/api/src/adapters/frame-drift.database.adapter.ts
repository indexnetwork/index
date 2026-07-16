import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';

import db, { type DrizzleDB } from '../lib/drizzle/drizzle';
import { normalizeEmbedding } from '../lib/embedding/vector';
import { crossNetworkYieldSnapshots, frameCentroidSnapshots, type FrameCentroidCorpus } from '../schemas/database.schema';

const INSERT_CHUNK_SIZE = 500;
const CORPUS_COUNT = 3;

export interface FrameCentroidCandidate {
  networkId: string;
  corpus: FrameCentroidCorpus;
  centroid: number[] | null;
  sampleCount: number;
  priorCentroid: number[] | null;
  priorBucketStart: Date | null;
}

export interface CrossNetworkYieldCandidate {
  networkAId: string;
  networkBId: string;
  opportunityCount: number | string | bigint;
  potentialIntentPairCount: number | string | bigint;
  priorYieldRate: number | string | null;
  priorBucketStart: Date | null;
}

export interface FrameDriftReadSet {
  centroids: FrameCentroidCandidate[];
  yields: CrossNetworkYieldCandidate[];
  selectedNetworkCount: number;
  eligibleNetworkCount: number;
  stableCohortHash: string;
  totalPossibleCohortPairCount: number;
  selectedPairCount: number;
  positiveMeasuredPairCount: number;
  graphOpportunityCount: number;
  attributedGraphOpportunityCount: number;
  unattributedGraphOpportunityCount: number;
  suppressedCentroidCount: number;
  emptyCentroidCount: number;
  invalidVectorCount: number;
}

export interface FrameCentroidSnapshotWrite {
  networkId: string;
  corpus: FrameCentroidCorpus;
  centroid: number[];
  sampleCount: number;
  embeddingModel: string;
  cosineDrift: number | null;
  priorBucketStart: Date | null;
  bucketStart: Date;
  bucketEnd: Date;
  capturedAt: Date;
}

export interface CrossNetworkYieldSnapshotWrite {
  networkAId: string;
  networkBId: string;
  opportunityCount: number;
  potentialIntentPairCount: number;
  yieldRate: number;
  yieldRateDelta: number | null;
  priorBucketStart: Date | null;
  bucketStart: Date;
  bucketEnd: Date;
  capturedAt: Date;
}

export interface FrameDriftSnapshotWrites {
  centroids: FrameCentroidSnapshotWrite[];
  yields: CrossNetworkYieldSnapshotWrite[];
}

export interface FrameDriftSnapshotRequest {
  bucketStart: Date;
  bucketEnd: Date;
  previousBucketStart: Date;
  embeddingModel: string;
  maxNetworks: number;
  maxPairs: number;
  minUsers: number;
}

export interface FrameDriftPersistenceResult {
  centroidSnapshotCount: number;
  yieldProxySnapshotCount: number;
}

export interface FrameDriftSnapshotStore {
  captureAndPersist(
    request: FrameDriftSnapshotRequest,
    buildWrites: (readSet: FrameDriftReadSet) => FrameDriftSnapshotWrites,
  ): Promise<FrameDriftPersistenceResult>;
}

interface SelectedNetworkRow extends Record<string, unknown> {
  id: string;
  total_count: number | string | bigint;
}

interface RawCentroidRow extends Record<string, unknown> {
  network_id: string;
  corpus: FrameCentroidCorpus;
  centroid: unknown;
  sample_count: number | string | bigint;
  contributing_user_count: number | string | bigint;
  prior_centroid: unknown;
  prior_bucket_start: Date | string | null;
}

interface RawYieldRow extends Record<string, unknown> {
  network_a_id: string | null;
  network_b_id: string | null;
  opportunity_count: number | string | bigint | null;
  potential_intent_pair_count: number | string | bigint | null;
  prior_yield_rate: number | string | null;
  prior_bucket_start: Date | string | null;
  graph_opportunity_count: number | string | bigint;
  attributed_graph_opportunity_count: number | string | bigint;
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function toSafeCount(value: number | string | bigint, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Unsafe ${label}: ${String(value)}`);
  }
  return parsed;
}

/** Normalize a raw pgvector result and reject empty or nonfinite vectors. */
export function normalizeFinitePgVector(value: unknown): number[] | null {
  const normalized = normalizeEmbedding(value);
  if (normalized.length === 0 || !normalized.every(Number.isFinite)) return null;
  return normalized;
}

async function insertCentroids(
  tx: Parameters<Parameters<DrizzleDB['transaction']>[0]>[0],
  rows: FrameCentroidSnapshotWrite[],
): Promise<number> {
  let insertedCount = 0;
  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + INSERT_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const inserted = await tx.insert(frameCentroidSnapshots)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: frameCentroidSnapshots.id });
    insertedCount += inserted.length;
  }
  return insertedCount;
}

async function insertYieldProxies(
  tx: Parameters<Parameters<DrizzleDB['transaction']>[0]>[0],
  rows: CrossNetworkYieldSnapshotWrite[],
): Promise<number> {
  let insertedCount = 0;
  for (let offset = 0; offset < rows.length; offset += INSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + INSERT_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const inserted = await tx.insert(crossNetworkYieldSnapshots)
      .values(chunk)
      .onConflictDoNothing()
      .returning({ id: crossNetworkYieldSnapshots.id });
    insertedCount += inserted.length;
  }
  return insertedCount;
}

/** Database boundary for immutable frame-drift observation snapshots. */
export class FrameDriftDatabaseAdapter implements FrameDriftSnapshotStore {
  constructor(private readonly database: DrizzleDB = db) {}

  /**
   * Read one repeatable capture-time observation and atomically insert any
   * previously unseen daily rows. Existing bucket rows are never rewritten.
   *
   * @param request - Closed opportunity window, model, privacy, and cohort bounds.
   * @param buildWrites - Pure metric calculation callback owned by the service.
   * @returns Actual inserted row counts; duplicate buckets return zero.
   * @throws When source counts are unsafe or persistence fails.
   */
  async captureAndPersist(
    request: FrameDriftSnapshotRequest,
    buildWrites: (readSet: FrameDriftReadSet) => FrameDriftSnapshotWrites,
  ): Promise<FrameDriftPersistenceResult> {
    const bucketStartIso = request.bucketStart.toISOString();
    const bucketEndIso = request.bucketEnd.toISOString();
    const previousBucketStartIso = request.previousBucketStart.toISOString();

    return this.database.transaction(async (tx) => {
      const selectedRows = await tx.execute<SelectedNetworkRow>(sql`
        SELECT id, count(*) OVER () AS total_count
        FROM networks
        WHERE deleted_at IS NULL AND is_personal = false
        ORDER BY created_at ASC, id ASC
        LIMIT ${request.maxNetworks}
      `);
      const selectedNetworkCount = selectedRows.length;
      const eligibleNetworkCount = selectedRows[0]
        ? toSafeCount(selectedRows[0].total_count, 'eligible network count')
        : 0;
      const stableCohortHash = createHash('sha256')
        .update(selectedRows.map((row) => row.id).join('\n'))
        .digest('hex');
      const totalPossibleCohortPairCount = selectedNetworkCount * (selectedNetworkCount - 1) / 2;
      const selectedPairCount = Math.min(totalPossibleCohortPairCount, request.maxPairs);

      const rawCentroids = await tx.execute<RawCentroidRow>(sql`
        WITH selected_networks AS MATERIALIZED (
          SELECT id
          FROM networks
          WHERE deleted_at IS NULL AND is_personal = false
          ORDER BY created_at ASC, id ASC
          LIMIT ${request.maxNetworks}
        ), corpus_centroids AS (
          SELECT pn.network_id, 'premise'::text AS corpus,
                 avg(p.embedding)::text AS centroid,
                 count(*)::bigint AS sample_count,
                 count(DISTINCT p.user_id)::bigint AS contributing_user_count
          FROM premise_networks pn
          JOIN selected_networks sn ON sn.id = pn.network_id
          JOIN premises p ON p.id = pn.premise_id
          JOIN users u ON u.id = p.user_id AND u.deleted_at IS NULL
          WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE' AND p.embedding IS NOT NULL
          GROUP BY pn.network_id
          UNION ALL
          SELECT ino.network_id, 'intent'::text AS corpus,
                 avg(i.embedding)::text AS centroid,
                 count(*)::bigint AS sample_count,
                 count(DISTINCT i.user_id)::bigint AS contributing_user_count
          FROM intent_networks ino
          JOIN selected_networks sn ON sn.id = ino.network_id
          JOIN intents i ON i.id = ino.intent_id
          JOIN users u ON u.id = i.user_id AND u.deleted_at IS NULL
          WHERE i.archived_at IS NULL
            AND (i.status = 'ACTIVE' OR i.status IS NULL)
            AND i.embedding IS NOT NULL
          GROUP BY ino.network_id
          UNION ALL
          SELECT uc.network_id, 'user_context'::text AS corpus,
                 avg(uc.embedding)::text AS centroid,
                 count(*)::bigint AS sample_count,
                 count(DISTINCT uc.user_id)::bigint AS contributing_user_count
          FROM user_contexts uc
          JOIN selected_networks sn ON sn.id = uc.network_id
          JOIN users u ON u.id = uc.user_id AND u.deleted_at IS NULL
          WHERE uc.network_id IS NOT NULL AND uc.embedding IS NOT NULL
          GROUP BY uc.network_id
        )
        SELECT cc.network_id, cc.corpus, cc.centroid, cc.sample_count,
               cc.contributing_user_count,
               prior.centroid::text AS prior_centroid,
               prior.bucket_start AS prior_bucket_start
        FROM corpus_centroids cc
        LEFT JOIN LATERAL (
          SELECT f.centroid, f.bucket_start
          FROM frame_centroid_snapshots f
          WHERE f.network_id = cc.network_id
            AND f.corpus = cc.corpus
            AND f.embedding_model = ${request.embeddingModel}
            AND f.bucket_start < (${bucketStartIso})::timestamptz
          ORDER BY f.bucket_start DESC
          LIMIT 1
        ) prior ON true
        ORDER BY cc.network_id ASC, cc.corpus ASC
      `);

      let invalidVectorCount = 0;
      let suppressedCentroidCount = 0;
      const centroids: FrameCentroidCandidate[] = [];
      for (const row of rawCentroids) {
        const contributingUserCount = toSafeCount(
          row.contributing_user_count,
          'centroid contributing user count',
        );
        if (contributingUserCount < request.minUsers) {
          suppressedCentroidCount += 1;
          continue;
        }
        const centroid = normalizeFinitePgVector(row.centroid);
        const priorCentroid = row.prior_centroid === null
          ? null
          : normalizeFinitePgVector(row.prior_centroid);
        if (centroid === null) invalidVectorCount += 1;
        if (row.prior_centroid !== null && priorCentroid === null) invalidVectorCount += 1;
        centroids.push({
          networkId: row.network_id,
          corpus: row.corpus,
          centroid,
          sampleCount: toSafeCount(row.sample_count, 'centroid sample count'),
          priorCentroid,
          priorBucketStart: toDate(row.prior_bucket_start),
        });
      }
      const emptyCentroidCount = selectedNetworkCount * CORPUS_COUNT - rawCentroids.length;

      const rawYields = await tx.execute<RawYieldRow>(sql`
        WITH selected_networks AS MATERIALIZED (
          SELECT id
          FROM networks
          WHERE deleted_at IS NULL AND is_personal = false
          ORDER BY created_at ASC, id ASC
          LIMIT ${request.maxNetworks}
        ), selected_pairs AS MATERIALIZED (
          SELECT a.id AS network_a_id, b.id AS network_b_id
          FROM selected_networks a
          JOIN selected_networks b ON a.id < b.id
          ORDER BY a.id ASC, b.id ASC
          LIMIT ${request.maxPairs}
        ), active_owner_counts AS MATERIALIZED (
          SELECT ino.network_id, i.user_id, count(*)::bigint AS intent_count
          FROM intent_networks ino
          JOIN selected_networks sn ON sn.id = ino.network_id
          JOIN intents i ON i.id = ino.intent_id
          JOIN users u ON u.id = i.user_id AND u.deleted_at IS NULL
          WHERE i.archived_at IS NULL
            AND (i.status = 'ACTIVE' OR i.status IS NULL)
            AND i.embedding IS NOT NULL
          GROUP BY ino.network_id, i.user_id
        ), network_totals AS MATERIALIZED (
          SELECT network_id, sum(intent_count)::bigint AS intent_count
          FROM active_owner_counts
          GROUP BY network_id
        ), pair_denominators AS MATERIALIZED (
          SELECT sp.network_a_id,
                 sp.network_b_id,
                 (
                   COALESCE(a.intent_count, 0) * COALESCE(b.intent_count, 0) - COALESCE((
                     SELECT sum(ao.intent_count * bo.intent_count)
                     FROM active_owner_counts ao
                     JOIN active_owner_counts bo ON bo.user_id = ao.user_id
                     WHERE ao.network_id = sp.network_a_id
                       AND bo.network_id = sp.network_b_id
                   ), 0)
                 )::bigint AS potential_intent_pair_count
          FROM selected_pairs sp
          LEFT JOIN network_totals a ON a.network_id = sp.network_a_id
          LEFT JOIN network_totals b ON b.network_id = sp.network_b_id
        ), positive_pairs AS MATERIALIZED (
          SELECT network_a_id, network_b_id, potential_intent_pair_count
          FROM pair_denominators
          WHERE potential_intent_pair_count > 0
        ), graph_opportunities AS MATERIALIZED (
          SELECT o.id, o.created_at, o.actors
          FROM opportunities o
          WHERE o.created_at >= (${bucketStartIso})::timestamptz
            AND o.created_at < (${bucketEndIso})::timestamptz
            AND o.detection->>'source' = 'opportunity_graph'
        ), opportunity_actors AS MATERIALIZED (
          SELECT o.id AS opportunity_id,
                 o.created_at AS opportunity_created_at,
                 actor->>'userId' AS user_id,
                 actor->>'intent' AS intent_id
          FROM graph_opportunities o
          CROSS JOIN LATERAL jsonb_array_elements(o.actors) actor
          WHERE actor->>'role' <> 'introducer'
            AND actor ? 'userId'
            AND actor ? 'intent'
        ), verified_actor_assignments AS MATERIALIZED (
          SELECT DISTINCT oa.opportunity_id, oa.user_id, ino.network_id
          FROM opportunity_actors oa
          JOIN intents i
            ON i.id = oa.intent_id
           AND i.user_id = oa.user_id
           AND i.embedding IS NOT NULL
          JOIN users u ON u.id = i.user_id AND u.deleted_at IS NULL
          JOIN intent_networks ino
            ON ino.intent_id = oa.intent_id
           AND ino.created_at <= oa.opportunity_created_at
          JOIN selected_networks sn ON sn.id = ino.network_id
        ), opportunity_pairs AS MATERIALIZED (
          SELECT DISTINCT a.opportunity_id,
                 a.network_id AS network_a_id,
                 b.network_id AS network_b_id
          FROM verified_actor_assignments a
          JOIN verified_actor_assignments b
            ON b.opportunity_id = a.opportunity_id
           AND b.user_id <> a.user_id
           AND a.network_id < b.network_id
          JOIN selected_pairs sp
            ON sp.network_a_id = a.network_id
           AND sp.network_b_id = b.network_id
        ), opportunity_counts AS MATERIALIZED (
          SELECT network_a_id, network_b_id,
                 count(DISTINCT opportunity_id)::bigint AS opportunity_count
          FROM opportunity_pairs
          GROUP BY network_a_id, network_b_id
        ), proxy_rows AS MATERIALIZED (
          SELECT pp.network_a_id, pp.network_b_id,
                 COALESCE(oc.opportunity_count, 0)::bigint AS opportunity_count,
                 pp.potential_intent_pair_count,
                 prior.yield_rate AS prior_yield_rate,
                 prior.bucket_start AS prior_bucket_start
          FROM positive_pairs pp
          LEFT JOIN opportunity_counts oc
            ON oc.network_a_id = pp.network_a_id
           AND oc.network_b_id = pp.network_b_id
          LEFT JOIN cross_network_yield_snapshots prior
            ON prior.network_a_id = pp.network_a_id
           AND prior.network_b_id = pp.network_b_id
           AND prior.bucket_start = (${previousBucketStartIso})::timestamptz
        ), coverage AS (
          SELECT count(*)::bigint AS graph_opportunity_count,
                 count(*) FILTER (WHERE EXISTS (
                   SELECT 1 FROM opportunity_pairs op WHERE op.opportunity_id = go.id
                 ))::bigint AS attributed_graph_opportunity_count
          FROM graph_opportunities go
        )
        SELECT pr.network_a_id, pr.network_b_id, pr.opportunity_count,
               pr.potential_intent_pair_count, pr.prior_yield_rate,
               pr.prior_bucket_start, c.graph_opportunity_count,
               c.attributed_graph_opportunity_count
        FROM coverage c
        LEFT JOIN proxy_rows pr ON true
        ORDER BY pr.network_a_id ASC NULLS LAST, pr.network_b_id ASC NULLS LAST
      `);

      const coverage = rawYields[0];
      const graphOpportunityCount = coverage
        ? toSafeCount(coverage.graph_opportunity_count, 'graph opportunity count')
        : 0;
      const attributedGraphOpportunityCount = coverage
        ? toSafeCount(coverage.attributed_graph_opportunity_count, 'attributed graph opportunity count')
        : 0;
      const yields: CrossNetworkYieldCandidate[] = rawYields.flatMap((row) => {
        if (
          row.network_a_id === null
          || row.network_b_id === null
          || row.opportunity_count === null
          || row.potential_intent_pair_count === null
        ) return [];
        return [{
          networkAId: row.network_a_id,
          networkBId: row.network_b_id,
          opportunityCount: row.opportunity_count,
          potentialIntentPairCount: row.potential_intent_pair_count,
          priorYieldRate: row.prior_yield_rate,
          priorBucketStart: toDate(row.prior_bucket_start),
        }];
      });

      const writes = buildWrites({
        centroids,
        yields,
        selectedNetworkCount,
        eligibleNetworkCount,
        stableCohortHash,
        totalPossibleCohortPairCount,
        selectedPairCount,
        positiveMeasuredPairCount: yields.length,
        graphOpportunityCount,
        attributedGraphOpportunityCount,
        unattributedGraphOpportunityCount: graphOpportunityCount - attributedGraphOpportunityCount,
        suppressedCentroidCount,
        emptyCentroidCount,
        invalidVectorCount,
      });
      const centroidSnapshotCount = await insertCentroids(tx, writes.centroids);
      const yieldProxySnapshotCount = await insertYieldProxies(tx, writes.yields);

      return { centroidSnapshotCount, yieldProxySnapshotCount };
    }, { isolationLevel: 'repeatable read' });
  }
}

export const frameDriftDatabaseAdapter = new FrameDriftDatabaseAdapter();
