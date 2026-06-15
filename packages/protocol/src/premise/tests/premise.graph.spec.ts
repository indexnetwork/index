// Env must be set before any imports that transitively call createModel
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect } from "bun:test";
import { PremiseGraphFactory } from "../premise.graph.js";
import type { PremiseGraphDatabase, PremiseRecord } from "../../shared/interfaces/database.interface.js";
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
    getAssignmentNetworkIdsForUser: async () => [],
    getNetworkAssignmentContext: async () => null,
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

  it("respects custom provenanceSource and provenanceConfidence overrides", async () => {
    const db = createMockDatabase();
    const embedder = createMockEmbedder();
    const factory = new PremiseGraphFactory(db, embedder);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: "user-2",
      assertionText: "I have 10 years of experience in machine learning",
      tier: "assertive" as const,
      volatile: false,
      provenanceSource: "enrichment" as const,
      provenanceSourceId: "source-1",
      provenanceConfidence: 0.85,
    });

    expect(result.premise).toBeDefined();
    expect(result.premise!.provenance.source).toBe("enrichment");
    expect(result.premise!.provenance.sourceId).toBe("source-1");
    expect(result.premise!.provenance.confidence).toBe(0.85);
    expect(result.error).toBeUndefined();
  }, 60_000);

  it("assigns created premises to all membership networks with metadata", async () => {
    const assignments: Array<{ networkId: string; score: number; metadata: unknown }> = [];
    const db = {
      ...createMockDatabase(),
      getAssignmentNetworkIdsForUser: async () => ["n1", "n2"],
      getNetworkAssignmentContext: async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }),
      assignPremiseToNetwork: async (_premiseId: string, networkId: string, score: number, metadata: unknown) => {
        assignments.push({ networkId, score, metadata });
      },
    };
    const embedder = createMockEmbedder();
    const premiseIndexer = { invoke: async () => ({ indexScore: 0, memberScore: 0, reasoning: "unused" }) };
    const factory = new PremiseGraphFactory(db, embedder, premiseIndexer as never);
    const graph = factory.createGraph();

    await graph.invoke({
      userId: "user-1",
      assertionText: "I build AI developer tools",
      tier: "assertive" as const,
      volatile: false,
    });

    expect(assignments.map((a) => a.networkId).sort()).toEqual(["n1", "n2"]);
    expect(assignments[0].metadata).toMatchObject({ resourceType: "premise", scope: "global", assigned: true, finalScore: 1 });
  }, 60_000);

  it("restricts premise assignment to active network scope", async () => {
    const assignments: string[] = [];
    const db = {
      ...createMockDatabase(),
      getAssignmentNetworkIdsForUser: async () => ["active-network", "other-network"],
      getNetworkAssignmentContext: async (networkId: string) => ({ networkId, indexPrompt: null, memberPrompt: null }),
      assignPremiseToNetwork: async (_premiseId: string, networkId: string) => {
        assignments.push(networkId);
      },
    };
    const factory = new PremiseGraphFactory(db, createMockEmbedder(), { invoke: async () => ({ indexScore: 0, memberScore: 0, reasoning: "unused" }) } as never);
    const graph = factory.createGraph();

    await graph.invoke({
      userId: "user-1",
      assertionText: "I am attending the active network event",
      tier: "assertive" as const,
      volatile: false,
      networkScopeId: "active-network",
    });

    expect(assignments).toEqual(["active-network"]);
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
