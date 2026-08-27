import { RADAR_SOFT_TARGETS } from '../opportunity.utils.js';

/** Input for computing radar health score. */
export interface RadarHealthInput {
  connectionCount: number;
  expiredCount: number;
  totalActionable: number;
  /** Unix ms timestamp of last rediscovery, or null if never. */
  lastRediscoveryAt: number | null;
  /** Window in ms over which freshness decays from 1 → 0 (e.g. 12h). */
  freshnessWindowMs: number;
  /** Score threshold below which shouldMaintain is true. Default 0.5. */
  threshold?: number;
}

/** Output of radar health computation. */
export interface RadarHealthResult {
  score: number;
  breakdown: {
    composition: number;
    freshness: number;
    expirationRatio: number;
  };
  shouldMaintain: boolean;
}

const WEIGHT_COMPOSITION = 0.4;
const WEIGHT_FRESHNESS = 0.3;
const WEIGHT_EXPIRATION = 0.3;
const DEFAULT_THRESHOLD = 0.5;

/**
 * Compute composition sub-score: how close current counts are to soft targets.
 * Uses normalized distance: 1 - (|actual - target| / max(target, actual, 1)) per category,
 * then averages across categories.
 */
function scoreComposition(connectionCount: number, expiredCount: number): number {
  const categories = [
    { actual: connectionCount, target: RADAR_SOFT_TARGETS.connection },
    { actual: expiredCount, target: RADAR_SOFT_TARGETS.expired },
  ];

  let totalScore = 0;
  for (const { actual, target } of categories) {
    const diff = Math.abs(actual - target);
    const denom = Math.max(target, actual, 1);
    totalScore += 1 - diff / denom;
  }

  return totalScore / categories.length;
}

/**
 * Compute freshness sub-score: linear decay from 1 → 0 over freshnessWindowMs.
 */
function scoreFreshness(lastRediscoveryAt: number | null, freshnessWindowMs: number): number {
  if (lastRediscoveryAt == null) return 0;
  const elapsed = Date.now() - lastRediscoveryAt;
  if (elapsed <= 0) return 1;
  if (elapsed >= freshnessWindowMs) return 0;
  return 1 - elapsed / freshnessWindowMs;
}

/**
 * Compute expiration ratio sub-score: 1 - (expired / total).
 */
function scoreExpirationRatio(expiredCount: number, totalActionable: number): number {
  const total = totalActionable + expiredCount;
  if (total === 0) return 0;
  return 1 - expiredCount / total;
}

/**
 * Compute radar health score (0–1) from current radar state.
 * Pure function, no side effects.
 *
 * @param input - Current radar composition and timing data
 * @returns Health score with breakdown and maintenance recommendation
 */
export function computeRadarHealth(input: RadarHealthInput): RadarHealthResult {
  const {
    connectionCount,
    expiredCount,
    totalActionable,
    lastRediscoveryAt,
    freshnessWindowMs,
    threshold = DEFAULT_THRESHOLD,
  } = input;

  // Empty radar is always unhealthy
  if (totalActionable === 0 && expiredCount === 0) {
    return {
      score: 0,
      breakdown: { composition: 0, freshness: 0, expirationRatio: 0 },
      shouldMaintain: true,
    };
  }

  const composition = scoreComposition(connectionCount, expiredCount);
  const freshness = scoreFreshness(lastRediscoveryAt, freshnessWindowMs);
  const expirationRatio = scoreExpirationRatio(expiredCount, totalActionable);

  const score =
    WEIGHT_COMPOSITION * composition +
    WEIGHT_FRESHNESS * freshness +
    WEIGHT_EXPIRATION * expirationRatio;

  return {
    score,
    breakdown: { composition, freshness, expirationRatio },
    shouldMaintain: score < threshold,
  };
}
