import { describe, it, expect } from "bun:test";

import { runPoolDiscriminatorShadow } from "../discriminator/discriminator.shadow.js";
import type { EmbeddingGenerator } from "../../../platform/embedder.js";
import type { MinedDiscriminator, PoolCandidate } from "../discriminator/discriminator.types.js";

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
      embeddingModel: "test/model-v1",
      retainEmbeddings: true,
      miner: { mine: async () => [skewed, balanced] },
      embedder: fakeEmbedder(() => [1, 0]),
    });
    expect(result.poolSize).toBe(6);
    expect(result.discriminators.map((a) => a.label)).toEqual(["balanced", "skewed"]);
    expect(result.discriminators[0].voi).toBeGreaterThan(result.discriminators[1].voi);
    expect(result.discriminators.every((a) => a.novelty === 1)).toBe(true);
    expect(result.discriminators.every((a) => a.embeddingModel === "test/model-v1")).toBe(true);
    expect(result.discriminators.every((a) => a.embedding?.join(",") === "1,0")).toBe(true);
  });

  it("computes novelty against reference texts (axis equal to a premise → voi ~0)", async () => {
    const d = minedDiscriminator("stale axis", (i) => (i < 3 ? "A" : "B"));
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: ["identical premise text"],
      embeddingModel: "test/model-v1",
      miner: { mine: async () => [d] },
      // Same vector for axis and reference → cosine 1 → novelty 0.
      embedder: fakeEmbedder(() => [0.4, 0.6, 0.2]),
    });
    expect(result.discriminators[0].novelty).toBeCloseTo(0, 6);
    expect(result.discriminators[0].voi).toBeCloseTo(0, 6);
  });

  it("uses a prior resolved-axis embedding to suppress a semantic equivalent", async () => {
    const d = minedDiscriminator("same pool axis", (i) => (i < 3 ? "A" : "B"));
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: [],
      priorReferenceEmbeddings: [[0.4, 0.6, 0.2]],
      embeddingModel: "test/model-v1",
      retainEmbeddings: true,
      miner: { mine: async () => [d] },
      embedder: fakeEmbedder(() => [0.4, 0.6, 0.2]),
    });
    expect(result.discriminators[0].novelty).toBeCloseTo(0, 6);
    expect(result.discriminators[0].voi).toBeCloseTo(0, 6);
    expect(result.discriminators[0].embedding).toEqual([0.4, 0.6, 0.2]);
  });

  it("uses every prior resolved-axis text, including an equivalent 25th reference", async () => {
    const d = minedDiscriminator("working style", (i) => (i < 3 ? "A" : "B"));
    const priorReferenceTexts = Array.from({ length: 25 }, (_, i) =>
      i === 24 ? "equivalent resolved working style" : `resolved axis ${i}`,
    );
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: [],
      priorReferenceTexts,
      miner: { mine: async () => [d] },
      embedder: fakeEmbedder((text) =>
        text.startsWith("working style") || text === "equivalent resolved working style"
          ? [1, 0]
          : [0, 1]),
    });
    expect(result.discriminators[0].novelty).toBeCloseTo(0, 6);
    expect(result.discriminators[0].voi).toBeCloseTo(0, 6);
  });

  it("uses every prior resolved-axis embedding, including an equivalent 25th reference", async () => {
    const d = minedDiscriminator("working style", (i) => (i < 3 ? "A" : "B"));
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: [],
      priorReferenceEmbeddings: Array.from({ length: 25 }, (_, i) => i === 24 ? [1, 0] : [0, 1]),
      miner: { mine: async () => [d] },
      embedder: fakeEmbedder(() => [1, 0]),
    });
    expect(result.discriminators[0].novelty).toBeCloseTo(0, 6);
    expect(result.discriminators[0].voi).toBeCloseTo(0, 6);
  });

  it("does not embed without novelty references merely to retain vectors", async () => {
    const d = minedDiscriminator("fresh axis", (i) => (i < 3 ? "A" : "B"));
    let embeddingCalls = 0;
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: [],
      miner: { mine: async () => [d] },
      embedder: fakeEmbedder(() => {
        embeddingCalls++;
        return [1, 0];
      }),
    });
    expect(embeddingCalls).toBe(0);
    expect(result.discriminators[0].novelty).toBe(1);
    expect(result.discriminators[0].embedding).toBeUndefined();
  });

  it("computes ordinary novelty without retaining generated vectors", async () => {
    const d = minedDiscriminator("stale axis", (i) => (i < 3 ? "A" : "B"));
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: ["same semantic reference"],
      miner: { mine: async () => [d] },
      embedder: fakeEmbedder(() => [0.4, 0.6]),
    });
    expect(result.discriminators[0].novelty).toBeCloseTo(0, 6);
    expect(result.discriminators[0].embedding).toBeUndefined();
    expect(result.discriminators[0].embeddingModel).toBeUndefined();
  });

  it("keeps current intent references alongside prior text history", async () => {
    const d = minedDiscriminator("current constraint axis", (i) => (i < 3 ? "A" : "B"));
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: ["current explicit constraint"],
      priorReferenceTexts: Array.from({ length: 24 }, (_, i) => `legacy axis ${i}`),
      miner: { mine: async () => [d] },
      embedder: fakeEmbedder((text) =>
        text === "current explicit constraint" || text.startsWith("current constraint axis")
          ? [1, 0]
          : [0, 1]),
    });
    expect(result.discriminators[0].novelty).toBeCloseTo(0, 6);
  });

  it("degrades to novelty 1 when the embedder fails (pass still completes)", async () => {
    const d = minedDiscriminator("resilient", (i) => (i < 3 ? "A" : "B"));
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: ["some premise"],
      priorReferenceEmbeddings: [[1, 0]],
      embeddingModel: "test/model-v1",
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
    expect(result.discriminators[0].embedding).toBeUndefined();
    expect(result.discriminators[0].embeddingModel).toBeUndefined();
  });

  it("signals when historical discriminator comparison is unavailable", async () => {
    const d = minedDiscriminator("resilient history", (i) => (i < 3 ? "A" : "B"));
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: [],
      priorReferenceEmbeddings: [[0.4, 0.6, 0.2]],
      miner: { mine: async () => [d] },
      embedder: {
        async generate() {
          throw new Error("embedding provider down");
        },
      },
    });
    expect(result.priorReferenceComparisonUnavailable).toBe(true);
  });

  it("signals unavailable history comparison for incompatible vector dimensions", async () => {
    const d = minedDiscriminator("dimension mismatch", (i) => (i < 3 ? "A" : "B"));
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: [],
      priorReferenceEmbeddings: [[0.4, 0.6, 0.2]],
      miner: { mine: async () => [d] },
      embedder: fakeEmbedder(() => [0.4, 0.6]),
    });
    expect(result.priorReferenceComparisonUnavailable).toBe(true);
    expect(result.discriminators[0].novelty).toBe(1);
    expect(result.discriminators[0].voi).toBeGreaterThan(0);
  });

  it("does not signal unavailable history comparison when no history was supplied", async () => {
    const d = minedDiscriminator("resilient fresh", (i) => (i < 3 ? "A" : "B"));
    let embeddingCalls = 0;
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: ["ordinary current reference"],
      miner: { mine: async () => [d] },
      embedder: {
        async generate() {
          embeddingCalls++;
          throw new Error("embedding provider down");
        },
      },
    });
    expect(embeddingCalls).toBe(1);
    expect(result.priorReferenceComparisonUnavailable).toBeUndefined();
    expect(result.discriminators[0].novelty).toBe(1);
    expect(result.discriminators[0].voi).toBeGreaterThan(0);
  });

  it("returns an empty result when the miner yields no axes", async () => {
    const result = await runPoolDiscriminatorShadow({
      intentText: "intent",
      candidates,
      referenceTexts: ["ref"],
      embeddingModel: "test/model-v1",
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
        embeddingModel: "test/model-v1",
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
