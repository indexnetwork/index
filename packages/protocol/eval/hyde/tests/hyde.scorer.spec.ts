import { describe, expect, it } from 'bun:test';

import { aggregateMode, cosineSimilarity, expectedTargetRank, rankCandidates } from '../hyde.scorer.js';
import type { EmbeddedCandidate, HydeEvalRunResult, LensQueryEmbedding } from '../hyde.types.js';

const candidates: EmbeddedCandidate[] = [
  { id: 'target', role: 'target', corpus: 'premises', text: 'target', embedding: [1, 0] },
  { id: 'trap', role: 'trap', corpus: 'intents', text: 'trap', embedding: [0, 1] },
  { id: 'distractor', role: 'distractor', corpus: 'premises', text: 'distractor', embedding: [-1, 0] },
];

const queryEmbeddings: LensQueryEmbedding[] = [
  { lensId: 'lens-a', corpus: 'premises', embedding: [0.8, 0.6] },
  { lensId: 'lens-b', corpus: 'intents', embedding: [0.6, 0.8] },
];

function result(overrides: Partial<HydeEvalRunResult> = {}): HydeEvalRunResult {
  return {
    caseId: 'case',
    mode: 'frame-v1',
    run: 1,
    expectedTargetRank: 1,
    ranking: [],
    lensCount: 2,
    returnedDocumentCount: 1,
    generatedDocumentCount: 2,
    overwrittenDocumentCount: 0,
    validatorSubmittedDocumentCount: 2,
    rejectedCount: 1,
    failedOpenCount: 0,
    documents: [],
    ...overrides,
  };
}

describe('HyDE retrieval ranking', () => {
  it('computes cosine similarity and rejects invalid vector shapes', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosineSimilarity([0, 0], [1, 0])).toBe(0);
    expect(() => cosineSimilarity([1], [1, 0])).toThrow('dimensions must match');
    expect(() => cosineSimilarity([Number.NaN], [1])).toThrow('finite');
  });

  it('applies the default threshold and additional qualifying-lens bonus', () => {
    const ranking = rankCandidates(queryEmbeddings, candidates);
    expect(ranking.map((candidate) => candidate.candidateId)).toEqual(['target', 'trap']);
    expect(ranking[0]).toMatchObject({
      score: 0.9,
      maxCosine: 0.8,
      qualifyingMatchCount: 2,
      matchedLensIds: ['lens-a', 'lens-b'],
    });
    expect(ranking[1]?.score).toBeCloseTo(0.9);
    expect(expectedTargetRank(ranking, 'target')).toBe(1.5);
    expect(expectedTargetRank([...ranking].reverse(), 'target')).toBe(1.5);
  });

  it('supports a configurable cutoff and only bonuses matches at or above it', () => {
    const ranking = rankCandidates(queryEmbeddings, candidates, { minScore: 0.7 });
    expect(ranking.map((candidate) => candidate.candidateId)).toEqual(['target', 'trap']);
    expect(ranking[0]).toMatchObject({ score: 0.8, qualifyingMatchCount: 1 });
    expect(ranking[0]?.matchedLensIds).toEqual(['lens-a']);
    expect(ranking[1]?.matchedLensIds).toEqual(['lens-b']);
    expect(rankCandidates(queryEmbeddings, candidates, { minScore: 0.81 })).toEqual([]);
  });

  it('reports a miss rather than ranking candidates when no document survives', () => {
    expect(rankCandidates([], candidates)).toEqual([]);
    expect(expectedTargetRank([], 'target')).toBeNull();
  });
});

describe('HyDE report aggregation', () => {
  it('aggregates Recall@K, MRR, and frame diagnostics across runs', () => {
    const summary = aggregateMode('frame-v1', [
      result({ expectedTargetRank: 1, generatedDocumentCount: 2, rejectedCount: 1 }),
      result({
        run: 2,
        expectedTargetRank: 3,
        generatedDocumentCount: 3,
        overwrittenDocumentCount: 1,
        rejectedCount: 0,
        failedOpenCount: 1,
      }),
      result({ run: 3, expectedTargetRank: null, generatedDocumentCount: 1, rejectedCount: 1 }),
    ], 2);

    expect(summary).toEqual({
      mode: 'frame-v1',
      runCount: 3,
      recallAtK: 1 / 3,
      mrr: (1 + 1 / 3) / 3,
      generatedDocumentCount: 6,
      overwrittenDocumentCount: 1,
      rejectedCount: 2,
      failedOpenCount: 1,
    });
  });

  it('keeps legacy rejection not applicable and handles empty reports', () => {
    const legacy = aggregateMode('legacy', [
      result({ mode: 'legacy', rejectedCount: null, expectedTargetRank: 2 }),
    ], 2);
    expect(legacy.rejectedCount).toBeNull();
    expect(legacy.recallAtK).toBe(1);
    expect(legacy.mrr).toBe(0.5);

    expect(aggregateMode('legacy', [], 1)).toMatchObject({ runCount: 0, recallAtK: 0, mrr: 0 });
    expect(() => aggregateMode('legacy', [result()], 1)).toThrow('non-legacy');
  });
});
