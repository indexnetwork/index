import { describe, it, expect } from "bun:test";

import { runPoolDiscriminatorShadow } from "../discriminator.shadow.js";
import type { EmbeddingGenerator } from "../../../shared/interfaces/embedder.interface.js";
import type { MinedDiscriminator, PoolCandidate } from "../discriminator.types.js";

const candidates: PoolCandidate[] = Array.from({ length: 6 }, (_, i) => ({
  id: `c${i}`,
  publicContext: `candidate ${i}`,
  score: 0.8,
}));

function minedDiscriminator(label: string, sideFor: (i: number) => string | null): MinedDiscriminator {
  return {
    label,
    questionSeed: `q-${label}`,
    sides: ["A", "B"],
    assignments: candidates.map((c, i) => {
      const side = sideFor(i);
      return { id: c.id, side, evidence: side ? "ev" : null, verified: side !== null };
    }),
    evidenceRate: 1,
  };
}

/** Embedder returning a fixed vector per text (by lookup), default orthogonal-ish. */
function fakeEmbedder(vectorFor: (text: string) => number[]): EmbeddingGenerator {
  return {
    async generate(text: string | string[]) {
      if (Array.isArray(text)) return text.map(vectorFor);
      return vectorFor(text);
    },
  };
}

describe("runPoolDiscriminatorShadow", () => {
  it("scores mined axes and sorts by VoI descending", async () => {
    const balanced = minedDiscriminator("balanced", (i) => (i < 3 ? "A" : "B"));
    const skewed = minedDiscriminator("skewed", (i) => (i < 5 ? "A" : "B"));
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: [],
      miner: { mine: async () => [skewed, balanced] },
      embedder: fakeEmbedder(() => [1, 0]),
    });
    expect(result.poolSize).toBe(6);
    expect(result.discriminators.map((a) => a.label)).toEqual(["balanced", "skewed"]);
    expect(result.discriminators[0].voi).toBeGreaterThan(result.discriminators[1].voi);
    // No references → novelty defaults to 1 without calling the embedder.
    expect(result.discriminators.every((a) => a.novelty === 1)).toBe(true);
  });

  it("computes novelty against reference texts (axis equal to a premise → voi ~0)", async () => {
    const d = minedDiscriminator("stale axis", (i) => (i < 3 ? "A" : "B"));
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: ["identical premise text"],
      miner: { mine: async () => [d] },
      // Same vector for axis and reference → cosine 1 → novelty 0.
      embedder: fakeEmbedder(() => [0.4, 0.6, 0.2]),
    });
    expect(result.discriminators[0].novelty).toBeCloseTo(0, 6);
    expect(result.discriminators[0].voi).toBeCloseTo(0, 6);
  });

  it("degrades to novelty 1 when the embedder fails (pass still completes)", async () => {
    const d = minedDiscriminator("resilient", (i) => (i < 3 ? "A" : "B"));
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: ["some premise"],
      miner: { mine: async () => [d] },
      embedder: {
        async generate() {
          throw new Error("embedding provider down");
        },
      },
    });
    expect(result.discriminators).toHaveLength(1);
    expect(result.discriminators[0].novelty).toBe(1);
    expect(result.discriminators[0].voi).toBeGreaterThan(0);
  });

  it("returns an empty result when the miner yields no axes", async () => {
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: ["ref"],
      miner: { mine: async () => [] },
      embedder: fakeEmbedder(() => [1]),
    });
    expect(result).toEqual({ poolSize: 6, discriminators: [] });
  });

  it("propagates miner errors (caller is fire-and-forget)", async () => {
    await expect(
      runPoolDiscriminatorShadow({
        intentText: "intent",
        candidates,
        referenceTexts: [],
        miner: {
          mine: async () => {
            throw new Error("LLM timeout");
          },
        },
        embedder: fakeEmbedder(() => [1]),
      }),
    ).rejects.toThrow("LLM timeout");
  });
});
