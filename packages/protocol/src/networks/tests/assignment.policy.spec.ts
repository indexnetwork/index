/**
 * Characterization: signal assignment policy.
 *
 * Verifies the assignment rules enforced by IntentNetworkGraphFactory:
 * - Direct (skipEvaluation: true) → manual_override, score 1, immediate write.
 * - Evaluated (skipEvaluation: false) + prompts → IntentIndexer evaluation with threshold.
 * - No-prompt fast path → automatic assignment without LLM call.
 * - Membership is re-checked at persistence time (fails-closed on revocation).
 * - Only the intent owner can assign or unassign their own intents.
 * - A user must be a member or owner to assign/unassign.
 *
 * IND-546: policy characterization spec for communities domain-first module.
 * Signals injected via the communities ports layer (IntentIndexer interface).
 */
import { describe, expect, it } from "bun:test";

import { IntentNetworkGraphFactory } from "../application/indexer.graph.js";
import type { IntentNetworkGraphDatabase } from "../ports/index.js";
import type { IntentIndexerOutput } from "../ports/index.js";

// ── Helpers ────────────────────────────────────────────────────────────────────

type DbOverrides = Partial<IntentNetworkGraphDatabase>;

function makeDb(overrides: DbOverrides = {}): IntentNetworkGraphDatabase {
  return {
    getIntent: async () => ({ id: "intent-1", userId: "user-1", payload: "Build AI tools" }),
    isNetworkMember: async () => true,
    isIndexOwner: async () => false,
    isIntentAssignedToIndex: async () => false,
    getIntentForIndexing: async () => ({
      id: "intent-1",
      userId: "user-1",
      payload: "Build AI tools",
      sourceType: null,
      sourceId: null,
    }),
    getNetworkAssignmentContext: async () => ({
      networkId: "net-1",
      indexPrompt: "AI founders",
      memberPrompt: "developer tools",
    }),
    getNetwork: async () => ({
      id: "net-1",
      title: "AI Network",
      prompt: "AI founders",
      type: "community",
      metadata: {},
    }),
    assignIntentToNetworkIfMember: async () => ({ kind: "assigned" as const }),
    unassignIntentFromIndex: async () => {},
    getNetworkIdsForIntent: async () => [],
    getNetworkIntentsForMember: async () => [],
    getIntentsInIndexForMember: async () => [],
    ...overrides,
  } as unknown as IntentNetworkGraphDatabase;
}

function makeIndexer(result: IntentIndexerOutput | null) {
  return { indexIntent: async () => result };
}

function makeGraph(dbOverrides: DbOverrides = {}, indexerResult: IntentIndexerOutput | null = null) {
  return new IntentNetworkGraphFactory(makeDb(dbOverrides), makeIndexer(indexerResult) as never).createGraph();
}

const BASE = {
  userId: "user-1",
  intentId: "intent-1",
  networkId: "net-1",
};

// ── Direct assignment ─────────────────────────────────────────────────────────

describe("assignment policy: direct (skipEvaluation: true)", () => {
  it("assigns immediately with manual_override metadata and score 1", async () => {
    const assignments: Array<{ score?: number; metadata?: unknown }> = [];
    const graph = makeGraph({
      assignIntentToNetworkIfMember: async (_u, _i, _n, score, metadata) => {
        assignments.push({ score, metadata });
        return { kind: "assigned" as const };
      },
    });

    const result = await graph.invoke({ ...BASE, operationMode: "create" as const, skipEvaluation: true });

    expect(result.mutationResult?.success).toBe(true);
    expect(assignments[0].score).toBe(1);
    expect((assignments[0].metadata as Record<string, unknown>).mode).toBe("manual_override");
    expect((assignments[0].metadata as Record<string, unknown>).assigned).toBe(true);
  });

  it("returns success even when already assigned", async () => {
    const graph = makeGraph({ isIntentAssignedToIndex: async () => true });
    const result = await graph.invoke({ ...BASE, operationMode: "create" as const, skipEvaluation: true });
    expect(result.mutationResult?.success).toBe(true);
    expect(result.mutationResult?.message).toContain("already");
  });
});

// ── Evaluated assignment ──────────────────────────────────────────────────────

describe("assignment policy: evaluated (skipEvaluation: false)", () => {
  it("uses weighted threshold: (0.6*index + 0.4*member) >= 0.7", async () => {
    // 0.8*0.6 + 0.6*0.4 = 0.48+0.24 = 0.72 → above threshold
    const assignments: Array<{ score?: number }> = [];
    const graph = new IntentNetworkGraphFactory(
      makeDb({
        assignIntentToNetworkIfMember: async (_u, _i, _n, score) => {
          assignments.push({ score });
          return { kind: "assigned" as const };
        },
      }),
      makeIndexer({ indexScore: 0.8, memberScore: 0.6, reasoning: "Match" }) as never,
    ).createGraph();

    const result = await graph.invoke({ ...BASE, operationMode: "create" as const, skipEvaluation: false });

    expect(result.mutationResult?.success).toBe(true);
    expect(result.finalScore).toBeCloseTo(0.72);
    expect(assignments[0].score).toBeCloseTo(0.72);
  });

  it("rejects when weighted score falls below threshold", async () => {
    // 0.4*0.6 + 0.4*0.4 = 0.24+0.16 = 0.40 → below 0.7
    const graph = makeGraph({}, { indexScore: 0.4, memberScore: 0.4, reasoning: "Weak match" });
    const result = await graph.invoke({ ...BASE, operationMode: "create" as const, skipEvaluation: false });
    expect(result.mutationResult?.success).toBe(false);
    expect(result.mutationResult?.error).toContain("did not qualify");
    expect(result.shouldAssign).toBe(false);
  });

  it("records automatic metadata with promptPresence when both prompts are present", async () => {
    const assignments: Array<{ metadata?: unknown }> = [];
    const graph = new IntentNetworkGraphFactory(
      makeDb({
        assignIntentToNetworkIfMember: async (_u, _i, _n, _s, metadata) => {
          assignments.push({ metadata });
          return { kind: "assigned" as const };
        },
      }),
      makeIndexer({ indexScore: 0.9, memberScore: 0.9, reasoning: "Strong match" }) as never,
    ).createGraph();

    await graph.invoke({ ...BASE, operationMode: "create" as const, skipEvaluation: false });

    const meta = assignments[0].metadata as Record<string, unknown>;
    expect(meta.mode).toBe("automatic");
    expect(meta.promptPresence).toBe("both");
    expect(meta.assigned).toBe(true);
  });
});

// ── No-prompt fast path ───────────────────────────────────────────────────────

describe("assignment policy: no-prompt fast path", () => {
  it("assigns without LLM call when both prompts are absent", async () => {
    let evaluatorCalled = false;
    const indexer = { indexIntent: async () => { evaluatorCalled = true; return null; } };
    const graph = new IntentNetworkGraphFactory(
      makeDb({
        getNetworkAssignmentContext: async () => ({ networkId: "net-1", indexPrompt: null, memberPrompt: null }),
      }),
      indexer as never,
    ).createGraph();

    const result = await graph.invoke({ ...BASE, operationMode: "create" as const, skipEvaluation: false });

    expect(evaluatorCalled).toBe(false);
    expect(result.mutationResult?.success).toBe(true);
    expect(result.mutationResult?.message).toContain("no prompts");
  });

  it("uses automatic mode with promptPresence:none on no-prompt path", async () => {
    const assignments: Array<{ metadata?: unknown }> = [];
    const graph = new IntentNetworkGraphFactory(
      makeDb({
        getNetworkAssignmentContext: async () => ({ networkId: "net-1", indexPrompt: "", memberPrompt: "  " }),
        assignIntentToNetworkIfMember: async (_u, _i, _n, _s, metadata) => {
          assignments.push({ metadata });
          return { kind: "assigned" as const };
        },
      }),
      makeIndexer(null) as never,
    ).createGraph();

    await graph.invoke({ ...BASE, operationMode: "create" as const, skipEvaluation: false });

    const meta = assignments[0].metadata as Record<string, unknown>;
    expect(meta.mode).toBe("automatic");
    expect(meta.promptPresence).toBe("none");
  });
});

// ── Membership authority for assignment ────────────────────────────────────────

describe("assignment policy: membership authority", () => {
  it("rejects assignment of another user's intent", async () => {
    const graph = makeGraph({
      getIntent: async () => ({ id: "intent-1", userId: "other-user", payload: "Not mine" }),
    });
    const result = await graph.invoke({ ...BASE, operationMode: "create" as const, skipEvaluation: true });
    expect(result.mutationResult?.success).toBe(false);
    expect(result.mutationResult?.error).toContain("own intents");
  });

  it("rejects assignment when user is not a member or owner", async () => {
    const graph = makeGraph({
      isNetworkMember: async () => false,
      isIndexOwner: async () => false,
    });
    const result = await graph.invoke({ ...BASE, operationMode: "create" as const, skipEvaluation: true });
    expect(result.mutationResult?.success).toBe(false);
    expect(result.mutationResult?.error).toContain("not a member");
  });

  it("fails closed when membership is revoked between intent creation and persistence", async () => {
    const graph = makeGraph({
      assignIntentToNetworkIfMember: async () => ({ kind: "membership_required" as const }),
    });
    const result = await graph.invoke({ ...BASE, operationMode: "create" as const, skipEvaluation: true });
    expect(result.mutationResult?.success).toBe(false);
    expect(result.mutationResult?.error).toContain("membership");
  });

  it("allows owner (non-member) to assign their own intent", async () => {
    const graph = makeGraph({
      isNetworkMember: async () => false,
      isIndexOwner: async () => true,
    });
    const result = await graph.invoke({ ...BASE, operationMode: "create" as const, skipEvaluation: true });
    expect(result.mutationResult?.success).toBe(true);
  });
});

// ── Unassign (delete) authority ───────────────────────────────────────────────

describe("assignment policy: unassign authority", () => {
  it("allows the intent owner to unassign their intent from a network they belong to", async () => {
    const graph = makeGraph({
      isIntentAssignedToIndex: async () => true,
      unassignIntentFromIndex: async () => {},
    });
    const result = await graph.invoke({ ...BASE, operationMode: "delete" as const });
    expect(result.mutationResult?.success).toBe(true);
  });

  it("rejects unassign when user does not own the intent", async () => {
    const graph = makeGraph({
      getIntent: async () => ({ id: "intent-1", userId: "other-user", payload: "Not mine" }),
    });
    const result = await graph.invoke({ ...BASE, operationMode: "delete" as const });
    expect(result.mutationResult?.success).toBe(false);
    expect(result.mutationResult?.error).toContain("own intents");
  });

  it("succeeds idempotently when intent is not assigned to the network", async () => {
    const graph = makeGraph({ isIntentAssignedToIndex: async () => false });
    const result = await graph.invoke({ ...BASE, operationMode: "delete" as const });
    expect(result.mutationResult?.success).toBe(true);
    expect(result.mutationResult?.message).toContain("not in this network");
  });
});
