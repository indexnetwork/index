/**
 * Retrieval score calibration.
 *
 * The property that matters: retrieval scores stay honest cosine-derived values.
 * A multi-signal bonus may reorder candidates, but it must never manufacture a
 * flat ceiling — a head cluster of identical maxima across unrelated documents is
 * what starved evaluation of every genuine match behind it.
 */
import { describe, expect, it } from 'bun:test';
import { MULTI_SIGNAL_BONUS_MAX, normalizeSimilarity, withMultiSignalBonus } from '../opportunity.similarity.js';
import { mergeStrategyCandidates } from '../opportunity.graph.discovery-strategies.js';
import type { CandidateMatch } from '../opportunity.state.js';
import type { Id } from '../../../platform/database.js';

describe('normalizeSimilarity', () => {
  it('passes honest cosine values through unchanged', () => {
    expect(normalizeSimilarity(0.42)).toBe(0.42);
    expect(normalizeSimilarity(0)).toBe(0);
    expect(normalizeSimilarity(1)).toBe(1);
  });

  it('clamps the float epsilon pgvector can return outside [0, 1]', () => {
    expect(normalizeSimilarity(1.0000000000000002)).toBe(1);
    expect(normalizeSimilarity(-0.03)).toBe(0);
  });

  it('treats an unparseable score as no similarity rather than poisoning the ranking', () => {
    expect(normalizeSimilarity(Number.NaN)).toBe(0);
    // A non-finite score is garbage, not a perfect match — it must not top the ranking.
    expect(normalizeSimilarity(Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('withMultiSignalBonus', () => {
  it('is a no-op for a single signal', () => {
    expect(withMultiSignalBonus(0.55, 1)).toBe(0.55);
    expect(withMultiSignalBonus(0.55, 0)).toBe(0.55);
  });

  it('rewards additional distinct signals without reaching 1', () => {
    const one = withMultiSignalBonus(0.6, 1);
    const two = withMultiSignalBonus(0.6, 2);
    const four = withMultiSignalBonus(0.6, 4);
    expect(two).toBeGreaterThan(one);
    expect(four).toBeGreaterThan(two);
    expect(four).toBeLessThan(1);
  });

  it('caps the bonus so agreement cannot outweigh the vector', () => {
    const capped = withMultiSignalBonus(0.5, 12);
    expect(capped).toBeCloseTo(0.5 + 0.5 * MULTI_SIGNAL_BONUS_MAX, 12);
  });

  it('only ever returns 1 when the raw score is already 1', () => {
    expect(withMultiSignalBonus(1, 6)).toBe(1);
    for (const raw of [0.99, 0.995, 0.999, 0.9999]) {
      expect(withMultiSignalBonus(raw, 8)).toBeLessThan(1);
    }
  });

  it('is strictly monotone in the raw score at any signal count', () => {
    for (const signals of [1, 2, 3, 5, 10]) {
      let previous = -1;
      for (let raw = 0; raw <= 1.0001; raw += 0.01) {
        const score = withMultiSignalBonus(Math.min(raw, 1), signals);
        expect(score).toBeGreaterThan(previous);
        previous = score;
      }
    }
  });

  it('keeps distinct documents distinct — no flat ceiling', () => {
    // Thirty candidates with distinct raw scores, each surfaced by every signal.
    const raws = Array.from({ length: 30 }, (_, i) => 0.70 + i * 0.01);
    const scores = raws.map((raw) => withMultiSignalBonus(raw, 6));
    expect(new Set(scores).size).toBe(raws.length);
    const max = Math.max(...scores);
    expect(scores.filter((s) => s === max)).toHaveLength(1);
  });
});

describe('mergeStrategyCandidates', () => {
  const candidate = (
    userId: string,
    similarity: number,
    discoverySource: CandidateMatch['discoverySource'],
  ): CandidateMatch => ({
    candidateUserId: userId as Id<'users'>,
    candidateIntentId: `${userId}-intent` as Id<'intents'>,
    networkId: 'idx-1' as Id<'networks'>,
    similarity,
    lens: 'lens',
    discoverySource,
  });

  it('never ties candidates at the ceiling, however many strategies agree', () => {
    const raws = [0.99, 0.97, 0.95, 0.93];
    const merged = mergeStrategyCandidates(
      raws.map((s, i) => candidate(`u${i}`, s, 'query')),
      raws.map((s, i) => candidate(`u${i}`, s, 'premise-similarity')),
      raws.map((s, i) => candidate(`u${i}`, s, 'context-to-intent')),
      raws.map((s, i) => candidate(`u${i}`, s, 'context-similarity')),
    );

    expect(merged).toHaveLength(raws.length);
    for (const c of merged) expect(c.similarity).toBeLessThan(1);
    expect(new Set(merged.map((c) => c.similarity)).size).toBe(raws.length);
    // Merging must not reorder candidates that agree on the same strategy set.
    expect(merged.map((c) => c.candidateUserId)).toEqual(['u0', 'u1', 'u2', 'u3']);
  });

  it('still ranks multi-strategy agreement above a lone match', () => {
    const merged = mergeStrategyCandidates(
      [candidate('agreed', 0.60, 'query'), candidate('alone', 0.62, 'query')],
      [candidate('agreed', 0.58, 'premise-similarity')],
      [candidate('agreed', 0.57, 'context-to-intent')],
    );
    const byUser = Object.fromEntries(merged.map((c) => [c.candidateUserId, c.similarity]));
    expect(byUser.agreed).toBeGreaterThan(byUser.alone);
    expect(byUser.alone).toBe(0.62);
  });
});
