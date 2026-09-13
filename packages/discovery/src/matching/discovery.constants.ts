/** Semantic retrieval cutoff, 0..1. */
export const DISCOVERY_MIN_SIMILARITY = 0.20;

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
