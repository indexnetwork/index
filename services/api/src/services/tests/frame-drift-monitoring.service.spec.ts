import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it } from 'bun:test';

import { normalizeFinitePgVector, type FrameDriftReadSet, type FrameDriftSnapshotStore, type FrameDriftSnapshotWrites } from '../../adapters/frame-drift.database.adapter';
import { calculateCosineDrift, calculateYieldMetrics, FrameDriftMonitoringService, validateClosedUtcDailyBucket } from '../frame-drift-monitoring.service';

const BUCKET_START = new Date('2026-07-14T00:00:00.000Z');
const BUCKET_END = new Date('2026-07-15T00:00:00.000Z');
const PREVIOUS_START = new Date('2026-07-13T00:00:00.000Z');
const NOW = new Date('2026-07-16T00:00:00.000Z');

function baseReadSet(): FrameDriftReadSet {
  return {
    centroids: [],
    yields: [],
    selectedNetworkCount: 2,
    eligibleNetworkCount: 2,
    stableCohortHash: 'stable-hash',
    totalPossibleCohortPairCount: 1,
    selectedPairCount: 1,
    positiveMeasuredPairCount: 0,
    graphOpportunityCount: 0,
    attributedGraphOpportunityCount: 0,
    unattributedGraphOpportunityCount: 0,
    suppressedCentroidCount: 0,
    emptyCentroidCount: 6,
    invalidVectorCount: 0,
  };
}

function createStore(
  readSet: FrameDriftReadSet,
  onWrites?: (writes: FrameDriftSnapshotWrites) => void,
): FrameDriftSnapshotStore {
  return {
    async captureAndPersist(_request, buildWrites) {
      const writes = buildWrites(readSet);
      onWrites?.(writes);
      return {
        centroidSnapshotCount: writes.centroids.length,
        yieldProxySnapshotCount: writes.yields.length,
      };
    },
  };
}

describe('frame-drift metric calculations', () => {
  it('normalizes raw pgvector values through the shared helper and rejects nonfinite values', () => {
    expect(normalizeFinitePgVector('[1,2]')).toEqual([1, 2]);
    expect(normalizeFinitePgVector('[1,"NaN"]')).toBeNull();
    expect(normalizeFinitePgVector([1, Number.POSITIVE_INFINITY])).toBeNull();
  });

  it('calculates identical, orthogonal, and opposite centroid drift', () => {
    expect(calculateCosineDrift([1, 0], [1, 0])).toBeCloseTo(0);
    expect(calculateCosineDrift([1, 0], [0, 1])).toBeCloseTo(1);
    expect(calculateCosineDrift([1, 0], [-1, 0])).toBeCloseTo(2);
  });

  it('returns null for no prior, malformed, zero, and dimension-mismatched vectors', () => {
    expect(calculateCosineDrift([1, 0], null)).toBeNull();
    expect(calculateCosineDrift([1, Number.NaN], [1, 0])).toBeNull();
    expect(calculateCosineDrift([0, 0], [1, 0])).toBeNull();
    expect(calculateCosineDrift([1], [1, 0])).toBeNull();
  });

  it('calculates normalized rates, prior deltas, and zero-numerator yield', () => {
    expect(calculateYieldMetrics(2, 4, 0.75)).toEqual({
      yieldRate: 0.5,
      yieldRateDelta: -0.25,
    });
    expect(calculateYieldMetrics(0, 4, null)).toEqual({
      yieldRate: 0,
      yieldRateDelta: null,
    });
    expect(calculateYieldMetrics(3, 1, null).yieldRate).toBe(3);
  });

  it('rejects invalid daily buckets', () => {
    expect(() => validateClosedUtcDailyBucket(
      new Date('2026-07-14T01:00:00Z'),
      BUCKET_END,
      NOW,
    )).toThrow();
    expect(() => validateClosedUtcDailyBucket(
      BUCKET_START,
      new Date('2026-07-16T00:00:00Z'),
      new Date('2026-07-15T12:00:00Z'),
    )).toThrow();
  });
});

describe('FrameDriftMonitoringService', () => {
  it('uses only an exact previous daily bucket for yield delta', async () => {
    const readSet = baseReadSet();
    readSet.totalPossibleCohortPairCount = 2;
    readSet.selectedPairCount = 2;
    readSet.positiveMeasuredPairCount = 2;
    readSet.yields = [
      {
        networkAId: 'a',
        networkBId: 'b',
        opportunityCount: 1,
        potentialIntentPairCount: 2,
        priorYieldRate: 0.75,
        priorBucketStart: PREVIOUS_START,
      },
      {
        networkAId: 'a',
        networkBId: 'c',
        opportunityCount: 1,
        potentialIntentPairCount: 4,
        priorYieldRate: 0.5,
        priorBucketStart: new Date('2026-07-12T00:00:00Z'),
      },
    ];

    let captured: FrameDriftSnapshotWrites | undefined;
    const service = new FrameDriftMonitoringService(
      createStore(readSet, (writes) => { captured = writes; }),
      () => NOW,
    );
    await service.captureDailyBucket(BUCKET_START, BUCKET_END);

    expect(captured?.yields[0].yieldRateDelta).toBe(-0.25);
    expect(captured?.yields[0].priorBucketStart).toEqual(PREVIOUS_START);
    expect(captured?.yields[1].yieldRateDelta).toBeNull();
    expect(captured?.yields[1].priorBucketStart).toBeNull();
  });

  it('skips malformed current centroids and preserves null drift without a prior', async () => {
    const readSet = baseReadSet();
    readSet.invalidVectorCount = 1;
    readSet.centroids = [
      {
        networkId: 'a',
        corpus: 'premise',
        centroid: [1, 0],
        sampleCount: 2,
        priorCentroid: null,
        priorBucketStart: null,
      },
      {
        networkId: 'b',
        corpus: 'intent',
        centroid: [Number.NaN],
        sampleCount: 1,
        priorCentroid: null,
        priorBucketStart: null,
      },
    ];

    let captured: FrameDriftSnapshotWrites | undefined;
    const service = new FrameDriftMonitoringService(
      createStore(readSet, (writes) => { captured = writes; }),
      () => NOW,
    );
    const result = await service.captureDailyBucket(BUCKET_START, BUCKET_END);

    expect(result.centroidSnapshotCount).toBe(1);
    expect(result.invalidVectorCount).toBe(1);
    expect(captured?.centroids[0].cosineDrift).toBeNull();
  });

  it('propagates nonfinite input before any write can occur', async () => {
    const readSet = baseReadSet();
    readSet.positiveMeasuredPairCount = 1;
    readSet.yields = [{
      networkAId: 'a',
      networkBId: 'b',
      opportunityCount: 1,
      potentialIntentPairCount: 2,
      priorYieldRate: Number.POSITIVE_INFINITY,
      priorBucketStart: PREVIOUS_START,
    }];
    let wrote = false;
    const store: FrameDriftSnapshotStore = {
      async captureAndPersist(_request, buildWrites) {
        buildWrites(readSet);
        wrote = true;
        return { centroidSnapshotCount: 0, yieldProxySnapshotCount: 0 };
      },
    };
    const service = new FrameDriftMonitoringService(store, () => NOW);

    await expect(service.captureDailyBucket(BUCKET_START, BUCKET_END)).rejects.toThrow('Unsafe prior yield rate');
    expect(wrote).toBe(false);
  });
});
