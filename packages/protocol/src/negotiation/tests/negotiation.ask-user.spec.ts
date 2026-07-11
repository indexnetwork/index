import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { allowedActionsFor, turnSchemaFor, configuredAskUserEnabled, askUserAnswerWindowMs, DEFAULT_ASK_USER_WINDOW_MS, ASK_USER_LOCK_SLACK_MS, InitiatorTurnSchema, CounterpartyTurnSchema, InitiatorAskUserTurnSchema, CounterpartyAskUserTurnSchema } from "../negotiation.protocol.js";
import { SystemNegotiationTurnSchema, FinalNegotiationTurnSchema } from "../negotiation.state.js";
import type { NegotiationTurn } from "../negotiation.state.js";
import type { QuestionerEnqueuePayload } from "../../questioner/questioner.types.js";

/**
 * IND-401 — `ask_user` client-consult pause (P3.2).
 *
 * Pins:
 * - vocabulary: ask_user is opt-in per surface ({ askUser: true }), v2
 *   non-final only; base schemas stay byte-identical,
 * - graph pause loop: ask_user turn → message persisted → turn context parked
 *   → answer-window timer armed → negotiation_inflight question enqueued →
 *   task input_required → graph exits without an outcome,
 * - availability gating: flag, wiring (questioner + timer + opportunityId),
 *   opening turn, final turn, and per-side rationing,
 * - coercion: an unavailable ask_user never enters the turn history,
 * - lock-gate extension: input_required tasks hold the conversation lock for
 *   the full answer window, not the 5-min turn freshness,
 * - resume floor: an ask_user last turn does not pass the floor — the asker
 *   speaks again on the continuation.
 */

// ─── Vocabulary + schema (pure) ──────────────────────────────────────────────

const askUserTurn: NegotiationTurn = {
  action: "ask_user",
  assessment: { reasoning: "need client input", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
  message: "May I share your budget range?",
  askUser: { disclosureSubject: "budget range", draftQuestion: "Can I tell them your budget range?" },
};

describe("ask_user vocabulary + seat schemas", () => {
  it("is excluded everywhere by default (no opts)", () => {
    expect(allowedActionsFor("v2", "initiator")).not.toContain("ask_user");
    expect(allowedActionsFor("v2", "counterparty")).not.toContain("ask_user");
    expect(allowedActionsFor("v1", "initiator")).not.toContain("ask_user");
  });

  it("is granted per surface via opts.askUser, v2 non-final only", () => {
    expect(allowedActionsFor("v2", "initiator", false, { askUser: true })).toContain("ask_user");
    expect(allowedActionsFor("v2", "counterparty", false, { askUser: true })).toContain("ask_user");
    // Final-cap turns must decide, never pause.
    expect(allowedActionsFor("v2", "initiator", true, { askUser: true })).not.toContain("ask_user");
    expect(allowedActionsFor("v2", "counterparty", true, { askUser: true })).not.toContain("ask_user");
    // v1 has no ask_user regardless.
    expect(allowedActionsFor("v1", "initiator", false, { askUser: true })).not.toContain("ask_user");
  });

  it("keeps the base v2 vocabularies byte-identical", () => {
    expect([...allowedActionsFor("v2", "initiator")]).toEqual(["outreach", "counter", "question", "withdraw"]);
    expect([...allowedActionsFor("v2", "counterparty")]).toEqual(["accept", "decline", "counter", "question"]);
  });

  it("turnSchemaFor selects the ask_user schema variants only when granted", () => {
    const v1Schemas = { system: SystemNegotiationTurnSchema, final: FinalNegotiationTurnSchema };
    expect(turnSchemaFor("v2", "initiator", false, v1Schemas, { askUser: true })).toBe(InitiatorAskUserTurnSchema);
    expect(turnSchemaFor("v2", "counterparty", false, v1Schemas, { askUser: true })).toBe(CounterpartyAskUserTurnSchema);
    expect(turnSchemaFor("v2", "initiator", false, v1Schemas)).toBe(InitiatorTurnSchema);
    expect(turnSchemaFor("v2", "counterparty", false, v1Schemas)).toBe(CounterpartyTurnSchema);
    // Final turns never get the variant.
    expect(turnSchemaFor("v2", "initiator", true, v1Schemas, { askUser: true })).not.toBe(InitiatorAskUserTurnSchema);
  });

  it("ask_user variants parse an ask_user turn with payload; base schemas reject it", () => {
    expect(InitiatorAskUserTurnSchema.safeParse(askUserTurn).success).toBe(true);
    expect(CounterpartyAskUserTurnSchema.safeParse(askUserTurn).success).toBe(true);
    expect(InitiatorTurnSchema.safeParse(askUserTurn).success).toBe(false);
    expect(CounterpartyTurnSchema.safeParse(askUserTurn).success).toBe(false);
  });

  it("env helpers: flag defaults off; window defaults 24h and accepts overrides", () => {
    const origEnabled = process.env.NEGOTIATION_ASK_USER_ENABLED;
    const origWindow = process.env.NEGOTIATION_ASK_USER_WINDOW_MS;
    try {
      delete process.env.NEGOTIATION_ASK_USER_ENABLED;
      delete process.env.NEGOTIATION_ASK_USER_WINDOW_MS;
      expect(configuredAskUserEnabled()).toBe(false);
      expect(askUserAnswerWindowMs()).toBe(DEFAULT_ASK_USER_WINDOW_MS);
      process.env.NEGOTIATION_ASK_USER_ENABLED = "true";
      expect(configuredAskUserEnabled()).toBe(true);
      process.env.NEGOTIATION_ASK_USER_WINDOW_MS = "60000";
      expect(askUserAnswerWindowMs()).toBe(60_000);
      process.env.NEGOTIATION_ASK_USER_WINDOW_MS = "-5";
      expect(askUserAnswerWindowMs()).toBe(DEFAULT_ASK_USER_WINDOW_MS);
    } finally {
      if (origEnabled === undefined) delete process.env.NEGOTIATION_ASK_USER_ENABLED; else process.env.NEGOTIATION_ASK_USER_ENABLED = origEnabled;
      if (origWindow === undefined) delete process.env.NEGOTIATION_ASK_USER_WINDOW_MS; else process.env.NEGOTIATION_ASK_USER_WINDOW_MS = origWindow;
    }
  });
});

// ─── Graph harness ───────────────────────────────────────────────────────────

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

/** Prior task metadata pinning the conversation to v2 with u-src as initiator. */
const V2_PRIOR_TASK = {
  id: "task-prior",
  conversationId: "conv-1",
  state: "completed",
  metadata: { type: "negotiation", protocolVersion: "v2", initiatorUserId: "u-src", sourceUserId: "u-src", candidateUserId: "u-cand" },
  createdAt: new Date(Date.now() - 3_600_000),
  updatedAt: new Date(Date.now() - 3_600_000),
};

function mkStubs(opts?: {
  priorMessages?: FakeMessage[];
  priorTask?: Record<string, unknown> | null;
}) {
  const createdMessages: Array<{ senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }> = [];
  const stateWrites: Array<{ taskId: string; state: string }> = [];
  const turnContextWrites: Array<{ taskId: string }> = [];
  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string) => ({ id: "task-new", conversationId, state: "submitted" }),
    updateOpportunityStatus: async () => {},
    createMessage: async (p: { senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }) => {
      createdMessages.push(p);
      return { id: `msg-${createdMessages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async (taskId: string, state: string) => {
      stateWrites.push({ taskId, state });
    },
    createArtifact: async () => {},
    setTaskTurnContext: async (taskId: string) => {
      turnContextWrites.push({ taskId });
    },
    getMessagesForConversation: async () => opts?.priorMessages ?? [],
    getOpportunityUserAnswers: async () => [],
    getNegotiationTaskForOpportunity: async () => (opts?.priorTask === undefined ? V2_PRIOR_TASK : opts.priorTask),
    getLatestNegotiationTaskForConversation: async () => null,
    getUserContext: async () => ({ text: "Alice builds AI startups" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async () => ({ handled: false, reason: "no_agent" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  const expiryArms: Array<{ negotiationId: string; payload: Record<string, unknown>; delayMs: number }> = [];
  const timeoutQueue = {
    enqueueTimeout: async () => "job-1",
    cancelTimeout: async () => {},
    enqueueAskUserExpiry: async (negotiationId: string, payload: Record<string, unknown>, delayMs: number) => {
      expiryArms.push({ negotiationId, payload, delayMs });
      return "askuser-job-1";
    },
    cancelAskUserExpiry: async () => {},
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[2];

  const questionerEnqueues: QuestionerEnqueuePayload[] = [];
  const questionerEnqueue = async (input: QuestionerEnqueuePayload) => {
    questionerEnqueues.push(input);
  };

  return { database, dispatcher, timeoutQueue, questionerEnqueue, createdMessages, stateWrites, turnContextWrites, expiryArms, questionerEnqueues };
}

async function runGraph(
  stubs: ReturnType<typeof mkStubs>,
  input: Record<string, unknown> = {},
  opts?: { omitTimeoutQueue?: boolean; omitQuestioner?: boolean },
) {
  const graph = new NegotiationGraphFactory(
    stubs.database,
    stubs.dispatcher,
    opts?.omitTimeoutQueue ? undefined : stubs.timeoutQueue,
    opts?.omitQuestioner ? undefined : stubs.questionerEnqueue,
  ).createGraph();
  return graph.invoke({
    sourceUser: { id: "u-src", intents: [], profile: { name: "Alice", bio: "PM", skills: ["product"] } },
    candidateUser: { id: "u-cand", intents: [], profile: { name: "Bob", bio: "ML engineer", location: "Berlin", skills: ["ml"] } },
    indexContext: { networkId: "net-1", prompt: "AI startup network" },
    seedAssessment: { reasoning: "complementary", valencyRole: "peer" },
    opportunityId: "opp-1",
    maxTurns: 4,
    ...input,
  } as Partial<typeof NegotiationGraphState.State>);
}

// Scripted system-agent turns + captured inputs.
let agentInputs: NegotiationAgentInput[] = [];
let agentScript: NegotiationTurn[] = [];

const declineTurn: NegotiationTurn = {
  action: "decline",
  assessment: { reasoning: "not a fit", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
  message: null,
};

describe("negotiation graph — ask_user pause (IND-401)", () => {
  let origAgentInvoke: typeof IndexNegotiator.prototype.invoke;
  const origFlag = process.env.NEGOTIATION_ASK_USER_ENABLED;
  const origWindow = process.env.NEGOTIATION_ASK_USER_WINDOW_MS;

  beforeAll(() => {
    origAgentInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function (input: NegotiationAgentInput) {
      agentInputs.push(input);
      const turn = agentScript.shift();
      if (!turn) throw new Error("agent script exhausted");
      return turn;
    };
  });

  afterAll(() => {
    IndexNegotiator.prototype.invoke = origAgentInvoke;
  });

  beforeEach(() => {
    agentInputs = [];
    agentScript = [];
    process.env.NEGOTIATION_ASK_USER_ENABLED = "true";
    delete process.env.NEGOTIATION_ASK_USER_WINDOW_MS;
  });

  afterEach(() => {
    if (origFlag === undefined) delete process.env.NEGOTIATION_ASK_USER_ENABLED; else process.env.NEGOTIATION_ASK_USER_ENABLED = origFlag;
    if (origWindow === undefined) delete process.env.NEGOTIATION_ASK_USER_WINDOW_MS; else process.env.NEGOTIATION_ASK_USER_WINDOW_MS = origWindow;
  });

  /** Continuation where the source (u-src, initiator) speaks next. */
  const continuationMessages = [priorMsg("u-src", "outreach", 0), priorMsg("u-cand", "counter", 1)];

  it("pauses the full loop: message + turn context + timer + question + input_required, no outcome", async () => {
    const stubs = mkStubs({ priorMessages: continuationMessages });
    agentScript = [askUserTurn];

    const result = await runGraph(stubs);

    // Turn persisted with the ask_user action.
    expect(stubs.createdMessages).toHaveLength(1);
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("ask_user");
    expect(stubs.createdMessages[0].senderId).toBe("agent:u-src");

    // Turn context parked for pickup/resume.
    expect(stubs.turnContextWrites).toEqual([{ taskId: "task-new" }]);

    // Answer-window timer armed with resume coordinates + default window.
    expect(stubs.expiryArms).toHaveLength(1);
    expect(stubs.expiryArms[0].negotiationId).toBe("task-new");
    expect(stubs.expiryArms[0].payload).toEqual({
      opportunityId: "opp-1",
      userId: "u-src",
      disclosureSubject: "budget range",
    });
    expect(stubs.expiryArms[0].delayMs).toBe(DEFAULT_ASK_USER_WINDOW_MS);

    // Question enqueued through the negotiation_inflight preset for the
    // asker's OWN client, counterparty referenced by attributes.
    expect(stubs.questionerEnqueues).toHaveLength(1);
    const q = stubs.questionerEnqueues[0];
    expect(q.mode).toBe("negotiation_inflight");
    expect(q.userId).toBe("u-src");
    expect(q.sourceType).toBe("opportunity");
    expect(q.sourceId).toBe("opp-1");
    const ctx = q.context as Record<string, unknown>;
    expect(ctx.negotiationId).toBe("task-new");
    expect(ctx.disclosureSubject).toBe("budget range");
    expect(ctx.draftQuestion).toBe("Can I tell them your budget range?");
    expect(ctx.counterpartyHint).toContain("ML engineer");
    expect(ctx.counterpartyHint).not.toContain("Bob");
    expect(ctx.indexContext).toBe("AI startup network");
    expect(ctx.userContext).toBe("Alice builds AI startups");

    // Task suspended as input_required; no completed transition, no outcome.
    expect(stubs.stateWrites).toContainEqual({ taskId: "task-new", state: "input_required" });
    expect(stubs.stateWrites.map((w) => w.state)).not.toContain("completed");
    expect(result.outcome).toBeNull();
  });

  it("respects the env window override when arming the timer", async () => {
    process.env.NEGOTIATION_ASK_USER_WINDOW_MS = "120000";
    const stubs = mkStubs({ priorMessages: continuationMessages });
    agentScript = [askUserTurn];
    await runGraph(stubs);
    expect(stubs.expiryArms[0].delayMs).toBe(120_000);
  });

  it("grants canAskUser to the agent when the loop is fully wired", async () => {
    const stubs = mkStubs({ priorMessages: continuationMessages });
    agentScript = [askUserTurn];
    await runGraph(stubs);
    expect(agentInputs[0].canAskUser).toBe(true);
  });

  it.each([
    ["flag off", { env: "false" }],
    ["questioner missing", { omitQuestioner: true }],
    ["timer missing", { omitTimeoutQueue: true }],
    ["no opportunityId", { noOpportunity: true }],
  ] as Array<[string, { env?: string; omitQuestioner?: boolean; omitTimeoutQueue?: boolean; noOpportunity?: boolean }]>)(
    "withholds canAskUser when %s",
    async (_label, cfg) => {
      if (cfg.env) process.env.NEGOTIATION_ASK_USER_ENABLED = cfg.env;
      const stubs = mkStubs({ priorMessages: continuationMessages });
      agentScript = [declineTurn];
      await runGraph(
        stubs,
        cfg.noOpportunity ? { opportunityId: "" } : {},
        { omitQuestioner: cfg.omitQuestioner, omitTimeoutQueue: cfg.omitTimeoutQueue },
      );
      expect(agentInputs[0].canAskUser).toBeUndefined();
    },
  );

  it("withholds canAskUser on the opening turn of a fresh negotiation", async () => {
    const stubs = mkStubs({ priorMessages: [], priorTask: null });
    const origVersion = process.env.NEGOTIATION_PROTOCOL_VERSION;
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    try {
      agentScript = [
        { ...declineTurn, action: "outreach" },
        declineTurn,
      ];
      await runGraph(stubs);
      expect(agentInputs[0].canAskUser).toBeUndefined();
      // Subsequent turn (turnCount > 0) regains it.
      expect(agentInputs[1].canAskUser).toBe(true);
    } finally {
      if (origVersion === undefined) delete process.env.NEGOTIATION_PROTOCOL_VERSION; else process.env.NEGOTIATION_PROTOCOL_VERSION = origVersion;
    }
  });

  it("rations: a side that already consumed ask_user does not get it again (prior sessions count)", async () => {
    const stubs = mkStubs({
      priorMessages: [
        priorMsg("u-src", "outreach", 0),
        priorMsg("u-cand", "counter", 1),
        priorMsg("u-src", "ask_user", 2),
        priorMsg("u-src", "counter", 3),
      ],
    });
    // Last sender u-src (counter) → candidate speaks; give the candidate a
    // decline so the run terminates after one turn.
    agentScript = [declineTurn];
    await runGraph(stubs);
    // u-cand has NOT consumed its consultation — it still gets the option.
    expect(agentInputs[0].canAskUser).toBe(true);

    // Now the source side speaks (candidate countered): no second consultation.
    const stubs2 = mkStubs({
      priorMessages: [
        priorMsg("u-src", "outreach", 0),
        priorMsg("u-src", "ask_user", 1),
        priorMsg("u-cand", "counter", 2),
      ],
    });
    agentInputs = [];
    agentScript = [{ ...declineTurn, action: "withdraw" }];
    await runGraph(stubs2);
    expect(agentInputs[0].canAskUser).toBeUndefined();
  });

  it("coerces an unavailable ask_user to the conservative fallback before persisting", async () => {
    process.env.NEGOTIATION_ASK_USER_ENABLED = "false";
    const stubs = mkStubs({ priorMessages: continuationMessages });
    // Script: agent emits ask_user anyway (schema would prevent this for the
    // system agent; this pins the safety net for dispatched turns), then the
    // counterparty declines to terminate.
    agentScript = [askUserTurn, declineTurn];
    await runGraph(stubs);
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("counter");
    expect(stubs.questionerEnqueues).toHaveLength(0);
    expect(stubs.expiryArms).toHaveLength(0);
    expect(stubs.stateWrites.map((w) => w.state)).not.toContain("input_required");
  });

  it("lock gate: an input_required task older than 5 min still holds the conversation lock", async () => {
    const stubs = mkStubs({
      priorMessages: continuationMessages,
      priorTask: {
        ...V2_PRIOR_TASK,
        state: "input_required",
        updatedAt: new Date(Date.now() - 10 * 60 * 1000), // 10 min — stale under the old 5-min rule
      },
    });
    agentScript = [declineTurn];
    const result = await runGraph(stubs);
    expect(result.error).toBe("busy");
    expect(stubs.createdMessages).toHaveLength(0);
  });

  it("lock gate: an input_required task past window+slack releases the lock", async () => {
    const stubs = mkStubs({
      priorMessages: continuationMessages,
      priorTask: {
        ...V2_PRIOR_TASK,
        state: "input_required",
        updatedAt: new Date(Date.now() - DEFAULT_ASK_USER_WINDOW_MS - ASK_USER_LOCK_SLACK_MS - 60_000),
      },
    });
    agentScript = [declineTurn];
    const result = await runGraph(stubs);
    expect(result.error).not.toBe("busy");
    expect(stubs.createdMessages).toHaveLength(1);
  });

  it("lock gate: a working task older than 5 min does NOT hold the lock (unchanged)", async () => {
    const stubs = mkStubs({
      priorMessages: continuationMessages,
      priorTask: {
        ...V2_PRIOR_TASK,
        state: "working",
        updatedAt: new Date(Date.now() - 10 * 60 * 1000),
      },
    });
    agentScript = [declineTurn];
    const result = await runGraph(stubs);
    expect(result.error).not.toBe("busy");
  });

  it("resume floor: an ask_user last turn does not pass the floor — the asker speaks again", async () => {
    const stubs = mkStubs({
      priorMessages: [
        priorMsg("u-src", "outreach", 0),
        priorMsg("u-cand", "counter", 1),
        priorMsg("u-src", "ask_user", 2),
      ],
    });
    agentScript = [{ ...declineTurn, action: "withdraw" }];
    await runGraph(stubs);
    // Without the floor rule the last sender (u-src) would hand the turn to
    // u-cand; with it, u-src resumes as the speaker.
    expect(agentInputs[0].ownUser.id).toBe("u-src");
  });

  it("resume floor: a non-ask_user last turn still flips the speaker (unchanged)", async () => {
    const stubs = mkStubs({
      priorMessages: [
        priorMsg("u-src", "outreach", 0),
        priorMsg("u-cand", "counter", 1),
      ],
    });
    agentScript = [{ ...declineTurn, action: "withdraw" }];
    await runGraph(stubs);
    expect(agentInputs[0].ownUser.id).toBe("u-src");
  });
});
