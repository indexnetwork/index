import type { HydeGenerationMode } from '../../src/shared/hyde/hyde.env.js';

import type { EmbeddedCandidate, HydeEvalRunResult, HydeModeSummary, LensQueryEmbedding, RankedCandidate } from './hyde.types.js';

export const HYDE_EVAL_DEFAULT_MIN_SCORE = 0.40;
export const HYDE_EVAL_LENS_BONUS_PER_ADDITIONAL_MATCH = 0.1;

export interface HydeRankingOptions {
  minScore?: number;
  lensBonusPerAdditionalMatch?: number;
}

/** Cosine similarity with strict shape/finite checks so broken eval input fails loudly. */
export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) {
    throw new Error(`Embedding dimensions must match and be non-empty (${left.length} vs ${right.length})`);
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let i = 0; i < left.length; i += 1) {
    const a = left[i];
    const b = right[i];
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new Error('Embeddings must contain only finite numbers');
    }
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }

  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

/**
 * Approximate EmbedderAdapter's current merge/rank behavior for one row per user.
 * Each candidate-lens cosine must clear minScore. The headline score is the best
 * qualifying cosine plus 0.1 per additional qualifying match, capped at one.
 */
export function rankCandidates(
  queryEmbeddings: LensQueryEmbedding[],
  candidates: EmbeddedCandidate[],
  options: HydeRankingOptions = {},
): RankedCandidate[] {
  if (queryEmbeddings.length === 0) return [];

  const minScore = options.minScore ?? HYDE_EVAL_DEFAULT_MIN_SCORE;
  const lensBonus = options.lensBonusPerAdditionalMatch
    ?? HYDE_EVAL_LENS_BONUS_PER_ADDITIONAL_MATCH;
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
    throw new Error(`minScore must be finite and between 0 and 1 (got ${minScore})`);
  }
  if (!Number.isFinite(lensBonus) || lensBonus < 0) {
    throw new Error(`lensBonusPerAdditionalMatch must be finite and non-negative (got ${lensBonus})`);
  }

  return candidates
    .map((candidate): RankedCandidate | null => {
      const qualifyingMatches = queryEmbeddings
        .map(({ lensId, embedding }) => ({
          lensId,
          cosine: cosineSimilarity(embedding, candidate.embedding),
        }))
        .filter((match) => match.cosine >= minScore);
      if (qualifyingMatches.length === 0) return null;

      const maxCosine = Math.max(...qualifyingMatches.map((match) => match.cosine));
      return {
        candidateId: candidate.id,
        role: candidate.role,
        score: Math.min(maxCosine + lensBonus * (qualifyingMatches.length - 1), 1),
        maxCosine,
        qualifyingMatchCount: qualifyingMatches.length,
        matchedLensIds: qualifyingMatches.map((match) => match.lensId),
      };
    })
    .filter((candidate): candidate is RankedCandidate => candidate !== null)
    // JavaScript's stable sort preserves the authored candidate order for score
    // ties; headline rank below is tie-aware and does not depend on that order.
    .sort((left, right) => right.score - left.score);
}

/** Average rank within an exact score tie, avoiding arbitrary ID-order metrics. */
export function expectedTargetRank(ranking: RankedCandidate[], expectedTargetId: string): number | null {
  const target = ranking.find((candidate) => candidate.candidateId === expectedTargetId);
  if (!target) return null;
  const epsilon = 1e-12;
  const higher = ranking.filter((candidate) => candidate.score > target.score + epsilon).length;
  const tied = ranking.filter((candidate) => Math.abs(candidate.score - target.score) <= epsilon).length;
  return higher + 1 + (tied - 1) / 2;
}

/** Aggregate paired run outcomes for one mode. Counts are totals, not rounded averages. */
export function aggregateMode(
  mode: HydeGenerationMode,
  runs: HydeEvalRunResult[],
  recallK: number,
): HydeModeSummary {
  if (!Number.isInteger(recallK) || recallK < 1) throw new Error('recallK must be a positive integer');
  if (runs.some((run) => run.mode !== mode)) throw new Error(`Cannot aggregate non-${mode} runs`);

  const hitCount = runs.filter((run) => run.expectedTargetRank !== null && run.expectedTargetRank <= recallK).length;
  const reciprocalRankSum = runs.reduce(
    (sum, run) => sum + (run.expectedTargetRank === null ? 0 : 1 / run.expectedTargetRank),
    0,
  );
  const rejectionApplicable = runs.some((run) => run.rejectedCount !== null);

  return {
    mode,
    runCount: runs.length,
    recallAtK: runs.length === 0 ? 0 : hitCount / runs.length,
    mrr: runs.length === 0 ? 0 : reciprocalRankSum / runs.length,
    generatedDocumentCount: runs.reduce((sum, run) => sum + run.generatedDocumentCount, 0),
    overwrittenDocumentCount: runs.reduce((sum, run) => sum + run.overwrittenDocumentCount, 0),
    rejectedCount: rejectionApplicable
      ? runs.reduce((sum, run) => sum + (run.rejectedCount ?? 0), 0)
      : null,
    failedOpenCount: runs.reduce((sum, run) => sum + run.failedOpenCount, 0),
  };
}
