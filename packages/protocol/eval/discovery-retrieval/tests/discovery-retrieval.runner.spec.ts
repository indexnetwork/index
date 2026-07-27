import { describe, expect, it, mock } from "bun:test";

import { CASES } from "../discovery-retrieval.cases.js";
import { buildCaseCandidateDocuments, runMode, type EmbedderLike } from "../discovery-retrieval.runner.js";

const fakeEmbedder: EmbedderLike = {
  async generate(texts) {
    return texts.map((_, index) => [index + 1, 1]);
  },
};

describe("discovery retrieval runner", () => {
  it("uses premise documents only for intent_to_premise and context documents only for intent_to_context", async () => {
    const embedded = await buildCaseCandidateDocuments(CASES[0]!, fakeEmbedder);
    expect(embedded.premiseDocuments.every((document) => document.representation === "premise")).toBe(true);
    expect(embedded.contextDocuments.every((document) => document.representation === "user_context")).toBe(true);
    expect(embedded.premiseDocuments.map((document) => document.userId)).toContain(CASES[0]!.expect.expectedUserIds[0]);
  });

  it("context_to_context bypasses HyDE generation and ranks source context embedding", async () => {
    const hyde = { invoke: mock(async () => { throw new Error("must not run"); }) };
    const result = await runMode({ mode: "context_to_context", c: CASES[0]!, hyde, embedder: fakeEmbedder });
    expect(hyde.invoke).not.toHaveBeenCalled();
    expect(result.ranking.length).toBeGreaterThan(0);
    expect(result.ranking.every((entry) => entry.representation === "user_context")).toBe(true);
  });

  it("intent paths call Hyde with sourceType query and rank independently", async () => {
    const hyde = { invoke: mock(async () => ({ hydeEmbeddings: { primary: [1, 1] } })) };
    const result = await runMode({ mode: "intent_to_context", c: CASES[0]!, hyde, embedder: fakeEmbedder });
    expect(hyde.invoke).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "query",
      sourceText: CASES[0]!.source.intent,
      forceRegenerate: true,
    }));
    expect(result.ranking.every((entry) => entry.representation === "user_context")).toBe(true);
  });

  it("keeps one max-score result per user and breaks equal user scores by id", async () => {
    const embedder: EmbedderLike = { async generate(texts) { return texts.map(() => [1, 0]); } };
    const hyde = { invoke: async () => ({ hydeEmbeddings: { one: [1, 0] } }) };
    const result = await runMode({ mode: "intent_to_premise", c: CASES[0]!, hyde, embedder });
    expect(new Set(result.ranking.map((entry) => entry.userId)).size).toBe(result.ranking.length);
    expect(result.ranking.map((entry) => entry.userId)).toEqual([...result.ranking.map((entry) => entry.userId)].sort());
  });
});
