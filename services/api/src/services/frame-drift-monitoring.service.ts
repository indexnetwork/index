import { frameDriftDatabaseAdapter, type CrossNetworkYieldCandidate, type CrossNetworkYieldSnapshotWrite, type FrameCentroidCandidate, type FrameCentroidSnapshotWrite, type FrameDriftReadSet, type FrameDriftSnapshotStore, type FrameDriftSnapshotWrites } from '../adapters/frame-drift.database.adapter';
import { resolveFrameDriftMonitoringConfig } from '../lib/frame-drift.config';
import { OPENROUTER_EMBEDDING_MODEL } from '../lib/embedding/embedding.config';
import { log } from '../lib/log';

const UTC_DAY_MS = 24 * 60 * 60 * 1000;

export interface YieldMetrics {
  yieldRate: number;
  yieldRateDelta: number | null;
}

export interface FrameDriftMonitoringResult {
  centroidSnapshotCount: number;
  yieldProxySnapshotCount: number;
  capturedAt: Date;
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
  networksTruncated: boolean;
  pairsTruncated: boolean;
  durationMs: number;
}

function finiteVector(vector: readonly number[] | null): vector is readonly number[] {
  return vector !== null && vector.length > 0 && vector.every(Number.isFinite);
}

/** Calculate cosine drift as one minus clamped cosine similarity. */
export function calculateCosineDrift(
  current: readonly number[] | null,
  prior: readonly number[] | null,
): number | null {
  if (!finiteVector(current) || !finiteVector(prior) || current.length !== prior.length) {
    return null;
  }

  let dot = 0;
  let currentSquared = 0;
  let priorSquared = 0;
  for (let index = 0; index < current.length; index += 1) {
    dot += current[index] * prior[index];
    currentSquared += current[index] * current[index];
    priorSquared += prior[index] * prior[index];
  }
  if (![dot, currentSquared, priorSquared].every(Number.isFinite)) return null;
  if (currentSquared === 0 || priorSquared === 0) return null;

  const similarity = dot / (Math.sqrt(currentSquared) * Math.sqrt(priorSquared));
  if (!Number.isFinite(similarity)) return null;
  return 1 - Math.max(-1, Math.min(1, similarity));
}

function safeNonNegativeInteger(value: number | string | bigint, label: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`Unsafe ${label}: ${String(value)}`);
  }
  return parsed;
}

/** Calculate the intent-assignment-pair normalized opportunity-yield proxy. */
export function calculateYieldMetrics(
  opportunityCountValue: number | string | bigint,
  potentialPairCountValue: number | string | bigint,
  priorYieldRate: number | string | null,
): YieldMetrics {
  const opportunityCount = safeNonNegativeInteger(opportunityCountValue, 'opportunity count');
  const potentialPairCount = safeNonNegativeInteger(potentialPairCountValue, 'potential intent-pair count');
  if (potentialPairCount === 0) {
    throw new Error('Potential intent-pair count must be positive');
  }

  const yieldRate = opportunityCount / potentialPairCount;
  if (!Number.isFinite(yieldRate) || yieldRate < 0) {
    throw new Error('Calculated yield rate is not finite and non-negative');
  }

  if (priorYieldRate === null) return { yieldRate, yieldRateDelta: null };
  const prior = Number(priorYieldRate);
  if (!Number.isFinite(prior) || prior < 0) {
    throw new Error(`Unsafe prior yield rate: ${String(priorYieldRate)}`);
  }
  const yieldRateDelta = yieldRate - prior;
  if (!Number.isFinite(yieldRateDelta)) {
    throw new Error('Calculated yield-rate delta is not finite');
  }
  return { yieldRate, yieldRateDelta };
}

/** Validate that the requested opportunity interval is one closed UTC day. */
export function validateClosedUtcDailyBucket(
  bucketStart: Date,
  bucketEnd: Date,
  now: Date = new Date(),
): void {
  const startMs = bucketStart.getTime();
  const endMs = bucketEnd.getTime();
  if (![startMs, endMs, now.getTime()].every(Number.isFinite)) {
    throw new Error('Frame-drift bucket timestamps must be valid');
  }
  if (
    bucketStart.getUTCHours() !== 0
    || bucketStart.getUTCMinutes() !== 0
    || bucketStart.getUTCSeconds() !== 0
    || bucketStart.getUTCMilliseconds() !== 0
    || endMs - startMs !== UTC_DAY_MS
    || bucketEnd.getUTCHours() !== 0
    || bucketEnd.getUTCMinutes() !== 0
    || bucketEnd.getUTCSeconds() !== 0
    || bucketEnd.getUTCMilliseconds() !== 0
  ) {
    throw new Error('Frame-drift bucket must be exactly one UTC calendar day');
  }
  if (endMs > now.getTime()) {
    throw new Error('Frame-drift bucket must be closed');
  }
}

function buildCentroidWrite(
  candidate: FrameCentroidCandidate,
  embeddingModel: string,
  bucketStart: Date,
  bucketEnd: Date,
  capturedAt: Date,
): FrameCentroidSnapshotWrite | null {
  if (!finiteVector(candidate.centroid)) return null;
  if (!Number.isSafeInteger(candidate.sampleCount) || candidate.sampleCount < 1) {
    throw new Error(`Unsafe centroid sample count: ${candidate.sampleCount}`);
  }
  return {
    networkId: candidate.networkId,
    corpus: candidate.corpus,
    centroid: [...candidate.centroid],
    sampleCount: candidate.sampleCount,
    embeddingModel,
    cosineDrift: calculateCosineDrift(candidate.centroid, candidate.priorCentroid),
    priorBucketStart: candidate.priorCentroid === null ? null : candidate.priorBucketStart,
    bucketStart,
    bucketEnd,
    capturedAt,
  };
}

function buildYieldWrite(
  candidate: CrossNetworkYieldCandidate,
  bucketStart: Date,
  bucketEnd: Date,
  previousBucketStart: Date,
  capturedAt: Date,
): CrossNetworkYieldSnapshotWrite {
  if (candidate.networkAId >= candidate.networkBId) {
    throw new Error('Cross-network yield-proxy pair is not canonical');
  }
  const hasExactPrior = candidate.priorBucketStart?.getTime() === previousBucketStart.getTime();
  const metrics = calculateYieldMetrics(
    candidate.opportunityCount,
    candidate.potentialIntentPairCount,
    hasExactPrior ? candidate.priorYieldRate : null,
  );
  return {
    networkAId: candidate.networkAId,
    networkBId: candidate.networkBId,
    opportunityCount: safeNonNegativeInteger(candidate.opportunityCount, 'opportunity count'),
    potentialIntentPairCount: safeNonNegativeInteger(
      candidate.potentialIntentPairCount,
      'potential intent-pair count',
    ),
    yieldRate: metrics.yieldRate,
    yieldRateDelta: metrics.yieldRateDelta,
    priorBucketStart: hasExactPrior ? candidate.priorBucketStart : null,
    bucketStart,
    bucketEnd,
    capturedAt,
  };
}

/** Measurement-only service for capture-time frame observations and a yield proxy. */
export class FrameDriftMonitoringService {
  private readonly logger = log.service.from('FrameDriftMonitoringService');

  constructor(
    private readonly store: FrameDriftSnapshotStore = frameDriftDatabaseAdapter,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /**
   * Capture observations shortly after one closed UTC opportunity window.
   * Centroids and denominator are capture-time truth, not historical state.
   */
  async captureDailyBucket(bucketStart: Date, bucketEnd: Date): Promise<FrameDriftMonitoringResult> {
    const startedAt = this.clock();
    validateClosedUtcDailyBucket(bucketStart, bucketEnd, startedAt);
    const config = resolveFrameDriftMonitoringConfig();
    const previousBucketStart = new Date(bucketStart.getTime() - UTC_DAY_MS);

    this.logger.info('Frame-drift observation started', {
      event: 'frame_drift_monitoring_started',
      bucketStart: bucketStart.toISOString(),
      bucketEnd: bucketEnd.toISOString(),
      embeddingModel: OPENROUTER_EMBEDDING_MODEL,
      maxNetworks: config.maxNetworks,
      maxPairs: config.maxPairs,
      minUsers: config.minUsers,
    });

    let capturedAt = startedAt;
    let readDiagnostics: Omit<FrameDriftMonitoringResult,
      'centroidSnapshotCount' | 'yieldProxySnapshotCount' | 'capturedAt' | 'durationMs'> = {
        selectedNetworkCount: 0,
        eligibleNetworkCount: 0,
        stableCohortHash: '',
        totalPossibleCohortPairCount: 0,
        selectedPairCount: 0,
        positiveMeasuredPairCount: 0,
        graphOpportunityCount: 0,
        attributedGraphOpportunityCount: 0,
        unattributedGraphOpportunityCount: 0,
        suppressedCentroidCount: 0,
        emptyCentroidCount: 0,
        invalidVectorCount: 0,
        networksTruncated: false,
        pairsTruncated: false,
      };
    let completedWrites: FrameDriftSnapshotWrites = { centroids: [], yields: [] };

    const persisted = await this.store.captureAndPersist({
      bucketStart,
      bucketEnd,
      previousBucketStart,
      embeddingModel: OPENROUTER_EMBEDDING_MODEL,
      maxNetworks: config.maxNetworks,
      maxPairs: config.maxPairs,
      minUsers: config.minUsers,
    }, (readSet: FrameDriftReadSet): FrameDriftSnapshotWrites => {
      capturedAt = this.clock();
      readDiagnostics = {
        selectedNetworkCount: readSet.selectedNetworkCount,
        eligibleNetworkCount: readSet.eligibleNetworkCount,
        stableCohortHash: readSet.stableCohortHash,
        totalPossibleCohortPairCount: readSet.totalPossibleCohortPairCount,
        selectedPairCount: readSet.selectedPairCount,
        positiveMeasuredPairCount: readSet.positiveMeasuredPairCount,
        graphOpportunityCount: readSet.graphOpportunityCount,
        attributedGraphOpportunityCount: readSet.attributedGraphOpportunityCount,
        unattributedGraphOpportunityCount: readSet.unattributedGraphOpportunityCount,
        suppressedCentroidCount: readSet.suppressedCentroidCount,
        emptyCentroidCount: readSet.emptyCentroidCount,
        invalidVectorCount: readSet.invalidVectorCount,
        networksTruncated: readSet.eligibleNetworkCount > readSet.selectedNetworkCount,
        pairsTruncated: readSet.totalPossibleCohortPairCount > readSet.selectedPairCount,
      };
      completedWrites = {
        centroids: readSet.centroids.flatMap((candidate) => {
          const write = buildCentroidWrite(
            candidate,
            OPENROUTER_EMBEDDING_MODEL,
            bucketStart,
            bucketEnd,
            capturedAt,
          );
          return write ? [write] : [];
        }),
        yields: readSet.yields.map((candidate) => buildYieldWrite(
          candidate,
          bucketStart,
          bucketEnd,
          previousBucketStart,
          capturedAt,
        )),
      };
      return completedWrites;
    });

    const bucketDiagnostics = {
      bucketStart: bucketStart.toISOString(),
      bucketEnd: bucketEnd.toISOString(),
      capturedAt: capturedAt.toISOString(),
      ...readDiagnostics,
    };
    if (
      readDiagnostics.invalidVectorCount > 0
      || readDiagnostics.networksTruncated
      || readDiagnostics.pairsTruncated
      || readDiagnostics.suppressedCentroidCount > 0
      || readDiagnostics.emptyCentroidCount > 0
      || readDiagnostics.unattributedGraphOpportunityCount > 0
    ) {
      this.logger.warn('Frame-drift observation completed with coverage warnings', {
        event: 'frame_drift_monitoring_warning',
        ...bucketDiagnostics,
      });
    }

    const topCentroidDrifts = persisted.centroidSnapshotCount === completedWrites.centroids.length
      ? completedWrites.centroids
        .filter((row) => row.cosineDrift !== null)
        .sort((left, right) => (right.cosineDrift ?? 0) - (left.cosineDrift ?? 0))
        .slice(0, 10)
        .map((row) => ({ networkId: row.networkId, corpus: row.corpus, cosineDrift: row.cosineDrift }))
      : [];
    const topNegativeYieldProxyDeltas = persisted.yieldProxySnapshotCount === completedWrites.yields.length
      ? completedWrites.yields
        .filter((row) => row.yieldRateDelta !== null && row.yieldRateDelta < 0)
        .sort((left, right) => (left.yieldRateDelta ?? 0) - (right.yieldRateDelta ?? 0))
        .slice(0, 10)
        .map((row) => ({
          networkAId: row.networkAId,
          networkBId: row.networkBId,
          yieldRateDelta: row.yieldRateDelta,
        }))
      : [];
    const durationMs = Math.max(0, this.clock().getTime() - startedAt.getTime());

    this.logger.info('Frame-drift observation completed', {
      event: 'frame_drift_monitoring_completed',
      ...bucketDiagnostics,
      centroidSnapshotCount: persisted.centroidSnapshotCount,
      yieldProxySnapshotCount: persisted.yieldProxySnapshotCount,
      durationMs,
      topCentroidDrifts,
      topNegativeYieldProxyDeltas,
    });

    return {
      ...persisted,
      capturedAt,
      ...readDiagnostics,
      durationMs,
    };
  }
}

export const frameDriftMonitoringService = new FrameDriftMonitoringService();
