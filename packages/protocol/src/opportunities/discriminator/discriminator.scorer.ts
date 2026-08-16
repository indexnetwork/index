/**
 * Pool-axis VoI scorer — pure functions, no LLM, no I/O (IND-417).
 *
 * VoI = H_norm × coverage^1.5 × novelty
 *
 *   H_norm    score-weighted entropy over the axis sides, normalized by
 *             log2(k). Entropy is computed over candidate *score mass*
 *             (confidence weights), not head counts, so a balanced split of
 *             low-confidence junk-tail candidates doesn't inflate VoI.
 *   coverage  fraction of total pool score mass with a verified side
 *             assignment. The ^1.5 exponent is the anti-vague-axis knob:
 *             axes the LLM couldn't ground in evidence lose fast.
 *   novelty   1 − max cosine similarity between the axis embedding and
 *             reference embeddings (existing premises, intent sentences).
 *             An axis the user has already answered elsewhere scores ~0.
 */

import type { MinedDiscriminator, PoolCandidate, ScoredDiscriminator } from "./discriminator.types.js";

/** Cosine similarity of two equal-length vectors, in [-1, 1]. 0 for degenerate input. */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Novelty of an axis vs reference texts: 1 − max cosine similarity, clamped
 * to [0, 1]. No references → 1 (fully novel).
 */
export function computeNovelty(axisEmbedding: number[], referenceEmbeddings: number[][]): number {
  if (referenceEmbeddings.length === 0) return 1;
  let maxSim = 0;
  for (const ref of referenceEmbeddings) {
    const sim = cosineSimilarity(axisEmbedding, ref);
    if (sim > maxSim) maxSim = sim;
  }
  return Math.min(1, Math.max(0, 1 - maxSim));
}

/**
 * Weight for one candidate's score mass. Negative/NaN scores contribute 0;
 * when the whole pool has zero mass the caller falls back to count weights.
 */
function massOf(score: number): number {
  return Number.isFinite(score) && score > 0 ? score : 0;
}

/**
 * Score one mined axis against its pool.
 *
 * @param axis        Mined axis with verified assignments (one per candidate).
 * @param candidates  The pool (provides score mass per candidate id).
 * @param novelty     Precomputed novelty in [0,1] (see {@link computeNovelty}).
 */
export function scoreDiscriminator(
  axis: MinedDiscriminator,
  candidates: PoolCandidate[],
  novelty: number,
): ScoredDiscriminator {
  const massById = new Map<string, number>();
  let totalMass = 0;
  for (const c of candidates) {
    const m = massOf(c.score);
    massById.set(c.id, m);
    totalMass += m;
  }
  // Degenerate pool (all zero/invalid scores): fall back to count weights.
  const useCounts = totalMass <= 0;
  if (useCounts) {
    totalMass = candidates.length;
    for (const c of candidates) massById.set(c.id, 1);
  }

  const sideMass = new Map<string, number>();
  let assignedMass = 0;
  for (const a of axis.assignments) {
    if (a.side === null || !a.verified) continue;
    if (!axis.sides.includes(a.side)) continue;
    const m = massById.get(a.id) ?? 0;
    if (m <= 0) continue;
    sideMass.set(a.side, (sideMass.get(a.side) ?? 0) + m);
    assignedMass += m;
  }

  const k = axis.sides.length;
  let entropy = 0;
  if (assignedMass > 0 && k >= 2) {
    let h = 0;
    for (const mass of sideMass.values()) {
      const p = mass / assignedMass;
      if (p > 0) h -= p * Math.log2(p);
    }
    entropy = h / Math.log2(k);
  }

  const coverage = totalMass > 0 ? assignedMass / totalMass : 0;
  const clampedNovelty = Math.min(1, Math.max(0, novelty));
  const voi = entropy * Math.pow(coverage, 1.5) * clampedNovelty;

  return { ...axis, entropy, coverage, novelty: clampedNovelty, voi };
}
