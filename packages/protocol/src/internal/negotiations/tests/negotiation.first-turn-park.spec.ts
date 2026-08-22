import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";

import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState, SystemNegotiationTurnSchema, FinalNegotiationTurnSchema } from "../negotiation.state.js";
import { turnSchemaFor } from "../negotiation.protocol.js";
import { hasGuaranteedAsk } from "../negotiation.graph.shared.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NegotiationStallGapAuthor } from "../negotiation.stall-gap.js";
import type { ChecklistDraftItem } from "../negotiation.checklist.contracts.js";
import type { NegotiationTurn } from "../negotiation.state.js";
import type { QuestionerEnqueuePayload } from "../../questions/question.input.js";

/**
 * A task's FIRST turn can park.
 *
 * The ask-user binding capture locks the task row `state = 'working'` and
 * refuses anything else — the integrity fence that makes the captured marker
 * the only settlement coordinate the timeout/answer paths accept. But the graph
 * announced `working` only at the END of a completed turn, so on a task's first
 * turn the row still held its creation state (`submitted`) and the park died on
 * "Ask-user material binding is no longer valid" — after the turn was already on
 * the record, which makes the failure unretryable and stalls the opportunity.
 *
 * Latent since the turn-0 pre-contact consult shipped (#1455) and never hit,
 * because no first-turn ask was ever drafted. The conclusion floor (#1464) made
 * first-turn asks routine and the first one in this system's history died here.
 *
 * What this file pins is the sequencing, and the stub is the regression net:
 * `captureNegotiationAskUserBinding` here ASSERTS the task's state exactly as
 * the api adapter does, so a park that binds against a non-working task fails
 * the spec instead of passing it — which is why the twenty-five specs that
 * already cover this loop all missed the bug.
 *
 * Harness mirrors `negotiation.conclude-floor.spec.ts`: stubbed database and
 * dispatcher, scripted agent turns, no live provider.
 */

type FakeMessage = {
  id: string;
  senderId: string;
  role: "agent";
  parts: unknown[];
  createdAt: Date;
};

const dimension = (
  name: string,
  kind: ChecklistDraftItem["kind"],
  result: ChecklistDraftItem["result"],
  basis = "",
): ChecklistDraftItem => ({ name, kind, result, basis });

/** Two dimensions scored, one open and the client's own to settle. */
const OPEN_CHECKLIST: ChecklistDraftItem[] = [
  dimension("Mutual want", "mutual_want", "ok", "Alice's intent seeks an ML engineer; Bob's seeks applied ML work"),
  dimension("Studio operations experience", "fit", "unknown"),
  dimension("Stage fit", "fit", "ok", "Bob's intent names early-stage product work"),
];

const QUESTION = {
  title: "Studio operations",
  prompt: "Does the studio side have to be hands-on, or is adjacent tooling work in scope?",
  options: [
    { label: "Hands-on only", description: "I want someone who has run one." },
    { label: "Adjacent tooling is fine", description: "Building for studios counts." },
  ],
  multiSelect: false,
};

const turn = (
  action: string,
  reasoning: string,
  extra: Partial<NegotiationTurn> = {},
): NegotiationTurn => ({
  action,
  assessment: { reasoning, suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
  message: null,
  ...extra,
} as NegotiationTurn);

const said = (
  action: string,
  message: string,
  checklist: ChecklistDraftItem[] = OPEN_CHECKLIST,
) => turn(action, `${action} turn`, { message, checklist } as Partial<NegotiationTurn>);

/**
 * Built per use, never shared: the graph rewrites `turn.action` in place on the
 * object the agent returned, so a module-level fixture handed to two tests is
 * silently rewritten by the first one.
 */
const askTurn = (checklist: ChecklistDraftItem[] = OPEN_CHECKLIST): NegotiationTurn =>
  turn("ask_user", "one unknown stands between me and a verdict", {
    askUser: {
      reason: "unresolved_owner_constraint",
      question: QUESTION,
      dimension: "Studio operations experience",
    },
    checklist,
  } as Partial<NegotiationTurn>);

/**
 * A draft as it leaves the MODEL, before the generation schema has seen it.
 *
 * Every other turn in this file is scripted post-parse, which is exactly how
 * the observed failure escaped twenty-five specs: the schema seam was the thing
 * that broke, and no harness ran a draft through it. `parseDraft` below closes
 * that gap — it parses with the same schema `IndexNegotiator` binds for
 * structured output, so a draft this model would really have produced either
 * survives into the graph or fails the spec.
 */
const parseDraft = (raw: Record<string, unknown>): NegotiationTurn =>
  turnSchemaFor("v2", "initiator", false, {
    system: SystemNegotiationTurnSchema,
    final: FinalNegotiationTurnSchema,
  }, { askUser: true, checklist: true }).parse(raw) as NegotiationTurn;

const OPENING = "Alice is hiring an ML engineer with studio operations experience.";

/** A persisted message row, as the graph's own readers expect to find one. */
const turnMsg = (userId: string, data: NegotiationTurn, index: number): FakeMessage => ({
  id: `prior-${index}`,
  senderId: `agent:${userId}`,
  role: "agent",
  parts: [{ kind: "data", data }],
  createdAt: new Date(Date.now() + index),
});

/** The prior session this negotiation is resumed from — one outreach, on the record. */
const priorSession = (): FakeMessage[] => [turnMsg("u-src", said("outreach", OPENING), 0)];

function mkStubs(opts?: {
  priorMessages?: FakeMessage[];
  /** Fail the capture for a reason that is NOT the task state, to pin the failure path. */
  bindingAmbiguous?: boolean;
}) {
  const createdMessages: Array<{ senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }> = [];
  const stateWrites: Array<{ taskId: string; state: string }> = [];
  const opportunityStatuses: string[] = [];
  const failedTurns: Array<Record<string, unknown>> = [];
  /** The task rows this run touches, and the state each is actually in. */
  const taskStates = new Map<string, string>();
  /** The state each binding capture found the task in — the whole point of this file. */
  const captureStates: string[] = [];

  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string) => {
      // Tasks are created `submitted`; nothing else sets them working.
      taskStates.set("task-new", "submitted");
      return { id: "task-new", conversationId, state: "submitted" };
    },
    updateOpportunityStatus: async (_id: string, status: string) => { opportunityStatuses.push(status); },
    createMessage: async (p: { senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }) => {
      createdMessages.push(p);
      return { id: `msg-${createdMessages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async (taskId: string, state: string) => {
      taskStates.set(taskId, state);
      stateWrites.push({ taskId, state });
    },
    createArtifact: async () => ({ id: "art-1" }),
    setTaskTurnContext: async () => {},
    setTaskFailedTurns: async (_taskId: string, failures: Array<Record<string, unknown>>) => {
      failedTurns.splice(0, failedTurns.length, ...failures);
    },
    captureNegotiationAskUserBinding: async (input: Record<string, unknown>) => {
      const observed = taskStates.get(input.taskId as string) ?? "missing";
      captureStates.push(observed);
      // THE FENCE, as the api adapter enforces it: the capture selects the task
      // row `FOR UPDATE` with `state = 'working'` and throws when it finds no
      // such row. A stub that skips this check is why the loop's existing specs
      // never saw a first-turn park fail.
      if (observed !== "working") throw new Error("Ask-user material binding is no longer valid");
      if (opts?.bindingAmbiguous) throw new Error("Ask-user opportunity actor binding is ambiguous");
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
    getNegotiationTaskForOpportunity: async () => null,
    getLatestNegotiationTaskForConversation: async () => null,
    getTask: async () => null,
    getUserContext: async () => ({ text: "Alice builds AI startups" }),
    getTasksForUser: async () => [],
    getArtifactsForTask: async () => [],
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async () => ({ handled: false, reason: "no_agent" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  const timeoutQueue = {
    enqueueTimeout: async () => "job-1",
    cancelTimeout: async () => {},
    enqueueAskUserExpiry: async () => "askuser-job-1",
    cancelAskUserExpiry: async () => {},
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[2];

  const questionerEnqueues: QuestionerEnqueuePayload[] = [];
  const questionerEnqueue = async (input: QuestionerEnqueuePayload) => { questionerEnqueues.push(input); };

  return {
    database, dispatcher, timeoutQueue, questionerEnqueue,
    createdMessages, stateWrites, questionerEnqueues, opportunityStatuses,
    captureStates, failedTurns,
  };
}

async function runGraph(stubs: ReturnType<typeof mkStubs>, input: Record<string, unknown> = {}) {
  const graph = new NegotiationGraphFactory(
    stubs.database, stubs.dispatcher, stubs.timeoutQueue, stubs.questionerEnqueue,
  ).createGraph();
  return graph.invoke({
    sourceUser: {
      id: "u-src",
      intents: [{ id: "intent-src", title: "Hire an ML engineer", description: "Looking for applied ML depth", confidence: 1 }],
      profile: { name: "Alice", bio: "PM", skills: ["evals"] },
    },
    candidateUser: {
      id: "u-cand",
      intents: [{ id: "intent-cand", title: "Join an AI product", description: "Wants applied ML work", confidence: 1 }],
      profile: { name: "Bob", bio: "ML engineer", skills: ["ml"] },
    },
    sourceIntentId: "intent-src",
    candidateIntentId: "intent-cand",
    indexContext: { networkId: "net-1", prompt: "AI network" },
    seedAssessment: { reasoning: "complementary", valencyRole: "peer" },
    opportunityId: "opp-1",
    maxTurns: 6,
    ...input,
  } as Partial<typeof NegotiationGraphState.State>);
}

const persistedActions = (stubs: ReturnType<typeof mkStubs>) =>
  stubs.createdMessages.map((message) => message.parts[0].data.action);

const persistedTurns = (stubs: ReturnType<typeof mkStubs>) =>
  stubs.createdMessages.map((message) => message.parts[0].data);

const states = (stubs: ReturnType<typeof mkStubs>) => stubs.stateWrites.map((write) => write.state);

let agentInputs: NegotiationAgentInput[] = [];
let agentScript: NegotiationTurn[] = [];

// The outreach screen runs before first contact on every negotiation; stub it
// so these cases exercise the turns they are about rather than a live model.
describe("a first-turn ask parks", () => {
  let origAgentInvoke: typeof IndexNegotiator.prototype.invoke;
  let origStallGapAuthor: typeof NegotiationStallGapAuthor.prototype.author;

  beforeAll(() => {
    origAgentInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function (input: NegotiationAgentInput) {
      agentInputs.push(input);
      const next = agentScript.shift();
      if (!next) throw new Error("agent script exhausted");
      return next;
    };
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
  });


  // THE DECISIVE SPEC — the live shape, turn 0 of a resumed session.
  it("binds against a working task when the agent asks on its very first turn", async () => {
    const stubs = mkStubs({ priorMessages: priorSession() });
    agentScript = [askTurn()];

    await runGraph(stubs);

    // The capture found the task WORKING — before this fix it found `submitted`
    // and the park threw.
    expect(stubs.captureStates).toEqual(["working"]);
    // And the flip came before the capture, not after the turn.
    expect(states(stubs)).toEqual(["working", "input_required"]);
    expect(persistedActions(stubs)).toEqual(["ask_user"]);
    expect(stubs.questionerEnqueues).toHaveLength(1);
    expect(stubs.questionerEnqueues[0].negotiation.taskId).toBe("task-new");
    // Nothing was concluded on the client's behalf.
    expect(stubs.opportunityStatuses).not.toContain("rejected");
  });

  it("binds against a working task when the conclusion floor fires the ask itself on turn 0", async () => {
    const stubs = mkStubs({ priorMessages: priorSession() });
    // The observed shape: the resumed session's first turn concludes over an
    // open dimension, is refused, concludes again — and the graph asks.
    agentScript = [
      turn("accept", "good enough to meet on", { checklist: OPEN_CHECKLIST } as Partial<NegotiationTurn>),
      turn("accept", "still good enough", { checklist: OPEN_CHECKLIST } as Partial<NegotiationTurn>),
    ];

    await runGraph(stubs);

    expect(stubs.captureStates).toEqual(["working"]);
    expect(states(stubs)).toEqual(["working", "input_required"]);
    expect(persistedActions(stubs)).toEqual(["ask_user"]);
    const parked = persistedTurns(stubs)[0];
    expect(parked.askUser).toEqual({
      reason: "unresolved_owner_constraint",
      dimension: "Studio operations experience",
      guaranteed: true,
    });
    expect(stubs.questionerEnqueues).toHaveLength(1);
    expect(stubs.opportunityStatuses).not.toContain("accepted");
  });

  it("binds against a working task for the turn-0 pre-contact consult", async () => {
    // No prior turns at all: the initiator consults its client BEFORE reaching
    // out, on a task whose first turn this also is.
    const stubs = mkStubs();
    agentScript = [askTurn([])];

    await runGraph(stubs);

    expect(stubs.captureStates).toEqual(["working"]);
    expect(states(stubs)).toEqual(["working", "input_required"]);
    expect(persistedActions(stubs)).toEqual(["ask_user"]);
    expect(stubs.questionerEnqueues[0].negotiation.recipientUserId).toBe("u-src");
  });

  it("leaves a later-turn ask exactly as it was — the end-of-turn flip still runs", async () => {
    const stubs = mkStubs();
    agentScript = [said("outreach", OPENING), askTurn()];

    await runGraph(stubs);

    expect(persistedActions(stubs)).toEqual(["outreach", "ask_user"]);
    expect(stubs.captureStates).toEqual(["working"]);
    // The completed outreach turn's own flip, then the park's — same state
    // twice is a no-op update, and the second one is what the fence reads.
    expect(states(stubs)).toEqual(["working", "working", "input_required"]);
    expect(stubs.questionerEnqueues).toHaveLength(1);
  });

  // THE SCHEMA SEAM — the live shape as the MODEL produced it, not as a
  // scripted fixture. Gemini drafted the ask itself for the first time, filled
  // the visible optional `guaranteed` with `false`, and wrote a real
  // 40-character title. Both were refusals: the parse threw inside the
  // structured-output call, the turn failed with nothing persisted, the retry
  // was refused again, and the question was never delivered.
  it("parks on a draft the model really produced — long title, guaranteed: false", async () => {
    const stubs = mkStubs({ priorMessages: priorSession() });
    // `parseDraft` throws if the seam refuses this; that IS the regression net.
    agentScript = [parseDraft({
      action: "ask_user",
      assessment: { reasoning: "one unknown stands between me and a verdict", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
      message: null,
      checklist: OPEN_CHECKLIST,
      askUser: {
        reason: "unresolved_owner_constraint",
        dimension: "Studio operations experience",
        // The graph's own mark, claimed by the model. It is not a field the
        // generation schema offers, so the claim is simply not there after.
        guaranteed: false,
        answerhood: {
          ok_when: "Alice says adjacent tooling work counts",
          conflict_when: "Alice says the studio side has to be hands-on",
        },
        question: { ...QUESTION, title: "Studio operations experience requirement" },
      },
    })];

    await runGraph(stubs);

    // The turn lived: it reached the record, bound, and parked.
    expect(stubs.captureStates).toEqual(["working"]);
    expect(states(stubs)).toEqual(["working", "input_required"]);
    expect(persistedActions(stubs)).toEqual(["ask_user"]);
    expect(stubs.failedTurns).toHaveLength(0);
    expect(stubs.questionerEnqueues).toHaveLength(1);

    const parked = persistedTurns(stubs)[0];
    // The title was repaired toward deliverable, not rejected...
    expect(parked.askUser!.question!.title).toBe("Studio");
    expect(parked.askUser!.question!.prompt).toBe(QUESTION.prompt);
    // ...and the model's claim on the floor's mark never reached the record,
    // so this seat's guarantee is still its own to spend.
    expect(parked.askUser!.guaranteed).toBeUndefined();
    expect(hasGuaranteedAsk(
      stubs.createdMessages.map((m) => ({ senderId: m.senderId, parts: m.parts })),
      "u-src",
    )).toBe(false);
    expect(stubs.opportunityStatuses).not.toContain("rejected");
  });

  it("still fails the turn when the binding is genuinely invalid", async () => {
    // The fence is not loosened, only sequenced: a capture that fails for a
    // real reason still ends the turn as a failure rather than crashing the
    // graph or parking a negotiation nothing can settle.
    const stubs = mkStubs({ priorMessages: priorSession(), bindingAmbiguous: true });
    agentScript = [askTurn()];

    await runGraph(stubs);

    expect(stubs.captureStates).toEqual(["working"]);
    // No park state after the flip: the turn reached the record and then
    // failed, and finalize closed the task out as it does for any failed turn.
    expect(states(stubs)).toEqual(["working", "completed"]);
    expect(persistedActions(stubs)).toEqual(["ask_user"]);
    expect(stubs.questionerEnqueues).toHaveLength(0);
    expect(stubs.failedTurns).toHaveLength(1);
    expect(stubs.failedTurns[0].error).toBe("Ask-user opportunity actor binding is ambiguous");
  });
});
