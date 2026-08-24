/**
 * These assertions deliberately mirror the protocol's
 * `opportunity.similarity.spec.ts`. The two implementations are duplicated across
 * the adapter boundary, so pinning the same numbers on both sides makes drift a
 * test failure rather than a silent divergence in retrieval scores.
 */
import { describe, expect, it } from 'bun:test';
import { MULTI_SIGNAL_BONUS_MAX, normalizeSimilarity, withMultiSignalBonus } from '../similarity.calibration';

describe('normalizeSimilarity', () => {
  it('passes honest cosine values through and clamps the rest', () => {
    expect(normalizeSimilarity(0.42)).toBe(0.42);
    expect(normalizeSimilarity(1.0000000000000002)).toBe(1);
    expect(normalizeSimilarity(-0.03)).toBe(0);
    expect(normalizeSimilarity(Number.NaN)).toBe(0);
  });
});

describe('withMultiSignalBonus', () => {
  it('is a no-op for a single signal', () => {
    expect(withMultiSignalBonus(0.55, 1)).toBe(0.55);
  });

  it('caps the bonus at a fraction of the headroom', () => {
    expect(withMultiSignalBonus(0.5, 12)).toBeCloseTo(0.5 + 0.5 * MULTI_SIGNAL_BONUS_MAX, 12);
  });

  it('only ever returns 1 when the raw score is already 1', () => {
    expect(withMultiSignalBonus(1, 6)).toBe(1);
    for (const raw of [0.99, 0.995, 0.999, 0.9999]) {
      expect(withMultiSignalBonus(raw, 8)).toBeLessThan(1);
    }
  });

  it('is strictly monotone in the raw score', () => {
    let previous = -1;
    for (let raw = 0; raw <= 1.0001; raw += 0.01) {
      const score = withMultiSignalBonus(Math.min(raw, 1), 5);
      expect(score).toBeGreaterThan(previous);
      previous = score;
    }
  });
});
