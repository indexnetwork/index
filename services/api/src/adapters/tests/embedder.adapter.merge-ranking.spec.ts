/**
 * HyDE candidate merge scoring. Pure — no database.
 *
 * The retrieval score a candidate carries into evaluation is the number the
 * evaluation batch is cut by, so it has to stay an honest cosine value. The
 * regression this pins: a per-matched-row bonus that saturated at 1.0, tying
 * dozens of unrelated candidates at the top of the ranking.
 */
import { describe, expect, it } from 'bun:test';
import { mergeAndRankHydeCandidates, type HydeCandidate } from '../embedder.adapter.js';

const match = (
  userId: string,
  score: number,
  matchedVia: string,
  id = `${userId}-${matchedVia}`,
): HydeCandidate => ({
  type: 'premise',
  id,
  userId,
  score,
  matchedVia,
  networkId: 'idx-1',
});

describe('mergeAndRankHydeCandidates', () => {
  it('keeps a single-lens candidate on its raw cosine score', () => {
    const [merged] = mergeAndRankHydeCandidates([match('u1', 0.63, 'lens-a')], 10);
    expect(merged.score).toBe(0.63);
    expect(merged.matchedLenses).toBeUndefined();
  });

  it('counts distinct lenses, not matched rows', () => {
    // One lens hitting five of a user's premises is one signal, not five.
    const manyRowsOneLens = mergeAndRankHydeCandidates(
      Array.from({ length: 5 }, (_, i) => match('u1', 0.6 - i * 0.01, 'lens-a', `p${i}`)),
      10,
    );
    expect(manyRowsOneLens[0].score).toBe(0.6);
    expect(manyRowsOneLens[0].matchedLenses).toBeUndefined();

    const twoLenses = mergeAndRankHydeCandidates(
      [match('u1', 0.6, 'lens-a'), match('u1', 0.5, 'lens-b')],
      10,
    );
    expect(twoLenses[0].score).toBeGreaterThan(0.6);
    expect(twoLenses[0].matchedLenses).toEqual(['lens-a', 'lens-b']);
  });

  it('cannot manufacture a flat ceiling out of unrelated candidates', () => {
    // Thirty users, each surfaced by three lenses across several premises —
    // the exact shape that used to score every one of them exactly 1.0.
    const candidates = Array.from({ length: 30 }, (_, i) => {
      const raw = 0.55 + i * 0.005;
      return ['lens-a', 'lens-b', 'lens-c'].flatMap((lens, l) => [
        match(`u${i}`, raw - l * 0.02, lens, `u${i}-${lens}-1`),
        match(`u${i}`, raw - l * 0.02 - 0.01, lens, `u${i}-${lens}-2`),
      ]);
    }).flat();

    const merged = mergeAndRankHydeCandidates(candidates, 100);

    expect(merged).toHaveLength(30);
    for (const c of merged) expect(c.score).toBeLessThan(1);
    const max = Math.max(...merged.map((c) => c.score));
    expect(merged.filter((c) => c.score === max)).toHaveLength(1);
    expect(new Set(merged.map((c) => c.score)).size).toBe(30);
  });

  it('preserves the raw ranking when every candidate has the same lens count', () => {
    const candidates = [0.9, 0.8, 0.7].flatMap((raw, i) => [
      match(`u${i}`, raw, 'lens-a'),
      match(`u${i}`, raw - 0.05, 'lens-b'),
    ]);
    expect(mergeAndRankHydeCandidates(candidates, 10).map((c) => c.userId)).toEqual(['u0', 'u1', 'u2']);
  });

  it('clamps a score pgvector returned just outside [0, 1]', () => {
    const [merged] = mergeAndRankHydeCandidates([match('u1', 1.0000000000000002, 'lens-a')], 10);
    expect(merged.score).toBe(1);
  });
});
