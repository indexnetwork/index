import { describe, expect, it } from 'bun:test';

import { aggregateMode, computeRunRetrievalMetrics, cosineSimilarity, expectedTargetRank, HYDE_EVAL_DEFAULT_MIN_SCORE, HYDE_EVAL_LENS_BONUS_PER_ADDITIONAL_MATCH, rankCandidates, scoreAllCandidates } from '../hyde.scorer.js';
import type { CandidateScore, EmbeddedCandidate, HydeEvalRunResult, LensQueryEmbedding, RelevanceGrade } from '../hyde.types.js';

const candidates: EmbeddedCandidate[] = [
  { id: 'target', role: 'positive', relevanceGrade: 3, corpus: 'premises', text: 'target', embedding: [1, 0] },
  {
    id: 'trap',
    role: 'hard-negative',
    relevanceGrade: 0,
    corpus: 'intents',
    text: 'trap',
    hardNegativeOf: { positiveCandidateId: 'target', axis: 'polarity', rationale: 'opposite role' },
    embedding: [0, 1],
  },
  { id: 'distractor', role: 'distractor', relevanceGrade: 0, corpus: 'premises', text: 'distractor', embedding: [-1, 0] },
];

const queryEmbeddings: LensQueryEmbedding[] = [
  { lensId: 'lens-a', corpus: 'premises', embedding: [0.8, 0.6] },
  { lensId: 'lens-b', corpus: 'intents', embedding: [0.6, 0.8] },
];

function score(
  candidateId: string,
  adjustedScore: number,
  maxCosine: number,
  options: Partial<CandidateScore> = {},
): CandidateScore {
  return {
    candidateId,
    role: 'distractor',
    relevanceGrade: 0,
    corpus: 'premises',
    score: adjustedScore,
    lensMatches: adjustedScore > 0 ? [{ lensId: 'lens', cosine: maxCosine }] : [],
    maxCosine,
    qualifyingMatchCount: adjustedScore > 0 ? 1 : 0,
    matchedLensIds: adjustedScore > 0 ? ['lens'] : [],
    qualified: adjustedScore > 0,
    ...options,
  };
}

function grades(entries: Array<[string, RelevanceGrade]>): Readonly<Record<string, RelevanceGrade>> {
  return Object.fromEntries(entries) as Readonly<Record<string, RelevanceGrade>>;
}

type LegacyRankedResult = HydeEvalRunResult & { expectedTargetRank: number | null };

function result(overrides: Partial<LegacyRankedResult> = {}): LegacyRankedResult {
  return {
    caseId: 'case',
    mode: 'frame-v1',
    run: 1,
    expectedTargetRank: 1,
    allCandidateScores: [],
    ranking: [],
    lensCount: 2,
    returnedDocumentCount: 1,
    generatedDocumentCount: 2,
    overwrittenDocumentCount: 0,
    validatorSubmittedDocumentCount: 2,
    rejectedCount: 1,
    failedOpenCount: 0,
    documents: [],
    resources: {
      lensInferenceCalls: [],
      generatorCalls: [],
      validatorCalls: [],
      documentEmbeddingCalls: [],
    },
    ...overrides,
  };
}

describe('HyDE retrieval candidate scoring', () => {
  it('computes cosine similarity and rejects invalid vector shapes', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(() => cosineSimilarity([1], [1, 0])).toThrow('dimensions must match');
    expect(() => cosineSimilarity([Number.NaN], [1])).toThrow('finite');
  });

  it('preserves the exact 0.30 cutoff and 0.1 additional-lens bonus', () => {
    expect(HYDE_EVAL_DEFAULT_MIN_SCORE).toBe(0.30);
    expect(HYDE_EVAL_LENS_BONUS_PER_ADDITIONAL_MATCH).toBe(0.1);
    const exactCutoff = Math.sqrt(1 - 0.3 ** 2);
    const half = Math.sqrt(1 - 0.5 ** 2);
    const scored = scoreAllCandidates([
      { lensId: 'cutoff', corpus: 'premises', embedding: [0.3, exactCutoff] },
      { lensId: 'best', corpus: 'premises', embedding: [0.5, half] },
    ], [candidates[0]]);

    expect(scored[0]).toMatchObject({
      qualified: true,
      qualifyingMatchCount: 2,
      matchedLensIds: ['cutoff', 'best'],
    });
    expect(scored[0]?.maxCosine).toBeCloseTo(0.5, 12);
    expect(scored[0]?.score).toBeCloseTo(0.6, 12);
  });

  it('retains metadata and raw scores for every candidate while ranking only qualifiers', () => {
    const allScores = scoreAllCandidates(queryEmbeddings, candidates);
    expect(allScores).toHaveLength(candidates.length);
    expect(allScores.map((candidate) => candidate.candidateId)).toEqual([
      'target',
      'trap',
      'distractor',
    ]);
    expect(allScores[1]).toMatchObject({
      role: 'hard-negative',
      relevanceGrade: 0,
      corpus: 'intents',
      hardNegativeOf: { positiveCandidateId: 'target', axis: 'polarity' },
      qualified: true,
    });
    expect(allScores[2]).toMatchObject({
      score: 0,
      maxCosine: -0.6,
      qualifyingMatchCount: 0,
      matchedLensIds: [],
      qualified: false,
    });

    const ranking = rankCandidates(queryEmbeddings, candidates);
    expect(ranking.map((candidate) => candidate.candidateId)).toEqual(['target', 'trap']);
    expect(ranking.every((candidate) => candidate.qualified)).toBeTrue();
    expect(expectedTargetRank(ranking, 'target')).toBe(1.5);
    expect(expectedTargetRank([...ranking].reverse(), 'target')).toBe(1.5);
  });

  it('returns zero raw and adjusted scores for every candidate when there are no queries', () => {
    expect(scoreAllCandidates([], candidates)).toEqual(candidates.map((candidate) => ({
      candidateId: candidate.id,
      role: candidate.role,
      relevanceGrade: candidate.relevanceGrade,
      corpus: candidate.corpus,
      ...(candidate.hardNegativeOf ? { hardNegativeOf: candidate.hardNegativeOf } : {}),
      score: 0,
      lensMatches: [],
      maxCosine: 0,
      qualifyingMatchCount: 0,
      matchedLensIds: [],
      qualified: false,
    })));
    expect(rankCandidates([], candidates)).toEqual([]);
  });
});

describe('canonical HyDE run retrieval metrics', () => {
  it('fractionally includes a score tie crossing K=5 and is candidate-order invariant', () => {
    const scores = [
      score('a', 0.9, 0.9),
      score('b', 0.8, 0.8),
      score('c', 0.7, 0.7),
      score('d', 0.6, 0.6),
      score('e', 0.6, 0.6),
      score('f', 0.6, 0.6),
      score('g', 0.6, 0.6),
    ];
    const resolved = grades([
      ['a', 1], ['b', 1], ['c', 1], ['d', 1], ['e', 0], ['f', 1], ['g', 0],
    ]);

    const forward = computeRunRetrievalMetrics(scores, resolved);
    const reversed = computeRunRetrievalMetrics([...scores].reverse(), resolved);
    expect(forward.precisionAt5).toBe(0.8);
    expect(reversed).toEqual(forward);
  });

  it('uses graded gains and expected discounts for a tied nDCG group', () => {
    const scores = [score('high', 0.9, 0.9), score('low', 0.9, 0.9), score('mid', 0.8, 0.8)];
    const metrics = computeRunRetrievalMetrics(scores, grades([
      ['high', 3], ['low', 1], ['mid', 2],
    ]));
    const d0 = 1;
    const d1 = 1 / Math.log2(3);
    const d2 = 1 / Math.log2(4);
    const actual = (7 + 1) * ((d0 + d1) / 2) + 3 * d2;
    const ideal = 7 * d0 + 3 * d1 + 1 * d2;
    expect(metrics.ndcgAt5).toBeCloseTo(actual / ideal, 12);
  });

  it('defines hard-negative FPR over all authored linked negatives still resolved zero', () => {
    const linked = (candidateId: string, adjustedScore: number, resolvedAsPositive = false) => score(
      candidateId,
      adjustedScore,
      adjustedScore,
      {
        role: 'hard-negative',
        hardNegativeOf: { positiveCandidateId: 'positive', axis: 'axis', rationale: 'linked' },
        relevanceGrade: resolvedAsPositive ? 0 : 3,
      },
    );
    const scores = [
      score('positive', 0.95, 0.7),
      linked('hn-retrieved-1', 0.9),
      linked('hn-retrieved-2', 0.8),
      score('other-1', 0.7, 0.7),
      score('other-2', 0.6, 0.6),
      linked('hn-omitted', 0),
      linked('hn-regraded', 0.99, true),
    ];
    const metrics = computeRunRetrievalMetrics(scores, grades([
      ['positive', 3],
      ['hn-retrieved-1', 0],
      ['hn-retrieved-2', 0],
      ['other-1', 0],
      ['other-2', 0],
      ['hn-omitted', 0],
      ['hn-regraded', 1],
    ]));
    expect(metrics.hardNegativeFprAt5).toBeCloseTo(2 / 3);
  });

  it('calculates linked positive margin from raw cosine rather than bonus score', () => {
    const scores = [
      score('positive', 0.8, 0.6, { relevanceGrade: 0 }),
      score('negative', 0.55, 0.55, {
        role: 'hard-negative',
        relevanceGrade: 3,
        hardNegativeOf: { positiveCandidateId: 'positive', axis: 'role', rationale: 'opposite' },
      }),
    ];
    const metrics = computeRunRetrievalMetrics(scores, grades([['positive', 2], ['negative', 0]]));
    expect(metrics.margin).toBeCloseTo(0.05);
  });

  it('returns zero when IDCG is zero and explicit nulls when linked metrics are unavailable', () => {
    const zeroIdcg = computeRunRetrievalMetrics(
      [score('irrelevant', 0.5, 0.5, { relevanceGrade: 3 })],
      grades([['irrelevant', 0]]),
    );
    expect(zeroIdcg.ndcgAt5).toBe(0);

    const unavailable = computeRunRetrievalMetrics(
      [score('positive', 0, 0, { relevanceGrade: 0 })],
      grades([['positive', 3]]),
    );
    expect(unavailable).toMatchObject({
      precisionAt5: 0,
      ndcgAt5: 0,
      hardNegativeFprAt5: null,
      margin: null,
    });
  });

  it('rejects unresolved, extra, duplicate, and invalid linked candidate IDs', () => {
    const one = score('one', 0.5, 0.5);
    expect(() => computeRunRetrievalMetrics([one], {})).toThrow('missing=[one]');
    expect(() => computeRunRetrievalMetrics([one], grades([['one', 0], ['extra', 0]]))).toThrow('extra=[extra]');
    expect(() => computeRunRetrievalMetrics([one, one], grades([['one', 0]]))).toThrow('Duplicate scored');
    expect(() => computeRunRetrievalMetrics([
      score('negative', 0.5, 0.5, {
        hardNegativeOf: { positiveCandidateId: 'unknown', axis: 'axis', rationale: 'bad link' },
      }),
    ], grades([['negative', 0]]))).toThrow('unknown candidate ID');
  });
});

describe('legacy HyDE report aggregation', () => {
  it('continues to compile and aggregate temporary Recall@K output', () => {
    const summary = aggregateMode('frame-v1', [
      result({ expectedTargetRank: 1, generatedDocumentCount: 2, rejectedCount: 1 }),
      result({ run: 2, expectedTargetRank: 3, generatedDocumentCount: 3, failedOpenCount: 1 }),
      result({ run: 3, expectedTargetRank: null, generatedDocumentCount: 1 }),
    ], 2);
    expect(summary).toMatchObject({
      mode: 'frame-v1',
      runCount: 3,
      recallAtK: 1 / 3,
      mrr: (1 + 1 / 3) / 3,
      generatedDocumentCount: 6,
      failedOpenCount: 1,
    });
  });
});
