import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import type { NegotiationGraphDatabase } from "../../shared/interfaces/database.interface.js";
import type { AgentDispatcher } from "../../shared/interfaces/agent-dispatcher.interface.js";
import { IndexNegotiator } from "../negotiation.agent.js";

let msgCounter = 0;

function createMockDatabase(overrides: Partial<Record<string, unknown>> = {}) {
  const messages: Array<{ id: string; senderId: string; parts: unknown[]; createdAt: Date }> = [];
  return {
    createConversation: async () => ({ id: "conv-1" }),
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createMessage: async (p: { conversationId: string; senderId: string; parts: unknown[] }) => {
      const msg = { id: `msg-${++msgCounter}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
      messages.push(msg);
      return msg;
    },
    createTask: async () => ({ id: "task-1", conversationId: "conv-1", state: "submitted" }),
    updateTaskState: async () => ({ id: "task-1", conversationId: "conv-1", state: "working" }),
    createArtifact: async () => ({ id: "art-1" }),
    setTaskTurnContext: async () => {},
    getNegotiationTaskForOpportunity: async () => null,
    getOpportunityUserAnswers: async () => [],
    getTasksForUser: async () => [],
    getTask: async () => null,
    getMessagesForConversation: async () => [],
    getArtifactsForTask: async () => [],
    updateOpportunityStatus: async () => ({ id: "opp-1", status: "negotiating" }),
    ...overrides,
    _messages: messages,
  } as unknown as NegotiationGraphDatabase;
}

function createMockDispatcher() {
  return {
    dispatch: async () => ({ handled: false as const, reason: "no_agent" as const }),
    hasPersonalAgent: async () => false,
  } as unknown as AgentDispatcher;
}

const sourceUser = {
  id: "user-source",
  intents: [{ id: "i1", title: "Looking for ML engineer", description: "Need ML expertise", confidence: 0.9 }],
  profile: { name: "Alice", bio: "PM at startup", skills: ["product"] },
};

const candidateUser = {
  id: "user-candidate",
  intents: [{ id: "i2", title: "Seeking PM", description: "ML eng seeking PM co-founder", confidence: 0.85 }],
  profile: { name: "Bob", bio: "ML engineer", skills: ["ML"] },
};

const seed = { reasoning: "Complementary skills", valencyRole: "peer" };
const indexContext = { networkId: "idx-1", prompt: "AI co-founders" };

// Save original invoke and restore after all tests
const origInvoke = IndexNegotiator.prototype.invoke;

afterAll(() => {
  IndexNegotiator.prototype.invoke = origInvoke;
});

describe("Negotiation continuation telemetry", () => {
  beforeEach(() => {
    msgCounter = 0;
  });

  it("fresh flow: isContinuation defaults to false, priorTurnCount defaults to 0", async () => {
    // Scripted: propose then accept to complete quickly
    const scripted = [
      { action: "propose", assessment: { reasoning: "r1", suggestedRoles: { ownUser: "agent", otherUser: "patient" } } },
      { action: "accept", assessment: { reasoning: "r2", suggestedRoles: { ownUser: "agent", otherUser: "patient" } } },
    ];
    let call = 0;
    IndexNegotiator.prototype.invoke = async function () { return scripted[Math.min(call++, scripted.length - 1)] as never; };

    const db = createMockDatabase();
    const dispatcher = createMockDispatcher();
    const factory = new NegotiationGraphFactory(db, dispatcher);
    const graph = factory.createGraph();

    const events: Array<Record<string, unknown>> = [];
    const { requestContext } = await import("../../shared/observability/request-context.js");
    const result = await requestContext.run(
      { traceEmitter: (e: Record<string, unknown>) => events.push(e) },
      async () =>
        graph.invoke({
          sourceUser,
          candidateUser,
          indexContext,
          seedAssessment: seed,
          opportunityId: "opp-fresh",
          maxTurns: 4,
        } as Partial<typeof NegotiationGraphState.State>),
    );

    // State fields default correctly for fresh (non-continuation) flow
    expect(result.isContinuation).toBe(false);
    expect(result.priorTurnCount).toBe(0);

    // Outcome should be accepted (propose → accept)
    expect(result.outcome).not.toBeNull();
    expect(result.outcome!.hasOpportunity).toBe(true);
  }, 30_000);

  it("negotiation_outcome trace event includes continuation fields", async () => {
    const scripted = [
      { action: "propose", assessment: { reasoning: "r1", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } },
      { action: "accept", assessment: { reasoning: "r2", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } },
    ];
    let call = 0;
    IndexNegotiator.prototype.invoke = async function () { return scripted[Math.min(call++, scripted.length - 1)] as never; };

    const db = createMockDatabase();
    const dispatcher = createMockDispatcher();
    const graph = new NegotiationGraphFactory(db, dispatcher).createGraph();

    const events: Array<Record<string, unknown>> = [];
    const { requestContext } = await import("../../shared/observability/request-context.js");
    await requestContext.run(
      { traceEmitter: (e: Record<string, unknown>) => events.push(e) },
      async () =>
        graph.invoke({
          sourceUser,
          candidateUser,
          indexContext,
          seedAssessment: seed,
          opportunityId: "opp-telem",
          maxTurns: 4,
        } as Partial<typeof NegotiationGraphState.State>),
    );

    const outcomes = events.filter((e) => e.type === "negotiation_outcome");
    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0];
    expect(outcome.isContinuation).toBe(false);
    expect(outcome.turnsAdded).toBe(2);
    expect(outcome.priorTurnCount).toBe(0);
  }, 30_000);

  it("negotiation_session_end includes continuation fields when called via negotiateCandidates", async () => {
    // Use a fake graph to isolate negotiateCandidates wrapper behavior
    const fakeGraph = {
      invoke: async (input: { opportunityId?: string }) => ({
        conversationId: `conv-for-${input.opportunityId}`,
        messages: [],
        outcome: { hasOpportunity: false, agreedRoles: [], reasoning: "no fit", turnCount: 2 },
        isContinuation: false,
        priorTurnCount: 0,
      }),
    };

    const events: Array<Record<string, unknown>> = [];
    const { negotiateCandidates } = await import("../negotiation.graph.js");
    const { requestContext } = await import("../../shared/observability/request-context.js");
    await requestContext.run(
      { traceEmitter: (e: Record<string, unknown>) => events.push(e) },
      async () => {
        await negotiateCandidates(
          fakeGraph as never,
          { id: "u-src", intents: [], profile: { name: "Alice" } } as never,
          [
            {
              userId: "u-1",
              reasoning: "r",
              valencyRole: "peer",
              candidateUser: { id: "u-1", intents: [], profile: { name: "Bob" } } as never,
              opportunityId: "opp-session",
            },
          ],
          { networkId: "net-1", prompt: "" },
          {
            traceEmitter: (e: Record<string, unknown>) => events.push(e),
            trigger: "ambient",
          },
        );
      },
    );

    const ends = events.filter((e) => e.type === "negotiation_session_end");
    expect(ends).toHaveLength(1);
    const endEvent = ends[0];
    expect(endEvent.isContinuation).toBe(false);
    expect(endEvent.turnsAdded).toBe(2);
    expect(endEvent.priorTurnCount).toBe(0);
    expect(endEvent.negotiationConversationId).toBe("conv-for-opp-session");
  }, 30_000);

  it("turn_cap outcome emits correct telemetry fields", async () => {
    // All turns counter — hits turn cap
    let call = 0;
    IndexNegotiator.prototype.invoke = async function () {
      call++;
      if (call === 1) return { action: "propose", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } as never;
      return { action: "counter", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } as never;
    };

    const db = createMockDatabase();
    const dispatcher = createMockDispatcher();
    const graph = new NegotiationGraphFactory(db, dispatcher).createGraph();

    const events: Array<Record<string, unknown>> = [];
    const { requestContext } = await import("../../shared/observability/request-context.js");
    const result = await requestContext.run(
      { traceEmitter: (e: Record<string, unknown>) => events.push(e) },
      async () =>
        graph.invoke({
          sourceUser,
          candidateUser,
          indexContext,
          seedAssessment: seed,
          opportunityId: "opp-cap",
          maxTurns: 2,
        } as Partial<typeof NegotiationGraphState.State>),
    );

    // State fields
    expect(result.isContinuation).toBe(false);
    expect(result.priorTurnCount).toBe(0);

    // Outcome trace event
    const outcomes = events.filter((e) => e.type === "negotiation_outcome");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe("turn_cap");
    expect(outcomes[0].isContinuation).toBe(false);
    expect(outcomes[0].turnsAdded).toBe(2);
    expect(outcomes[0].priorTurnCount).toBe(0);
  }, 30_000);

  it("waiting_for_agent outcome includes isContinuation field", async () => {
    const db = createMockDatabase();
    const dispatcher = {
      hasPersonalAgent: async () => true,
      dispatch: async () => ({ handled: false, reason: "waiting" as const }),
    } as unknown as AgentDispatcher;

    const graph = new NegotiationGraphFactory(db, dispatcher).createGraph();

    const events: Array<Record<string, unknown>> = [];
    const { requestContext } = await import("../../shared/observability/request-context.js");
    await requestContext.run(
      { traceEmitter: (e: Record<string, unknown>) => events.push(e) },
      async () =>
        graph.invoke({
          sourceUser,
          candidateUser,
          indexContext,
          seedAssessment: seed,
          opportunityId: "opp-park",
          maxTurns: 4,
        } as Partial<typeof NegotiationGraphState.State>),
    );

    const outcomes = events.filter((e) => e.type === "negotiation_outcome");
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0].outcome).toBe("waiting_for_agent");
    expect(outcomes[0].isContinuation).toBe(false);
  }, 30_000);

  it("continuation: reuses conversation, seeds prior turns, sets isContinuation true", async () => {
    const priorTurn = {
      action: "propose",
      assessment: { reasoning: "Good fit", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
    };
    const priorMessages = [{
      id: "msg-prior-1",
      senderId: `agent:${sourceUser.id}`,
      role: "agent" as const,
      parts: [{ kind: "data" as const, data: priorTurn }],
      createdAt: new Date(Date.now() - 60_000),
    }];

    let call = 0;
    IndexNegotiator.prototype.invoke = async function () {
      call++;
      return { action: "accept", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } as never;
    };

    const db = createMockDatabase({
      getMessagesForConversation: async () => priorMessages,
    });
    const dispatcher = createMockDispatcher();
    const graph = new NegotiationGraphFactory(db, dispatcher).createGraph();

    const result = await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext,
      seedAssessment: seed,
      maxTurns: 2,
    } as Partial<typeof NegotiationGraphState.State>);

    expect(result.isContinuation).toBe(true);
    expect(result.priorTurnCount).toBe(1);
    expect(result.outcome).not.toBeNull();

    IndexNegotiator.prototype.invoke = origInvoke;
  }, 30_000);

  it("continuation with userAnswers: passes answers to agent prompt", async () => {
    const priorTurn = {
      action: "propose",
      assessment: { reasoning: "Good fit", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
    };
    const priorMessages = [{
      id: "msg-prior-1",
      senderId: `agent:${sourceUser.id}`,
      role: "agent" as const,
      parts: [{ kind: "data" as const, data: priorTurn }],
      createdAt: new Date(Date.now() - 60_000),
    }];

    const mockAnswers = [
      { questionId: "q1", selectedOptions: ["ML infrastructure"], freeText: "Specifically PyTorch", answeredAt: "2026-05-25T12:00:00Z" },
      { questionId: "q2", selectedOptions: ["Co-founder"], answeredAt: "2026-05-25T12:01:00Z" },
    ];

    let capturedInput: Record<string, unknown> | null = null;
    IndexNegotiator.prototype.invoke = async function (input) {
      capturedInput = input as unknown as Record<string, unknown>;
      return { action: "accept", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } as never;
    };

    const db = createMockDatabase({
      getMessagesForConversation: async () => priorMessages,
      getOpportunityUserAnswers: async () => mockAnswers,
    });
    const dispatcher = createMockDispatcher();
    const graph = new NegotiationGraphFactory(db, dispatcher).createGraph();

    const result = await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext,
      seedAssessment: seed,
      opportunityId: "opp-answers",
      maxTurns: 4,
    } as Partial<typeof NegotiationGraphState.State>);

    expect(result.isContinuation).toBe(true);
    expect(result.userAnswers).toHaveLength(2);
    expect(capturedInput).not.toBeNull();
    expect((capturedInput as Record<string, unknown>).userAnswers).toHaveLength(2);

    IndexNegotiator.prototype.invoke = origInvoke;
  }, 30_000);

  it("fresh flow: userAnswers not loaded when not a continuation", async () => {
    let getAnswersCalled = false;
    const scripted = [
      { action: "propose", assessment: { reasoning: "r1", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } },
      { action: "accept", assessment: { reasoning: "r2", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } },
    ];
    let call = 0;
    IndexNegotiator.prototype.invoke = async function () { return scripted[Math.min(call++, scripted.length - 1)] as never; };

    const db = createMockDatabase({
      getOpportunityUserAnswers: async () => { getAnswersCalled = true; return []; },
    });
    const dispatcher = createMockDispatcher();
    const graph = new NegotiationGraphFactory(db, dispatcher).createGraph();

    await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext,
      seedAssessment: seed,
      opportunityId: "opp-fresh-no-answers",
      maxTurns: 4,
    } as Partial<typeof NegotiationGraphState.State>);

    expect(getAnswersCalled).toBe(false);

    IndexNegotiator.prototype.invoke = origInvoke;
  }, 30_000);

  it("lock gate: returns error when active task exists within freshness window", async () => {
    const db = createMockDatabase({
      getNegotiationTaskForOpportunity: async () => ({
        id: "task-prior",
        conversationId: "conv-1",
        state: "working",
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    });
    const dispatcher = createMockDispatcher();
    const graph = new NegotiationGraphFactory(db, dispatcher).createGraph();

    const result = await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext,
      seedAssessment: seed,
      opportunityId: "opp-locked",
      maxTurns: 2,
    } as Partial<typeof NegotiationGraphState.State>);

    expect(result.error).toBe("busy");
  }, 30_000);

  it("stale lock: task older than 5 minutes does not block", async () => {
    const staleTime = new Date(Date.now() - 10 * 60 * 1000);
    let call = 0;
    IndexNegotiator.prototype.invoke = async function () {
      call++;
      if (call === 1) return { action: "propose", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } as never;
      return { action: "accept", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } as never;
    };

    const db = createMockDatabase({
      getNegotiationTaskForOpportunity: async () => ({
        id: "task-stale",
        conversationId: "conv-1",
        state: "working",
        metadata: null,
        createdAt: staleTime,
        updatedAt: staleTime,
      }),
    });
    const dispatcher = createMockDispatcher();
    const graph = new NegotiationGraphFactory(db, dispatcher).createGraph();

    const result = await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext,
      seedAssessment: seed,
      opportunityId: "opp-stale",
      maxTurns: 4,
    } as Partial<typeof NegotiationGraphState.State>);

    expect(result.outcome).not.toBeNull();

    IndexNegotiator.prototype.invoke = origInvoke;
  }, 30_000);
});
