import { describe, it, expect } from "bun:test";

import { cosineSimilarity, computeNovelty, scoreDiscriminator } from "../discriminator.scorer.js";
import type { MinedDiscriminator, PoolCandidate, VerifiedAssignment } from "../discriminator.types.js";

function pool(n: number, score = 0.8): PoolCandidate[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `c${i}`,
    publicContext: `candidate ${i}`,
    score,
  }));
}

function assignments(
  candidates: PoolCandidate[],
  sideFor: (i: number) => string | null,
): VerifiedAssignment[] {
  return candidates.map((c, i) => {
    const side = sideFor(i);
    return { id: c.id, side, evidence: side ? "ev" : null, verified: side !== null };
  });
}

function axis(candidates: PoolCandidate[], sideFor: (i: number) => string | null, sides = ["A", "B"]): MinedDiscriminator {
  return {
    label: "test axis",
    questionSeed: "which?",
    sides,
    assignments: assignments(candidates, sideFor),
    evidenceRate: 1,
  };
}

describe("cosineSimilarity", () => {
  it("is 1 for identical vectors and 0 for orthogonal ones", () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 6);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 6);
  });

  it("returns 0 for degenerate input (empty, mismatched length, zero vector)", () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });
});

describe("computeNovelty", () => {
  it("returns 1 when there are no references", () => {
    expect(computeNovelty([1, 2, 3], [])).toBe(1);
  });

  it("scores ~0 for an axis semantically equal to an existing reference", () => {
    const emb = [0.3, 0.5, 0.8];
    expect(computeNovelty(emb, [[1, 0, 0], emb])).toBeCloseTo(0, 6);
  });

  it("uses the max similarity across references", () => {
    // ref2 is closer than ref1 → novelty reflects ref2
    const novelty = computeNovelty([1, 0], [[0, 1], [Math.SQRT1_2, Math.SQRT1_2]]);
    expect(novelty).toBeCloseTo(1 - Math.SQRT1_2, 4);
  });
});

describe("scoreDiscriminator", () => {
  it("a balanced split beats a 90/10 split (same coverage, same novelty)", () => {
    const p = pool(10);
    const balanced = scoreDiscriminator(axis(p, (i) => (i < 5 ? "A" : "B")), p, 1);
    const skewed = scoreDiscriminator(axis(p, (i) => (i < 9 ? "A" : "B")), p, 1);
    expect(balanced.entropy).toBeCloseTo(1, 6);
    expect(balanced.coverage).toBeCloseTo(1, 6);
    expect(balanced.voi).toBeGreaterThan(skewed.voi);
  });

  it("an unknown-heavy axis loses to a covered axis with the same split", () => {
    const p = pool(10);
    const covered = scoreDiscriminator(axis(p, (i) => (i % 2 === 0 ? "A" : "B")), p, 1);
    // Only 4 of 10 assigned (2 per side) — balanced but low coverage.
    const unknownHeavy = scoreDiscriminator(
      axis(p, (i) => (i < 2 ? "A" : i < 4 ? "B" : null)),
      p,
      1,
    );
    expect(unknownHeavy.entropy).toBeCloseTo(1, 6);
    expect(unknownHeavy.coverage).toBeCloseTo(0.4, 6);
    expect(covered.voi).toBeGreaterThan(unknownHeavy.voi);
    // coverage^1.5 bite: 0.4^1.5 ≈ 0.253
    expect(unknownHeavy.voi).toBeCloseTo(Math.pow(0.4, 1.5), 4);
  });

  it("novelty ~0 (axis equals an existing premise) zeroes the VoI", () => {
    const p = pool(10);
    const scored = scoreDiscriminator(axis(p, (i) => (i < 5 ? "A" : "B")), p, 0);
    expect(scored.voi).toBe(0);
  });

  it("weights entropy by score mass, not head counts", () => {
    // 5 low-confidence on A vs 5 high-confidence on B: mass 0.5 vs 4.5.
    const p: PoolCandidate[] = [
      ...Array.from({ length: 5 }, (_, i) => ({ id: `lo${i}`, publicContext: "x", score: 0.1 })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `hi${i}`, publicContext: "x", score: 0.9 })),
    ];
    const a: MinedDiscriminator = {
      label: "mass",
      questionSeed: "q",
      sides: ["A", "B"],
      assignments: p.map((c) => ({
        id: c.id,
        side: c.id.startsWith("lo") ? "A" : "B",
        evidence: "ev",
        verified: true,
      })),
      evidenceRate: 1,
    };
    const scored = scoreDiscriminator(a, p, 1);
    // p(A) = 0.1 → H = -(0.1 log 0.1 + 0.9 log 0.9) ≈ 0.469, well below 1
    expect(scored.entropy).toBeLessThan(0.5);
    expect(scored.entropy).toBeGreaterThan(0.4);
  });

  it("ignores unverified assignments and sides outside the axis", () => {
    const p = pool(4);
    const a: MinedDiscriminator = {
      label: "strict",
      questionSeed: "q",
      sides: ["A", "B"],
      assignments: [
        { id: "c0", side: "A", evidence: "ev", verified: true },
        { id: "c1", side: "B", evidence: "hallucinated", verified: false }, // demoted
        { id: "c2", side: "C", evidence: "ev", verified: true }, // side not in axis
        { id: "c3", side: null, evidence: null, verified: false },
      ],
      evidenceRate: 0.5,
    };
    const scored = scoreDiscriminator(a, p, 1);
    // Only c0 counts → single side → entropy 0, coverage 0.25.
    expect(scored.coverage).toBeCloseTo(0.25, 6);
    expect(scored.entropy).toBe(0);
    expect(scored.voi).toBe(0);
  });

  it("falls back to count weights when the whole pool has zero score mass", () => {
    const p = pool(6, 0);
    const scored = scoreDiscriminator(axis(p, (i) => (i < 3 ? "A" : "B")), p, 1);
    expect(scored.entropy).toBeCloseTo(1, 6);
    expect(scored.coverage).toBeCloseTo(1, 6);
    expect(scored.voi).toBeCloseTo(1, 6);
  });

  it("handles 3-sided axes (normalizes entropy by log2(3))", () => {
    const p = pool(9);
    const scored = scoreDiscriminator(
      axis(p, (i) => ["A", "B", "C"][i % 3], ["A", "B", "C"]),
      p,
      1,
    );
    expect(scored.entropy).toBeCloseTo(1, 6);
  });
});
