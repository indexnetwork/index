/** Default semantic retrieval cutoff; callers may explicitly choose a different floor. */
export const DISCOVERY_MIN_SIMILARITY = 0.20;

/** @param value - Explicit cosine similarity floor. @returns Validated floor. @throws For invalid scores. */
export function validateDiscoveryMinSimilarity(value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('DISCOVERY_MIN_SIMILARITY must be between 0 and 1.');
  return value;
}

/** Recent rejection is returned as evidence for the agent's decision. */
export const REJECTION_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
