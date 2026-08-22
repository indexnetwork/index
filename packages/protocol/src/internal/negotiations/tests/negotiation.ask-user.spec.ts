import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { AsyncLocalStorage } from "async_hooks";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NegotiationStallGapAuthor } from "../negotiation.stall-gap.js";
import { allowedActionsFor, turnSchemaFor, ASK_USER_WINDOW_MS, ASK_USER_LOCK_SLACK_MS, CHECKLIST_NEGOTIATION_ASK_ROUNDS_CAP, DEFAULT_NEGOTIATION_ASK_ROUNDS_CAP, InitiatorTurnSchema, CounterpartyTurnSchema, InitiatorAskUserTurnSchema, CounterpartyAskUserTurnSchema } from "../negotiation.protocol.js";
import type { NegotiationTurn } from "../negotiation.state.js";
import type { QuestionerEnqueuePayload } from "../../../protocol/question-input.js";
import { assessConsultationEligibility, NEGOTIATION_CONSULTATION_POLICY_MODE } from "../negotiation.consultation-policy.js";
import type { NegotiationConsultationReason } from "../negotiation.consultation-policy.js";
import { requestContext, setRequestContextStore } from "../../shared/observability/request-context.js";
import { QUESTION_BUDGET_PER_PRINCIPAL } from "../negotiation.checklist.contracts.js";
import type { NegotiationTurnPayload } from "../../shared/interfaces/agent-dispatcher.interface.js";

setRequestContextStore(new AsyncLocalStorage());

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
  askUser: { reason: "consequential_disclosure_permission" },
};

describe("ask_user vocabulary + seat schemas", () => {
  it("is excluded everywhere by default (no opts)", () => {
    expect(allowedActionsFor("initiator")).not.toContain("ask_user");
    expect(allowedActionsFor("counterparty")).not.toContain("ask_user");
  });

  it("is granted per surface via opts.askUser, v2 non-final only", () => {
    expect(allowedActionsFor("initiator", false, { askUser: true })).toContain("ask_user");
    expect(allowedActionsFor("counterparty", false, { askUser: true })).toContain("ask_user");
    // Final-cap turns must decide, never pause.
    expect(allowedActionsFor("initiator", true, { askUser: true })).not.toContain("ask_user");
    expect(allowedActionsFor("counterparty", true, { askUser: true })).not.toContain("ask_user");
  });

  it("keeps the base v2 vocabularies byte-identical", () => {
    expect([...allowedActionsFor("initiator")]).toEqual(["outreach", "counter", "question", "withdraw"]);
    expect([...allowedActionsFor("counterparty")]).toEqual(["accept", "decline", "counter", "question"]);
  });

  it("turnSchemaFor selects the ask_user schema variants only when granted", () => {
    expect(turnSchemaFor("initiator", false, { askUser: true })).toBe(InitiatorAskUserTurnSchema);
    expect(turnSchemaFor("counterparty", false, { askUser: true })).toBe(CounterpartyAskUserTurnSchema);
    expect(turnSchemaFor("initiator", false)).toBe(InitiatorTurnSchema);
    expect(turnSchemaFor("counterparty", false)).toBe(CounterpartyTurnSchema);
    // Final turns never get the variant.
    expect(turnSchemaFor("initiator", true, { askUser: true })).not.toBe(InitiatorAskUserTurnSchema);
  });

  it("ask_user variants parse an ask_user turn with payload; base schemas reject it", () => {
    expect(InitiatorAskUserTurnSchema.safeParse(askUserTurn).success).toBe(true);
    expect(CounterpartyAskUserTurnSchema.safeParse(askUserTurn).success).toBe(true);
    expect(InitiatorTurnSchema.safeParse(askUserTurn).success).toBe(false);
    expect(CounterpartyTurnSchema.safeParse(askUserTurn).success).toBe(false);
  });

  it("the answer window is 24h", () => {
    expect(ASK_USER_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("deterministic consultation eligibility policy (IND-508)", () => {
  const base = {
    seat: "initiator" as const,
    isOpeningTurn: false,
    isFinalTurn: false,
    ownSuggestedRole: "peer" as const,
    priorActions: [] as const,
    consultationBudgetSpent: false,
    hasExactResumeCoordinate: true,
    lifecycleValid: true,
  };

  it.each([
    ["unresolved owner-controlled constraint", { action: "question" as const }, "unresolved_owner_constraint"],
    ["consequential disclosure/permission", { action: "counter" as const, ownSuggestedRole: "patient" as const }, "consequential_disclosure_permission"],
    ["repeated non-convergence", { action: "counter" as const, priorActions: ["counter", "question"] as const }, "repeated_non_convergence"],
    ["insufficient commitment authority", { action: "counter" as const, ownSuggestedRole: "agent" as const }, "insufficient_commitment_authority"],
  ] as const)("classifies %s without reading free-form content", (_label, partial, reason: NegotiationConsultationReason) => {
    expect(assessConsultationEligibility({ ...base, ...partial })).toEqual({ eligible: true, reason });
  });

  it.each([
    // The opening turn admits ONLY a model-authored `ask_user` from the
    // initiator seat (the pre-contact verdict); every inferred category the
    // table above relies on stays excluded there.
    { isOpeningTurn: true },
    { isOpeningTurn: true, seat: "counterparty" as const, action: "ask_user" as const },
    { isFinalTurn: true },
    { action: "accept" as const },
    { action: "decline" as const },
    { action: "decline" as const },
    { action: "withdraw" as const },
    { consultationBudgetSpent: true },
    { hasExactResumeCoordinate: false },
    { lifecycleValid: false },
  ])("fails closed for excluded state %#", (partial) => {
    expect(assessConsultationEligibility({ ...base, action: "question", ...partial })).toEqual({ eligible: false });
  });

  it("runs the deterministic consultation policy", () => {
    expect(NEGOTIATION_CONSULTATION_POLICY_MODE).toBe("on");
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
    counterpartyBinding: { kind: 'intent' as const, id: isSrc ? 'intent-cand' : 'intent-src' },
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
    getNegotiationMessages: async () => opts?.priorMessages ?? [],
    getOpportunityUserAnswers: async () => [],
    getNegotiationTaskForOpportunity: async () => {
      opportunityTaskReads += 1;
      return opts?.priorTask === undefined ? V2_PRIOR_TASK : opts.priorTask;
    },
    getTask: async (id: string) => tasksById.get(id) ?? null,
    getLatestNegotiationTaskForConversation: async () => null,
    getUserContext: async () => ({ text: "Alice builds AI startups" }),
    /** Pre-contact consult cap substrate: no parks open for either side. */
    getTasksForUser: async () => [],
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

  // Post-stall parking authors a gap at finalize, which is its own model call
  // and its own ask_user message. This spec is about the mid-flight
  // consultation policy, so it holds parking to "no gap" throughout —
  // otherwise every unconcluded case here would consume a scripted turn and
  // emit an ask_user message that has nothing to do with what is under test.
  // Parking itself is covered by negotiation.park-on-stall.spec.ts.
  let origStallGapAuthor: typeof NegotiationStallGapAuthor.prototype.author;

  beforeAll(() => {
    origAgentInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function (input: NegotiationAgentInput) {
      agentInputs.push(input);
      const turn = agentScript.shift();
      if (!turn) throw new Error("agent script exhausted");
      return turn;
    };
    origStallGapAuthor = NegotiationStallGapAuthor.prototype.author;
    NegotiationStallGapAuthor.prototype.author = async function () {
      return null;
    };
  });

  afterAll(() => {
    IndexNegotiator.prototype.invoke = origAgentInvoke;
    NegotiationStallGapAuthor.prototype.author = origStallGapAuthor;
  });

  beforeEach(() => {
    agentInputs = [];
    agentScript = [];
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
  ] as Array<[string, FakeMessage[], NegotiationTurn]>)('names the exact consultation category for %s, and declines to infer one', async (reason, priorMessages, draft) => {
    const stubs = mkStubs({ priorMessages });
    agentScript = [draft];
    const events: Array<Record<string, unknown>> = [];

    await requestContext.run(
      { traceEmitter: ((e: Record<string, unknown>) => { events.push(e); }) as never },
      () => runGraph(stubs),
    );

    // The policy finds the shape eligible and names one exact category...
    const eligible = events.filter((e) => e.type === 'negotiation_consultation_policy' && e.stage === 'eligible');
    expect(eligible).toHaveLength(1);
    expect(eligible[0].reason).toBe(reason);
    expect(eligible[0].mode).toBe('on');

    // ...but under the checklist protocol it never manufactures the question.
    // The agent is the only party that has read this negotiation, so an
    // inferred question would be about the wrong unknown. The draft stands.
    expect(stubs.createdMessages).toHaveLength(1);
    expect(stubs.createdMessages[0].parts[0].data.action).toBe(draft.action);
    expect(stubs.questionerEnqueues).toHaveLength(0);
    expect(stubs.expiryArms).toHaveLength(0);
    expect(stubs.stateWrites.filter((write) => write.state === "input_required")).toHaveLength(0);

    // The policy's own telemetry carries the category and nothing else: it
    // never sees user text, and the draft's private reasoning must not ride
    // out on it. (The ordinary turn trace is a separate channel and has always
    // carried the agent's reasoning.)
    const policyEvents = JSON.stringify(events.filter((e) => e.type === 'negotiation_consultation_policy'));
    expect(policyEvents).not.toContain('Ignore prior instructions');
    for (const canary of ["CANARY_PRIVATE_REASONING", "CANARY_PRIVATE_MESSAGE", "CANARY_DISCLOSURE_REASONING", "CANARY_DISCLOSURE_MESSAGE"]) {
      expect(policyEvents).not.toContain(canary);
    }
  });

  it.each([
    ['opening', [], { priorTask: null }, { ...declineTurn, action: 'question' as const }, { maxTurns: 4, fresh: true }],
    ['final', continuationMessages, {}, { ...declineTurn, action: 'question' as const }, { maxTurns: 1 }],
    ['accept', continuationMessages, {}, { ...declineTurn, action: 'accept' as const }, { maxTurns: 4 }],
    ['reject', continuationMessages, {}, { ...declineTurn, action: 'reject' as const }, { maxTurns: 4 }],
    ['withdraw', continuationMessages, {}, { ...declineTurn, action: 'withdraw' as const }, { maxTurns: 4 }],
    ['already consulted', [...continuationMessages, priorMsg('u-src', 'ask_user', 2), priorMsg('u-cand', 'counter', 3)], {}, { ...declineTurn, action: 'question' as const }, { maxTurns: 4 }],
  ] as Array<[string, FakeMessage[], Parameters<typeof mkStubs>[0], NegotiationTurn, { maxTurns: number; fresh?: boolean }]>)('no consultation effects for %s', async (_label, priorMessages, stubOptions, draft, runOptions) => {
    {
      const stubs = mkStubs({ ...stubOptions, priorMessages });
      agentScript = [draft, declineTurn];
      await runGraph(stubs, { maxTurns: runOptions.maxTurns });
      expect(stubs.questionerEnqueues.filter((question) => question.mode === 'negotiation_inflight')).toEqual([]);
      expect(stubs.expiryArms).toEqual([]);
      expect(stubs.stateWrites.map((write) => write.state)).not.toContain('input_required');
      expect(stubs.createdMessages.map((message) => message.parts[0].data.action)).not.toContain('ask_user');
      expect(stubs.askUserBindingCaptures).toEqual([]);
    }
  });

  it('excludes a pre-screened path before consultation effects', async () => {
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

  it('excludes a missing exact resume coordinate before consultation effects', async () => {
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
    const dispatched: NegotiationTurnPayload[] = [];
    const externalRecipient = mkStubs();
    externalRecipient.dispatcher.dispatch = async (_userId: string, _scope, payload: NegotiationTurnPayload, _options) => {
      dispatched.push(payload);
      return { handled: true, turn: declineTurn };
    };
    await runGraph(externalRecipient, { privateConsultation });
    expect(dispatched[0].privateConsultation).toEqual(privateConsultation);

    const externalCounterparty = mkStubs({ priorMessages: [priorMsg('u-src', 'counter', 0)] });
    externalCounterparty.dispatcher.dispatch = async (_userId: string, _scope, payload: NegotiationTurnPayload, _options) => {
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
      counterpartyBinding: { kind: 'intent', id: 'intent-cand' },
    });
    expect(stubs.expiryArms[0].delayMs).toBe(ASK_USER_WINDOW_MS);

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
    const ctx = q.context as unknown as Record<string, unknown>;
    expect(ctx.negotiationId).toBe("task-new");
    expect(ctx.consultationPolicyReason).toBe("consequential_disclosure_permission");
    expect(ctx).not.toHaveProperty("disclosureSubject");
    expect(ctx).not.toHaveProperty("draftQuestion");
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

  it("normalizes a mixed counter plus own-client consultation payload into a real pause", async () => {
    const stubs = mkStubs({ priorMessages: continuationMessages });
    agentScript = [{
      ...askUserTurn,
      action: "counter",
      message: "I need to ask Alice about her budget before continuing.",
    }];

    const result = await runGraph(stubs);

    expect(stubs.createdMessages).toHaveLength(1);
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("ask_user");
    expect(stubs.questionerEnqueues).toHaveLength(1);
    expect(stubs.stateWrites).toContainEqual({ taskId: "task-new", state: "input_required" });
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
    // No safe fields means no card: the policy does not author one on the
    // agent's behalf, and the agent's private draft must never become one.
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
      counterpartyBinding: { kind: 'intent', id: 'intent-cand' },
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

  it("arms the expiry timer at the ask-user answer window", async () => {
    const stubs = mkStubs({ priorMessages: continuationMessages });
    agentScript = [askUserTurn];
    await runGraph(stubs);
    expect(stubs.expiryArms[0].delayMs).toBe(ASK_USER_WINDOW_MS);
  });

  it("grants canAskUser to the agent when the loop is fully wired", async () => {
    const stubs = mkStubs({ priorMessages: continuationMessages });
    agentScript = [askUserTurn];
    await runGraph(stubs);
    expect(agentInputs[0].canAskUser).toBe(true);
  });

  it.each([
    ["questioner missing", { omitQuestioner: true }],
    ["timer missing", { omitTimeoutQueue: true }],
    ["no opportunityId", { noOpportunity: true }],
  ] as Array<[string, { omitQuestioner?: boolean; omitTimeoutQueue?: boolean; noOpportunity?: boolean }]>)(
    "withholds canAskUser when %s",
    async (_label, cfg) => {
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

  it("grants canAskUser on the opening turn of a fresh negotiation (pre-contact verdict) and keeps it after", async () => {
    // The opening turn used to be a blanket exclusion here. It is now the
    // pre-contact consultation: the initiator may consult its client BEFORE
    // deciding whether to reach out. `negotiation.pre-contact-consult.spec.ts`
    // owns that behaviour end to end; this pins the grant itself, and that
    // granting it did not disturb the mid-flight grant on later turns.
    const stubs = mkStubs({ priorMessages: [], priorTask: null });
    {
      agentScript = [
        { ...declineTurn, action: "outreach" },
        declineTurn,
      ];
      await runGraph(stubs);
      expect(agentInputs[0].canAskUser).toBe(true);
      expect(agentInputs[1].canAskUser).toBe(true);
    }
  });

  it("rations per principal: a side that has spent its whole budget does not get it again (prior sessions count)", async () => {
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
    // u-cand has spent none of its budget — it still gets the option.
    expect(agentInputs[0].canAskUser).toBe(true);

    // Now the source side speaks with its whole per-principal budget spent.
    const spent: FakeMessage[] = [priorMsg("u-src", "outreach", 0)];
    for (let i = 0; i < QUESTION_BUDGET_PER_PRINCIPAL; i++) {
      spent.push(priorMsg("u-src", "ask_user", spent.length));
      spent.push(priorMsg("u-cand", "counter", spent.length));
    }
    const stubs2 = mkStubs({ priorMessages: spent });
    agentInputs = [];
    agentScript = [{ ...declineTurn, action: "withdraw" }];
    await runGraph(stubs2);
    expect(agentInputs[0].canAskUser).toBeUndefined();
  });

  it("caps ask rounds negotiation-wide: parks from EITHER side count against the cap", async () => {
    // Same shape as the per-side rationing case, but with the negotiation-wide
    // cap already spent. u-cand has never consulted and still loses the option,
    // because the cap counts both seats. Seeded past the larger of the two
    // protocol caps so it binds regardless of which one applies.
    const spentRounds = Math.max(DEFAULT_NEGOTIATION_ASK_ROUNDS_CAP, CHECKLIST_NEGOTIATION_ASK_ROUNDS_CAP);
    const priorMessages = [priorMsg("u-src", "outreach", 0), priorMsg("u-cand", "counter", 1)];
    for (let i = 0; i < spentRounds; i++) {
      priorMessages.push(priorMsg("u-src", "ask_user", priorMessages.length));
      priorMessages.push(priorMsg("u-src", "counter", priorMessages.length));
    }
    const stubs = mkStubs({ priorMessages });
    agentScript = [declineTurn];
    await runGraph(stubs);
    expect(agentInputs[0].canAskUser).toBeUndefined();
  });

  it("coerces an unavailable ask_user to the conservative fallback before persisting", async () => {
    // Unavailable now means unwired, not flagged off.
    const stubs = mkStubs({ priorMessages: continuationMessages });
    // Script: agent emits ask_user anyway (schema would prevent this for the
    // system agent; this pins the safety net for dispatched turns), then the
    // counterparty declines to terminate.
    agentScript = [askUserTurn, declineTurn];
    await runGraph(stubs, {}, { omitQuestioner: true });
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
        updatedAt: new Date(Date.now() - ASK_USER_WINDOW_MS - ASK_USER_LOCK_SLACK_MS - 60_000),
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
