import { describe, it, expect } from "bun:test";
import { PremiseGraphFactory } from "../premise.graph.js";
import { createMockDatabase, createMockEmbedder, createMockAnalyzer } from "./premise.graph.spec.js";
import type { PremiseDecomposerOutput } from "../premise.decomposer.js";

const baseOutput: PremiseDecomposerOutput = {
  reasoning: "test",
  premises: [
    { text: "I am a software engineer", tier: "assertive", validityDays: null },
    { text: "I am based in Berlin", tier: "assertive", validityDays: null },
  ],
  retractedPremiseIds: [],
  revisedBio: null,
};

function createMockDecomposer(output: PremiseDecomposerOutput, invocations: Array<{
  input: string;
  existingPremises?: Array<{ id: string; text: string }>;
  currentBio?: string;
}> = []) {
  return {
    invoke: async (input: string, existingPremises?: Array<{ id: string; text: string }>, currentBio?: string) => {
      invocations.push({ input, existingPremises, currentBio });
      return output;
    },
  };
}

describe("PremiseGraphFactory (decompose mode)", () => {
  it("decomposes input into premises and creates each via the create pipeline", async () => {
    const db = createMockDatabase();
    const decomposer = createMockDecomposer(baseOutput);
    const factory = new PremiseGraphFactory(db, createMockEmbedder(), undefined, createMockAnalyzer(), decomposer);
    const graph = factory.createGraph();

    await graph.invoke({
      userId: "user-1",
      input: "I am a software engineer based in Berlin.",
      operationMode: "decompose" as const,
    });

    const created = await db.getPremisesForUser("user-1", "ACTIVE");
    expect(created.map((p) => p.assertion.text).sort()).toEqual([
      "I am a software engineer",
      "I am based in Berlin",
    ]);
  }, 30_000);

  it("assigns a validUntil window to contextual premises only", async () => {
    const db = createMockDatabase();
    const decomposer = createMockDecomposer({
      reasoning: "test",
      premises: [
        { text: "I am a founder", tier: "assertive", validityDays: null },
        { text: "I am raising a Series A", tier: "contextual", validityDays: 30 },
      ],
      retractedPremiseIds: [],
      revisedBio: null,
    });
    const factory = new PremiseGraphFactory(db, createMockEmbedder(), undefined, createMockAnalyzer(), decomposer);
    const graph = factory.createGraph();

    await graph.invoke({
      userId: "user-1",
      input: "I am a founder currently raising a Series A.",
      operationMode: "decompose" as const,
    });

    const created = await db.getPremisesForUser("user-1", "ACTIVE");
    const assertive = created.find((p) => p.assertion.text === "I am a founder")!;
    const contextual = created.find((p) => p.assertion.text === "I am raising a Series A")!;
    expect(assertive.validity.validUntil).toBeUndefined();
    expect(assertive.validity.volatile).toBe(false);
    expect(contextual.validity.validUntil).toBeDefined();
    expect(contextual.validity.volatile).toBe(true);
  }, 30_000);

  it("offers the user's ACTIVE premises and current bio to the decomposer", async () => {
    const db = createMockDatabase();
    await db.createPremise({
      userId: "user-1",
      assertion: { text: "I am a software engineer", tier: "assertive" },
      provenance: { source: "explicit", confidence: 1.0, timestamp: new Date().toISOString() },
      validity: { volatile: false },
    });
    await db.updateUser("user-1", { intro: "Software engineer. Based in Berlin." });

    const invocations: Array<{ input: string; existingPremises?: Array<{ id: string; text: string }>; currentBio?: string }> = [];
    const decomposer = createMockDecomposer({ ...baseOutput, premises: [] }, invocations);
    const factory = new PremiseGraphFactory(db, createMockEmbedder(), undefined, createMockAnalyzer(), decomposer);
    const graph = factory.createGraph();

    await graph.invoke({
      userId: "user-1",
      input: "I no longer work as a software engineer.",
      operationMode: "decompose" as const,
    });

    expect(invocations).toHaveLength(1);
    expect(invocations[0].existingPremises).toEqual([{ id: expect.any(String), text: "I am a software engineer" }]);
    expect(invocations[0].currentBio).toBe("Software engineer. Based in Berlin.");
  }, 30_000);

  it("retracts premises the decomposer flags as disavowed, before creating the correction", async () => {
    const db = createMockDatabase();
    const existing = await db.createPremise({
      userId: "user-1",
      assertion: { text: "I am based in Berlin", tier: "assertive" },
      provenance: { source: "explicit", confidence: 1.0, timestamp: new Date().toISOString() },
      validity: { volatile: false },
    });

    const decomposer = createMockDecomposer({
      reasoning: "disavows Berlin",
      premises: [{ text: "I am based in Istanbul", tier: "assertive", validityDays: null }],
      retractedPremiseIds: [existing.id],
      revisedBio: null,
    });
    const factory = new PremiseGraphFactory(db, createMockEmbedder(), undefined, createMockAnalyzer(), decomposer);
    const graph = factory.createGraph();

    await graph.invoke({
      userId: "user-1",
      input: "I no longer live in Berlin. I am based in Istanbul.",
      operationMode: "decompose" as const,
    });

    const retracted = await db.getPremise(existing.id);
    expect(retracted!.status).toBe("RETRACTED");
    expect(retracted!.retractedAt).toBeInstanceOf(Date);

    const active = await db.getPremisesForUser("user-1", "ACTIVE");
    expect(active.map((p) => p.assertion.text)).toContain("I am based in Istanbul");
  }, 30_000);

  it("applies retractions even when no new premises are extracted", async () => {
    const db = createMockDatabase();
    const existing = await db.createPremise({
      userId: "user-1",
      assertion: { text: "I am a software engineer", tier: "assertive" },
      provenance: { source: "explicit", confidence: 1.0, timestamp: new Date().toISOString() },
      validity: { volatile: false },
    });

    const decomposer = createMockDecomposer({
      reasoning: "pure removal",
      premises: [],
      retractedPremiseIds: [existing.id],
      revisedBio: null,
    });
    const factory = new PremiseGraphFactory(db, createMockEmbedder(), undefined, createMockAnalyzer(), decomposer);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      input: "Remove everything about software engineering.",
      operationMode: "decompose" as const,
    });

    expect(result.error).toBeUndefined();
    const retracted = await db.getPremise(existing.id);
    expect(retracted!.status).toBe("RETRACTED");
  }, 30_000);

  it("rewrites the stored bio when the decomposer returns a revision", async () => {
    const db = createMockDatabase();
    await db.updateUser("user-1", { intro: "Engineer. Creator of the HOPE language." });

    const decomposer = createMockDecomposer({
      reasoning: "bio mentions disavowed fact",
      premises: [],
      retractedPremiseIds: [],
      revisedBio: "Engineer.",
    });
    const factory = new PremiseGraphFactory(db, createMockEmbedder(), undefined, createMockAnalyzer(), decomposer);
    const graph = factory.createGraph();

    await graph.invoke({
      userId: "user-1",
      input: "Remove all mentions of the HOPE language.",
      operationMode: "decompose" as const,
    });

    const user = await db.getUser("user-1");
    expect(user!.intro).toBe("Engineer.");
  }, 30_000);

  it("does not touch the bio when the decomposer returns no revision", async () => {
    const db = createMockDatabase();
    await db.updateUser("user-1", { intro: "Engineer." });

    const decomposer = createMockDecomposer({ ...baseOutput, premises: [] });
    const factory = new PremiseGraphFactory(db, createMockEmbedder(), undefined, createMockAnalyzer(), decomposer);
    const graph = factory.createGraph();

    await graph.invoke({
      userId: "user-1",
      input: "I also enjoy woodworking.",
      operationMode: "decompose" as const,
    });

    const user = await db.getUser("user-1");
    expect(user!.intro).toBe("Engineer.");
  }, 30_000);

  it("skips a near-duplicate premise via the shared dedupe step", async () => {
    const db = {
      ...createMockDatabase(),
      findSimilarActivePremise: async () => ({
        premiseId: "existing-1",
        assertionText: "I am a software engineer",
        similarity: 0.97,
      }),
    };
    const decomposer = createMockDecomposer(baseOutput);
    const factory = new PremiseGraphFactory(db, createMockEmbedder(), undefined, createMockAnalyzer(), decomposer);
    const graph = factory.createGraph();

    await graph.invoke({
      userId: "user-1",
      input: "I am a software engineer based in Berlin.",
      operationMode: "decompose" as const,
    });

    const created = await db.getPremisesForUser("user-1", "ACTIVE");
    expect(created).toEqual([]);
  }, 30_000);

  it("continues creating remaining premises when one fails", async () => {
    const db = createMockDatabase();
    const realCreate = db.createPremise.bind(db);
    let calls = 0;
    db.createPremise = (async (input: Parameters<typeof realCreate>[0]) => {
      calls++;
      if (calls === 1) throw new Error("db write failed");
      return realCreate(input);
    }) as typeof realCreate;

    const decomposer = createMockDecomposer(baseOutput);
    const factory = new PremiseGraphFactory(db, createMockEmbedder(), undefined, createMockAnalyzer(), decomposer);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      input: "I am a software engineer based in Berlin.",
      operationMode: "decompose" as const,
    });

    expect(result.error).toBeUndefined();
    const created = await db.getPremisesForUser("user-1", "ACTIVE");
    expect(created).toHaveLength(1);
  }, 30_000);

  it("returns an error when no input is provided", async () => {
    const db = createMockDatabase();
    const decomposer = createMockDecomposer(baseOutput);
    const factory = new PremiseGraphFactory(db, createMockEmbedder(), undefined, createMockAnalyzer(), decomposer);
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      operationMode: "decompose" as const,
    });

    expect(result.error).toBeDefined();
  }, 30_000);
});
