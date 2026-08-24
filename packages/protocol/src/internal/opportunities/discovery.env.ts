/**
 * Discovery retrieval thresholds.
 *
 * Discovery is intent-to-intent. The match-type and profile-source gates
 * (DISCOVERY_ALLOWED_TYPES, DISCOVERY_PROFILE_SOURCE) are gone with the
 * profile corpus they selected.
 */

/** Semantic retrieval cutoff, 0..1. */
export const DISCOVERY_MIN_SIMILARITY = 0.20;

/** Floor an evaluator score must clear for the opportunity to be accepted. */
export const DISCOVERY_EVALUATOR_MIN_SCORE = 40;

/**
 * Minimum opportunities a discovery run tries to surface when the pool
 * allows it. When fewer than this many candidates pass evaluation, the run
 * fills the rest with the best-scored rejected candidates (their real, low
 * score is persisted so they stay distinguishable downstream).
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

export function validateDiscoveryEvaluatorMinScore(value: number): number {
  return validateThreshold('DISCOVERY_EVALUATOR_MIN_SCORE', value, 100);
}
