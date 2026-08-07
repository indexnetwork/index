import { describe, expect, it, mock } from "bun:test";

import { buildExecutionEvidence, summarizeExecution } from "../../shared/index.js";
import { CASES } from "../discovery-retrieval.cases.js";
import { buildCaseCandidateDocuments, runCase, runMode, type EmbedderLike } from "../discovery-retrieval.runner.js";
import type { DiscoveryRetrievalCase } from "../discovery-retrieval.types.js";

const fakeEmbedder: EmbedderLike = {
  async generate(texts) {
    return texts.map((_, index) => [index + 1, 1]);
  },
};

const representationCase: DiscoveryRetrievalCase = {
  id: "representation-isolation",
  rule: "complementary_role",
  tier: 1,
  description: "Representation pools deliberately select different candidates.",
  source: { intent: "intent source", userContext: "source context" },
  candidates: [
    {
      userId: "premise-fit",
      displayName: "Premise fit",
      premises: ["premise winner"],
      userContext: "premise candidate context",
    },
    {
      userId: "context-fit",
      displayName: "Context fit",
      premises: ["context candidate premise"],
      userContext: "context winner",
    },
  ],
  expect: {
    expectedUserIds: ["premise-fit"],
    excludedUserIds: [],
    topK: 2,
    maxExpectedRank: 1,
    reasoningCriteria: "representation isolation test",
  },
};

const representationEmbedder: EmbedderLike = {
  async generate(texts) {
    const vectors: Record<string, number[]> = {
      "premise winner": [1, 0],
      "context candidate premise": [0, 1],
      "premise candidate context": [0, 1],
      "context winner": [1, 0],
      "source context": [1, 0],
    };
    return texts.map((text) => {
      const vector = vectors[text];
      if (!vector) throw new Error(`Unexpected embedding input: ${text}`);
      return vector;
    });
  },
};

describe("discovery retrieval runner", () => {
  it("builds premise and context candidate documents independently", async () => {
    const embedded = await buildCaseCandidateDocuments(CASES[0]!, fakeEmbedder);
    expect(embedded.premiseDocuments.every((document) => document.representation === "premise")).toBe(true);
    expect(embedded.contextDocuments.every((document) => document.representation === "user_context")).toBe(true);
    expect(embedded.premiseDocuments.map((document) => document.userId)).toContain(CASES[0]!.expect.expectedUserIds[0]);
  });

  it("keeps intent representation pools isolated", async () => {
    const hyde = { invoke: mock(async () => ({ hydeEmbeddings: { primary: [1, 0] } })) };
    const premiseResult = await runMode({
      mode: "intent_to_premise",
      c: representationCase,
      hyde,
      embedder: representationEmbedder,
    });
    const contextResult = await runMode({
      mode: "intent_to_context",
      c: representationCase,
      hyde,
      embedder: representationEmbedder,
    });

    expect(premiseResult.ranking[0]).toMatchObject({ userId: "premise-fit", representation: "premise" });
    expect(contextResult.ranking[0]).toMatchObject({ userId: "context-fit", representation: "user_context" });
    expect(hyde.invoke).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "query",
      sourceText: representationCase.source.intent,
      forceRegenerate: true,
    }));
  });

  it("context_to_context bypasses HyDE and uses the context pool", async () => {
    const hyde = { invoke: mock(async () => { throw new Error("must not run"); }) };
    const result = await runMode({
      mode: "context_to_context",
      c: representationCase,
      hyde,
      embedder: representationEmbedder,
    });

    expect(hyde.invoke).not.toHaveBeenCalled();
    expect(result.ranking[0]).toMatchObject({ userId: "context-fit", representation: "user_context" });
  });

  it("keeps one max-score result per user and breaks equal user scores by id", async () => {
    const embedder: EmbedderLike = { async generate(texts) { return texts.map(() => [1, 0]); } };
    const hyde = { invoke: async () => ({ hydeEmbeddings: { one: [1, 0] } }) };
    const result = await runMode({ mode: "intent_to_premise", c: CASES[0]!, hyde, embedder });
    expect(new Set(result.ranking.map((entry) => entry.userId)).size).toBe(result.ranking.length);
    expect(result.ranking.map((entry) => entry.userId)).toEqual([...result.ranking.map((entry) => entry.userId)].sort());
  });

  it("records candidate embedding failures as incomplete attempt evidence", async () => {
    const hyde = { invoke: mock(async () => ({ hydeEmbeddings: { primary: [1, 0] } })) };
    const batch = await runCase({
      hyde,
      embedder: { async generate() { throw new Error("candidate embedding unavailable"); } },
    }, CASES[0]!, 1, { maxAttempts: 1, retryDelayMs: 0, attemptTimeoutMs: 100 });

    for (const modeBatch of Object.values(batch.batches)) {
      expect(modeBatch.outputs).toEqual([]);
      expect(modeBatch.runs).toHaveLength(1);
      expect(modeBatch.runs[0]).toMatchObject({ outcome: "failed" });
      expect(modeBatch.runs[0]?.attempts[0]).toMatchObject({ outcome: "failure" });
    }
    expect(summarizeExecution(buildExecutionEvidence(Object.values(batch.batches)))).toMatchObject({
      requestedRuns: 3,
      completedRuns: 0,
      failedRuns: 3,
      complete: false,
    });
    expect(hyde.invoke).not.toHaveBeenCalled();
  });
});
