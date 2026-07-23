import { describe, it, expect } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";

function mkStubs() {
  const messages: Array<{ id: string; senderId: string; parts: unknown[]; createdAt: Date }> = [];
  const createdTaskMetadata: Array<Record<string, unknown>> = [];
  const database = {
    createConversation: async () => ({ id: "conv-1" }),
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (_conversationId: string, metadata: Record<string, unknown>) => {
      createdTaskMetadata.push(metadata);
      return { id: "task-1" };
    },
    updateOpportunityStatus: async () => {},
    createMessage: async (p: { conversationId: string; senderId: string; parts: unknown[] }) => {
      const msg = { id: `msg-${messages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
      messages.push(msg);
      return msg;
    },
    updateTaskState: async () => {},
    createArtifact: async () => {},
    setTaskTurnContext: async () => {},
    getMessagesForConversation: async () => [],
    getNegotiationTaskForOpportunity: async () => null,
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async () => ({ handled: false, reason: "no-agent" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  return { database, dispatcher, messages, createdTaskMetadata };
}

describe("negotiation graph — task intent snapshots", () => {
  it("captures immutable, deduplicated source and candidate intent snapshots at task creation", async () => {
    const { database, dispatcher, createdTaskMetadata } = mkStubs();
    const sourceUser = {
      id: "u-src",
      intents: [
        { id: "intent-source", title: "Source title", description: "Source description", confidence: 0.8 },
        { id: "intent-source", title: "Duplicate", description: "Duplicate", confidence: 0.2 },
        { id: " ", title: "Blank", description: "Blank", confidence: 1 },
      ],
      profile: {},
    };
    const candidateUser = {
      id: "u-cand",
      intents: [
        { id: "intent-candidate", title: "Candidate title", description: "Candidate description", confidence: 0.9 },
      ],
      profile: {},
    };

    const { IndexNegotiator } = await import("../negotiation.agent.js");
    const originalInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function () {
      return {
        action: "propose" as const,
        assessment: {
          reasoning: "stub",
          suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const },
        },
        message: "stub",
      };
    };

    try {
      await new NegotiationGraphFactory(database, dispatcher).createGraph().invoke({
        sourceUser,
        candidateUser,
        sourceIntentId: "intent-source",
        candidateIntentId: "intent-candidate",
        indexContext: { networkId: "net-1", prompt: "" },
        seedAssessment: { reasoning: "x", valencyRole: "peer" },
        opportunityId: "opp-1",
        maxTurns: 1,
      } as Partial<typeof NegotiationGraphState.State>);
    } finally {
      IndexNegotiator.prototype.invoke = originalInvoke;
    }

    sourceUser.intents[0].title = "Mutated after capture";
    candidateUser.intents[0].description = "Mutated after capture";
    expect(createdTaskMetadata).toHaveLength(1);
    expect(createdTaskMetadata[0].intentSnapshots).toEqual([
      {
        userId: "u-src",
        intentId: "intent-source",
        title: "Source title",
        description: "Source description",
      },
      {
        userId: "u-cand",
        intentId: "intent-candidate",
        title: "Candidate title",
        description: "Candidate description",
      },
    ]);
    expect(createdTaskMetadata[0].participantBindings).toEqual([
      { userId: "u-src", intentId: "intent-source", networkId: "net-1" },
      { userId: "u-cand", intentId: "intent-candidate", networkId: "net-1" },
    ]);
    expect(createdTaskMetadata[0].sourceIntentId).toBe("intent-source");
    expect(createdTaskMetadata[0].candidateIntentId).toBe("intent-candidate");
  });

  it("fails init closed without finalize writes when the exact attempt cannot claim a task", async () => {
    const { database, dispatcher } = mkStubs();
    const persistedBoundary = new Date("2026-07-18T12:00:00.000Z");
    const claims: Array<{
      conversationId: string;
      opportunityId: string;
      expectedStatus: string;
      expectedUpdatedAt: Date;
      metadata: Record<string, unknown>;
    }> = [];
    let genericTaskCreates = 0;
    let taskStateUpdates = 0;
    let artifactCreates = 0;
    let statusUpdates = 0;

    database.createNegotiationTaskForAttempt = async (input) => {
      claims.push(input);
      return null;
    };
    database.createTask = async () => {
      genericTaskCreates += 1;
      return { id: "unexpected-task", conversationId: "conv-1", state: "submitted" };
    };
    database.updateTaskState = async () => {
      taskStateUpdates += 1;
      throw new Error("task not found");
    };
    database.createArtifact = async () => {
      artifactCreates += 1;
      return { id: "unexpected-artifact" };
    };
    database.updateOpportunityStatus = async () => {
      statusUpdates += 1;
      return null;
    };

    const result = await new NegotiationGraphFactory(database, dispatcher).createGraph().invoke({
      sourceUser: {
        id: "u-src",
        intents: [{ id: "intent-src", title: "Source", description: "Source intent", confidence: 1 }],
        profile: {},
      },
      candidateUser: {
        id: "u-cand",
        intents: [{ id: "intent-cand", title: "Candidate", description: "Candidate intent", confidence: 1 }],
        profile: {},
      },
      indexContext: { networkId: "net-1", prompt: "" },
      seedAssessment: { reasoning: "x", valencyRole: "peer" },
      opportunityId: "opp-stale",
      opportunityStatus: "latent",
      opportunityUpdatedAt: persistedBoundary,
      maxTurns: 1,
    } as Partial<typeof NegotiationGraphState.State>);

    expect(result.error).toContain("Negotiation attempt is stale or already claimed");
    expect(genericTaskCreates).toBe(0);
    expect(taskStateUpdates).toBe(0);
    expect(artifactCreates).toBe(0);
    expect(statusUpdates).toBe(0);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toMatchObject({
      conversationId: "conv-1",
      opportunityId: "opp-stale",
      expectedStatus: "latent",
      expectedUpdatedAt: persistedBoundary,
      metadata: {
        type: "negotiation",
        opportunityId: "opp-stale",
        sourceUserId: "u-src",
        candidateUserId: "u-cand",
        networkId: "net-1",
        intentSnapshots: [
          { userId: "u-src", intentId: "intent-src", title: "Source", description: "Source intent" },
          { userId: "u-cand", intentId: "intent-cand", title: "Candidate", description: "Candidate intent" },
        ],
      },
    });
  });

  it("persists a terminal artifact and opportunity status after a latent attempt claim", async () => {
    const { database, dispatcher } = mkStubs();
    const persistedBoundary = new Date("2026-07-18T12:00:00.000Z");
    const claimedStatuses: string[] = [];
    const taskStates: string[] = [];
    const artifacts: Array<{ taskId: string; name?: string; parts: unknown[] }> = [];
    const opportunityStatuses: string[] = [];

    database.createNegotiationTaskForAttempt = async (input) => {
      claimedStatuses.push(input.expectedStatus);
      return { id: "task-attempt", conversationId: input.conversationId, state: "submitted" };
    };
    database.updateTaskState = async (_taskId, state) => {
      taskStates.push(state);
      return { id: "task-attempt", conversationId: "conv-1", state };
    };
    database.createArtifact = async (input) => {
      artifacts.push(input);
      return { id: "artifact-1" };
    };
    database.updateOpportunityStatus = async (_opportunityId, status) => {
      opportunityStatuses.push(status);
      return { id: "opp-latent", status };
    };

    const { IndexNegotiator } = await import("../negotiation.agent.js");
    const originalInvoke = IndexNegotiator.prototype.invoke;
    let turn = 0;
    IndexNegotiator.prototype.invoke = async function () {
      turn += 1;
      return {
        action: turn === 1 ? "propose" as const : "reject" as const,
        assessment: {
          reasoning: turn === 1 ? "considering" : "not a fit",
          suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const },
        },
        message: turn === 1 ? "Could this work?" : "No match",
      };
    };

    try {
      await new NegotiationGraphFactory(database, dispatcher).createGraph().invoke({
        sourceUser: { id: "u-src", intents: [], profile: {} },
        candidateUser: { id: "u-cand", intents: [], profile: {} },
        indexContext: { networkId: "net-1", prompt: "" },
        seedAssessment: { reasoning: "x", valencyRole: "peer" },
        opportunityId: "opp-latent",
        opportunityStatus: "latent",
        opportunityUpdatedAt: persistedBoundary,
        maxTurns: 2,
      } as Partial<typeof NegotiationGraphState.State>);
    } finally {
      IndexNegotiator.prototype.invoke = originalInvoke;
    }

    expect(claimedStatuses).toEqual(["latent"]);
    expect(taskStates).toContain("completed");
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]).toMatchObject({ taskId: "task-attempt", name: "negotiation-outcome" });
    expect(opportunityStatuses).toEqual(["rejected"]);
  });
});

describe("negotiation graph — negotiation_turn emission", () => {
  it("emits negotiation_turn with correct payload after each turn", async () => {
    // Stub IndexNegotiator.invoke so the test is fully hermetic — no LLM calls.
    const { IndexNegotiator } = await import("../negotiation.agent.js");
    const origInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function () {
      return {
        action: "propose" as const,
        assessment: {
          reasoning: "stub reasoning",
          suggestedRoles: { ownUser: "agent" as const, otherUser: "patient" as const },
        },
        message: "hi",
      };
    };

    try {
      const { database, dispatcher } = mkStubs();
      const factory = new NegotiationGraphFactory(database, dispatcher);
      const graph = factory.createGraph();

      const events: Array<Record<string, unknown>> = [];
      const traceEmitter = (e: Record<string, unknown>) => events.push(e);

      const { requestContext } = await import("../../shared/observability/request-context.js");
      await requestContext.run({ traceEmitter: traceEmitter as never }, async () => {
        await graph.invoke({
          sourceUser: { id: "u-src", intents: [], profile: { name: "Alice" } },
          candidateUser: { id: "u-cand", intents: [], profile: { name: "Bob" } },
          indexContext: { networkId: "net-1", prompt: "" },
          seedAssessment: { reasoning: "x", valencyRole: "peer" },
          opportunityId: "opp-1",
          maxTurns: 2,
        } as Partial<typeof NegotiationGraphState.State>);
      });

      const turnEvents = events.filter((e) => e.type === "negotiation_turn");
      expect(turnEvents.length).toBeGreaterThanOrEqual(1);
      const first = turnEvents[0];
      expect(first.opportunityId).toBe("opp-1");
      expect(first.negotiationConversationId).toBe("conv-1");
      expect(first.turnIndex).toBe(0);
      expect(first.actor).toBe("source");
      expect(typeof first.action).toBe("string");
      expect(typeof first.durationMs).toBe("number");
      expect(first.reasoning).toBe("stub reasoning");
      expect(first.message).toBe("hi");
      expect(first.suggestedRoles).toEqual({ ownUser: "agent", otherUser: "patient" });
    } finally {
      IndexNegotiator.prototype.invoke = origInvoke;
    }
  }, 30000);
});

describe("negotiation graph — negotiation_outcome emission", () => {
  it("emits outcome='accepted' when finalize runs after an accept turn", async () => {
    // Scripted: first turn propose, second turn accept
    const scripted = [
      { action: "propose", assessment: { reasoning: "r1", suggestedRoles: { ownUser: "agent", otherUser: "patient" } }, message: "hi" },
      { action: "accept",  assessment: { reasoning: "r2", suggestedRoles: { ownUser: "agent", otherUser: "patient" } } },
    ];
    let call = 0;
    const { database, dispatcher } = mkStubs();
    const { IndexNegotiator } = await import("../negotiation.agent.js");
    const orig = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function () { return scripted[Math.min(call++, scripted.length - 1)] as never; };

    try {
      const graph = new NegotiationGraphFactory(database, dispatcher).createGraph();
      const events: Array<Record<string, unknown>> = [];
      const { requestContext } = await import("../../shared/observability/request-context.js");
      await requestContext.run({ traceEmitter: (e: Record<string, unknown>) => events.push(e) }, async () => {
        await graph.invoke({
          sourceUser: { id: "u-src" },
          candidateUser: { id: "u-cand" },
          indexContext: { networkId: "net-1", prompt: "" },
          seedAssessment: { reasoning: "x", valencyRole: "peer" },
          opportunityId: "opp-accept",
          maxTurns: 4,
        } as Partial<typeof NegotiationGraphState.State>);
      });

      const outcomes = events.filter((e) => e.type === "negotiation_outcome");
      expect(outcomes).toHaveLength(1);
      const outcome = outcomes[0];
      expect(outcome).toBeTruthy();
      expect(outcome!.opportunityId).toBe("opp-accept");
      expect(outcome!.outcome).toBe("accepted");
      expect(outcome!.turnCount).toBe(2);
      const agreedRoles = outcome!.agreedRoles as { ownUser?: string; otherUser?: string } | undefined;
      expect(agreedRoles).toBeDefined();
      expect(agreedRoles?.ownUser).toBeTruthy();
      expect(agreedRoles?.otherUser).toBeTruthy();
    } finally {
      IndexNegotiator.prototype.invoke = orig;
    }
  }, 30000);

  it("emits outcome='turn_cap' when maxTurns is reached without accept/reject", async () => {
    const { database, dispatcher } = mkStubs();
    const { IndexNegotiator } = await import("../negotiation.agent.js");
    const orig = IndexNegotiator.prototype.invoke;
    // First turn must be "propose" (graph forces it), subsequent turns counter — so we hit turn_cap at maxTurns.
    let call = 0;
    IndexNegotiator.prototype.invoke = async function () {
      call++;
      if (call === 1) return { action: "propose", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } as never;
      return { action: "counter", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } as never;
    };
    try {
      const graph = new NegotiationGraphFactory(database, dispatcher).createGraph();
      const events: Array<Record<string, unknown>> = [];
      const { requestContext } = await import("../../shared/observability/request-context.js");
      await requestContext.run({ traceEmitter: (e: Record<string, unknown>) => events.push(e) }, async () => {
        await graph.invoke({
          sourceUser: { id: "u-src" }, candidateUser: { id: "u-cand" },
          indexContext: { networkId: "net-1", prompt: "" },
          seedAssessment: { reasoning: "x", valencyRole: "peer" },
          opportunityId: "opp-cap", maxTurns: 2,
        } as Partial<typeof NegotiationGraphState.State>);
      });
      const outcomes = events.filter((e) => e.type === "negotiation_outcome");
      expect(outcomes).toHaveLength(1);
      const outcome = outcomes[0];
      expect(outcome?.outcome).toBe("turn_cap");
      expect(outcome?.turnCount).toBe(2);
    } finally {
      IndexNegotiator.prototype.invoke = orig;
    }
  }, 30000);

  it("emits outcome='waiting_for_agent' when dispatcher parks the turn", async () => {
    const { database } = mkStubs();
    const dispatcher = {
      hasExternalAgent: async () => true,
      dispatch: async () => ({ handled: false, reason: "waiting" as const }),
    } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];
    const graph = new NegotiationGraphFactory(database, dispatcher).createGraph();
    const events: Array<Record<string, unknown>> = [];
    const { requestContext } = await import("../../shared/observability/request-context.js");
    await requestContext.run({ traceEmitter: (e: Record<string, unknown>) => events.push(e) }, async () => {
      await graph.invoke({
        sourceUser: { id: "u-src" }, candidateUser: { id: "u-cand" },
        indexContext: { networkId: "net-1", prompt: "" },
        seedAssessment: { reasoning: "x", valencyRole: "peer" },
        opportunityId: "opp-park", maxTurns: 4,
      } as Partial<typeof NegotiationGraphState.State>);
    });
    const outcomes = events.filter((e) => e.type === "negotiation_outcome");
    expect(outcomes).toHaveLength(1);
    const outcome = outcomes[0];
    expect(outcome?.outcome).toBe("waiting_for_agent");
  }, 30000);
});

describe("negotiation graph — questioner enqueue on stall", () => {
  function withUserContext(database: ReturnType<typeof mkStubs>["database"]) {
    (database as unknown as Record<string, unknown>).getUserContext = async () => ({ text: "user ctx" });
    return database;
  }

  it("enqueues a negotiation question when the negotiation hits turn_cap", async () => {
    const { database, dispatcher } = mkStubs();
    withUserContext(database);
    const { IndexNegotiator } = await import("../negotiation.agent.js");
    const orig = IndexNegotiator.prototype.invoke;
    let call = 0;
    IndexNegotiator.prototype.invoke = async function () {
      call++;
      if (call === 1) return { action: "propose", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } as never;
      return { action: "counter", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } as never;
    };
    const enqueued: Array<Record<string, unknown>> = [];
    const questionerEnqueue = async (input: Record<string, unknown>) => { enqueued.push(input); };
    try {
      const graph = new NegotiationGraphFactory(
        database,
        dispatcher,
        undefined,
        questionerEnqueue as never,
      ).createGraph();
      await graph.invoke({
        sourceUser: { id: "u-src", intents: [{ id: "intent-src", title: "Build", description: "Find a product collaborator", confidence: 1 }], profile: { name: "Alice", bio: "builder" } },
        candidateUser: { id: "u-cand", intents: [{ id: "intent-cand", title: "Design", description: "Join a product", confidence: 1 }], profile: { name: "Bob", bio: "designer" } },
        sourceIntentId: "intent-src",
        candidateIntentId: "intent-cand",
        indexContext: { networkId: "net-1", prompt: "private network prompt" },
        seedAssessment: { reasoning: "x", valencyRole: "peer" },
        opportunityId: "opp-stall", maxTurns: 2,
      } as Partial<typeof NegotiationGraphState.State>);

      expect(enqueued).toHaveLength(1);
      const job = enqueued[0]!;
      expect(job.mode).toBe("negotiation");
      expect(job.userId).toBe("u-src");
      expect(job.sourceType).toBe("opportunity");
      expect(job.sourceId).toBe("opp-stall");
      expect(job.purpose).toBe("stalled_followup");
      expect(job.negotiation).toEqual({
        purpose: "stalled_followup",
        recipientUserId: "u-src",
        recipientIntentId: "intent-src",
        opportunityId: "opp-stall",
        taskId: "task-1",
        networkId: "net-1",
      });
      const context = job.context as Record<string, unknown>;
      expect(context.outcomeReason).toBe("turn_cap");
      expect(context.counterpartyHint).toBe("the other participant");
      expect(context.recipientIntent).toContain("Find a product collaborator");
      expect(context.indexContext).toBe("the selected network");
      expect(context.userContext).toBe("user ctx");
      expect(JSON.stringify(job)).not.toContain("Bob");
      expect(JSON.stringify(job)).not.toContain("designer");
      expect(JSON.stringify(job)).not.toContain("private network prompt");
    } finally {
      IndexNegotiator.prototype.invoke = orig;
    }
  }, 30000);

  it("does not enqueue when the negotiation is accepted", async () => {
    const scripted = [
      { action: "propose", assessment: { reasoning: "r1", suggestedRoles: { ownUser: "agent", otherUser: "patient" } }, message: "hi" },
      { action: "accept", assessment: { reasoning: "r2", suggestedRoles: { ownUser: "agent", otherUser: "patient" } } },
    ];
    let call = 0;
    const { database, dispatcher } = mkStubs();
    withUserContext(database);
    const { IndexNegotiator } = await import("../negotiation.agent.js");
    const orig = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function () { return scripted[Math.min(call++, scripted.length - 1)] as never; };
    const enqueued: Array<Record<string, unknown>> = [];
    try {
      const graph = new NegotiationGraphFactory(
        database,
        dispatcher,
        undefined,
        (async (input: Record<string, unknown>) => { enqueued.push(input); }) as never,
      ).createGraph();
      await graph.invoke({
        sourceUser: { id: "u-src" }, candidateUser: { id: "u-cand" },
        indexContext: { networkId: "net-1", prompt: "" },
        seedAssessment: { reasoning: "x", valencyRole: "peer" },
        opportunityId: "opp-accept", maxTurns: 4,
      } as Partial<typeof NegotiationGraphState.State>);

      expect(enqueued).toHaveLength(0);
    } finally {
      IndexNegotiator.prototype.invoke = orig;
    }
  }, 30000);
});

describe("negotiateCandidates — session wrapper events", () => {
  it("emits negotiation_session_start and _end per candidate with trigger + ids", async () => {
    const fakeGraph = {
      invoke: async (input: { opportunityId?: string }) => ({
        conversationId: `conv-for-${input.opportunityId}`,
        messages: [],
        outcome: { hasOpportunity: false, agreedRoles: [], reasoning: "", turnCount: 0 },
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
          { id: "u-src", name: "Alice" } as never,
          [
            {
              userId: "u-1",
              reasoning: "r",
              valencyRole: "peer",
              candidateUser: { id: "u-1", intents: [], profile: { name: "Bob" } } as never,
              opportunityId: "opp-10",
            },
          ],
          { networkId: "net-1", prompt: "" },
          {
            traceEmitter: (e: Record<string, unknown>) => events.push(e),
            trigger: "orchestrator",
          },
        );
      },
    );

    const starts = events.filter((e) => e.type === "negotiation_session_start");
    const ends = events.filter((e) => e.type === "negotiation_session_end");
    expect(starts).toHaveLength(1);
    expect(ends).toHaveLength(1);
    expect(starts[0].opportunityId).toBe("opp-10");
    expect(starts[0].trigger).toBe("orchestrator");
    expect(starts[0].sourceUserId).toBe("u-src");
    expect(starts[0].candidateUserId).toBe("u-1");
    expect(starts[0].candidateName).toBe("Bob");
    expect(ends[0].opportunityId).toBe("opp-10");
    expect(typeof ends[0].durationMs).toBe("number");
  }, 30000);

  it("does not emit session events when opportunityId is missing", async () => {
    const fakeGraph = {
      invoke: async () => ({
        conversationId: "conv-x",
        messages: [],
        outcome: { hasOpportunity: false, agreedRoles: [], reasoning: "", turnCount: 0 },
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
          { id: "u-src" } as never,
          [{ userId: "u-2", reasoning: "r", valencyRole: "peer", candidateUser: { id: "u-2" } as never }],
          { networkId: "net-1", prompt: "" },
          { traceEmitter: (e: Record<string, unknown>) => events.push(e), trigger: "ambient" },
        );
      },
    );
    expect(events.filter((e) => e.type === "negotiation_session_start")).toHaveLength(0);
    expect(events.filter((e) => e.type === "negotiation_session_end")).toHaveLength(0);
  }, 30000);
});
