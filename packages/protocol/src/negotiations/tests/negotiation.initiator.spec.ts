import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator } from "../negotiation.agent.js";

/**
 * IND-396 — initiator seat stamping (v2 client-advocate protocol).
 *
 * Every negotiation task row is created in exactly one place (the init node),
 * so these tests pin the resolution order of `metadata.initiatorUserId`:
 *   1. inherit from the prior task for the same opportunity (continuations
 *      never re-derive the seat),
 *   2. conversation-scoped tie-break (symmetric concurrent starts),
 *   3. explicit `initiatorUserId` on the invoke input,
 *   4. fallback to sourceUser.id (pre-stamp behavior).
 */

type TaskRecord = {
  id: string;
  conversationId: string;
  state: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

function mkStubs(opts?: {
  priorOpportunityTask?: TaskRecord | null;
  conversationTask?: TaskRecord | null;
  omitConversationLookup?: boolean;
}) {
  const createdTasks: Array<{ conversationId: string; metadata: Record<string, unknown> }> = [];
  const database = {
    createConversation: async () => ({ id: "conv-1" }),
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string, metadata: Record<string, unknown>) => {
      createdTasks.push({ conversationId, metadata });
      return { id: "task-new", conversationId, state: "submitted" };
    },
    updateOpportunityStatus: async () => {},
    createMessage: async (p: { senderId: string; parts: unknown[] }) => ({
      id: "msg-1", senderId: p.senderId, parts: p.parts, createdAt: new Date(),
    }),
    updateTaskState: async () => {},
    createArtifact: async () => {},
    setTaskTurnContext: async () => {},
    getMessagesForConversation: async () => [],
    getOpportunityUserAnswers: async () => [],
    getNegotiationTaskForOpportunity: async () => opts?.priorOpportunityTask ?? null,
    ...(opts?.omitConversationLookup
      ? {}
      : { getLatestNegotiationTaskForConversation: async () => opts?.conversationTask ?? null }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async () => ({ handled: false, reason: "no-agent" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  return { database, dispatcher, createdTasks };
}

function mkTask(partial: Partial<TaskRecord>): TaskRecord {
  return {
    id: "task-prior",
    conversationId: "conv-1",
    state: "completed",
    metadata: null,
    createdAt: new Date(Date.now() - 60 * 60 * 1000),
    updatedAt: new Date(Date.now() - 60 * 60 * 1000),
    ...partial,
  };
}

async function runGraph(
  stubs: ReturnType<typeof mkStubs>,
  input: Record<string, unknown>,
) {
  const graph = new NegotiationGraphFactory(stubs.database, stubs.dispatcher).createGraph();
  return graph.invoke({
    sourceUser: { id: "u-src", intents: [], profile: { name: "Alice" } },
    candidateUser: { id: "u-cand", intents: [], profile: { name: "Bob" } },
    indexContext: { networkId: "net-1", prompt: "" },
    seedAssessment: { reasoning: "x", valencyRole: "peer" },
    maxTurns: 1,
    ...input,
  } as Partial<typeof NegotiationGraphState.State>);
}

describe("negotiation graph — initiatorUserId stamping (IND-396)", () => {
  let origInvoke: typeof IndexNegotiator.prototype.invoke;

  beforeAll(() => {
    origInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function () {
      return {
        action: "accept" as const,
        assessment: {
          reasoning: "stub",
          suggestedRoles: { ownUser: "agent" as const, otherUser: "patient" as const },
        },
        message: "deal",
      };
    };
  });

  afterAll(() => {
    IndexNegotiator.prototype.invoke = origInvoke;
  });

  it("fresh run: stamps sourceUser.id when nothing else is available", async () => {
    const stubs = mkStubs();
    await runGraph(stubs, { opportunityId: "opp-1" });

    expect(stubs.createdTasks.length).toBe(1);
    expect(stubs.createdTasks[0].metadata.initiatorUserId).toBe("u-src");
    expect(stubs.createdTasks[0].metadata.sourceUserId).toBe("u-src");
  });

  it("explicit stamp: invoke input initiatorUserId wins over the sourceUser fallback", async () => {
    const stubs = mkStubs();
    await runGraph(stubs, { opportunityId: "opp-1", initiatorUserId: "u-explicit" });

    expect(stubs.createdTasks[0].metadata.initiatorUserId).toBe("u-explicit");
  });

  it("no-opportunity path (triggerDiscoveryNegotiation shape): explicit stamp still lands", async () => {
    const stubs = mkStubs();
    await runGraph(stubs, { initiatorUserId: "u-viewer" });

    expect(stubs.createdTasks.length).toBe(1);
    expect(stubs.createdTasks[0].metadata.initiatorUserId).toBe("u-viewer");
    expect(stubs.createdTasks[0].metadata.opportunityId).toBeUndefined();
  });

  it("continuation inherits from the prior task even when the heuristic would flip the seat", async () => {
    // Prior session was initiated by the *candidate* side of this run.
    const stubs = mkStubs({
      priorOpportunityTask: mkTask({
        state: "completed",
        metadata: { type: "negotiation", initiatorUserId: "u-cand", sourceUserId: "u-cand" },
      }),
    });
    // This re-entry runs with u-src as sourceUser (the heuristic would pick u-src).
    await runGraph(stubs, { opportunityId: "opp-1", initiatorUserId: "u-src" });

    expect(stubs.createdTasks[0].metadata.initiatorUserId).toBe("u-cand");
    expect(stubs.createdTasks[0].metadata.sourceUserId).toBe("u-src");
  });

  it("pre-stamp prior task: falls back to the session sourceUser (heuristic unchanged)", async () => {
    const stubs = mkStubs({
      priorOpportunityTask: mkTask({
        state: "completed",
        metadata: { type: "negotiation", sourceUserId: "u-cand" }, // no initiatorUserId
      }),
    });
    await runGraph(stubs, { opportunityId: "opp-1" });

    expect(stubs.createdTasks[0].metadata.initiatorUserId).toBe("u-src");
  });

  it("tie-break: concurrent symmetric start on the same conversation yields exactly one initiator", async () => {
    // The counterparty's run (different opportunityId) already created an
    // active, fresh task on this agent-pair DM — it won the seat.
    const stubs = mkStubs({
      conversationTask: mkTask({
        id: "task-winner",
        state: "working",
        updatedAt: new Date(), // fresh
        metadata: { type: "negotiation", initiatorUserId: "u-cand", sourceUserId: "u-cand", opportunityId: "opp-theirs" },
      }),
    });
    await runGraph(stubs, { opportunityId: "opp-ours" });

    // The losing run proceeds, but as counterparty: it inherits the winner's seat.
    expect(stubs.createdTasks.length).toBe(1);
    expect(stubs.createdTasks[0].metadata.initiatorUserId).toBe("u-cand");
    expect(stubs.createdTasks[0].metadata.sourceUserId).toBe("u-src");
  });

  it("tie-break is inert for stale conversation tasks (asymmetric flows unchanged)", async () => {
    const stubs = mkStubs({
      conversationTask: mkTask({
        id: "task-old",
        state: "completed", // terminal — not a concurrent start
        metadata: { type: "negotiation", initiatorUserId: "u-cand" },
      }),
    });
    await runGraph(stubs, { opportunityId: "opp-ours" });

    expect(stubs.createdTasks[0].metadata.initiatorUserId).toBe("u-src");
  });

  it("dep without getLatestNegotiationTaskForConversation (optional): stamps without crashing", async () => {
    const stubs = mkStubs({ omitConversationLookup: true });
    await runGraph(stubs, { opportunityId: "opp-1" });

    expect(stubs.createdTasks[0].metadata.initiatorUserId).toBe("u-src");
  });

  it("emits initiatorUserId on negotiation_session_start via negotiateCandidates", async () => {
    const { negotiateCandidates } = await import("../negotiation.graph.js");
    const events: Array<Record<string, unknown>> = [];
    const fakeGraph = {
      invoke: async (input: Record<string, unknown>) => {
        events.push({ type: "_invoke", initiatorUserId: input.initiatorUserId });
        return { outcome: { hasOpportunity: false, reasoning: "", turnCount: 1 }, messages: [] };
      },
    };

    await negotiateCandidates(
      fakeGraph as never,
      { id: "u-src", intents: [], profile: {} },
      [{
        userId: "u-cand",
        opportunityId: "opp-1",
        reasoning: "r",
        valencyRole: "peer",
        candidateUser: { id: "u-cand", intents: [], profile: {} },
      }],
      { networkId: "", prompt: "" },
      { initiatorUserId: "u-initiator", traceEmitter: ((e: Record<string, unknown>) => events.push(e)) as never },
    );

    const start = events.find((e) => e.type === "negotiation_session_start");
    expect(start?.initiatorUserId).toBe("u-initiator");
    const invoked = events.find((e) => e.type === "_invoke");
    expect(invoked?.initiatorUserId).toBe("u-initiator");
  });
});
