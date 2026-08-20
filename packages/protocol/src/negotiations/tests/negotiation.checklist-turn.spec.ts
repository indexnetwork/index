import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NegotiationStallGapAuthor } from "../negotiation.stall-gap.js";
import { QUESTION_BUDGET_PER_PRINCIPAL, type ChecklistDraftItem } from "../negotiation.checklist.contracts.js";
import type { NegotiationTurn } from "../negotiation.state.js";
import type { QuestionerEnqueuePayload } from "../../questions/question.input.js";

/**
 * The checklist protocol at the graph seam
 * (docs/plans/2026-08-19-checklist-negotiations.md §2–§4).
 *
 * The contracts spec pins the rules as functions; this pins that the TURN NODE
 * is what applies them — because the alternative is a protocol that holds only
 * while the model cooperates:
 *
 *  - the checklist is authored once and persisted ON the turn, so the message
 *    record is its store and both seats score the same frozen dimensions,
 *  - a later draft that adds, drops or renames a dimension changes nothing,
 *  - an ask that fails admissibility is refused and the turn continues the
 *    dialogue instead of parking a question on the client,
 *  - the question budget is per principal and counts every flavour of park.
 *
 * Harness mirrors `negotiation.pre-contact-consult.spec.ts` — stubbed
 * database/dispatcher, scripted agent turns, no live provider.
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

const dimension = (
  name: string,
  kind: ChecklistDraftItem["kind"],
  result: ChecklistDraftItem["result"],
  basis = "",
): ChecklistDraftItem => ({ name, kind, result, basis });

const CHECKLIST: ChecklistDraftItem[] = [
  dimension("Mutual want", "mutual_want", "ok", "Alice's intent seeks an ML engineer; Bob's seeks applied ML work"),
  dimension("Location", "fit", "unknown"),
  dimension("Stage fit", "fit", "unknown"),
];

/**
 * The same three dimensions, all scored, one of them in conflict.
 *
 * Filler for the cases whose claim is about the FIRST turn only. The
 * conclusion floor refuses a terminal verdict while an askable unknown stands
 * and, failing that, fires the ask itself — so a filler turn left over the
 * frozen unknowns would park the negotiation and answer a question the test is
 * not asking. Scored and conflicted, the filler simply ends the negotiation and
 * the assertions read what they were written to read. The floor's own behaviour
 * is pinned in `negotiation.conclude-floor.spec.ts`.
 */
const SCORED_CHECKLIST: ChecklistDraftItem[] = [
  dimension("Mutual want", "mutual_want", "ok", "Alice's intent seeks an ML engineer; Bob's seeks applied ML work"),
  dimension("Location", "fit", "conflict", "Bob's intent states Berlin only; Alice's states remote"),
  dimension("Stage fit", "fit", "ok", "Bob's intent names early-stage product work"),
];

const ANSWERHOOD = { ok_when: "Alice says remote is fine", conflict_when: "Alice says Berlin only" };

const QUESTION = {
  title: "Location",
  prompt: "Does this search have to stay in Berlin, or is remote in scope?",
  options: [
    { label: "Berlin only", description: "I will hold out for people already there." },
    { label: "Remote is fine", description: "I will keep talking to strong people anywhere." },
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

const askTurn = (askUser: Record<string, unknown>, checklist: ChecklistDraftItem[] = CHECKLIST) =>
  turn("ask_user", "one unknown stands between me and the opening decision", {
    askUser: askUser as NegotiationTurn["askUser"],
    checklist,
  } as Partial<NegotiationTurn>);

function mkStubs(opts?: { priorMessages?: FakeMessage[] }) {
  const createdMessages: Array<{ senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }> = [];
  const stateWrites: Array<{ taskId: string; state: string }> = [];

  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string) => ({ id: "task-new", conversationId, state: "submitted" }),
    updateOpportunityStatus: async () => {},
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

  return { database, dispatcher, timeoutQueue, questionerEnqueue, createdMessages, stateWrites, questionerEnqueues };
}

async function runGraph(stubs: ReturnType<typeof mkStubs>, input: Record<string, unknown> = {}) {
  const graph = new NegotiationGraphFactory(
    stubs.database, stubs.dispatcher, stubs.timeoutQueue, stubs.questionerEnqueue,
  ).createGraph();
  return graph.invoke({
    sourceUser: { id: "u-src", intents: [{ id: "intent-src", title: "Hire an ML engineer", description: "Looking for applied ML depth", confidence: 1 }], profile: { name: "Alice", bio: "PM", skills: ["evals"] } },
    candidateUser: { id: "u-cand", intents: [{ id: "intent-cand", title: "Join an AI product", description: "Wants applied ML work", confidence: 1 }], profile: { name: "Bob", bio: "ML engineer", skills: ["ml"] } },
    sourceIntentId: "intent-src",
    candidateIntentId: "intent-cand",
    indexContext: { networkId: "net-1", prompt: "AI network" },
    seedAssessment: { reasoning: "complementary", valencyRole: "peer" },
    opportunityId: "opp-1",
    maxTurns: 4,
    ...input,
  } as Partial<typeof NegotiationGraphState.State>);
}

/** Every checklist persisted on a turn, in order. */
function persistedChecklists(stubs: ReturnType<typeof mkStubs>) {
  return stubs.createdMessages.map((message) => message.parts[0].data.checklist);
}

let agentInputs: NegotiationAgentInput[] = [];
let agentScript: NegotiationTurn[] = [];

describe("checklist protocol at the turn seam", () => {
  let origAgentInvoke: typeof IndexNegotiator.prototype.invoke;
  let origStallGapAuthor: typeof NegotiationStallGapAuthor.prototype.author;
  const originals: Record<string, string | undefined> = {};

  beforeAll(() => {
    origAgentInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function (input: NegotiationAgentInput) {
      agentInputs.push(input);
      const next = agentScript.shift();
      if (!next) throw new Error("agent script exhausted");
      return next;
    };
    // The post-stall park is a separate model call with its own ask_user
    // message; held to "no gap" so it cannot be mistaken for one of these.
    origStallGapAuthor = NegotiationStallGapAuthor.prototype.author;
    NegotiationStallGapAuthor.prototype.author = async function () { return null; };
    for (const key of ["NEGOTIATION_ASK_USER_ENABLED", "NEGOTIATION_CONSULTATION_POLICY_MODE", "NEGOTIATION_PROTOCOL_VERSION", "NEGOTIATION_SCREEN_MODE", "NEGOTIATOR_STANCE"]) {
      originals[key] = process.env[key];
    }
  });

  afterAll(() => {
    IndexNegotiator.prototype.invoke = origAgentInvoke;
    NegotiationStallGapAuthor.prototype.author = origStallGapAuthor;
  });

  beforeEach(() => {
    agentInputs = [];
    agentScript = [];
    // The dev configuration this ships into.
    process.env.NEGOTIATION_ASK_USER_ENABLED = "true";
    process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = "on";
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    process.env.NEGOTIATION_SCREEN_MODE = "off";
    process.env.NEGOTIATOR_STANCE = "skeptic";
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it("authors the checklist on the opening turn and persists it with the turn", async () => {
    const stubs = mkStubs();
    agentScript = [
      turn("outreach", "opening", { message: "hi", checklist: CHECKLIST } as Partial<NegotiationTurn>),
      turn("decline", "not for me"),
    ];
    await runGraph(stubs);

    // The opening turn saw no checklist — it is the turn that writes one.
    expect(agentInputs[0].checklist).toEqual([]);
    expect(agentInputs[0].questionsSpent).toBe(0);

    const persisted = persistedChecklists(stubs)[0]!;
    expect(persisted.map((entry) => entry.name)).toEqual(["Mutual want", "Location", "Stage fit"]);
    expect(persisted.find((entry) => entry.name === "Mutual want")!.result).toBe("ok");
    // And the responding seat scores the SAME frozen dimensions.
    expect(agentInputs[1].checklist!.map((entry) => entry.name)).toEqual(["Mutual want", "Location", "Stage fit"]);
  });

  it("freezes the dimensions: a later draft may re-score but not rewrite", async () => {
    const stubs = mkStubs();
    agentScript = [
      turn("outreach", "opening", { message: "hi", checklist: CHECKLIST } as Partial<NegotiationTurn>),
      turn("counter", "pushing back", {
        checklist: [
          // Re-scored — kept.
          dimension("Location", "fit", "ok", "Bob's profile says Berlin, Alice's intent says Berlin"),
          // Invented mid-flight — ignored.
          dimension("Ticket size", "hard_constraint", "conflict", "made up on turn 2"),
          // Dropped from the draft entirely — carried through unchanged.
        ],
      } as Partial<NegotiationTurn>),
      turn("withdraw", "done"),
    ];
    await runGraph(stubs);

    const second = persistedChecklists(stubs)[1]!;
    expect(second.map((entry) => entry.name)).toEqual(["Mutual want", "Location", "Stage fit"]);
    expect(second.find((entry) => entry.name === "Location")!.result).toBe("ok");
    expect(second.find((entry) => entry.name === "Stage fit")!.result).toBe("unknown");
    expect(second.some((entry) => entry.name === "Ticket size")).toBe(false);
  });

  it("drops an ok that cites no commitment back to unknown before it can conclude anything", async () => {
    const stubs = mkStubs();
    agentScript = [
      turn("outreach", "opening", {
        message: "hi",
        checklist: [
          dimension("Mutual want", "mutual_want", "ok", "both intents state it"),
          dimension("Location", "fit", "ok", "   "),
          dimension("Stage fit", "fit", "unknown"),
        ],
      } as Partial<NegotiationTurn>),
      turn("decline", "not for me"),
    ];
    await runGraph(stubs);

    const persisted = persistedChecklists(stubs)[0]!;
    const location = persisted.find((entry) => entry.name === "Location")!;
    expect(location.result).toBe("unknown");
    expect(location.basis).toBe("");
  });

  it("parks on an admissible ask, carrying the dimension and answerhood into the record", async () => {
    const stubs = mkStubs();
    agentScript = [askTurn({
      reason: "unresolved_owner_constraint",
      question: QUESTION,
      dimension: "Location",
      answerhood: ANSWERHOOD,
    })];
    await runGraph(stubs);

    expect(stubs.stateWrites.some((write) => write.state === "input_required")).toBe(true);
    const parked = stubs.createdMessages[0].parts[0].data;
    expect(parked.action).toBe("ask_user");
    expect(parked.askUser!.dimension).toBe("Location");
    expect(parked.askUser!.answerhood).toEqual(ANSWERHOOD);
    // The park carries the checklist it was decided from.
    expect(parked.checklist!.map((entry) => entry.name)).toContain("Location");
  });

  it.each([
    ["names no dimension", { reason: "unresolved_owner_constraint", question: QUESTION, answerhood: ANSWERHOOD }],
    ["names a dimension the checklist does not carry", { reason: "unresolved_owner_constraint", question: QUESTION, dimension: "Ticket size", answerhood: ANSWERHOOD }],
    ["declares no answerhood", { reason: "unresolved_owner_constraint", question: QUESTION, dimension: "Location" }],
    ["declares an answerhood that cannot flip anything", { reason: "unresolved_owner_constraint", question: QUESTION, dimension: "Location", answerhood: { ok_when: "she answers", conflict_when: "she answers" } }],
  ] as const)("refuses an ask that %s, and continues the dialogue instead", async (_label, askUser) => {
    const stubs = mkStubs();
    agentScript = [
      askTurn(askUser as Record<string, unknown>),
      turn("decline", "not for me", { checklist: SCORED_CHECKLIST } as Partial<NegotiationTurn>),
    ];
    await runGraph(stubs);

    // No park: the turn falls back to continuing the dialogue, and no question
    // was ever put to the client.
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("counter");
    expect(stubs.stateWrites.some((write) => write.state === "input_required")).toBe(false);
    expect(stubs.questionerEnqueues).toHaveLength(0);
  });

  it("refuses a second ask about a topic already asked in this negotiation", async () => {
    // "Location" is the only dimension left open, deliberately: the claim here
    // is that the SAME topic cannot be asked twice, and the conclusion floor
    // would otherwise (correctly) fire an ask about the other open dimension —
    // which would park the negotiation and make this fixture read as though the
    // repeat had been admitted. With one open topic and that topic already
    // asked, nothing is askable and the repeat stands alone.
    const oneOpen: ChecklistDraftItem[] = [
      dimension("Mutual want", "mutual_want", "ok", "Alice's intent seeks an ML engineer; Bob's seeks applied ML work"),
      dimension("Location", "fit", "unknown"),
      dimension("Stage fit", "fit", "ok", "Bob's intent names early-stage product work"),
    ];
    const prior = [
      turnMsg("u-src", turn("outreach", "opening", { message: "hi", checklist: oneOpen } as Partial<NegotiationTurn>), 0),
      turnMsg("u-cand", turn("counter", "pushing back"), 1),
      turnMsg("u-src", askTurn({
        reason: "unresolved_owner_constraint",
        question: QUESTION,
        dimension: "Location",
        answerhood: ANSWERHOOD,
      }, oneOpen), 2),
      turnMsg("u-cand", turn("counter", "still pushing"), 3),
    ];
    const stubs = mkStubs({ priorMessages: prior });
    agentScript = [
      // Same topic, new words.
      askTurn({
        reason: "unresolved_owner_constraint",
        question: QUESTION,
        dimension: "  location  ",
        answerhood: ANSWERHOOD,
      }, oneOpen),
      turn("withdraw", "done", { checklist: oneOpen } as Partial<NegotiationTurn>),
    ];
    await runGraph(stubs, { maxTurns: 8 });

    expect(agentInputs[0].askedTopics).toEqual([{ dimension: "Location", answerhood: ANSWERHOOD }]);
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("counter");
    expect(stubs.stateWrites.some((write) => write.state === "input_required")).toBe(false);
  });

  it("spends one question budget per principal, counting every park that asked them", async () => {
    const spent = Array.from({ length: QUESTION_BUDGET_PER_PRINCIPAL }, (_unused, index) =>
      turnMsg("u-src", askTurn({
        reason: "unresolved_owner_constraint",
        question: QUESTION,
        dimension: `Spent ${index}`,
        answerhood: ANSWERHOOD,
      }), index * 2));
    const stubs = mkStubs({
      priorMessages: [
        turnMsg("u-src", turn("outreach", "opening", { message: "hi", checklist: CHECKLIST } as Partial<NegotiationTurn>), 0),
        ...spent,
        turnMsg("u-cand", turn("counter", "still pushing"), 9),
      ],
    });
    agentScript = [
      askTurn({
        reason: "unresolved_owner_constraint",
        question: QUESTION,
        dimension: "Stage fit",
        answerhood: { ok_when: "Alice says pre-seed is in scope", conflict_when: "Alice says Series A only" },
      }),
      turn("withdraw", "done"),
    ];
    await runGraph(stubs, { maxTurns: 12 });

    // The grant is gone, so the prompt never offered the pause...
    expect(agentInputs[0].questionsSpent).toBe(QUESTION_BUDGET_PER_PRINCIPAL);
    expect(agentInputs[0].canAskUser).toBeUndefined();
    // ...and an ask drafted anyway is coerced rather than parked.
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("counter");
    expect(stubs.stateWrites.some((write) => write.state === "input_required")).toBe(false);
  });

  it("carries no checklist at all under advocate — the pre-checklist negotiation is untouched", async () => {
    process.env.NEGOTIATOR_STANCE = "advocate";
    const stubs = mkStubs();
    agentScript = [
      turn("outreach", "opening", { message: "hi", checklist: CHECKLIST } as Partial<NegotiationTurn>),
      turn("decline", "not for me"),
    ];
    await runGraph(stubs);

    expect(agentInputs[0].checklist).toBeUndefined();
    expect(agentInputs[0].questionsSpent).toBeUndefined();
    // A draft that arrives anyway is not reconciled onto the turn.
    expect(stubs.createdMessages[0].parts[0].data.checklist).toEqual(CHECKLIST);
  });
});
