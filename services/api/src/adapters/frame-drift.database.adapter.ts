import { sql } from 'drizzle-orm';

import db, { type DrizzleDB } from '../lib/drizzle/drizzle';
import { crossNetworkYieldSnapshots, frameCentroidSnapshots, type FrameCentroidCorpus } from '../schemas/database.schema';

const UPSERT_CHUNK_SIZE = 500;

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
  eligiblePairCount: number;
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
}

export interface FrameDriftPersistenceResult {
  centroidSnapshotCount: number;
  yieldSnapshotCount: number;
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
  prior_centroid: unknown;
  prior_bucket_start: Date | string | null;
}

interface RawYieldRow extends Record<string, unknown> {
  network_a_id: string;
  network_b_id: string;
  opportunity_count: number | string | bigint;
  potential_intent_pair_count: number | string | bigint;
  prior_yield_rate: number | string | null;
  prior_bucket_start: Date | string | null;
  total_pair_count: number | string | bigint;
}

function toDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function toSafeCount(value: number | string | bigint, label: string): number {
  const parsed = typeof value === 'bigint' ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Unsafe ${label}: ${String(value)}`);
  }
  return parsed;
}

/** Normalize a PostgreSQL pgvector result into a finite numeric array. */
export function normalizePgVector(value: unknown): number[] | null {
  const values = Array.isArray(value)
    ? value
    : typeof value === 'string' && value.startsWith('[') && value.endsWith(']')
      ? value.slice(1, -1).split(',')
      : null;
  if (!values || values.length === 0) return null;

  const normalized = values.map((item) => Number(item));
  return normalized.every(Number.isFinite) ? normalized : null;
}

async function upsertCentroids(
  tx: Parameters<Parameters<DrizzleDB['transaction']>[0]>[0],
  rows: FrameCentroidSnapshotWrite[],
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + UPSERT_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    await tx.insert(frameCentroidSnapshots).values(chunk).onConflictDoUpdate({
      target: [
        frameCentroidSnapshots.networkId,
        frameCentroidSnapshots.corpus,
        frameCentroidSnapshots.embeddingModel,
        frameCentroidSnapshots.bucketStart,
      ],
      set: {
        centroid: sql`excluded.centroid`,
        sampleCount: sql`excluded.sample_count`,
        cosineDrift: sql`excluded.cosine_drift`,
        priorBucketStart: sql`excluded.prior_bucket_start`,
        bucketEnd: sql`excluded.bucket_end`,
        capturedAt: sql`excluded.captured_at`,
      },
    });
  }
}

async function upsertYields(
  tx: Parameters<Parameters<DrizzleDB['transaction']>[0]>[0],
  rows: CrossNetworkYieldSnapshotWrite[],
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += UPSERT_CHUNK_SIZE) {
    const chunk = rows.slice(offset, offset + UPSERT_CHUNK_SIZE);
    if (chunk.length === 0) continue;
    await tx.insert(crossNetworkYieldSnapshots).values(chunk).onConflictDoUpdate({
      target: [
        crossNetworkYieldSnapshots.networkAId,
        crossNetworkYieldSnapshots.networkBId,
        crossNetworkYieldSnapshots.bucketStart,
      ],
      set: {
        opportunityCount: sql`excluded.opportunity_count`,
        potentialIntentPairCount: sql`excluded.potential_active_intent_pair_count`,
        yieldRate: sql`excluded.yield_rate`,
        yieldRateDelta: sql`excluded.yield_rate_delta`,
        priorBucketStart: sql`excluded.prior_bucket_start`,
        bucketEnd: sql`excluded.bucket_end`,
        capturedAt: sql`excluded.captured_at`,
      },
    });
  }
}

/** Database boundary for frame-drift measurement snapshots. */
export class FrameDriftDatabaseAdapter implements FrameDriftSnapshotStore {
  constructor(private readonly database: DrizzleDB = db) {}

  /**
   * Read a bounded, repeatable-read metric snapshot and atomically upsert the
   * derived centroid and yield rows produced by the service callback.
   *
   * @param request - Closed daily bucket, model, and cohort bounds.
   * @param buildWrites - Pure metric calculation callback owned by the service.
   * @returns Counts of snapshot rows persisted.
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
        ORDER BY id ASC
        LIMIT ${request.maxNetworks}
      `);
      const selectedNetworkCount = selectedRows.length;
      const eligibleNetworkCount = selectedRows[0]
        ? toSafeCount(selectedRows[0].total_count, 'eligible network count')
        : 0;

      const rawCentroids = await tx.execute<RawCentroidRow>(sql`
        WITH selected_networks AS MATERIALIZED (
          SELECT id
          FROM networks
          WHERE deleted_at IS NULL AND is_personal = false
          ORDER BY id ASC
          LIMIT ${request.maxNetworks}
        ), corpus_centroids AS (
          SELECT pn.network_id, 'premise'::text AS corpus,
                 avg(p.embedding)::text AS centroid, count(*)::bigint AS sample_count
          FROM premise_networks pn
          JOIN selected_networks sn ON sn.id = pn.network_id
          JOIN premises p ON p.id = pn.premise_id
          WHERE p.deleted_at IS NULL AND p.status = 'ACTIVE' AND p.embedding IS NOT NULL
          GROUP BY pn.network_id
          UNION ALL
          SELECT ino.network_id, 'intent'::text AS corpus,
                 avg(i.embedding)::text AS centroid, count(*)::bigint AS sample_count
          FROM intent_networks ino
          JOIN selected_networks sn ON sn.id = ino.network_id
          JOIN intents i ON i.id = ino.intent_id
          WHERE i.archived_at IS NULL
            AND (i.status = 'ACTIVE' OR i.status IS NULL)
            AND i.embedding IS NOT NULL
          GROUP BY ino.network_id
          UNION ALL
          SELECT uc.network_id, 'user_context'::text AS corpus,
                 avg(uc.embedding)::text AS centroid, count(*)::bigint AS sample_count
          FROM user_contexts uc
          JOIN selected_networks sn ON sn.id = uc.network_id
          WHERE uc.network_id IS NOT NULL AND uc.embedding IS NOT NULL
          GROUP BY uc.network_id
        )
        SELECT cc.network_id, cc.corpus, cc.centroid, cc.sample_count,
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
      const centroids = rawCentroids.map((row): FrameCentroidCandidate => {
        const centroid = normalizePgVector(row.centroid);
        const priorCentroid = row.prior_centroid === null
          ? null
          : normalizePgVector(row.prior_centroid);
        if (centroid === null) invalidVectorCount += 1;
        if (row.prior_centroid !== null && priorCentroid === null) invalidVectorCount += 1;
        return {
          networkId: row.network_id,
          corpus: row.corpus,
          centroid,
          sampleCount: toSafeCount(row.sample_count, 'centroid sample count'),
          priorCentroid,
          priorBucketStart: toDate(row.prior_bucket_start),
        };
      });

      const rawYields = await tx.execute<RawYieldRow>(sql`
        WITH selected_networks AS MATERIALIZED (
          SELECT id
          FROM networks
          WHERE deleted_at IS NULL AND is_personal = false
          ORDER BY id ASC
          LIMIT ${request.maxNetworks}
        ), active_owner_counts AS MATERIALIZED (
          SELECT ino.network_id, i.user_id, count(*)::bigint AS intent_count
          FROM intent_networks ino
          JOIN selected_networks sn ON sn.id = ino.network_id
          JOIN intents i ON i.id = ino.intent_id
          WHERE ino.created_at < (${bucketEndIso})::timestamptz
            AND i.archived_at IS NULL
            AND (i.status = 'ACTIVE' OR i.status IS NULL)
          GROUP BY ino.network_id, i.user_id
        ), network_totals AS MATERIALIZED (
          SELECT network_id, sum(intent_count)::bigint AS intent_count
          FROM active_owner_counts
          GROUP BY network_id
        ), eligible_pairs AS MATERIALIZED (
          SELECT a.network_id AS network_a_id,
                 b.network_id AS network_b_id,
                 (
                   a.intent_count * b.intent_count - COALESCE((
                     SELECT sum(ao.intent_count * bo.intent_count)
                     FROM active_owner_counts ao
                     JOIN active_owner_counts bo ON bo.user_id = ao.user_id
                     WHERE ao.network_id = a.network_id
                       AND bo.network_id = b.network_id
                   ), 0)
                 )::bigint AS potential_intent_pair_count
          FROM network_totals a
          JOIN network_totals b ON a.network_id < b.network_id
        ), positive_pairs AS MATERIALIZED (
          SELECT network_a_id, network_b_id, potential_intent_pair_count
          FROM eligible_pairs
          WHERE potential_intent_pair_count > 0
        ), bounded_pairs AS MATERIALIZED (
          SELECT network_a_id, network_b_id, potential_intent_pair_count,
                 count(*) OVER () AS total_pair_count
          FROM positive_pairs
          ORDER BY potential_intent_pair_count DESC, network_a_id ASC, network_b_id ASC
          LIMIT ${request.maxPairs}
        ), opportunity_actors AS MATERIALIZED (
          SELECT o.id AS opportunity_id,
                 o.created_at AS opportunity_created_at,
                 actor->>'userId' AS user_id,
                 actor->>'intent' AS intent_id
          FROM opportunities o
          CROSS JOIN LATERAL jsonb_array_elements(o.actors) actor
          WHERE o.created_at >= (${bucketStartIso})::timestamptz
            AND o.created_at < (${bucketEndIso})::timestamptz
            AND actor->>'role' <> 'introducer'
            AND actor ? 'userId'
            AND actor ? 'intent'
        ), verified_actor_assignments AS MATERIALIZED (
          SELECT DISTINCT oa.opportunity_id, oa.user_id, ino.network_id
          FROM opportunity_actors oa
          JOIN intents i ON i.id = oa.intent_id AND i.user_id = oa.user_id
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
        ), opportunity_counts AS MATERIALIZED (
          SELECT network_a_id, network_b_id, count(DISTINCT opportunity_id)::bigint AS opportunity_count
          FROM opportunity_pairs
          GROUP BY network_a_id, network_b_id
        )
        SELECT bp.network_a_id, bp.network_b_id,
               COALESCE(oc.opportunity_count, 0)::bigint AS opportunity_count,
               bp.potential_intent_pair_count,
               prior.yield_rate AS prior_yield_rate,
               prior.bucket_start AS prior_bucket_start,
               bp.total_pair_count
        FROM bounded_pairs bp
        LEFT JOIN opportunity_counts oc
          ON oc.network_a_id = bp.network_a_id
         AND oc.network_b_id = bp.network_b_id
        LEFT JOIN cross_network_yield_snapshots prior
          ON prior.network_a_id = bp.network_a_id
         AND prior.network_b_id = bp.network_b_id
         AND prior.bucket_start = (${previousBucketStartIso})::timestamptz
        ORDER BY bp.potential_intent_pair_count DESC, bp.network_a_id ASC, bp.network_b_id ASC
      `);

      const eligiblePairCount = rawYields[0]
        ? toSafeCount(rawYields[0].total_pair_count, 'eligible pair count')
        : 0;
      const yields = rawYields.map((row): CrossNetworkYieldCandidate => ({
        networkAId: row.network_a_id,
        networkBId: row.network_b_id,
        opportunityCount: row.opportunity_count,
        potentialIntentPairCount: row.potential_intent_pair_count,
        priorYieldRate: row.prior_yield_rate,
        priorBucketStart: toDate(row.prior_bucket_start),
      }));

      const writes = buildWrites({
        centroids,
        yields,
        selectedNetworkCount,
        eligibleNetworkCount,
        eligiblePairCount,
        invalidVectorCount,
      });
      await upsertCentroids(tx, writes.centroids);
      await upsertYields(tx, writes.yields);

      return {
        centroidSnapshotCount: writes.centroids.length,
        yieldSnapshotCount: writes.yields.length,
      };
    }, { isolationLevel: 'repeatable read' });
  }
}

export const frameDriftDatabaseAdapter = new FrameDriftDatabaseAdapter();
