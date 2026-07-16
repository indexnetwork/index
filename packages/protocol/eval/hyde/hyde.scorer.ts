import type { HydeGenerationMode } from '../../src/shared/hyde/hyde.env.js';

import { HYDE_LENS_BONUS, HYDE_METRIC_K, HYDE_MIN_SCORE } from './hyde.policy.js';
import type { CandidateScore, EmbeddedCandidate, HydeEvalRunResult, HydeModeSummary, HydeRunRetrievalMetrics, LensQueryEmbedding, RankedCandidate, RelevanceGrade, ResolvedRelevanceGrades } from './hyde.types.js';

export const HYDE_EVAL_DEFAULT_MIN_SCORE = HYDE_MIN_SCORE;
export const HYDE_EVAL_LENS_BONUS_PER_ADDITIONAL_MATCH = HYDE_LENS_BONUS;
export const HYDE_EVAL_METRIC_K = HYDE_METRIC_K;
export const HYDE_EVAL_SCORE_TIE_EPSILON = 1e-12;

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

function resolveRankingOptions(options: HydeRankingOptions): { minScore: number; lensBonus: number } {
  const minScore = options.minScore ?? HYDE_EVAL_DEFAULT_MIN_SCORE;
  const lensBonus = options.lensBonusPerAdditionalMatch
    ?? HYDE_EVAL_LENS_BONUS_PER_ADDITIONAL_MATCH;
  if (!Number.isFinite(minScore) || minScore < 0 || minScore > 1) {
    throw new Error(`minScore must be finite and between 0 and 1 (got ${minScore})`);
  }
  if (!Number.isFinite(lensBonus) || lensBonus < 0) {
    throw new Error(`lensBonusPerAdditionalMatch must be finite and non-negative (got ${lensBonus})`);
  }
  return { minScore, lensBonus };
}

function assertUniqueCandidateIds(candidates: readonly { id: string }[]): void {
  const ids = new Set<string>();
  for (const candidate of candidates) {
    if (candidate.id.length === 0) throw new Error('Candidate IDs must be non-empty');
    if (ids.has(candidate.id)) throw new Error(`Duplicate candidate ID: ${candidate.id}`);
    ids.add(candidate.id);
  }
}

/**
 * Score every candidate while approximating EmbedderAdapter's merge behavior.
 * Raw cosine is retained independently from qualification and bonus scoring.
 */
export function scoreAllCandidates(
  queryEmbeddings: readonly LensQueryEmbedding[],
  candidates: readonly EmbeddedCandidate[],
  options: HydeRankingOptions = {},
): CandidateScore[] {
  const { minScore, lensBonus } = resolveRankingOptions(options);
  assertUniqueCandidateIds(candidates);

  return candidates.map((candidate) => {
    const matches = queryEmbeddings.map(({ lensId, embedding }) => ({
      lensId,
      cosine: cosineSimilarity(embedding, candidate.embedding),
    }));
    const qualifyingMatches = matches.filter((match) => match.cosine >= minScore);
    const qualified = qualifyingMatches.length > 0;
    const maxCosine = matches.length === 0
      ? 0
      : Math.max(...matches.map((match) => match.cosine));

    return {
      candidateId: candidate.id,
      role: candidate.role,
      relevanceGrade: candidate.relevanceGrade,
      corpus: candidate.corpus,
      ...(candidate.hardNegativeOf ? { hardNegativeOf: candidate.hardNegativeOf } : {}),
      score: qualified
        ? Math.min(maxCosine + lensBonus * (qualifyingMatches.length - 1), 1)
        : 0,
      lensMatches: matches,
      maxCosine,
      qualifyingMatchCount: qualifyingMatches.length,
      matchedLensIds: qualifyingMatches.map((match) => match.lensId),
      qualified,
    };
  });
}

/** Qualified candidates sorted by descending bonus-adjusted score with stable ties. */
export function rankCandidates(
  queryEmbeddings: readonly LensQueryEmbedding[],
  candidates: readonly EmbeddedCandidate[],
  options: HydeRankingOptions = {},
): RankedCandidate[] {
  return scoreAllCandidates(queryEmbeddings, candidates, options)
    .filter((candidate): candidate is RankedCandidate => candidate.qualified)
    .sort((left, right) => right.score - left.score);
}

/** Average rank within an epsilon score tie, avoiding arbitrary ID-order metrics. */
export function expectedTargetRank(ranking: RankedCandidate[], expectedTargetId: string): number | null {
  const target = ranking.find((candidate) => candidate.candidateId === expectedTargetId);
  if (!target) return null;
  const higher = ranking.filter(
    (candidate) => candidate.score > target.score + HYDE_EVAL_SCORE_TIE_EPSILON,
  ).length;
  const tied = ranking.filter(
    (candidate) => Math.abs(candidate.score - target.score) <= HYDE_EVAL_SCORE_TIE_EPSILON,
  ).length;
  return higher + 1 + (tied - 1) / 2;
}

function resolvedGradeEntries(grades: ResolvedRelevanceGrades): Array<[string, RelevanceGrade]> {
  if (grades instanceof Map) return [...grades.entries()];
  return Object.entries(grades) as Array<[string, RelevanceGrade]>;
}

function validatedResolvedGrades(
  scores: readonly CandidateScore[],
  grades: ResolvedRelevanceGrades,
): Map<string, RelevanceGrade> {
  const scoreIds = new Set<string>();
  for (const candidate of scores) {
    if (candidate.candidateId.length === 0) throw new Error('Candidate IDs must be non-empty');
    if (scoreIds.has(candidate.candidateId)) {
      throw new Error(`Duplicate scored candidate ID: ${candidate.candidateId}`);
    }
    if (!Number.isFinite(candidate.score) || !Number.isFinite(candidate.maxCosine)) {
      throw new Error(`Candidate ${candidate.candidateId} must have finite scores`);
    }
    scoreIds.add(candidate.candidateId);
  }

  const resolved = new Map<string, RelevanceGrade>();
  for (const [candidateId, grade] of resolvedGradeEntries(grades)) {
    if (candidateId.length === 0) throw new Error('Resolved candidate IDs must be non-empty');
    if (resolved.has(candidateId)) throw new Error(`Duplicate resolved candidate ID: ${candidateId}`);
    if (grade !== 0 && grade !== 1 && grade !== 2 && grade !== 3) {
      throw new Error(`Resolved relevance grade for ${candidateId} must be 0, 1, 2, or 3`);
    }
    resolved.set(candidateId, grade);
  }

  const missing = [...scoreIds].filter((candidateId) => !resolved.has(candidateId)).sort();
  const extra = [...resolved.keys()].filter((candidateId) => !scoreIds.has(candidateId)).sort();
  if (missing.length > 0 || extra.length > 0) {
    throw new Error(
      `Resolved grade coverage must exactly match candidate IDs; missing=[${missing.join(',')}], extra=[${extra.join(',')}]`,
    );
  }

  for (const candidate of scores) {
    const linkedId = candidate.hardNegativeOf?.positiveCandidateId;
    if (linkedId !== undefined && !scoreIds.has(linkedId)) {
      throw new Error(`Hard negative ${candidate.candidateId} links unknown candidate ID ${linkedId}`);
    }
  }
  return resolved;
}

interface ScoreTieGroup {
  candidates: RankedCandidate[];
  startIndex: number;
}

function rankedTieGroups(scores: readonly CandidateScore[]): ScoreTieGroup[] {
  const ranking = scores
    .filter((candidate): candidate is RankedCandidate => candidate.qualified)
    .sort((left, right) => right.score - left.score);
  const groups: ScoreTieGroup[] = [];
  for (const candidate of ranking) {
    const current = groups[groups.length - 1];
    if (current
      && Math.abs(current.candidates[0].score - candidate.score) <= HYDE_EVAL_SCORE_TIE_EPSILON) {
      current.candidates.push(candidate);
    } else {
      groups.push({ candidates: [candidate], startIndex: groups.reduce((sum, group) => sum + group.candidates.length, 0) });
    }
  }
  return groups;
}

function inclusionWeight(group: ScoreTieGroup, k: number): number {
  const slotsRemaining = Math.max(0, Math.min(group.candidates.length, k - group.startIndex));
  return slotsRemaining / group.candidates.length;
}

function discount(positionIndex: number): number {
  return 1 / Math.log2(positionIndex + 2);
}

/**
 * Compute canonical run metrics from independently resolved relevance grades.
 * Authored construction grades are deliberately never consulted.
 */
export function computeRunRetrievalMetrics(
  allCandidateScores: readonly CandidateScore[],
  resolvedGrades: ResolvedRelevanceGrades,
): HydeRunRetrievalMetrics {
  const grades = validatedResolvedGrades(allCandidateScores, resolvedGrades);
  const groups = rankedTieGroups(allCandidateScores);
  const k = HYDE_EVAL_METRIC_K;

  let weightedPositiveCount = 0;
  let dcg = 0;
  for (const group of groups) {
    if (group.startIndex >= k) break;
    const weight = inclusionWeight(group, k);
    weightedPositiveCount += group.candidates.reduce(
      (sum, candidate) => sum + (grades.get(candidate.candidateId)! > 0 ? weight : 0),
      0,
    );

    const occupiedCount = Math.min(group.candidates.length, k - group.startIndex);
    const expectedDiscount = Array.from(
      { length: occupiedCount },
      (_, offset) => discount(group.startIndex + offset),
    ).reduce((sum, value) => sum + value, 0) / group.candidates.length;
    dcg += group.candidates.reduce(
      (sum, candidate) => sum + (2 ** grades.get(candidate.candidateId)! - 1) * expectedDiscount,
      0,
    );
  }

  const idealGrades = [...grades.values()].sort((left, right) => right - left).slice(0, k);
  const idcg = idealGrades.reduce<number>(
    (sum, grade, index) => sum + (2 ** grade - 1) * discount(index),
    0,
  );

  const validHardNegatives = allCandidateScores.filter(
    (candidate) => candidate.hardNegativeOf !== undefined && grades.get(candidate.candidateId) === 0,
  );
  let weightedRetrievedHardNegatives = 0;
  if (validHardNegatives.length > 0) {
    const validIds = new Set(validHardNegatives.map((candidate) => candidate.candidateId));
    for (const group of groups) {
      if (group.startIndex >= k) break;
      const weight = inclusionWeight(group, k);
      weightedRetrievedHardNegatives += group.candidates.reduce(
        (sum, candidate) => sum + (validIds.has(candidate.candidateId) ? weight : 0),
        0,
      );
    }
  }

  const positives = allCandidateScores.filter(
    (candidate) => grades.get(candidate.candidateId)! > 0,
  );
  const margins: number[] = [];
  for (const positive of positives) {
    const linkedNegatives = validHardNegatives.filter(
      (candidate) => candidate.hardNegativeOf?.positiveCandidateId === positive.candidateId,
    );
    if (linkedNegatives.length === 0) continue;
    margins.push(
      positive.maxCosine - Math.max(...linkedNegatives.map((candidate) => candidate.maxCosine)),
    );
  }

  return {
    precisionAt5: weightedPositiveCount / k,
    ndcgAt5: idcg === 0 ? 0 : dcg / idcg,
    hardNegativeFprAt5: validHardNegatives.length === 0
      ? null
      : weightedRetrievedHardNegatives / validHardNegatives.length,
    margin: margins.length === 0
      ? null
      : margins.reduce((sum, value) => sum + value, 0) / margins.length,
  };
}

type LegacyRankedRun = HydeEvalRunResult & { expectedTargetRank?: number | null };

/**
 * Legacy report aggregation retained for the pre-collection debug command.
 * Collection run results deliberately carry no canonical target rank.
 */
export function aggregateMode(
  mode: HydeGenerationMode,
  runs: LegacyRankedRun[],
  recallK: number,
): HydeModeSummary {
  if (!Number.isInteger(recallK) || recallK < 1) throw new Error('recallK must be a positive integer');
  if (runs.some((run) => run.mode !== mode)) throw new Error(`Cannot aggregate non-${mode} runs`);

  const hitCount = runs.filter((run) =>
    run.expectedTargetRank !== undefined
      && run.expectedTargetRank !== null
      && run.expectedTargetRank <= recallK).length;
  const reciprocalRankSum = runs.reduce((sum, run) =>
    sum + (run.expectedTargetRank === undefined || run.expectedTargetRank === null
      ? 0
      : 1 / run.expectedTargetRank), 0);
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
