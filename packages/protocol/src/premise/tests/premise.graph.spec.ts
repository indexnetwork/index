import { describe, it, expect } from "bun:test";
import { config } from "dotenv";

config({ path: ".env.development", override: true });

import { PremiseGraphFactory } from "../premise.graph.js";
import type {
  PremiseGraphDatabase,
  PremiseRecord,
} from "../../shared/interfaces/database.interface.js";
import type { Embedder } from "../../shared/interfaces/embedder.interface.js";

function createMockDatabase(): PremiseGraphDatabase {
  const premises: PremiseRecord[] = [];

  return {
    createPremise: async (input) => {
      const record: PremiseRecord = {
        id: crypto.randomUUID(),
        userId: input.userId,
        assertion: input.assertion,
        provenance: input.provenance,
        analysis: input.analysis ?? null,
        validity: input.validity,
        embedding: input.embedding ?? null,
        status: 'ACTIVE',
        createdAt: new Date(),
        updatedAt: new Date(),
        retractedAt: null,
      };
      premises.push(record);
      return record;
    },
    getPremise: async (id) => premises.find(p => p.id === id) ?? null,
    getPremisesForUser: async (userId, status) =>
      premises.filter(p => p.userId === userId && (!status || p.status === status)),
    updatePremise: async (id, updates) => {
      const idx = premises.findIndex(p => p.id === id);
      if (idx === -1) throw new Error("Premise not found");
      premises[idx] = { ...premises[idx], ...updates, updatedAt: new Date() };
      return premises[idx];
    },
    assignPremiseToNetwork: async () => {},
    getPremiseNetworks: async () => [],
    getUserIndexIds: async () => [],
    getNetwork: async () => null,
    getNetworkMemberContext: async () => null,
  };
}

function createMockEmbedder(): Embedder {
  return {
    generate: async (_text: string | string[]) => new Array(2000).fill(0.01),
    search: async () => [],
    searchWithHydeEmbeddings: async () => [],
    searchWithProfileEmbedding: async () => [],
  } as Embedder;
}

describe("PremiseGraphFactory", () => {
  it("creates a premise with analysis and embedding", async () => {
    const db = createMockDatabase();
    const embedder = createMockEmbedder();
    const factory = new PremiseGraphFactory(db, embedder);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      assertionText: "I am a climate-tech founder based in Berlin",
      tier: "assertive" as const,
      volatile: false,
    });

    expect(result.premise).toBeDefined();
    expect(result.premise!.assertion.text).toBe("I am a climate-tech founder based in Berlin");
    expect(result.premise!.assertion.tier).toBe("assertive");
    expect(result.analysis).toBeDefined();
    expect(result.analysis!.speechActType).toMatch(/DECLARATIVE|ASSERTIVE/);
    expect(result.embedding).toBeDefined();
    expect(result.embedding!.length).toBe(2000);
    expect(result.error).toBeUndefined();
  }, 60_000);

  it("returns premises in query mode without LLM calls", async () => {
    const db = createMockDatabase();
    const embedder = createMockEmbedder();
    const factory = new PremiseGraphFactory(db, embedder);
    const graph = factory.createGraph();

    // Seed a premise directly into the mock DB
    await db.createPremise({
      userId: "user-1",
      assertion: { text: "I am a founder", tier: "assertive" },
      provenance: { source: "explicit", confidence: 1.0, timestamp: new Date().toISOString() },
      validity: { volatile: false },
    });

    const result = await graph.invoke({
      userId: "user-1",
      operationMode: "query" as const,
    });

    expect(result.readResult).toBeDefined();
    expect(result.readResult!.count).toBe(1);
    expect(result.readResult!.premises[0].assertion.text).toBe("I am a founder");
  }, 10_000);
});
