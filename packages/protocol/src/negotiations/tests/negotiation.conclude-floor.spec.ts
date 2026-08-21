import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";

import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NegotiationStallGapAuthor } from "../negotiation.stall-gap.js";
import { askableUnknowns, assessAskAdmissibility, assessConcludeAdmissibility, type ChecklistDraftItem, type ChecklistItem } from "../negotiation.checklist.contracts.js";
import type { NegotiationTurn } from "../negotiation.state.js";
import type { QuestionerEnqueuePayload } from "../../questions/question.input.js";
import { requestContext } from "../../shared/observability/request-context.js";
import { stubScreenerReachOut } from "./screen.stub.js";

/**
 * The conclusion floor: an askable unknown outranks a verdict, and when the
 * model refuses the door anyway the graph fires the question itself.
 *
 * The failure this pins is not a bug in one negotiation. A week of live
 * traffic produced ZERO `ask_user` turns against 23 policy-recognized
 * consultation moments: every agent that hit a dimension it had itself scored
 * `unknown` found a cheaper move than asking — assume it away and accept,
 * interrogate the counterparty who does not hold the answer, or conclude and
 * be done. The verdict rule has said "an unknown is not a reason to end
 * anything" since the checklist shipped. The prompt lost, exactly as it lost on
 * the decline (#1463).
 *
 * So the choice stops being the model's:
 *
 *  - a drafted TERMINAL verdict is refused while an askable unknown stands,
 *    and the turn is re-issued once with those dimensions named,
 *  - a re-issue that asks is the outcome the floor exists to produce, and it
 *    parks through the ordinary admission path,
 *  - a turn that STILL leaves the arrow unfired is coerced into an ask the
 *    graph authors from the dimension — once per negotiation per principal,
 *  - and every escape the floor has is a real one: a spent budget, an
 *    unreachable principal, a settled checklist and the final turn all leave
 *    the verdict exactly where it is today.
 *
 * Harness mirrors `negotiation.copy-loop.spec.ts`: stubbed database and
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

/** The same, with the authoring agent's declaration of whose fact it is. */
const owned = (
  name: string,
  kind: ChecklistDraftItem["kind"],
  result: ChecklistDraftItem["result"],
  settles: ChecklistItem["settles"],
  basis = "",
): ChecklistDraftItem => ({ name, kind, result, basis, settles });

/** One dimension scored, two open — and nothing in conflict. */
const OPEN_CHECKLIST: ChecklistDraftItem[] = [
  dimension("Mutual want", "mutual_want", "ok", "Alice's intent seeks an ML engineer; Bob's seeks applied ML work"),
  dimension("Studio operations", "fit", "unknown"),
  dimension("Stage fit", "fit", "unknown"),
];

/** The same three, all scored, nothing left to ask about. */
const SETTLED_CHECKLIST: ChecklistDraftItem[] = [
  dimension("Mutual want", "mutual_want", "ok", "Alice's intent seeks an ML engineer; Bob's seeks applied ML work"),
  dimension("Studio operations", "fit", "ok", "Bob's intent names studio tooling work"),
  dimension("Stage fit", "fit", "ok", "Bob's intent names early-stage product work"),
];

/**
 * The live incident, as a checklist. Both open dimensions are about what the
 * COUNTERPARTY works on, and the agent's drafted `question` to their agent was
 * the protocol's own prescribed move.
 */
const COUNTERPARTY_CHECKLIST: ChecklistDraftItem[] = [
  owned("Query match: story games", "hard_constraint", "unknown", "counterparty"),
  owned("Query match: live ops", "hard_constraint", "unknown", "counterparty"),
  owned("Mutual want", "mutual_want", "ok", "either", "Alice's intent seeks an ML engineer; Bob's seeks applied ML work"),
];

/** The same, with one dimension that IS the client's — deliberately last. */
const MIXED_CHECKLIST: ChecklistDraftItem[] = [
  ...COUNTERPARTY_CHECKLIST,
  owned("Timing", "fit", "unknown", "client"),
];

const ANSWERHOOD = { ok_when: "Alice says a studio background is optional", conflict_when: "Alice says it is required" };
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

const askTurn = (
  askUser: Record<string, unknown>,
  checklist: ChecklistDraftItem[] = OPEN_CHECKLIST,
) => turn("ask_user", "one unknown stands between me and a verdict", {
  askUser: askUser as NegotiationTurn["askUser"],
  checklist,
} as Partial<NegotiationTurn>);

const OPENING = "Alice is hiring an ML engineer with studio operations experience.";

/** A persisted message row, as the graph's own readers expect to find one. */
const turnMsg = (userId: string, data: NegotiationTurn, index: number): FakeMessage => ({
  id: `prior-${index}`,
  senderId: `agent:${userId}`,
  role: "agent",
  parts: [{ kind: "data", data }],
  createdAt: new Date(Date.now() + index),
});

function mkStubs(opts?: { priorMessages?: FakeMessage[]; unreachableUserIds?: string[] }) {
  const createdMessages: Array<{ senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }> = [];
  const stateWrites: Array<{ taskId: string; state: string }> = [];
  const opportunityStatuses: string[] = [];

  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string) => ({ id: "task-new", conversationId, state: "submitted" }),
    updateOpportunityStatus: async (_id: string, status: string) => { opportunityStatuses.push(status); },
    createMessage: async (p: { senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }) => {
      createdMessages.push(p);
      return { id: `msg-${createdMessages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async (taskId: string, state: string) => { stateWrites.push({ taskId, state }); },
    createArtifact: async () => ({ id: "art-1" }),
    setTaskTurnContext: async () => {},
    captureNegotiationAskUserBinding: async (input: Record<string, unknown>) => ({
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
    }),
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
    unreachableUserIds: opts?.unreachableUserIds ?? [],
  };
}

/** Every wide trace event the run emitted. */
let traceEvents: Array<Record<string, unknown>> = [];

async function runGraph(stubs: ReturnType<typeof mkStubs>, input: Record<string, unknown> = {}) {
  const graph = new NegotiationGraphFactory(
    stubs.database, stubs.dispatcher, stubs.timeoutQueue, stubs.questionerEnqueue,
  ).createGraph();
  const unreachable = (userId: string) =>
    stubs.unreachableUserIds.includes(userId) ? { principalUnreachable: true } : {};
  const invocation = () => graph.invoke({
    sourceUser: {
      id: "u-src",
      intents: [{ id: "intent-src", title: "Hire an ML engineer", description: "Looking for applied ML depth", confidence: 1 }],
      profile: { name: "Alice", bio: "PM", skills: ["evals"] },
      ...unreachable("u-src"),
    },
    candidateUser: {
      id: "u-cand",
      intents: [{ id: "intent-cand", title: "Join an AI product", description: "Wants applied ML work", confidence: 1 }],
      profile: { name: "Bob", bio: "ML engineer", skills: ["ml"] },
      ...unreachable("u-cand"),
    },
    sourceIntentId: "intent-src",
    candidateIntentId: "intent-cand",
    indexContext: { networkId: "net-1", prompt: "AI network" },
    seedAssessment: { reasoning: "complementary", valencyRole: "peer" },
    opportunityId: "opp-1",
    maxTurns: 6,
    ...input,
  } as Partial<typeof NegotiationGraphState.State>);
  return requestContext.run(
    { traceEmitter: ((event: Record<string, unknown>) => { traceEvents.push(event); }) as never },
    invocation,
  );
}

function persistedActions(stubs: ReturnType<typeof mkStubs>) {
  return stubs.createdMessages.map((message) => message.parts[0].data.action);
}

function persistedTurns(stubs: ReturnType<typeof mkStubs>) {
  return stubs.createdMessages.map((message) => message.parts[0].data);
}

function parkedCount(stubs: ReturnType<typeof mkStubs>) {
  return stubs.stateWrites.filter((write) => write.state === "input_required").length;
}

function tracesOfType(type: string) {
  return traceEvents.filter((event) => event.type === type);
}

let agentInputs: NegotiationAgentInput[] = [];
let agentScript: NegotiationTurn[] = [];

// ─── The contract, as a condition table ──────────────────────────────────────

// The outreach screen runs before first contact on every negotiation; stub it
// so these cases exercise the turns they are about rather than a live model.
const restoreScreenStub = stubScreenerReachOut();
afterAll(() => { restoreScreenStub(); });

describe("what makes an unknown askable", () => {
  const authored = OPEN_CHECKLIST as ChecklistItem[];

  it("refuses a verdict while an unasked unknown stands, and names the dimensions", () => {
    expect(assessConcludeAdmissibility({
      checklist: authored,
      askedDimensions: [],
      askUserAvailable: true,
    })).toEqual({
      admissible: false,
      reason: "unknowns_askable",
      unknowns: ["Studio operations", "Stage fit"],
    });
  });

  it("admits the verdict the moment the ask channel is down — a spent budget, an unreachable principal, the final turn", () => {
    // Every one of those conditions is already folded into the single boolean
    // the turn node computes; the contract's job is to honour it rather than
    // to re-derive it, so one case covers all of them.
    expect(assessConcludeAdmissibility({
      checklist: authored,
      askedDimensions: [],
      askUserAvailable: false,
    })).toEqual({ admissible: true });
  });

  it("admits the verdict when every unknown has already been asked about", () => {
    expect(assessConcludeAdmissibility({
      checklist: authored,
      // Topic identity is the dimension, case- and whitespace-insensitive.
      askedDimensions: ["  studio OPERATIONS ", "Stage fit"],
      askUserAvailable: true,
    })).toEqual({ admissible: true });
  });

  it("admits the verdict over a checklist with nothing unknown on it", () => {
    expect(assessConcludeAdmissibility({
      checklist: SETTLED_CHECKLIST as ChecklistItem[],
      askedDimensions: [],
      askUserAvailable: true,
    })).toEqual({ admissible: true });
  });

  it("fails open on an unauthored checklist — there is no law to have violated", () => {
    expect(assessConcludeAdmissibility({ checklist: [], askedDimensions: [], askUserAvailable: true }))
      .toEqual({ admissible: true });
    expect(assessConcludeAdmissibility({
      checklist: [dimension("Stage fit", "fit", "unknown")] as ChecklistItem[],
      askedDimensions: [],
      askUserAvailable: true,
    })).toEqual({ admissible: true });
  });

  it("takes a dimension the counterparty is the one to state out of the askable set", () => {
    // The incident, at the contract. "Askable" was `unknown ∧ unasked` and
    // nothing in it knew whose fact was missing, so a checklist whose open
    // dimensions were all about the COUNTERPARTY's work looked exactly like
    // one about the client's own timing.
    expect(askableUnknowns(COUNTERPARTY_CHECKLIST as ChecklistItem[], [])).toEqual([]);
    expect(assessConcludeAdmissibility({
      checklist: COUNTERPARTY_CHECKLIST as ChecklistItem[],
      askedDimensions: [],
      askUserAvailable: true,
    })).toEqual({ admissible: true });
  });

  it("picks the client's dimension over the counterparty's, whatever the authored order says", () => {
    // Order is still the checklist's own — among the dimensions that survive
    // the filter. The two counterparty-settled ones come FIRST here, which is
    // precisely how the live floor landed on one of them.
    expect(askableUnknowns(MIXED_CHECKLIST as ChecklistItem[], []).map((entry) => entry.name))
      .toEqual(["Timing"]);
  });

  it("keeps an unmarked or `either` dimension askable — no authoring failure switches the floor off", () => {
    // The direction the default is chosen in. A legacy checklist carries no
    // marking at all, and a repaired one carries `either`; both behave exactly
    // as they did before the field existed.
    const unmarked = [
      dimension("Mutual want", "mutual_want", "ok", "both intents state it"),
      dimension("Studio operations", "fit", "unknown"),
      owned("Stage fit", "fit", "unknown", "either"),
    ] as ChecklistItem[];
    expect(askableUnknowns(unmarked, []).map((entry) => entry.name))
      .toEqual(["Studio operations", "Stage fit"]);
  });

  it("refuses an agent's own ask about a dimension the counterparty is the one to state", () => {
    expect(assessAskAdmissibility({
      checklist: COUNTERPARTY_CHECKLIST as ChecklistItem[],
      dimension: "Query match: story games",
      answerhood: ANSWERHOOD,
      askedDimensions: [],
      questionsSpent: 0,
    })).toEqual({ admissible: false, reason: "counterparty_authoritative" });
  });

  it("keeps the checklist's own authored order — the frozen screen is not re-prioritized", () => {
    expect(askableUnknowns(authored, ["Studio operations"]).map((item) => item.name))
      .toEqual(["Stage fit"]);
    expect(askableUnknowns(authored, []).map((item) => item.name))
      .toEqual(["Studio operations", "Stage fit"]);
  });
});

// ─── The floor at the turn seam ──────────────────────────────────────────────

describe("the conclusion floor at the turn seam", () => {
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
    traceEvents = [];
  });


  // THE DECISIVE SPEC. Everything else here is a boundary on this one.
  it("refuses a premature accept, re-issues the turn, and lets the re-issued ask park", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      // The observed shape: a match closed while two dimensions this very turn
      // scored `unknown` were still open, still the client's own to settle,
      // and still unasked.
      turn("accept", "good enough to meet on", { checklist: OPEN_CHECKLIST } as Partial<NegotiationTurn>),
      // Told concluding is not available, the agent asks — which is the entire
      // point of the floor, and the turn the live system never once produced.
      askTurn({
        reason: "unresolved_owner_constraint",
        question: QUESTION,
        dimension: "Studio operations",
        answerhood: ANSWERHOOD,
      }),
    ];
    await runGraph(stubs);

    // The premature accept never reached the record; the ask did.
    expect(persistedActions(stubs)).toEqual(["outreach", "ask_user"]);
    expect(parkedCount(stubs)).toBe(1);

    // Exactly one extra draft, and it was told which dimensions were open.
    expect(agentInputs).toHaveLength(3);
    expect(agentInputs[1].concludeFloor).toBeUndefined();
    expect(agentInputs[2].concludeFloor).toEqual({ askableDimensions: ["Studio operations", "Stage fit"] });
    // Still the SAME turn: same seat, same history, no turn spent on it.
    expect(agentInputs[2].seat).toBe(agentInputs[1].seat);
    expect(agentInputs[2].history).toHaveLength(agentInputs[1].history.length);

    // The re-issued ask went through the ORDINARY admission and park path —
    // the agent's own question and answerhood survive, and the questioner was
    // enqueued against the parked side's exact binding.
    const parked = persistedTurns(stubs)[1];
    expect(parked.askUser!.question).toEqual(QUESTION);
    expect(parked.askUser!.answerhood).toEqual(ANSWERHOOD);
    // Not a graph-authored ask: the agent wrote this one.
    expect(parked.askUser!.guaranteed).toBeUndefined();
    expect(stubs.questionerEnqueues).toHaveLength(1);
    expect(stubs.questionerEnqueues[0].negotiation.recipientUserId).toBe("u-cand");

    // And the dimension travels to whatever authors the client-facing question.
    const context = stubs.questionerEnqueues[0].context as Record<string, unknown>;
    expect(context.dimension).toEqual({
      name: "Studio operations",
      kind: "fit",
      answerhood: ANSWERHOOD,
    });

    // The premature verdict is a readable fact about the run, not something an
    // investigation has to reconstruct from the checklist.
    expect(tracesOfType("negotiation_conclude_premature")).toHaveLength(1);
    expect(tracesOfType("negotiation_conclude_premature")[0]).toMatchObject({
      action: "accept",
      reason: "unknowns_askable",
      unknowns: ["Studio operations", "Stage fit"],
    });
  });

  it("fires the ask itself when the re-issue concludes again — the guarantee", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      turn("accept", "good enough to meet on", { checklist: OPEN_CHECKLIST } as Partial<NegotiationTurn>),
      // Named the open dimensions and told concluding is unavailable, it
      // concludes anyway. This is the behaviour a week of traffic showed.
      turn("accept", "still good enough", { checklist: OPEN_CHECKLIST } as Partial<NegotiationTurn>),
    ];
    await runGraph(stubs);

    // No accept was persisted: the arrow fired instead.
    expect(persistedActions(stubs)).toEqual(["outreach", "ask_user"]);
    expect(parkedCount(stubs)).toBe(1);
    expect(stubs.opportunityStatuses).not.toContain("accepted");

    const parked = persistedTurns(stubs)[1];
    expect(parked.askUser).toEqual({
      reason: "unresolved_owner_constraint",
      dimension: "Studio operations",
      guaranteed: true,
    });
    // The terminal message is dropped with the action it belonged to: it was
    // written to end the negotiation, and carried onto an ask it would announce
    // a verdict the record does not contain.
    expect(parked.message).toBeNull();

    // Traced with the dimension it fired on.
    expect(tracesOfType("negotiation_ask_guaranteed")).toHaveLength(1);
    expect(tracesOfType("negotiation_ask_guaranteed")[0]).toMatchObject({
      draftedAction: "accept",
      dimension: "Studio operations",
    });

    // The questioner payload carries the dimension — this is what makes the
    // delivered question a question about "Studio operations" rather than the
    // pre-#1455 "would you be open to connecting?".
    expect(stubs.questionerEnqueues).toHaveLength(1);
    const context = stubs.questionerEnqueues[0].context as Record<string, unknown>;
    expect(context.dimension).toEqual({
      name: "Studio operations",
      kind: "fit",
      guaranteed: true,
    });
  });

  it("fires on a non-terminal dodge too, and exactly once per negotiation per principal", async () => {
    // The counterparty has already been guaranteed an ask about "Studio
    // operations" earlier in this negotiation — the durable mark rides on the
    // persisted turn, so a resumed run reads it back the same way.
    const prior = [
      turnMsg("u-src", said("outreach", OPENING), 0),
      turnMsg("u-cand", turn("ask_user", "graph-fired", {
        checklist: OPEN_CHECKLIST,
        askUser: { reason: "unresolved_owner_constraint", dimension: "Studio operations", guaranteed: true },
      } as Partial<NegotiationTurn>), 1),
      turnMsg("u-src", said("counter", "here is more colour"), 2),
    ];
    const stubs = mkStubs({ priorMessages: prior });
    agentScript = [
      // The counterparty speaks next. "Stage fit" is still unknown, still
      // unasked, and the seat drafts a counter rather than the question — but
      // its one guarantee is already spent, so this does NOT double-park.
      said("counter", "let me push back once more"),
      // The initiator then scores everything and closes, so the run ends here
      // rather than walking into the OTHER principal's own untouched guarantee
      // — which is a different seat's budget and not what this pins.
      turn("accept", "fine", { checklist: SETTLED_CHECKLIST } as Partial<NegotiationTurn>),
    ];
    await runGraph(stubs, { isContinuation: true });

    expect(persistedActions(stubs)).toEqual(["counter", "accept"]);
    expect(parkedCount(stubs)).toBe(0);
    expect(tracesOfType("negotiation_ask_guaranteed")).toHaveLength(0);
  });

  it("fires once on the first non-terminal dodge when the guarantee is unspent", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      // A counter that leaves both dimensions open. Nothing terminal is drafted
      // and no exit is taken — the agent simply keeps talking around the thing
      // only its client can settle.
      said("counter", "tell me more about the tooling side"),
    ];
    await runGraph(stubs);

    expect(persistedActions(stubs)).toEqual(["outreach", "ask_user"]);
    expect(parkedCount(stubs)).toBe(1);
    // The non-terminal message is NOT discarded: it is a real contribution to
    // the exchange, and the seat parks after making it instead of handing the
    // turn over.
    const parked = persistedTurns(stubs)[1];
    expect(parked.message).toBe("tell me more about the tooling side");
    expect(parked.askUser!.guaranteed).toBe(true);
    expect(parked.askUser!.dimension).toBe("Studio operations");
  });

  it("leaves an agent's own admissible ask completely alone", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      askTurn({
        reason: "unresolved_owner_constraint",
        question: QUESTION,
        dimension: "Stage fit",
        answerhood: ANSWERHOOD,
      }),
    ];
    await runGraph(stubs);

    expect(persistedActions(stubs)).toEqual(["outreach", "ask_user"]);
    const parked = persistedTurns(stubs)[1];
    expect(parked.askUser!.dimension).toBe("Stage fit");
    expect(parked.askUser!.guaranteed).toBeUndefined();
    expect(tracesOfType("negotiation_ask_guaranteed")).toHaveLength(0);
  });

  it("lets a verdict through the moment the budget is spent — the floor's own escape", async () => {
    // Three prior asks: this principal's whole budget, spent.
    const prior = [
      turnMsg("u-src", said("outreach", OPENING), 0),
      ...Array.from({ length: 3 }, (_unused, index) =>
        turnMsg("u-cand", turn("ask_user", "asking", {
          checklist: OPEN_CHECKLIST,
          askUser: { reason: "unresolved_owner_constraint", dimension: `Spent ${index}`, answerhood: ANSWERHOOD },
        } as Partial<NegotiationTurn>), index + 1)),
    ];
    const stubs = mkStubs({ priorMessages: prior });
    agentScript = [turn("accept", "budget spent; the rest is for the meeting", { checklist: OPEN_CHECKLIST } as Partial<NegotiationTurn>)];
    await runGraph(stubs, { isContinuation: true, maxTurns: 8 });

    // The accept stands, with its unknowns carried into the meeting — which is
    // exactly what the verdict rule has always said a spent budget means.
    expect(persistedActions(stubs)).toEqual(["accept"]);
    expect(parkedCount(stubs)).toBe(0);
    // One draft: no re-issue was asked for, and no ask was fired on its behalf.
    expect(agentInputs).toHaveLength(1);
    expect(tracesOfType("negotiation_conclude_premature")).toHaveLength(0);
    expect(tracesOfType("negotiation_ask_guaranteed")).toHaveLength(0);
  });

  it("is inert for an unreachable principal — #1459 keeps its corner", async () => {
    const stubs = mkStubs({ unreachableUserIds: ["u-src", "u-cand"] });
    agentScript = [
      said("outreach", OPENING),
      turn("accept", "the record is all there will ever be", { checklist: OPEN_CHECKLIST } as Partial<NegotiationTurn>),
    ];
    await runGraph(stubs);

    // No question can be put and no answer can ever arrive, so the verdict is
    // the honest move and the floor stands aside.
    expect(persistedActions(stubs)).toEqual(["outreach", "accept"]);
    expect(parkedCount(stubs)).toBe(0);
    expect(stubs.questionerEnqueues).toHaveLength(0);
    expect(agentInputs).toHaveLength(2);
  });

  it("lets the final turn's forced verdict stand — the cap wins", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      // maxTurns 2 makes this the final turn: there is no room for a park and
      // an answer, so the ask channel is closed and the verdict is admissible.
      turn("accept", "out of turns", { checklist: OPEN_CHECKLIST } as Partial<NegotiationTurn>),
    ];
    const result = await runGraph(stubs, { maxTurns: 2 });

    expect(persistedActions(stubs)).toEqual(["outreach", "accept"]);
    expect(result.outcome?.hasOpportunity).toBe(true);
    expect(parkedCount(stubs)).toBe(0);
  }, 10_000);

  it("never binds the opening turn — the checklist is authored there, and an open dimension is what the protocol asked for", async () => {
    const stubs = mkStubs();
    agentScript = [
      // Turn 0 authors the checklist with two dimensions the record does not
      // settle, which is exactly what the authoring instruction demands. A
      // floor that bound here would park every negotiation before contact.
      said("outreach", OPENING),
      turn("accept", "fine", { checklist: SETTLED_CHECKLIST } as Partial<NegotiationTurn>),
    ];
    await runGraph(stubs);

    expect(persistedActions(stubs)[0]).toBe("outreach");
    expect(persistedTurns(stubs)[0].askUser).toBeUndefined();
  });

  // ─── The authority half: whose fact the open dimension is ────────────────
  // Observed live, sandbox, task 3c151027: turn 2, initiator seat. Both open
  // dimensions were about what the COUNTERPARTY works on, the agent drafted
  // `question` to their agent — the protocol's own prescribed move — and the
  // floor read a non-ask turn with an unknown standing, picked askable[0], and
  // asked the client in her own DM whether the other person works on
  // generative story games.

  it("does not fire on a `question` turn whose open dimensions are the counterparty's to state", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING, COUNTERPARTY_CHECKLIST),
      // The incident's turn, exactly: a question routed to the other agent
      // about a fact only the other side holds.
      said("question", "does your client work on live-ops titles?", COUNTERPARTY_CHECKLIST),
    ];
    await runGraph(stubs);

    // The question turn persists untouched. No ask, no park, no coercion.
    expect(persistedActions(stubs)).toEqual(["outreach", "question"]);
    expect(persistedTurns(stubs)[1].message).toBe("does your client work on live-ops titles?");
    expect(persistedTurns(stubs)[1].askUser).toBeUndefined();
    expect(parkedCount(stubs)).toBe(0);
    expect(stubs.questionerEnqueues).toHaveLength(0);
    expect(tracesOfType("negotiation_ask_guaranteed")).toHaveLength(0);
  });

  it("fires on the CLIENT's dimension, never on askable[0] by authored order alone", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING, MIXED_CHECKLIST),
      // Same dodge, but this checklist does hold one dimension the client can
      // settle — and it is the LAST one. Order still decides among the
      // dimensions that survive the filter; it no longer decides across it.
      said("counter", "let me push on the tooling side", MIXED_CHECKLIST),
    ];
    await runGraph(stubs);

    expect(persistedActions(stubs)).toEqual(["outreach", "ask_user"]);
    expect(parkedCount(stubs)).toBe(1);
    const parked = persistedTurns(stubs)[1];
    expect(parked.askUser).toEqual({
      reason: "unresolved_owner_constraint",
      dimension: "Timing",
      guaranteed: true,
    });
    expect(tracesOfType("negotiation_ask_guaranteed")[0]).toMatchObject({ dimension: "Timing" });
  });

  it("admits a verdict whose only unknowns are the counterparty's to state — that is dialogue's job", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING, COUNTERPARTY_CHECKLIST),
      turn("accept", "their agent could not settle it; it will keep", {
        checklist: COUNTERPARTY_CHECKLIST,
      } as Partial<NegotiationTurn>),
    ];
    await runGraph(stubs);

    // No re-issue, no guaranteed ask: an unknown nobody here can answer is
    // carried, which is what the verdict law has always said about unknowns.
    expect(persistedActions(stubs)).toEqual(["outreach", "accept"]);
    expect(agentInputs).toHaveLength(2);
    expect(tracesOfType("negotiation_conclude_premature")).toHaveLength(0);
    expect(tracesOfType("negotiation_ask_guaranteed")).toHaveLength(0);
    expect(parkedCount(stubs)).toBe(0);
  });

  it("refuses an agent's own ask about a counterparty-settled dimension, and names the reason", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING, COUNTERPARTY_CHECKLIST),
      // The mirror image, and the reason the marking binds in both directions:
      // an agent that drafts the wrong ask is refused by the same field that
      // keeps the floor from manufacturing it.
      askTurn({
        reason: "unresolved_owner_constraint",
        question: QUESTION,
        dimension: "Query match: story games",
        answerhood: ANSWERHOOD,
      }, COUNTERPARTY_CHECKLIST),
    ];
    await runGraph(stubs);

    expect(persistedActions(stubs)[1]).not.toBe("ask_user");
    expect(parkedCount(stubs)).toBe(0);
    expect(tracesOfType("negotiation_ask_inadmissible")).toHaveLength(1);
    expect(tracesOfType("negotiation_ask_inadmissible")[0]).toMatchObject({
      reason: "counterparty_authoritative",
    });
  });

  it("refuses to let an agent claim the graph's guarantee mark for itself", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      // A draft that stamps its own ask as graph-fired would retire its seat's
      // guarantee for the rest of the negotiation. The mark is the graph's.
      askTurn({
        reason: "unresolved_owner_constraint",
        question: QUESTION,
        dimension: "Stage fit",
        answerhood: ANSWERHOOD,
        guaranteed: true,
      }),
    ];
    await runGraph(stubs);

    expect(persistedTurns(stubs)[1].askUser!.guaranteed).toBeUndefined();
  });
});

/**
 * The prompt half, at the agent seam. `CapturingNegotiator` mirrors
 * `negotiation.copy-loop.spec.ts`: the `callModel` seam, no live provider.
 */
class CapturingNegotiator extends IndexNegotiator {
  calls = 0;
  systemPrompts: string[] = [];
  userMessages: string[] = [];
  constructor(private outputs: unknown[]) {
    super({ turnTimeoutMs: 1000 });
  }
  protected override async callModel(
    _model: unknown,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    this.systemPrompts.push(chatMessages[0].content);
    this.userMessages.push(chatMessages[1].content);
    const out = this.outputs[Math.min(this.calls, this.outputs.length - 1)];
    this.calls += 1;
    return out;
  }
}

const counterOutput = {
  action: "counter",
  assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
  message: null,
};

const agentBaseInput: NegotiationAgentInput = {
  ownUser: { id: "u-init", intents: [], profile: { name: "Alice" } },
  otherUser: { id: "u-cp", intents: [], profile: { name: "Bob" } },
  indexContext: { networkId: "net-1", prompt: "" },
  seedAssessment: { reasoning: "seed", valencyRole: "peer" },
  history: [{
    action: "outreach",
    assessment: { reasoning: "worth a look", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
    message: OPENING,
  }],
  seat: "counterparty",
  protocolVersion: "v2",
};

describe("the prompt closes the hatch the floor exists to close", () => {
  async function promptFor(overrides: Partial<NegotiationAgentInput> = {}) {
    const agent = new CapturingNegotiator([counterOutput]);
    await agent.invoke({ ...agentBaseInput, ...overrides });
    return { system: agent.systemPrompts[0], user: agent.userMessages[0] };
  }

  it("makes 'the first conversation will settle it' conditional on the budget being spent", async () => {
    const { system } = await promptFor();
    // The leak the reference behaviour does not have: production's hatch was
    // unconditional, so any unknown could be waved through as something two
    // people settle when they meet.
    expect(system).toContain("A HATCH THAT ONLY OPENS ONCE ASKING IS OVER");
    expect(system).toContain("While budget remains and Alice is reachable, an unknown that is theirs to settle is ASKED before any verdict");
  });

  it("denies a basis to the reason the match was suggested, as it already denies one to a profile", async () => {
    const { system } = await promptFor();
    expect(system).toContain("The reason this match was suggested to you is not a commitment either");
  });

  it("names the open dimensions back on a floor re-issue, and leaves exactly two moves", async () => {
    const { user } = await promptFor({
      concludeFloor: { askableDimensions: ["Studio operations", "Stage fit"] },
    });
    expect(user).toContain("TRIED TO END THIS NEGOTIATION WHILE DIMENSIONS YOU SCORED UNKNOWN WERE STILL OPEN AND STILL ASKABLE");
    expect(user).toContain("- Studio operations");
    expect(user).toContain("- Stage fit");
    expect(user).toContain("Concluding is not available to you while that is true");
    // The two moves, and the provenance bar on the first of them.
    expect(user).toContain("Either SCORE it from something a principal actually STATED");
    expect(user).toContain("Or ASK Alice about the one that is theirs to settle");
    expect(user).toContain("is not a commitment and cannot score it");
    // Belt to the server's braces: the title cap is repaired if the model
    // ignores it, and stated here so it has less reason to. The re-issue is
    // where an agent that has never asked before writes its first question.
    expect(user).toContain("give it a title of at most 12 characters");
  });

  it("says nothing about concluding on an ordinary turn", async () => {
    const { user } = await promptFor();
    expect(user).not.toContain("STILL OPEN AND STILL ASKABLE");
  });

});
