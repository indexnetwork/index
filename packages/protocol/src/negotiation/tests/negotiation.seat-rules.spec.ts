import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import type { NegotiationTurn } from "../negotiation.state.js";

/**
 * IND-397 — seat-scoped turn schemas + counterparty-only accept (graph level).
 *
 * Pins:
 * - protocolVersion stamping for fresh runs (env switch) and inheritance for
 *   continuations (a v1 conversation stays v1 mid-flight even with env=v2),
 * - turn-0 opening action per version (v1 propose, v2 initiator outreach),
 * - seat + version propagation into the system agent and dispatch payload,
 * - v2 coercion of out-of-seat personal-agent turns (initiator accept →
 *   conservative counter),
 * - counterparty accept finalizing normally under v2.
 */

type TaskRecord = {
  id: string;
  conversationId: string;
  state: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeMessage = {
  id: string;
  senderId: string;
  role: "agent";
  parts: unknown[];
  createdAt: Date;
};

function priorMsg(senderUserId: string, action: string, idx: number): FakeMessage {
  return {
    id: `prior-${idx}`,
    senderId: `agent:${senderUserId}`,
    role: "agent",
    parts: [{ kind: "data", data: { action, assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null } }],
    createdAt: new Date(Date.now() - (100 - idx) * 1000),
  };
}

function mkStubs(opts?: {
  priorOpportunityTask?: TaskRecord | null;
  conversationTask?: TaskRecord | null;
  priorMessages?: FakeMessage[];
  dispatch?: (userId: string) => Promise<unknown>;
}) {
  const createdTasks: Array<{ conversationId: string; metadata: Record<string, unknown> }> = [];
  const createdMessages: Array<{ senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }> = [];
  const database = {
    createConversation: async () => ({ id: "conv-1" }),
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string, metadata: Record<string, unknown>) => {
      createdTasks.push({ conversationId, metadata });
      return { id: "task-new", conversationId, state: "submitted" };
    },
    updateOpportunityStatus: async () => {},
    createMessage: async (p: { senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }) => {
      createdMessages.push(p);
      return { id: `msg-${createdMessages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async () => {},
    createArtifact: async () => {},
    setTaskTurnContext: async () => {},
    getMessagesForConversation: async () => opts?.priorMessages ?? [],
    getOpportunityUserAnswers: async () => [],
    getNegotiationTaskForOpportunity: async () => opts?.priorOpportunityTask ?? null,
    getLatestNegotiationTaskForConversation: async () => opts?.conversationTask ?? null,
    getUserContext: async () => null,
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async (userId: string) =>
      opts?.dispatch ? opts.dispatch(userId) : { handled: false, reason: "no_agent" },
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  return { database, dispatcher, createdTasks, createdMessages };
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

async function runGraph(stubs: ReturnType<typeof mkStubs>, input: Record<string, unknown>) {
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

const agentInputs: NegotiationAgentInput[] = [];
let stubAction: string | ((input: NegotiationAgentInput) => string) = "counter";

describe("negotiation graph — seat rules + protocol version (IND-397)", () => {
  let origInvoke: typeof IndexNegotiator.prototype.invoke;
  const origEnv = process.env.NEGOTIATION_PROTOCOL_VERSION;

  beforeAll(() => {
    origInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function (input: NegotiationAgentInput) {
      agentInputs.push(input);
      const action = typeof stubAction === "function" ? stubAction(input) : stubAction;
      return {
        action: action as NegotiationTurn["action"],
        assessment: { reasoning: "stub", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
        message: null,
      };
    };
  });

  afterAll(() => {
    IndexNegotiator.prototype.invoke = origInvoke;
  });

  beforeEach(() => {
    agentInputs.length = 0;
    stubAction = "counter";
    delete process.env.NEGOTIATION_PROTOCOL_VERSION;
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.NEGOTIATION_PROTOCOL_VERSION;
    else process.env.NEGOTIATION_PROTOCOL_VERSION = origEnv;
  });

  it("fresh run with env=v2: stamps protocolVersion v2 and forces turn 0 to outreach", async () => {
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    const stubs = mkStubs();
    stubAction = "counter"; // out-of-position opening — must be forced

    await runGraph(stubs, { opportunityId: "opp-1" });

    expect(stubs.createdTasks[0].metadata.protocolVersion).toBe("v2");
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("outreach");
    // System agent got the initiator seat + v2 version
    expect(agentInputs[0].seat).toBe("initiator");
    expect(agentInputs[0].protocolVersion).toBe("v2");
  });

  it("fresh run without env: stays v1 and forces turn 0 to propose (legacy unchanged)", async () => {
    const stubs = mkStubs();
    stubAction = "counter";

    await runGraph(stubs, { opportunityId: "opp-1" });

    expect(stubs.createdTasks[0].metadata.protocolVersion).toBe("v1");
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("propose");
    expect(agentInputs[0].protocolVersion).toBe("v1");
  });

  it("version inheritance: continuation of a v1 conversation stays v1 even with env=v2", async () => {
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    const stubs = mkStubs({
      priorOpportunityTask: mkTask({
        metadata: { type: "negotiation", initiatorUserId: "u-src", sourceUserId: "u-src", protocolVersion: "v1" },
      }),
      priorMessages: [priorMsg("u-src", "propose", 0), priorMsg("u-cand", "counter", 1)],
    });
    stubAction = "counter";

    await runGraph(stubs, { opportunityId: "opp-1" });

    expect(stubs.createdTasks[0].metadata.protocolVersion).toBe("v1");
    expect(agentInputs[0].protocolVersion).toBe("v1");
  });

  it("version inheritance: prior task without a version field grandfathers to v1 under env=v2", async () => {
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    const stubs = mkStubs({
      priorOpportunityTask: mkTask({
        metadata: { type: "negotiation", initiatorUserId: "u-src", sourceUserId: "u-src" }, // pre-v2 task
      }),
      priorMessages: [priorMsg("u-src", "propose", 0)],
    });

    await runGraph(stubs, { opportunityId: "opp-1" });

    expect(stubs.createdTasks[0].metadata.protocolVersion).toBe("v1");
  });

  it("version inheritance: prior conversation turns without any readable task grandfather to v1", async () => {
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    const stubs = mkStubs({
      priorMessages: [priorMsg("u-src", "propose", 0), priorMsg("u-cand", "counter", 1)],
    });

    await runGraph(stubs, { opportunityId: "opp-1" });

    expect(stubs.createdTasks[0].metadata.protocolVersion).toBe("v1");
  });

  it("version inheritance: a v2 conversation stays v2 even after env rollback to v1", async () => {
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v1";
    const stubs = mkStubs({
      priorOpportunityTask: mkTask({
        metadata: { type: "negotiation", initiatorUserId: "u-src", sourceUserId: "u-src", protocolVersion: "v2" },
      }),
      priorMessages: [priorMsg("u-src", "outreach", 0)],
    });

    await runGraph(stubs, { opportunityId: "opp-1" });

    expect(stubs.createdTasks[0].metadata.protocolVersion).toBe("v2");
    expect(agentInputs[0].protocolVersion).toBe("v2");
  });

  it("v2 continuation: counterparty seat is derived from initiatorUserId, not speaking order", async () => {
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    // Prior session: initiator u-src spoke last → this session opens with the
    // candidate (u-cand) speaking. u-cand holds the counterparty seat.
    const stubs = mkStubs({
      priorOpportunityTask: mkTask({
        metadata: { type: "negotiation", initiatorUserId: "u-src", sourceUserId: "u-src", protocolVersion: "v2" },
      }),
      priorMessages: [priorMsg("u-src", "outreach", 0)],
    });
    stubAction = "accept";

    const result = await runGraph(stubs, { opportunityId: "opp-1", maxTurns: 6 });

    expect(agentInputs[0].seat).toBe("counterparty");
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("accept");
    expect((result as { outcome: { hasOpportunity: boolean } }).outcome?.hasOpportunity).toBe(true);
  });

  it("v2: personal-agent accept from the initiator seat is coerced to conservative counter", async () => {
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    // Prior session: counterparty (u-cand) spoke last → initiator (u-src)
    // speaks next. Its personal agent tries to accept — out of seat.
    const stubs = mkStubs({
      priorOpportunityTask: mkTask({
        metadata: { type: "negotiation", initiatorUserId: "u-src", sourceUserId: "u-src", protocolVersion: "v2" },
      }),
      priorMessages: [priorMsg("u-src", "outreach", 0), priorMsg("u-cand", "counter", 1)],
      dispatch: async () => ({
        handled: true,
        turn: {
          action: "accept",
          assessment: { reasoning: "rogue", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
          message: null,
        },
      }),
    });

    await runGraph(stubs, { opportunityId: "opp-1", maxTurns: 1 });

    expect(stubs.createdMessages[0].parts[0].data.action).toBe("counter");
    expect(stubs.createdMessages[0].senderId).toBe("agent:u-src");
  });

  it("v2: withdraw finalizes as rejected (reject-like), not stalled", async () => {
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    const statusUpdates: string[] = [];
    const stubs = mkStubs({
      priorOpportunityTask: mkTask({
        metadata: { type: "negotiation", initiatorUserId: "u-src", sourceUserId: "u-src", protocolVersion: "v2" },
      }),
      priorMessages: [priorMsg("u-src", "outreach", 0), priorMsg("u-cand", "counter", 1)],
    });
    (stubs.database as unknown as { updateOpportunityStatus: (id: string, s: string) => Promise<void> }).updateOpportunityStatus =
      async (_id: string, s: string) => { statusUpdates.push(s); };
    stubAction = "withdraw";

    const result = await runGraph(stubs, { opportunityId: "opp-1", maxTurns: 6 });

    expect((result as { outcome: { hasOpportunity: boolean } }).outcome?.hasOpportunity).toBe(false);
    expect(statusUpdates).toContain("rejected");
  });

  it("v2 final turn: agent is invoked with isFinalTurn and the parked seat", async () => {
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    const stubs = mkStubs();
    stubAction = (input) => (input.isFinalTurn ? "decline" : "counter");

    await runGraph(stubs, { opportunityId: "opp-1", maxTurns: 2 });

    // Turn 0: initiator opening; Turn 1 (= maxTurns): final counterparty turn
    expect(agentInputs.length).toBe(2);
    expect(agentInputs[1].isFinalTurn).toBe(true);
    expect(agentInputs[1].seat).toBe("counterparty");
    expect(agentInputs[1].protocolVersion).toBe("v2");
  });

  it("dispatch payload announces seat, version, and allowedActions", async () => {
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    const payloads: Array<Record<string, unknown>> = [];
    const stubs = mkStubs({
      dispatch: async () => ({ handled: false, reason: "no_agent" }),
    });
    (stubs.dispatcher as unknown as { dispatch: (u: string, s: unknown, p: Record<string, unknown>) => Promise<unknown> }).dispatch =
      async (_u: string, _s: unknown, p: Record<string, unknown>) => { payloads.push(p); return { handled: false, reason: "no_agent" }; };

    await runGraph(stubs, { opportunityId: "opp-1", maxTurns: 6 });

    expect(payloads[0].seat).toBe("initiator");
    expect(payloads[0].protocolVersion).toBe("v2");
    expect(payloads[0].allowedActions).toEqual(["outreach", "counter", "question", "withdraw"]);
  });
});
