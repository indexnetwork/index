/** Semantic retrieval cutoff, 0..1. */
export const DISCOVERY_MIN_SIMILARITY = 0.20;

/**
 * Minimum opportunities a discovery run surfaces when the pool allows it.
 */
export const DISCOVERY_MIN_MATCHES = 10;

function validateThreshold(name: string, value: number, max: number): number {
  if (!Number.isFinite(value) || value < 0 || value > max) {
    throw new Error(`${name} must be a finite decimal between 0 and ${max} (inclusive)`);
  }
  return value;
}

export function validateDiscoveryMinSimilarity(value: number): number {
  return validateThreshold('DISCOVERY_MIN_SIMILARITY', value, 1);
}

/**
 * IND-567: Cool-down window (ms) for cross-query rejection suppression.
 * Candidates with a recently rejected opportunity within this window
 * receive a similarity penalty during evaluation ranking. 7 days.
 */
export const REJECTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Similarity multiplier applied to candidates that fall within the rejection
 * cool-down window (IND-567). 0.5 halves their ranking score, typically
 * pushing them below the evaluation-batch cut while leaving a soft trace in
 * the trace log rather than silently dropping them.
 */
export const REJECTION_COOLDOWN_SIMILARITY_PENALTY = 0.5;
