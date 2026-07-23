import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { allowedActionsFor, turnSchemaFor, configuredAskUserEnabled, askUserAnswerWindowMs, DEFAULT_ASK_USER_WINDOW_MS, ASK_USER_LOCK_SLACK_MS, InitiatorTurnSchema, CounterpartyTurnSchema, InitiatorAskUserTurnSchema, CounterpartyAskUserTurnSchema } from "../negotiation.protocol.js";
import { SystemNegotiationTurnSchema, FinalNegotiationTurnSchema } from "../negotiation.state.js";
import type { NegotiationTurn } from "../negotiation.state.js";
import type { QuestionerEnqueuePayload } from "../../questioner/questioner.types.js";
import { assessConsultationEligibility, negotiationConsultationPolicyMode } from "../negotiation.consultation-policy.js";
import { requestContext } from "../../shared/observability/request-context.js";

/**
 * IND-401 — `ask_user` client-consult pause (P3.2).
 *
 * Pins:
 * - vocabulary: ask_user is opt-in per surface ({ askUser: true }), v2
 *   non-final only; base schemas stay byte-identical,
 * - graph pause loop: ask_user turn → message persisted → material binding
 *   captured (fenced when resuming) → answer-window timer armed with the
 *   captured provenance → negotiation_inflight question enqueued → task
 *   input_required → graph exits without an outcome,
 * - availability gating: flag, wiring (questioner + timer + opportunityId),
 *   opening turn, final turn, and per-side rationing,
 * - coercion: an unavailable ask_user never enters the turn history,
 * - lock-gate extension: input_required tasks hold the conversation lock for
 *   the full answer window, not the 5-min turn freshness,
 * - resume floor: an ask_user last turn does not pass the floor — the asker
 *   speaks again on the continuation,
 * - fenced exact-successor resume: a durable continuation only proceeds when
 *   both the caller-supplied settlement AND the caller-supplied
 *   continuationExecution (claimed lease/fence) agree with the stored prior
 *   task and stored successor task; it never falls back to the latest
 *   opportunity task.
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

describe("deterministic consultation eligibility policy (IND-508)", () => {
  const base = {
    protocolVersion: "v2" as const,
    seat: "initiator" as const,
    isOpeningTurn: false,
    isFinalTurn: false,
    screenedOut: false,
    ownSuggestedRole: "peer" as const,
    priorActions: [] as const,
    previouslyConsulted: false,
    hasExactResumeCoordinate: true,
    lifecycleValid: true,
  };

  it.each([
    ["unresolved owner-controlled constraint", { action: "question" as const }, "unresolved_owner_constraint"],
    ["consequential disclosure/permission", { action: "counter" as const, ownSuggestedRole: "patient" as const }, "consequential_disclosure_permission"],
    ["repeated non-convergence", { action: "counter" as const, priorActions: ["counter", "question"] as const }, "repeated_non_convergence"],
    ["insufficient commitment authority", { action: "counter" as const, ownSuggestedRole: "agent" as const }, "insufficient_commitment_authority"],
  ])("classifies %s without reading free-form content", (_label, partial, reason) => {
    expect(assessConsultationEligibility({ ...base, ...partial })).toEqual({ eligible: true, reason });
  });

  it.each([
    { protocolVersion: "v1" as const },
    { isOpeningTurn: true },
    { isFinalTurn: true },
    { screenedOut: true },
    { action: "accept" as const },
    { action: "decline" as const },
    { action: "reject" as const },
    { action: "withdraw" as const },
    { previouslyConsulted: true },
    { hasExactResumeCoordinate: false },
    { lifecycleValid: false },
  ])("fails closed for excluded state %#", (partial) => {
    expect(assessConsultationEligibility({ ...base, action: "question", ...partial })).toEqual({ eligible: false });
  });

  it("defaults invalid policy modes to off", () => {
    const prior = process.env.NEGOTIATION_CONSULTATION_POLICY_MODE;
    try {
      delete process.env.NEGOTIATION_CONSULTATION_POLICY_MODE;
      expect(negotiationConsultationPolicyMode()).toBe("off");
      process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = "unexpected";
      expect(negotiationConsultationPolicyMode()).toBe("off");
      process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = "shadow";
      expect(negotiationConsultationPolicyMode()).toBe("shadow");
    } finally {
      if (prior === undefined) delete process.env.NEGOTIATION_CONSULTATION_POLICY_MODE; else process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = prior;
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

/** Deterministic ask-user material binding, keyed by which side is asking. */
function bindingFor(recipientUserId: string, input: Record<string, unknown>) {
  const isSrc = recipientUserId === 'u-src';
  return {
    version: 2 as const,
    settlementId: input.settlementId as string,
    recipientUserId,
    recipientIntentId: input.recipientIntentId as string,
    opportunityId: input.opportunityId as string,
    networkId: input.networkId as string,
    intentFingerprint: isSrc ? 'fp-src' : 'fp-cand',
    opportunityStatus: 'pending',
    opportunityUpdatedAt: '2026-01-01T00:00:00.000Z',
    counterpartyUserId: isSrc ? 'u-cand' : 'u-src',
    counterpartyIntentId: isSrc ? 'intent-cand' : 'intent-src',
  };
}

function mkStubs(opts?: {
  priorMessages?: FakeMessage[];
  priorTask?: Record<string, unknown> | null;
  exactTask?: Record<string, unknown> | null;
  successorTask?: Record<string, unknown> | null;
}) {
  const createdMessages: Array<{ senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }> = [];
  const stateWrites: Array<{ taskId: string; state: string }> = [];
  const turnContextWrites: Array<{ taskId: string; context: Record<string, unknown> }> = [];
  const askUserBindingCaptures: Array<Record<string, unknown>> = [];
  let opportunityTaskReads = 0;
  const tasksById = new Map<string, Record<string, unknown>>();
  if (opts?.exactTask) tasksById.set(opts.exactTask.id as string, opts.exactTask);
  if (opts?.successorTask) tasksById.set(opts.successorTask.id as string, opts.successorTask);
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
    setTaskTurnContext: async (taskId: string, context: Record<string, unknown>) => {
      turnContextWrites.push({ taskId, context });
    },
    captureNegotiationAskUserBinding: async (input: Record<string, unknown>) => {
      askUserBindingCaptures.push(input);
      return bindingFor(input.recipientUserId as string, input);
    },
    getMessagesForConversation: async () => opts?.priorMessages ?? [],
    getOpportunityUserAnswers: async () => [],
    getNegotiationTaskForOpportunity: async () => {
      opportunityTaskReads += 1;
      return opts?.priorTask === undefined ? V2_PRIOR_TASK : opts.priorTask;
    },
    getTask: async (id: string) => tasksById.get(id) ?? null,
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

  return {
    database, dispatcher, timeoutQueue, questionerEnqueue, createdMessages, stateWrites,
    turnContextWrites, expiryArms, questionerEnqueues, askUserBindingCaptures,
    get opportunityTaskReads() { return opportunityTaskReads; },
  };
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
    sourceUser: { id: "u-src", intents: [{ id: "intent-src", title: "Build AI", description: "Find an AI collaborator", confidence: 1 }], profile: { name: "Alice", bio: "PM", skills: ["product"] } },
    candidateUser: { id: "u-cand", intents: [{ id: "intent-cand", title: "Apply ML", description: "Join an AI product", confidence: 1 }], profile: { name: "Bob", bio: "ML engineer", location: "Berlin", skills: ["ml"] } },
    sourceIntentId: "intent-src",
    candidateIntentId: "intent-cand",
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
  const origScreenMode = process.env.NEGOTIATION_SCREEN_MODE;
  const origPolicyMode = process.env.NEGOTIATION_CONSULTATION_POLICY_MODE;

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
    process.env.NEGOTIATION_SCREEN_MODE = "off";
    delete process.env.NEGOTIATION_CONSULTATION_POLICY_MODE;
    delete process.env.NEGOTIATION_ASK_USER_WINDOW_MS;
  });

  afterEach(() => {
    if (origFlag === undefined) delete process.env.NEGOTIATION_ASK_USER_ENABLED; else process.env.NEGOTIATION_ASK_USER_ENABLED = origFlag;
    if (origWindow === undefined) delete process.env.NEGOTIATION_ASK_USER_WINDOW_MS; else process.env.NEGOTIATION_ASK_USER_WINDOW_MS = origWindow;
    if (origScreenMode === undefined) delete process.env.NEGOTIATION_SCREEN_MODE; else process.env.NEGOTIATION_SCREEN_MODE = origScreenMode;
    if (origPolicyMode === undefined) delete process.env.NEGOTIATION_CONSULTATION_POLICY_MODE; else process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = origPolicyMode;
  });

  /** Continuation where the source (u-src, initiator) speaks next. */
  const continuationMessages = [priorMsg("u-src", "outreach", 0), priorMsg("u-cand", "counter", 1)];

  it.each([
    ["unresolved_owner_constraint", continuationMessages, { ...declineTurn, action: "question" }],
    ["consequential_disclosure_permission", continuationMessages, {
      action: "counter" as const,
      assessment: { reasoning: "CANARY_DISCLOSURE_REASONING", suggestedRoles: { ownUser: "patient" as const, otherUser: "peer" as const } },
      message: "CANARY_DISCLOSURE_MESSAGE",
    }],
    ["repeated_non_convergence", [priorMsg("u-src", "counter", 0), priorMsg("u-cand", "question", 1)], { ...declineTurn, action: "counter" }],
    ["insufficient_commitment_authority", continuationMessages, {
      action: "counter" as const,
      assessment: { reasoning: "CANARY_PRIVATE_REASONING", suggestedRoles: { ownUser: "agent" as const, otherUser: "peer" as const } },
      message: "CANARY_PRIVATE_MESSAGE",
    }],
  ] as Array<[string, FakeMessage[], NegotiationTurn]>)('deterministically pauses one exact safe consultation for %s', async (reason, priorMessages, draft) => {
    process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = "on";
    const stubs = mkStubs({ priorMessages });
    agentScript = [draft];

    await runGraph(stubs);

    expect(stubs.createdMessages).toHaveLength(1);
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("ask_user");
    expect(stubs.expiryArms).toHaveLength(1);
    expect(stubs.questionerEnqueues).toHaveLength(1);
    expect(stubs.stateWrites.filter((write) => write.state === "input_required")).toHaveLength(1);
    expect(stubs.questionerEnqueues[0].userId).toBe("u-src");
    expect(stubs.questionerEnqueues[0].negotiation?.recipientIntentId).toBe("intent-src");
    const serialized = JSON.stringify({ messages: stubs.createdMessages, questions: stubs.questionerEnqueues, timers: stubs.expiryArms });
    expect(serialized).toContain(reason === "unresolved_owner_constraint" ? "your preferences" : "your");
    expect(serialized).not.toContain("CANARY_PRIVATE_REASONING");
    expect(serialized).not.toContain("CANARY_PRIVATE_MESSAGE");
  });

  it('shadow retains a valid legacy ask_user pause while adding only eligibility telemetry', async () => {
    const off = mkStubs({ priorMessages: continuationMessages });
    agentScript = [askUserTurn];
    await runGraph(off);

    process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = "shadow";
    const shadow = mkStubs({ priorMessages: continuationMessages });
    const events: Array<Record<string, unknown>> = [];
    agentScript = [askUserTurn];
    await requestContext.run({ traceEmitter: (event) => events.push(event as unknown as Record<string, unknown>) }, async () => runGraph(shadow));

    expect(shadow.createdMessages).toEqual(off.createdMessages);
    expect(shadow.expiryArms).toEqual(off.expiryArms);
    expect(shadow.questionerEnqueues).toEqual(off.questionerEnqueues);
    expect(shadow.stateWrites).toEqual(off.stateWrites);
    expect(events.filter((event) => event.type === 'negotiation_consultation_policy')).toEqual([
      { type: 'negotiation_consultation_policy', stage: 'eligible', mode: 'shadow', reason: 'consequential_disclosure_permission' },
    ]);
    expect(JSON.stringify(events)).not.toContain('Can I tell them');
  });

  it.each([
    ['opening', [], { priorTask: null }, { ...declineTurn, action: 'question' as const }, { maxTurns: 4, fresh: true }],
    ['final', continuationMessages, {}, { ...declineTurn, action: 'question' as const }, { maxTurns: 1 }],
    ['accept', continuationMessages, {}, { ...declineTurn, action: 'accept' as const }, { maxTurns: 4 }],
    ['reject', continuationMessages, {}, { ...declineTurn, action: 'reject' as const }, { maxTurns: 4 }],
    ['withdraw', continuationMessages, {}, { ...declineTurn, action: 'withdraw' as const }, { maxTurns: 4 }],
    ['already consulted', [...continuationMessages, priorMsg('u-src', 'ask_user', 2), priorMsg('u-cand', 'counter', 3)], {}, { ...declineTurn, action: 'question' as const }, { maxTurns: 4 }],
  ] as Array<[string, FakeMessage[], Parameters<typeof mkStubs>[0], NegotiationTurn, { maxTurns: number; fresh?: boolean }]>)('policy on does not create consultation effects for %s', async (_label, priorMessages, stubOptions, draft, runOptions) => {
    process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = 'on';
    const priorVersion = process.env.NEGOTIATION_PROTOCOL_VERSION;
    process.env.NEGOTIATION_PROTOCOL_VERSION = 'v2';
    try {
      const stubs = mkStubs({ ...stubOptions, priorMessages });
      agentScript = [draft, declineTurn];
      await runGraph(stubs, { maxTurns: runOptions.maxTurns });
      expect(stubs.questionerEnqueues.filter((question) => question.mode === 'negotiation_inflight')).toEqual([]);
      expect(stubs.expiryArms).toEqual([]);
      expect(stubs.stateWrites.map((write) => write.state)).not.toContain('input_required');
      expect(stubs.createdMessages.map((message) => message.parts[0].data.action)).not.toContain('ask_user');
      expect(stubs.askUserBindingCaptures).toEqual([]);
    } finally {
      if (priorVersion === undefined) delete process.env.NEGOTIATION_PROTOCOL_VERSION; else process.env.NEGOTIATION_PROTOCOL_VERSION = priorVersion;
    }
  });

  it('policy on excludes a pre-screened path before consultation effects', async () => {
    process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = 'on';
    const stubs = mkStubs({ priorMessages: continuationMessages });
    agentScript = [{ ...declineTurn, action: 'question' }, declineTurn];
    await runGraph(stubs, {
      screenDecision: { mode: 'enforce', decision: 'pass', screenedAt: new Date().toISOString(), durationMs: 0 },
    });
    expect(stubs.questionerEnqueues).toEqual([]);
    expect(stubs.expiryArms).toEqual([]);
    expect(stubs.askUserBindingCaptures).toEqual([]);
    expect(stubs.createdMessages.map((message) => message.parts[0].data.action)).not.toContain('ask_user');
  });

  it('policy on excludes a missing exact resume coordinate before consultation effects', async () => {
    process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = 'on';
    const stubs = mkStubs({ priorMessages: continuationMessages });
    agentScript = [askUserTurn, declineTurn];
    await runGraph(stubs, {}, { omitQuestioner: true });
    expect(stubs.questionerEnqueues).toEqual([]);
    expect(stubs.expiryArms).toEqual([]);
    expect(stubs.askUserBindingCaptures).toEqual([]);
    expect(stubs.stateWrites.map((write) => write.state)).not.toContain('input_required');
    expect(stubs.createdMessages.map((message) => message.parts[0].data.action)).not.toContain('ask_user');
  });

  it('delivers private consultation only to the exact recipient across immediate dispatch and system fallback', async () => {
    const privateConsultation = {
      recipientUserId: 'u-src', recipientIntentId: 'intent-src', kind: 'answer' as const,
      selectedOptions: ['do not share budget'], freeText: 'Keep the range private.',
    };
    const dispatched: Array<Record<string, unknown>> = [];
    const externalRecipient = mkStubs();
    externalRecipient.dispatcher.dispatch = async (_userId: string, _scope: unknown, payload: Record<string, unknown>) => {
      dispatched.push(payload);
      return { handled: true, turn: declineTurn };
    };
    await runGraph(externalRecipient, { privateConsultation });
    expect(dispatched[0].privateConsultation).toEqual(privateConsultation);

    const externalCounterparty = mkStubs({ priorMessages: [priorMsg('u-src', 'counter', 0)] });
    externalCounterparty.dispatcher.dispatch = async (_userId: string, _scope: unknown, payload: Record<string, unknown>) => {
      dispatched.push(payload);
      return { handled: true, turn: declineTurn };
    };
    await runGraph(externalCounterparty, { privateConsultation });
    expect(dispatched[1].privateConsultation).toBeUndefined();

    agentScript = [declineTurn];
    await runGraph(mkStubs(), { privateConsultation });
    expect(agentInputs[0].privateConsultation).toEqual(privateConsultation);

    agentScript = [declineTurn];
    await runGraph(mkStubs({ priorMessages: [priorMsg('u-src', 'counter', 0)] }), { privateConsultation });
    expect(agentInputs[1].privateConsultation).toBeUndefined();
  });

  it("pauses the full loop: message + material binding + timer + question + input_required, no outcome", async () => {
    const stubs = mkStubs({ priorMessages: continuationMessages });
    agentScript = [askUserTurn];

    const result = await runGraph(stubs);

    // Turn persisted with the ask_user action.
    expect(stubs.createdMessages).toHaveLength(1);
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("ask_user");
    expect(stubs.createdMessages[0].senderId).toBe("agent:u-src");

    // Material binding captured for pickup/resume (recipient-scoped; the
    // opaque provenance never touches the shared turnContext write path).
    expect(stubs.askUserBindingCaptures).toHaveLength(1);
    const capture = stubs.askUserBindingCaptures[0];
    expect(capture.taskId).toBe('task-new');
    expect(capture.settlementId).toBe('negotiation-question-settlement-v1-task-new');
    expect(capture.recipientUserId).toBe('u-src');
    expect(capture.recipientIntentId).toBe('intent-src');
    expect(capture.opportunityId).toBe('opp-1');
    expect(capture.networkId).toBe('net-1');

    // Answer-window timer armed with the captured material provenance + default window.
    expect(stubs.expiryArms).toHaveLength(1);
    expect(stubs.expiryArms[0].negotiationId).toBe("task-new");
    expect(stubs.expiryArms[0].payload).toEqual({
      settlementId: 'negotiation-question-settlement-v1-task-new',
      opportunityId: "opp-1",
      userId: "u-src",
      recipientIntentId: 'intent-src',
      networkId: 'net-1',
      intentFingerprint: 'fp-src',
      opportunityStatus: 'pending',
      opportunityUpdatedAt: '2026-01-01T00:00:00.000Z',
      counterpartyUserId: 'u-cand',
      counterpartyIntentId: 'intent-cand',
    });
    expect(stubs.expiryArms[0].delayMs).toBe(DEFAULT_ASK_USER_WINDOW_MS);

    // Question enqueued through the negotiation_inflight preset for the
    // asker's OWN exact opportunity-bound signal.
    expect(stubs.questionerEnqueues).toHaveLength(1);
    const q = stubs.questionerEnqueues[0];
    expect(q.mode).toBe("negotiation_inflight");
    expect(q.userId).toBe("u-src");
    expect(q.sourceType).toBe("opportunity");
    expect(q.sourceId).toBe("opp-1");
    expect(q.purpose).toBe("inflight_consultation");
    expect(q.negotiation).toEqual({
      purpose: "inflight_consultation",
      recipientUserId: "u-src",
      recipientIntentId: "intent-src",
      opportunityId: "opp-1",
      taskId: "task-new",
      networkId: "net-1",
    });
    const ctx = q.context as Record<string, unknown>;
    expect(ctx.negotiationId).toBe("task-new");
    expect(ctx.disclosureSubject).toBe("budget range");
    expect(ctx.draftQuestion).toBe("Can I tell them your budget range?");
    expect(ctx.counterpartyHint).toBe("the other participant");
    expect(ctx.counterpartyHint).not.toContain("Bob");
    expect(ctx.counterpartyHint).not.toContain("ML engineer");
    expect(ctx.indexContext).toBe("the selected network");
    expect(ctx.userContext).toBe("Alice builds AI startups");

    // Task suspended as input_required; no completed transition, no outcome.
    expect(stubs.stateWrites).toContainEqual({ taskId: "task-new", state: "input_required" });
    expect(stubs.stateWrites.map((w) => w.state)).not.toContain("completed");
    expect(result.outcome).toBeNull();
  });

  it('keeps the exact task paused when question enqueue fails', async () => {
    const stubs = mkStubs({ priorMessages: continuationMessages });
    stubs.questionerEnqueue = async () => { throw new Error('redis unavailable'); };
    agentScript = [askUserTurn];

    const result = await runGraph(stubs);

    expect(stubs.expiryArms).toHaveLength(1);
    expect(stubs.stateWrites).toContainEqual({ taskId: 'task-new', state: 'input_required' });
    expect(stubs.stateWrites.map((write) => write.state)).not.toContain('completed');
    expect(result.outcome).toBeNull();
  });

  it('keeps timeout recovery armed but emits no card when structured safe fields are absent', async () => {
    const stubs = mkStubs({ priorMessages: continuationMessages });
    agentScript = [{
      action: 'ask_user',
      assessment: {
        reasoning: 'PRIVATE TRANSCRIPT: Alice profile and matchReason 123e4567-e89b-12d3-a456-426614174000',
        suggestedRoles: { ownUser: 'peer', otherUser: 'peer' },
      },
      message: 'Raw private transcript must never become a question.',
      askUser: null,
    }];

    await runGraph(stubs);

    expect(stubs.expiryArms).toHaveLength(1);
    expect(stubs.stateWrites).toContainEqual({ taskId: 'task-new', state: 'input_required' });
    expect(stubs.questionerEnqueues).toHaveLength(0);
    expect(JSON.stringify(stubs.expiryArms)).not.toContain('PRIVATE TRANSCRIPT');
    expect(JSON.stringify(stubs.expiryArms)).not.toContain('matchReason');
  });

  it("routes candidate-side consultation to the candidate's own exact intent", async () => {
    const stubs = mkStubs({
      priorMessages: [priorMsg("u-src", "outreach", 0), priorMsg("u-src", "counter", 1)],
    });
    agentScript = [askUserTurn];
    await runGraph(stubs);

    expect(stubs.questionerEnqueues).toHaveLength(1);
    expect(stubs.questionerEnqueues[0].userId).toBe("u-cand");
    expect(stubs.questionerEnqueues[0].negotiation).toEqual({
      purpose: "inflight_consultation",
      recipientUserId: "u-cand",
      recipientIntentId: "intent-cand",
      opportunityId: "opp-1",
      taskId: "task-new",
      networkId: "net-1",
    });
    expect(stubs.questionerEnqueues[0].negotiation?.recipientIntentId).not.toBe("intent-src");
  });

  it('resumes only the exact settled task and never asks for a newer opportunity task', async () => {
    const settlementId = 'negotiation-question-settlement-v1-task-paused';
    const successorTask = {
      id: 'task-successor',
      conversationId: 'conv-1',
      state: 'submitted',
      metadata: {
        continuationExecution: {
          version: 1,
          priorTaskId: 'task-paused',
          settlementId,
          successorTaskId: 'task-successor',
          token: 'tok-1',
          fence: 1,
          status: 'claimed',
          leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
          claimedAt: new Date().toISOString(),
          heartbeatAt: new Date().toISOString(),
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const stubs = mkStubs({
      priorMessages: [...continuationMessages, priorMsg('u-src', 'ask_user', 2)],
      exactTask: {
        id: 'task-paused',
        conversationId: 'conv-1',
        state: 'canceled',
        metadata: {
          type: 'negotiation',
          protocolVersion: 'v2',
          initiatorUserId: 'u-src',
          sourceUserId: 'u-src',
          candidateUserId: 'u-cand',
          opportunityId: 'opp-1',
          networkId: 'net-1',
          questionSettlement: {
            version: 1,
            settlementId,
            taskId: 'task-paused',
            recipientUserId: 'u-src',
            recipientIntentId: 'intent-src',
            opportunityId: 'opp-1',
            networkId: 'net-1',
            kind: 'answer',
            questionId: 'q-1',
            continuationStatus: 'requested',
            settledAt: '2026-07-23T00:00:00.000Z',
          },
        },
        createdAt: new Date(Date.now() - 60_000),
        updatedAt: new Date(),
      },
      successorTask,
    });
    agentScript = [{
      action: 'withdraw',
      assessment: { reasoning: 'stop', suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } },
      message: null,
    }];

    const continuationExecution = {
      taskId: 'task-paused',
      settlementId,
      opportunityId: 'opp-1',
      userId: 'u-src',
      recipientIntentId: 'intent-src',
      networkId: 'net-1',
      intentFingerprint: 'fp-src',
      opportunityStatus: 'pending',
      opportunityUpdatedAt: '2026-01-01T00:00:00.000Z',
      counterpartyUserId: 'u-cand',
      counterpartyIntentId: 'intent-cand',
      successorTaskId: 'task-successor',
      conversationId: 'conv-1',
      token: 'tok-1',
      fence: 1,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      consultation: {
        recipientUserId: 'u-src',
        recipientIntentId: 'intent-src',
        kind: 'answer' as const,
        selectedOptions: ['sure'],
      },
    };

    const result = await runGraph(stubs, {
      resumeFromTaskId: 'task-paused',
      continuationSettlementId: settlementId,
      continuationExecution,
    });

    // Never falls back to a "latest opportunity task" lookup — only the exact
    // stamped prior task and its exact fenced successor are consulted.
    expect(stubs.opportunityTaskReads).toBe(0);
    // The graph operated on the claimed successor task, not a freshly minted one.
    expect(result.taskId).toBe('task-successor');
    // A rejected/withdraw outcome on the exact fenced successor produces a
    // positive terminal receipt proving this exact claim settled.
    expect(result.continuationReceipt).toEqual({
      priorTaskId: 'task-paused',
      settlementId,
      successorTaskId: 'task-successor',
      fence: 1,
      outcome: 'rejected',
    });
  });

  it('fails closed when the caller supplies a settlement without a matching claimed continuationExecution', async () => {
    const settlementId = 'negotiation-question-settlement-v1-task-paused';
    const stubs = mkStubs({
      priorMessages: [...continuationMessages, priorMsg('u-src', 'ask_user', 2)],
      exactTask: {
        id: 'task-paused',
        conversationId: 'conv-1',
        state: 'canceled',
        metadata: {
          type: 'negotiation',
          opportunityId: 'opp-1',
          questionSettlement: { settlementId, taskId: 'task-paused' },
        },
        createdAt: new Date(Date.now() - 60_000),
        updatedAt: new Date(),
      },
    });
    agentScript = [];

    const result = await runGraph(stubs, {
      resumeFromTaskId: 'task-paused',
      continuationSettlementId: settlementId,
      // continuationExecution omitted — resumeFromTaskId alone must not admit.
    });

    expect(result.error).toBe('invalid continuation correlation');
    expect(stubs.createdMessages).toHaveLength(0);
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
