import { describe, expect, it } from 'bun:test';
import { DISCOVERY_EVALUATOR_MIN_SCORE, DISCOVERY_MIN_SIMILARITY, validateDiscoveryEvaluatorMinScore, validateDiscoveryMinSimilarity } from '../discovery.env.js';

describe('discovery thresholds', () => {
  it('retrieves at 0.20 and accepts evaluator scores at or above 40', () => {
    expect(DISCOVERY_MIN_SIMILARITY).toBe(0.20);
    expect(DISCOVERY_EVALUATOR_MIN_SCORE).toBe(40);
  });

  it('validates caller-supplied override values', () => {
    expect(validateDiscoveryMinSimilarity(0.42)).toBe(0.42);
    expect(validateDiscoveryEvaluatorMinScore(63)).toBe(63);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01])(
    'rejects invalid numeric similarity %s',
    (value) => {
      expect(() => validateDiscoveryMinSimilarity(value)).toThrow('DISCOVERY_MIN_SIMILARITY');
    },
  );

  it.each([Number.NaN, Number.NEGATIVE_INFINITY, -1, 100.01])(
    'rejects invalid numeric evaluator score %s',
    (value) => {
      expect(() => validateDiscoveryEvaluatorMinScore(value)).toThrow('DISCOVERY_EVALUATOR_MIN_SCORE');
    },
  );
});
