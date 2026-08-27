import { describe, expect, it } from 'bun:test';
import { DISCOVERY_MIN_SIMILARITY, validateDiscoveryMinSimilarity } from '../discovery.env.js';

describe('discovery thresholds', () => {
  it('retrieves at 0.20', () => {
    expect(DISCOVERY_MIN_SIMILARITY).toBe(0.20);
  });

  it('validates caller-supplied override values', () => {
    expect(validateDiscoveryMinSimilarity(0.42)).toBe(0.42);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01])(
    'rejects invalid numeric similarity %s',
    (value) => {
      expect(() => validateDiscoveryMinSimilarity(value)).toThrow('DISCOVERY_MIN_SIMILARITY');
    },
  );
});
