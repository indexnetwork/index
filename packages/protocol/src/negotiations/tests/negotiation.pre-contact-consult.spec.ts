import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NegotiationStallGapAuthor } from "../negotiation.stall-gap.js";
import { classifyParkedNegotiation } from "../negotiation.answer-consumption.js";
import { negotiationQuestionSettlementId } from "../negotiation.question-safety.js";
import { assessConsultationEligibility, countOpenPreContactConsults, isPreContactConsultResume, MAX_OPEN_PRE_CONTACT_CONSULTS_PER_INTENT, PRE_CONTACT_CONSULT_MARKER } from "../negotiation.consultation-policy.js";
import type { NegotiationTurn } from "../negotiation.state.js";
import type { QuestionerEnqueuePayload } from "../../questions/question.input.js";
import { stubScreenerReachOut } from "./screen.stub.js";

/**
 * Pre-contact consultation — the initiator's turn-0 THIRD verdict.
 *
 * Before this, the acting agent's vocabulary at turn 0 was binary: reach out,
 * or pass with the counterparty never contacted. A match was passed in dev
 * because the agent could not tell whether a client's stated criterion
 * strictly bounded the search — a fact only the client holds. `ask_user` is
 * now admissible at turn 0 for the initiator seat, which parks the negotiation
 * `input_required` before any contact and rides the shipped conversational
 * loop unchanged (#1428–#1442): park → question-message in the signal's DM →
 * client answers → resume → the agent re-takes the turn-0 decision.
 *
 * What this file pins:
 *  - the Ashley shape end to end: turn-0 `ask_user` → parked inflight with a
 *    coherent binding and the AUTHORED question intact → answer → resume →
 *    outreach, grounded in the answer,
 *  - an unanswered consult resolves to today's behaviour: the expiry resume's
 *    refusal is still an OPENING refusal — quiet `screened_out`, nothing ever
 *    sent — not a mid-negotiation withdraw,
 *  - contradiction-shaped doubt does not consult: the admission policy admits
 *    only a volunteered `ask_user`, so a draft that judged the match on the
 *    evidence passes silently,
 *  - the per-signal open-consult cap,
 *  - the turn-0 coercion still fires for a malformed opening, on the fresh
 *    turn and on the pre-contact resume alike.
 *
 * Harness mirrors `negotiation.ask-user.spec.ts` (the house pattern for the
 * consult loop): stubbed database/dispatcher, scripted agent turns, no live
 * provider.
 */

type FakeMessage = {
  id: string;
  senderId: string;
  role: "agent";
  parts: unknown[];
  createdAt: Date;
};

function turnMsg(senderUserId: string, turn: NegotiationTurn, idx: number): FakeMessage {
  return {
    id: `prior-${idx}`,
    senderId: `agent:${senderUserId}`,
    role: "agent",
    parts: [{ kind: "data", data: turn }],
    createdAt: new Date(Date.now() - (100 - idx) * 1000),
  };
}

/** The question the negotiator authors for the Ashley shape — scope, not the person. */
const ASHLEY_QUESTION = {
  title: "Scope",
  prompt: "Does the topic-classification framing strictly bound who counts here, or is adjacent depth in scope?",
  options: [
    { label: "Strictly that field", description: "I will only reach out to people working squarely in it." },
    { label: "Adjacent depth counts", description: "I will also reach out to strong generalists nearby." },
  ],
  multiSelect: false,
};

/**
 * Turns are built per use, never shared. The turn-0 coercion rewrites
 * `turn.action` IN PLACE on the object the agent returned, so a module-level
 * fixture handed to two tests is silently rewritten by the first one.
 */
const preContactAskUserTurn = (): NegotiationTurn => ({
  action: "ask_user",
  assessment: {
    reasoning: "cannot tell whether the stated criterion strictly bounds the search",
    suggestedRoles: { ownUser: "peer", otherUser: "peer" },
  },
  message: null,
  askUser: { reason: "unresolved_owner_constraint", question: ASHLEY_QUESTION },
});

const plainTurn = (action: string, reasoning: string, message: string | null = null): NegotiationTurn => ({
  action,
  assessment: { reasoning, suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
  message,
} as NegotiationTurn);

const outreachTurn = () => plainTurn("outreach", "in scope per Alice's answer", "Alice said adjacent depth counts, so this is worth a conversation.");
const declineTurn = () => plainTurn("decline", "not a fit");

/** One `input_required` task metadata shaped exactly as a pre-contact park writes it. */
function parkedTaskRow(id: string, userId: string, intentId: string, opts?: { preContact?: boolean }) {
  return {
    id,
    state: "input_required",
    metadata: {
      type: "negotiation",
      turnContext: {
        ...(opts?.preContact === false ? {} : { [PRE_CONTACT_CONSULT_MARKER]: true }),
        askUserBinding: { recipientUserId: userId, recipientIntentId: intentId },
      },
    },
  };
}

function mkStubs(opts?: {
  priorMessages?: FakeMessage[];
  priorTask?: Record<string, unknown> | null;
  exactTask?: Record<string, unknown> | null;
  successorTask?: Record<string, unknown> | null;
  parkedTasks?: Array<Record<string, unknown>>;
}) {
  const createdMessages: Array<{ senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }> = [];
  const stateWrites: Array<{ taskId: string; state: string }> = [];
  const askUserBindingCaptures: Array<Record<string, unknown>> = [];
  const statusUpdates: Array<{ opportunityId: string; status: string }> = [];
  const tasksById = new Map<string, Record<string, unknown>>();
  if (opts?.exactTask) tasksById.set(opts.exactTask.id as string, opts.exactTask);
  if (opts?.successorTask) tasksById.set(opts.successorTask.id as string, opts.successorTask);

  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string) => ({ id: "task-new", conversationId, state: "submitted" }),
    updateOpportunityStatus: async (opportunityId: string, status: string) => {
      statusUpdates.push({ opportunityId, status });
    },
    createMessage: async (p: { senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }) => {
      createdMessages.push(p);
      return { id: `msg-${createdMessages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async (taskId: string, state: string) => { stateWrites.push({ taskId, state }); },
    createArtifact: async () => ({ id: "art-1" }),
    setTaskTurnContext: async () => {},
    captureNegotiationAskUserBinding: async (input: Record<string, unknown>) => {
      askUserBindingCaptures.push(input);
      return {
        version: 2 as const,
        settlementId: input.settlementId as string,
        recipientUserId: input.recipientUserId as string,
        recipientIntentId: input.recipientIntentId as string,
        opportunityId: input.opportunityId as string,
        networkId: input.networkId as string,
        intentFingerprint: "fp-src",
        opportunityStatus: "pending",
        opportunityUpdatedAt: "2026-01-01T00:00:00.000Z",
        counterpartyUserId: "u-cand",
        counterpartyIntentId: "intent-cand",
      };
    },
    getMessagesForConversation: async () => opts?.priorMessages ?? [],
    getNegotiationMessages: async () => opts?.priorMessages ?? [],
    getOpportunityUserAnswers: async () => [],
    getNegotiationTaskForOpportunity: async () => (opts?.priorTask === undefined ? null : opts.priorTask),
    getLatestNegotiationTaskForConversation: async () => null,
    getTask: async (id: string) => tasksById.get(id) ?? null,
    getUserContext: async () => ({ text: "Alice builds AI startups" }),
    getTasksForUser: async () => opts?.parkedTasks ?? [],
    getArtifactsForTask: async () => [],
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
  const questionerEnqueue = async (input: QuestionerEnqueuePayload) => { questionerEnqueues.push(input); };

  return {
    database, dispatcher, timeoutQueue, questionerEnqueue,
    createdMessages, stateWrites, askUserBindingCaptures, statusUpdates, expiryArms, questionerEnqueues,
  };
}

async function runGraph(stubs: ReturnType<typeof mkStubs>, input: Record<string, unknown> = {}) {
  const graph = new NegotiationGraphFactory(
    stubs.database, stubs.dispatcher, stubs.timeoutQueue, stubs.questionerEnqueue,
  ).createGraph();
  return graph.invoke({
    sourceUser: { id: "u-src", intents: [{ id: "intent-src", title: "Topic classification", description: "Looking for depth in topic classification / linguistics", confidence: 1 }], profile: { name: "Alice", bio: "Researcher", skills: ["nlp"] } },
    candidateUser: { id: "u-cand", intents: [{ id: "intent-cand", title: "Consumer AI", description: "Founder with general AI depth", confidence: 1 }], profile: { name: "Bob", bio: "Founder", skills: ["ai"] } },
    sourceIntentId: "intent-src",
    candidateIntentId: "intent-cand",
    indexContext: { networkId: "net-1", prompt: "AI network" },
    seedAssessment: { reasoning: "adjacent AI depth", valencyRole: "peer" },
    opportunityId: "opp-1",
    maxTurns: 4,
    ...input,
  } as Partial<typeof NegotiationGraphState.State>);
}

let agentInputs: NegotiationAgentInput[] = [];
let agentScript: NegotiationTurn[] = [];

/** The exact-resume coordinates a settled pre-contact park produces. */
const SETTLEMENT_ID = negotiationQuestionSettlementId("task-paused");

function resumeFixtures(consultation: {
  kind: "answer" | "timeout";
  selectedOptions: string[];
  freeText?: string;
}) {
  const exactTask = {
    id: "task-paused",
    conversationId: "conv-1",
    state: "canceled",
    metadata: {
      type: "negotiation",
      protocolVersion: "v2",
      initiatorUserId: "u-src",
      sourceUserId: "u-src",
      candidateUserId: "u-cand",
      opportunityId: "opp-1",
      networkId: "net-1",
      turnContext: { [PRE_CONTACT_CONSULT_MARKER]: true },
      questionSettlement: {
        version: 1,
        settlementId: SETTLEMENT_ID,
        taskId: "task-paused",
        recipientUserId: "u-src",
        recipientIntentId: "intent-src",
        opportunityId: "opp-1",
        networkId: "net-1",
        kind: consultation.kind,
        questionId: "q-1",
        continuationStatus: "requested",
        settledAt: "2026-07-23T00:00:00.000Z",
      },
    },
    createdAt: new Date(Date.now() - 60_000),
    updatedAt: new Date(),
  };
  const successorTask = {
    id: "task-successor",
    conversationId: "conv-1",
    state: "submitted",
    metadata: {
      continuationExecution: {
        version: 1,
        priorTaskId: "task-paused",
        settlementId: SETTLEMENT_ID,
        successorTaskId: "task-successor",
        token: "tok-1",
        fence: 1,
        status: "claimed",
        leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
        claimedAt: new Date().toISOString(),
        heartbeatAt: new Date().toISOString(),
      },
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const continuationExecution = {
    taskId: "task-paused",
    settlementId: SETTLEMENT_ID,
    opportunityId: "opp-1",
    userId: "u-src",
    recipientIntentId: "intent-src",
    networkId: "net-1",
    intentFingerprint: "fp-src",
    opportunityStatus: "pending",
    opportunityUpdatedAt: "2026-01-01T00:00:00.000Z",
    counterpartyUserId: "u-cand",
    counterpartyIntentId: "intent-cand",
    successorTaskId: "task-successor",
    conversationId: "conv-1",
    token: "tok-1",
    fence: 1,
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    consultation: {
      recipientUserId: "u-src",
      recipientIntentId: "intent-src",
      ...consultation,
    },
  };
  return { exactTask, successorTask, continuationExecution };
}

// The outreach screen runs before first contact on every negotiation; stub it
// so these cases exercise the turns they are about rather than a live model.
const restoreScreenStub = stubScreenerReachOut();
afterAll(() => { restoreScreenStub(); });

describe("pre-contact consultation — the initiator's turn-0 third verdict", () => {
  let origAgentInvoke: typeof IndexNegotiator.prototype.invoke;
  let origStallGapAuthor: typeof NegotiationStallGapAuthor.prototype.author;
  const origFlag = process.env.NEGOTIATION_ASK_USER_ENABLED;
  const origScreenMode = process.env.NEGOTIATION_SCREEN_MODE;
  const origPolicyMode = process.env.NEGOTIATION_CONSULTATION_POLICY_MODE;
  const origVersion = process.env.NEGOTIATION_PROTOCOL_VERSION;

  beforeAll(() => {
    origAgentInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function (input: NegotiationAgentInput) {
      agentInputs.push(input);
      const turn = agentScript.shift();
      if (!turn) throw new Error("agent script exhausted");
      return turn;
    };
    // Post-stall parking is a separate model call with its own ask_user
    // message; held to "no gap" so it cannot be mistaken for a pre-contact one.
    origStallGapAuthor = NegotiationStallGapAuthor.prototype.author;
    NegotiationStallGapAuthor.prototype.author = async function () { return null; };
  });

  afterAll(() => {
    IndexNegotiator.prototype.invoke = origAgentInvoke;
    NegotiationStallGapAuthor.prototype.author = origStallGapAuthor;
  });

  beforeEach(() => {
    agentInputs = [];
    agentScript = [];
    // The dev configuration this verdict ships into.
    process.env.NEGOTIATION_ASK_USER_ENABLED = "true";
    process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = "on";
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    process.env.NEGOTIATION_SCREEN_MODE = "off";
  });

  afterEach(() => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    };
    restore("NEGOTIATION_ASK_USER_ENABLED", origFlag);
    restore("NEGOTIATION_SCREEN_MODE", origScreenMode);
    restore("NEGOTIATION_CONSULTATION_POLICY_MODE", origPolicyMode);
    restore("NEGOTIATION_PROTOCOL_VERSION", origVersion);
  });

  // ─── Admission policy (pure) ───────────────────────────────────────────────

  describe("admission", () => {
    const base = {
      protocolVersion: "v2" as const,
      seat: "initiator" as const,
      isOpeningTurn: true,
      isFinalTurn: false,
      screenedOut: false,
      ownSuggestedRole: "peer" as const,
      priorActions: [] as const,
      consultationBudgetSpent: false,
      hasExactResumeCoordinate: true,
      lifecycleValid: true,
    };

    it("admits a volunteered opening ask_user from the initiator as an owner-constraint consult", () => {
      expect(assessConsultationEligibility({ ...base, action: "ask_user" }))
        .toEqual({ eligible: true, reason: "unresolved_owner_constraint" });
    });

    it.each([
      ["the counterparty seat", { seat: "counterparty" as const, action: "ask_user" as const }],
      ["a question draft", { action: "question" as const }],
      ["a counter draft", { action: "counter" as const }],
      ["a patient-side counter (the mid-flight disclosure rule)", { action: "counter" as const, ownSuggestedRole: "patient" as const }],
      ["an agent-side counter (the mid-flight authority rule)", { action: "counter" as const, ownSuggestedRole: "agent" as const }],
      ["a withdraw draft", { action: "withdraw" as const }],
    ] as const)("does not consult at the opening turn for %s", (_label, partial) => {
      expect(assessConsultationEligibility({ ...base, action: "question", ...partial })).toEqual({ eligible: false });
    });

    it("keeps every non-opening exclusion intact at the opening turn", () => {
      for (const partial of [
        { protocolVersion: "v1" as const },
        { isFinalTurn: true },
        { screenedOut: true },
        { consultationBudgetSpent: true },
        { hasExactResumeCoordinate: false },
        { lifecycleValid: false },
      ]) {
        expect(assessConsultationEligibility({ ...base, action: "ask_user", ...partial })).toEqual({ eligible: false });
      }
    });

    it("recognizes a pre-contact resume only when nothing but consults has been said", () => {
      expect(isPreContactConsultResume([])).toBe(false);
      expect(isPreContactConsultResume([{ action: "ask_user" }])).toBe(true);
      // A mid-flight consult always has an outreach behind it.
      expect(isPreContactConsultResume([{ action: "outreach" }, { action: "counter" }, { action: "ask_user" }])).toBe(false);
    });
  });

  // ─── The Ashley shape, end to end ─────────────────────────────────────────

  it("turn 0 → parks input_required with the AUTHORED question, before any contact", async () => {
    const stubs = mkStubs();
    agentScript = [preContactAskUserTurn()];

    const result = await runGraph(stubs);

    // The pause is the only thing that happened: no outreach was drafted, so
    // the counterparty is never told this match was considered.
    expect(result.status).toBe("input_required");
    expect(stubs.createdMessages).toHaveLength(1);
    const parked = stubs.createdMessages[0].parts[0].data;
    expect(parked.action).toBe("ask_user");
    expect(stubs.createdMessages.map((m) => m.parts[0].data.action)).not.toContain("outreach");
    expect(stubs.stateWrites.filter((w) => w.state === "input_required")).toHaveLength(1);

    // Policy mode `on` ADMITS this draft rather than replacing it: the agent
    // is the only party that has read the client's own signal, and a turn-0
    // park has no transcript for the client to read instead of the question.
    expect(parked.askUser?.question).toEqual(ASHLEY_QUESTION);
    expect(parked.askUser?.reason).toBe("unresolved_owner_constraint");

    // The whole shipped consult loop rides unchanged.
    expect(stubs.expiryArms).toHaveLength(1);
    expect(stubs.questionerEnqueues).toHaveLength(1);
    expect(stubs.questionerEnqueues[0].mode).toBe("negotiation_inflight");
    expect(stubs.questionerEnqueues[0].purpose).toBe("inflight_consultation");
    expect(stubs.questionerEnqueues[0].negotiation).toMatchObject({
      recipientUserId: "u-src",
      recipientIntentId: "intent-src",
      opportunityId: "opp-1",
    });

    // The park carries the pre-contact stamp the per-signal cap counts on.
    const captured = stubs.askUserBindingCaptures[0];
    expect((captured.turnContext as Record<string, unknown>)[PRE_CONTACT_CONSULT_MARKER]).toBe(true);
  }, 30_000);

  it("the park classifies as inflight with a coherent binding (#1432)", async () => {
    const stubs = mkStubs();
    agentScript = [preContactAskUserTurn()];
    await runGraph(stubs);

    // Reconstruct the task exactly as `captureNegotiationAskUserBinding`
    // persists it: the supplied turnContext plus the binding it returns.
    const captured = stubs.askUserBindingCaptures[0];
    const parkedTask = {
      id: "task-new",
      conversationId: "conv-1",
      state: "input_required",
      metadata: {
        turnContext: {
          ...(captured.turnContext as Record<string, unknown>),
          askUserBinding: {
            settlementId: captured.settlementId,
            recipientUserId: captured.recipientUserId,
            recipientIntentId: captured.recipientIntentId,
            opportunityId: captured.opportunityId,
            networkId: captured.networkId,
          },
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const classification = await classifyParkedNegotiation({
      getNegotiationTaskForOpportunity: async () => parkedTask,
      getNegotiationMessages: async () => [],
    } as never, { opportunityId: "opp-1", userId: "u-src" });

    expect(classification.kind).toBe("inflight");
    expect(classification).toMatchObject({
      taskId: "task-new",
      binding: { recipientUserId: "u-src", recipientIntentId: "intent-src", opportunityId: "opp-1" },
    });

    // The other side's answer must never resume it.
    const otherSide = await classifyParkedNegotiation({
      getNegotiationTaskForOpportunity: async () => parkedTask,
      getNegotiationMessages: async () => [],
    } as never, { opportunityId: "opp-1", userId: "u-cand" });
    expect(otherSide.kind).toBe("wrong_recipient");
  }, 30_000);

  it("the answer resumes the opening decision and the outreach is grounded in it", async () => {
    const fixtures = resumeFixtures({
      kind: "answer",
      selectedOptions: ["Adjacent depth counts"],
      freeText: "adjacent depth counts — reach out",
    });
    const stubs = mkStubs({
      priorMessages: [turnMsg("u-src", preContactAskUserTurn(), 0)],
      exactTask: fixtures.exactTask,
      successorTask: fixtures.successorTask,
    });
    agentScript = [outreachTurn(), declineTurn()];

    const result = await runGraph(stubs, {
      resumeFromTaskId: "task-paused",
      continuationSettlementId: SETTLEMENT_ID,
      continuationExecution: fixtures.continuationExecution,
    });

    // Re-entered as a continuation of the SAME negotiation, on the fenced
    // successor — and `outreach` is legal there, so the opening still happens.
    expect(result.taskId).toBe("task-successor");
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("outreach");

    // The client's answer is what the re-taken decision reads.
    expect(agentInputs[0].privateConsultation).toMatchObject({
      recipientUserId: "u-src",
      freeText: "adjacent depth counts — reach out",
    });
    // It is still the opening: the seat has not spent its outreach yet. The
    // grant survives the resume because the principal's budget is a budget,
    // not a one-shot ration — one consult spent of QUESTION_BUDGET_PER_PRINCIPAL
    // leaves the rest.
    expect(agentInputs[0].isContinuation).toBe(true);
    expect(agentInputs[0].canAskUser).toBe(true);
    expect(agentInputs[0].questionsSpent).toBe(1);
    expect(agentInputs[0].history.map((t) => t.action)).toEqual(["ask_user"]);
  }, 30_000);

  // ─── Expiry resolves to today's behaviour: pass, never contacted ──────────

  it("an unanswered consult expires to a PASS, not to a reach-out", async () => {
    const fixtures = resumeFixtures({ kind: "timeout", selectedOptions: [] });
    const stubs = mkStubs({
      priorMessages: [turnMsg("u-src", preContactAskUserTurn(), 0)],
      exactTask: fixtures.exactTask,
      successorTask: fixtures.successorTask,
    });
    // No answer arrived; the agent falls back to the judgment it could not
    // resolve — the same refusal it would have made without consulting.
    agentScript = [plainTurn("withdraw", "cannot confirm scope; not worth Alice's attention")];

    const result = await runGraph(stubs, {
      resumeFromTaskId: "task-paused",
      continuationSettlementId: SETTLEMENT_ID,
      continuationExecution: fixtures.continuationExecution,
    });

    // The critical direction: the post-consult refusal is still an OPENING
    // refusal. No message is persisted at all — the counterparty never learns
    // the match existed — and the outcome is the quiet screen-out, exactly
    // what the unconsulted turn-0 refusal produces today.
    expect(stubs.createdMessages).toHaveLength(0);
    expect(result.outcome?.reason).toBe("screened_out");
    expect(result.outcome?.hasOpportunity).toBe(false);
    expect(result.outcome?.reasoning).toContain("cannot confirm scope");
  }, 30_000);

  it("a MID-FLIGHT consult resume keeps the post-consultation withdraw legitimate", async () => {
    // The exemption the pre-contact carve-out narrows must still hold where it
    // was written for: an outreach is on the table, so walking away from it is
    // a real move and belongs in the record.
    const fixtures = resumeFixtures({ kind: "answer", selectedOptions: ["drop it"] });
    const stubs = mkStubs({
      priorMessages: [
        turnMsg("u-src", plainTurn("outreach", "r", "hi"), 0),
        turnMsg("u-cand", plainTurn("counter", "r", "maybe"), 1),
        turnMsg("u-src", preContactAskUserTurn(), 2),
      ],
      exactTask: fixtures.exactTask,
      successorTask: fixtures.successorTask,
    });
    agentScript = [plainTurn("withdraw", "Alice said drop it")];

    const result = await runGraph(stubs, {
      resumeFromTaskId: "task-paused",
      continuationSettlementId: SETTLEMENT_ID,
      continuationExecution: fixtures.continuationExecution,
    });

    expect(stubs.createdMessages).toHaveLength(1);
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("withdraw");
    expect(result.outcome?.reason).not.toBe("screened_out");
  }, 30_000);

  // ─── Contradiction-shaped doubt does not consult ──────────────────────────

  it("a contradiction the evidence already settles passes silently — no park", async () => {
    const stubs = mkStubs();
    agentScript = [plainTurn("withdraw", "she is a dentist; nothing in the signal reaches this")];

    const result = await runGraph(stubs);

    expect(stubs.createdMessages).toHaveLength(0);
    expect(stubs.expiryArms).toEqual([]);
    expect(stubs.questionerEnqueues).toEqual([]);
    expect(stubs.askUserBindingCaptures).toEqual([]);
    expect(result.outcome?.reason).toBe("screened_out");
  }, 30_000);

  it("policy mode `on` never manufactures an opening consult from a draft that asked for something else", async () => {
    const stubs = mkStubs();
    // A turn-0 `question` is the mid-flight `unresolved_owner_constraint`
    // trigger. At the opening it must coerce to the opening action, not park:
    // the inferred categories need history to be a safe inference.
    agentScript = [plainTurn("question", "which stack?", "which stack?"), declineTurn()];

    await runGraph(stubs);

    expect(stubs.askUserBindingCaptures).toEqual([]);
    expect(stubs.expiryArms).toEqual([]);
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("outreach");
  }, 30_000);

  // ─── Per-signal bound ─────────────────────────────────────────────────────

  describe("per-signal open-consult cap", () => {
    it("counts only OPEN pre-contact parks for the exact recipient pair", () => {
      const rows = [
        parkedTaskRow("t1", "u-src", "intent-src"),
        parkedTaskRow("t2", "u-src", "intent-src"),
        // Another signal, another user, a mid-flight park, and the acting task.
        parkedTaskRow("t3", "u-src", "intent-other"),
        parkedTaskRow("t4", "u-cand", "intent-src"),
        parkedTaskRow("t5", "u-src", "intent-src", { preContact: false }),
        parkedTaskRow("t6", "u-src", "intent-src"),
        { ...parkedTaskRow("t7", "u-src", "intent-src"), state: "completed" },
      ];
      expect(countOpenPreContactConsults(rows, { userId: "u-src", intentId: "intent-src", excludeTaskId: "t6" })).toBe(2);
    });

    it("withholds the verdict once the signal holds the cap, and coerces an ask_user draft", async () => {
      const parkedTasks = Array.from({ length: MAX_OPEN_PRE_CONTACT_CONSULTS_PER_INTENT }, (_, i) =>
        parkedTaskRow(`parked-${i}`, "u-src", "intent-src"));
      const stubs = mkStubs({ parkedTasks });
      agentScript = [preContactAskUserTurn(), declineTurn()];

      await runGraph(stubs);

      expect(agentInputs[0].canAskUser).toBeUndefined();
      expect(stubs.askUserBindingCaptures).toEqual([]);
      expect(stubs.expiryArms).toEqual([]);
      // The seat falls back to today's binary: the malformed pause becomes the
      // opening action rather than entering the shared history.
      expect(stubs.createdMessages[0].parts[0].data.action).toBe("outreach");
    }, 30_000);

    it("still grants the verdict one park below the cap", async () => {
      const parkedTasks = Array.from({ length: MAX_OPEN_PRE_CONTACT_CONSULTS_PER_INTENT - 1 }, (_, i) =>
        parkedTaskRow(`parked-${i}`, "u-src", "intent-src"));
      const stubs = mkStubs({ parkedTasks });
      agentScript = [preContactAskUserTurn()];

      await runGraph(stubs);

      expect(agentInputs[0].canAskUser).toBe(true);
      expect(stubs.askUserBindingCaptures).toHaveLength(1);
    }, 30_000);
  });

  // ─── Prompt: the verdict is base seat-level, stances only lean ────────────

  describe("turn-0 prompt guidance", () => {
    class Capturing extends IndexNegotiator {
      prompt = "";
      constructor() { super({ turnTimeoutMs: 1000 }); }
      /**
       * The file-wide `beforeAll` replaces `invoke` with the scripted graph
       * stub; these tests need the REAL prompt builder, so they call through
       * to the saved original and capture at the `callModel` seam instead.
       */
      override invoke(input: NegotiationAgentInput) {
        return origAgentInvoke.call(this, input);
      }
      protected override async callModel(_model: unknown, chatMessages: Array<{ role: string; content: string }>) {
        this.prompt = chatMessages[0].content;
        return { action: "outreach", assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null };
      }
    }

    const promptInput = (over: Partial<NegotiationAgentInput> = {}): NegotiationAgentInput => ({
      ownUser: { id: "u-src", intents: [{ id: "i-1", title: "t", description: "d", confidence: 1 }], profile: { name: "Alice" } },
      otherUser: { id: "u-cand", intents: [{ id: "i-2", title: "t", description: "d", confidence: 1 }], profile: { name: "Bob" } },
      indexContext: { networkId: "net-1" },
      seedAssessment: { reasoning: "seed", valencyRole: "peer" },
      history: [],
      seat: "initiator",
      protocolVersion: "v2",
      ...over,
    });

    async function render(input: NegotiationAgentInput): Promise<string> {
      const agent = new Capturing();
      await agent.invoke(input);
      return agent.prompt;
    }

    it("renders the third verdict on a granted opening initiator turn", async () => {
      const prompt = await render(promptInput({ canAskUser: true }));
      expect(prompt).toContain('BEFORE ANY CONTACT, "ask_user" is a THIRD verdict');
      expect(prompt).toContain("the counterparty is never told this match was considered");
      // The line the admission policy cannot draw itself.
      expect(prompt).toContain("A contradiction is yours to judge");
    });

    it.each([
      ["no grant", promptInput()],
      ["mid-exchange", promptInput({ canAskUser: true, history: [{ action: "outreach", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: "hi" }] })],
      ["a continuation", promptInput({ canAskUser: true, isContinuation: true })],
      ["the counterparty seat", promptInput({ canAskUser: true, seat: "counterparty" })],
      ["a final turn", promptInput({ canAskUser: true, isFinalTurn: true })],
    ] as Array<[string, NegotiationAgentInput]>)("does not render it for %s", async (_label, input) => {
      expect(await render(input)).not.toContain("BEFORE ANY CONTACT");
    });

    it("keeps the base seat-level rule verbatim and only leans on top of it", async () => {
      const marker = 'BEFORE ANY CONTACT, "ask_user" is a THIRD verdict';
      const prompt = await render(promptInput({ canAskUser: true }));
      expect(prompt).toContain(marker);
      const rule = prompt.slice(prompt.indexOf(marker));

      // The base rule survives verbatim — every bullet of it, including the
      // one that bounds the verdict. The stance text is INSERTED after it
      // rather than replacing any of it.
      expect(rule).toContain("Nothing has been sent and nothing is sent while you wait");
      expect(rule).toContain("Do NOT use it when the evidence in front of you already decides");
      // Under the checklist protocol a dimension that is unknown and the
      // client's own to settle is a pre-contact question too (plan §3), which
      // the base rule — written for #1445, before the checklist existed —
      // scopes to the signal's wording.
      //
      // The asymmetry this fixes: with the responding seat no longer closing
      // over an open dimension, it parks and asks its own principal on turn 1,
      // so the initiating side never reaches a later turn on which it could
      // ask its client anything. Turn 0 is its only chance.
      expect(rule).toContain("whether the ANSWER would still hold for the next candidate");
      // And the base rule's safety test survives: a question whose answer is
      // only about this one candidate stays the agent's to judge.
      expect(rule).toContain("it is yours to judge, not theirs");
      // The lean sits on top.
      expect(rule).toContain("lean toward asking rather than passing");
    });
  });

  // ─── Turn-0 coercion still does its original job ──────────────────────────

  it("still coerces a malformed opening, on the fresh turn and on the pre-contact resume", async () => {
    const fresh = mkStubs();
    agentScript = [plainTurn("counter", "hmm", "hmm"), declineTurn()];
    await runGraph(fresh);
    expect(fresh.createdMessages[0].parts[0].data.action).toBe("outreach");

    // On the resume the same rule applies: nothing was ever sent, so a
    // `counter` there would make the counterparty's first sight of this match
    // a mid-exchange reply.
    const fixtures = resumeFixtures({ kind: "answer", selectedOptions: ["in scope"] });
    const resumed = mkStubs({
      priorMessages: [turnMsg("u-src", preContactAskUserTurn(), 0)],
      exactTask: fixtures.exactTask,
      successorTask: fixtures.successorTask,
    });
    agentInputs = [];
    agentScript = [plainTurn("counter", "hmm", "hmm"), declineTurn()];
    await runGraph(resumed, {
      resumeFromTaskId: "task-paused",
      continuationSettlementId: SETTLEMENT_ID,
      continuationExecution: fixtures.continuationExecution,
    });
    expect(resumed.createdMessages[0].parts[0].data.action).toBe("outreach");
  }, 30_000);
});
