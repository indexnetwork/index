import { describe, expect, it } from "bun:test";

import type { IntentIndexerOutput } from "../../../intent/intent.indexer.js";

import { IntentNetworkGraphFactory } from "../indexer.graph.js";

function createDb(overrides: Record<string, unknown> = {}) {
  const assignments: Array<{ intentId: string; networkId: string; score?: number; metadata?: unknown }> = [];
  return {
    assignments,
    getIntent: async () => ({ id: "intent-1", userId: "user-1", payload: "Build AI tools" }),
    isNetworkMember: async () => true,
    isIndexOwner: async () => false,
    isIntentAssignedToIndex: async () => false,
    getIntentForIndexing: async () => ({ id: "intent-1", userId: "user-1", payload: "Build AI tools", sourceType: null, sourceId: null }),
    getNetworkAssignmentContext: async () => ({ networkId: "network-1", indexPrompt: "AI founders", memberPrompt: "developer tools" }),
    getNetwork: async () => ({ id: "network-1", title: "AI", prompt: "AI founders", type: "community", metadata: {} }),
    assignIntentToNetworkIfMember: async (_userId: string, intentId: string, networkId: string, score?: number, metadata?: unknown) => {
      assignments.push({ intentId, networkId, score, metadata });
      return { kind: "assigned" as const };
    },
    unassignIntentFromIndex: async () => {},
    getNetworkIdsForIntent: async () => [],
    getNetworkIntentsForMember: async () => [],
    getIntentsInIndexForMember: async () => [],
    ...overrides,
  };
}

function createIndexer(result: IntentIndexerOutput | null) {
  return {
    evaluate: async () => result,
  };
}

describe("IntentNetworkGraphFactory", () => {
  it("records manual override metadata for skipEvaluation assignment", async () => {
    const db = createDb();
    const graph = new IntentNetworkGraphFactory(db as never, createIndexer(null) as never).createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      intentId: "intent-1",
      networkId: "network-1",
      operationMode: "create" as const,
      skipEvaluation: true,
    });

    expect(result.mutationResult?.success).toBe(true);
    expect(db.assignments[0]).toMatchObject({ intentId: "intent-1", networkId: "network-1", score: 1 });
    expect(db.assignments[0].metadata).toMatchObject({ resourceType: "intent", mode: "manual_override", assigned: true });
  });

  it("uses unified weighted threshold for evaluated assignment", async () => {
    const db = createDb();
    const graph = new IntentNetworkGraphFactory(
      db as never,
      createIndexer({ indexScore: 0.8, memberScore: 0.6, reasoning: "Weighted match" }) as never,
    ).createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      intentId: "intent-1",
      networkId: "network-1",
      operationMode: "create" as const,
      skipEvaluation: false,
    });

    expect(result.mutationResult?.success).toBe(true);
    expect(result.finalScore).toBeCloseTo(0.72);
    expect(db.assignments[0].metadata).toMatchObject({ mode: "automatic", finalScore: 0.72, promptPresence: "both" });
  });

  it("uses final-authority assignment for the no-prompts path", async () => {
    const db = createDb({
      getNetworkAssignmentContext: async () => ({ networkId: "network-1", indexPrompt: null, memberPrompt: null }),
    });
    const graph = new IntentNetworkGraphFactory(db as never, createIndexer(null) as never).createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      intentId: "intent-1",
      networkId: "network-1",
      operationMode: "create" as const,
      skipEvaluation: false,
    });

    expect(result.mutationResult).toEqual({ success: true, message: "Intent assigned to network (no prompts)." });
    expect(db.assignments).toHaveLength(1);
  });

  it("maps a concurrent already-assigned final result idempotently", async () => {
    const db = createDb({
      assignIntentToNetworkIfMember: async () => ({ kind: "already_assigned" as const }),
    });
    const graph = new IntentNetworkGraphFactory(db as never, createIndexer(null) as never).createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      intentId: "intent-1",
      networkId: "network-1",
      operationMode: "create" as const,
      skipEvaluation: true,
    });

    expect(result.assignmentResult).toEqual({ networkId: "network-1", assigned: true, success: true });
    expect(result.mutationResult).toEqual({ success: true, message: "That intent is already in this network." });
  });

  it("fails closed when final membership authority denies direct assignment", async () => {
    const db = createDb({
      assignIntentToNetworkIfMember: async () => ({ kind: "membership_required" as const }),
    });
    const graph = new IntentNetworkGraphFactory(db as never, createIndexer(null) as never).createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      intentId: "intent-1",
      networkId: "network-1",
      operationMode: "create" as const,
      skipEvaluation: true,
    });

    expect(result.assignmentResult).toEqual({ networkId: "network-1", assigned: false, success: false });
    expect(result.mutationResult).toEqual({
      success: false,
      error: "Current network membership is required to assign this intent.",
    });
    expect(db.assignments).toEqual([]);
  });

  it("fails closed when membership is revoked during evaluation", async () => {
    const db = createDb({
      assignIntentToNetworkIfMember: async () => ({ kind: "membership_required" as const }),
    });
    const graph = new IntentNetworkGraphFactory(
      db as never,
      createIndexer({ indexScore: 0.9, memberScore: 0.9, reasoning: "Strong before revocation" }) as never,
    ).createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      intentId: "intent-1",
      networkId: "network-1",
      operationMode: "create" as const,
      skipEvaluation: false,
    });

    expect(result.shouldAssign).toBe(false);
    expect(result.assignmentResult).toEqual({ networkId: "network-1", assigned: false, success: false });
    expect(result.mutationResult?.success).toBe(false);
  });

  it("maps a stale or foreign intent final-authority result safely", async () => {
    const db = createDb({
      assignIntentToNetworkIfMember: async () => ({ kind: "intent_not_owned_or_not_found" as const }),
    });
    const graph = new IntentNetworkGraphFactory(db as never, createIndexer(null) as never).createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      intentId: "intent-1",
      networkId: "network-1",
      operationMode: "create" as const,
      skipEvaluation: true,
    });

    expect(result.mutationResult).toEqual({ success: false, error: "Intent is no longer available for assignment." });
  });

  it("fails closed when evaluated assignment context is missing", async () => {
    const db = createDb({ getNetworkAssignmentContext: async () => null });
    const graph = new IntentNetworkGraphFactory(
      db as never,
      createIndexer({ indexScore: 0.9, memberScore: 0.9, reasoning: "Would otherwise match" }) as never,
    ).createGraph();

    const result = await graph.invoke({
      userId: "user-1",
      intentId: "intent-1",
      networkId: "network-1",
      operationMode: "create" as const,
      skipEvaluation: false,
    });

    expect(result.mutationResult).toEqual({ success: false, error: "Network assignment context not found." });
    expect(result.assignmentResult).toMatchObject({ networkId: "network-1", assigned: false, success: false });
    expect(db.assignments).toEqual([]);
  });
});
