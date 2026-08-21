import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator } from "../negotiation.agent.js";
import { NegotiationStallGapAuthor, NEGOTIATION_PARK_REASONING, type NegotiationStallGap, type StallGapAuthorInput } from "../negotiation.stall-gap.js";
import { negotiationAskRoundsCap, CHECKLIST_NEGOTIATION_ASK_ROUNDS_CAP, DEFAULT_NEGOTIATION_ASK_ROUNDS_CAP } from "../negotiation.protocol.js";
import { countNegotiationAskRounds, hasPriorAskUser } from "../negotiation.graph.shared.js";
import { requestContext } from "../../shared/observability/request-context.js";
import type { NegotiationTurn } from "../negotiation.state.js";
import type { QuestionerEnqueuePayload } from "../../questions/question.input.js";
import { stubScreenerReachOut } from "./screen.stub.js";

/**
 * Post-stall park with a bounded ask cap (conversational-questions plan).
 *
 * Pins:
 * - an unconcluded negotiation (turn cap here) parks: the authored gap is
 *   persisted as an `ask_user` message in the negotiation's own record, with
 *   the fixed park reasoning and the source's agent as sender,
 * - grounding: the gap call receives the transcript, the stall reason, and
 *   the signal's client-DM excerpt retrieved for (sourceUser, sourceIntentId),
 * - bounding: at or past the per-negotiation ask-rounds cap the negotiation
 *   stalls terminally — no authoring call, no park, telemetry only,
 * - the flag defaults off and off means byte-identical legacy behavior,
 * - a null gap (nothing to ask) and an unsafe question both degrade to
 *   today's terminal stall,
 * - the legacy questioner enqueue still fires alongside a park (its removal
 *   belongs to the delivery lane's retirement sweep),
 * - round counting shares the per-side ration's substrate: `ask_user`
 *   messages, counted negotiation-wide.
 */

const gapQuestion = {
  title: "Timing",
  prompt: "When could you realistically start a collaboration?",
  options: [
    { label: "This quarter", description: "A retry will push for an immediate start." },
    { label: "Later this year", description: "A retry will propose a slower ramp-up." },
  ],
  multiSelect: false,
};

const safeGap: NegotiationStallGap = { reason: "unresolved_owner_constraint", question: gapQuestion };

type FakeMessage = { id: string; senderId: string; role: "agent"; parts: unknown[]; createdAt: Date };

function priorMsg(senderUserId: string, action: string, idx: number): FakeMessage {
  return {
    id: `prior-${idx}`,
    senderId: `agent:${senderUserId}`,
    role: "agent",
    parts: [{ kind: "data", data: { action, assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null } }],
    createdAt: new Date(Date.now() - (100 - idx) * 1000),
  };
}

function mkStubs(opts?: { priorMessages?: FakeMessage[] }) {
  const createdMessages: Array<{ senderId: string; taskId?: string; parts: Array<{ kind: string; data: NegotiationTurn }> }> = [];
  const stateWrites: string[] = [];
  const opportunityStatuses: string[] = [];
  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string) => ({ id: "task-1", conversationId, state: "submitted" }),
    updateOpportunityStatus: async (_id: string, status: string) => { opportunityStatuses.push(status); },
    createMessage: async (p: { senderId: string; taskId?: string; parts: Array<{ kind: string; data: NegotiationTurn }> }) => {
      createdMessages.push(p);
      return { id: `msg-${createdMessages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async (_taskId: string, state: string) => { stateWrites.push(state); },
    createArtifact: async () => ({ id: "artifact-1" }),
    setTaskTurnContext: async () => {},
    getMessagesForConversation: async () => opts?.priorMessages ?? [],
    getNegotiationMessages: async () => opts?.priorMessages ?? [],
    getOpportunityUserAnswers: async () => [],
    getNegotiationTaskForOpportunity: async () => null,
    getLatestNegotiationTaskForConversation: async () => null,
    getUserContext: async () => ({ text: "user ctx" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async () => ({ handled: false, reason: "no_agent" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  const questionerEnqueues: QuestionerEnqueuePayload[] = [];
  const questionerEnqueue = async (input: QuestionerEnqueuePayload) => { questionerEnqueues.push(input); };

  const clientDmQueries: Array<{ userId: string; intentId: string }> = [];
  const clientDmRetrieve = async (query: { userId: string; intentId: string }) => {
    clientDmQueries.push(query);
    return [{ role: "client" as const, content: "I only want equity partnerships" }];
  };

  return { database, dispatcher, questionerEnqueue, clientDmRetrieve, createdMessages, stateWrites, opportunityStatuses, questionerEnqueues, clientDmQueries };
}

async function runGraph(stubs: ReturnType<typeof mkStubs>, events?: Array<Record<string, unknown>>) {
  const graph = new NegotiationGraphFactory(
    stubs.database,
    stubs.dispatcher,
    undefined,
    stubs.questionerEnqueue,
    undefined,
    undefined,
    stubs.clientDmRetrieve,
  ).createGraph();
  const invoke = () => graph.invoke({
    sourceUser: { id: "u-src", intents: [{ id: "intent-src", title: "Build AI", description: "Find an AI collaborator", confidence: 1 }], profile: { name: "Alice", bio: "PM" } },
    candidateUser: { id: "u-cand", intents: [{ id: "intent-cand", title: "Apply ML", description: "Join an AI product", confidence: 1 }], profile: { name: "Bob", bio: "ML engineer" } },
    sourceIntentId: "intent-src",
    candidateIntentId: "intent-cand",
    indexContext: { networkId: "net-1", prompt: "" },
    seedAssessment: { reasoning: "x", valencyRole: "peer" },
    opportunityId: "opp-1",
    maxTurns: 2,
  } as Partial<typeof NegotiationGraphState.State>);
  if (!events) return invoke();
  return requestContext.run({ traceEmitter: ((e: Record<string, unknown>) => events.push(e)) as never }, invoke);
}

// Scripted seams.
let agentScript: NegotiationTurn[] = [];
let authorInputs: StallGapAuthorInput[] = [];
let authorResult: NegotiationStallGap | null = null;

const counterTurn: NegotiationTurn = {
  action: "counter",
  assessment: { reasoning: "still apart", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
  message: null,
};

// The outreach screen runs before first contact on every negotiation; stub it
// so these cases exercise the turns they are about rather than a live model.
const restoreScreenStub = stubScreenerReachOut();
afterAll(() => { restoreScreenStub(); });

describe("negotiation graph — post-stall park", () => {
  let origAgentInvoke: typeof IndexNegotiator.prototype.invoke;
  let origAuthor: typeof NegotiationStallGapAuthor.prototype.author;
  const origScreenMode = process.env.NEGOTIATION_SCREEN_MODE;

  beforeAll(() => {
    origAgentInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function () {
      const turn = agentScript.shift();
      if (!turn) throw new Error("agent script exhausted");
      return turn;
    };
    origAuthor = NegotiationStallGapAuthor.prototype.author;
    NegotiationStallGapAuthor.prototype.author = async function (input: StallGapAuthorInput) {
      authorInputs.push(input);
      return authorResult;
    };
  });

  afterAll(() => {
    IndexNegotiator.prototype.invoke = origAgentInvoke;
    NegotiationStallGapAuthor.prototype.author = origAuthor;
  });

  beforeEach(() => {
    agentScript = [
      { ...counterTurn, action: "propose" },
      counterTurn,
    ];
    authorInputs = [];
    authorResult = safeGap;
    process.env.NEGOTIATION_SCREEN_MODE = "off";
  });

  afterEach(() => {
    if (origScreenMode === undefined) delete process.env.NEGOTIATION_SCREEN_MODE; else process.env.NEGOTIATION_SCREEN_MODE = origScreenMode;
  });

  it("parks a turn-capped negotiation with its authored gap as an ask_user message", async () => {
    const stubs = mkStubs();
    const events: Array<Record<string, unknown>> = [];
    await runGraph(stubs, events);

    // Two turns + the park message, appended last.
    expect(stubs.createdMessages).toHaveLength(3);
    const park = stubs.createdMessages[2];
    expect(park.senderId).toBe("agent:u-src");
    expect(park.taskId).toBe("task-1");
    const parkTurn = park.parts[0].data;
    expect(parkTurn.action).toBe("ask_user");
    expect(parkTurn.assessment.reasoning).toBe(NEGOTIATION_PARK_REASONING);
    expect(parkTurn.askUser).toEqual({ reason: "unresolved_owner_constraint", question: gapQuestion });

    // The negotiation still finalizes exactly as before: completed + stalled.
    expect(stubs.stateWrites).toContain("completed");
    expect(stubs.opportunityStatuses).toContain("stalled");

    // Authoring was grounded in the transcript, stall reason, and client DM.
    expect(authorInputs).toHaveLength(1);
    expect(authorInputs[0].stallReason).toBe("turn_cap");
    expect(authorInputs[0].userName).toBe("Alice");
    expect(authorInputs[0].signal).toEqual({ title: "Build AI", description: "Find an AI collaborator" });
    expect(authorInputs[0].history).toHaveLength(2);
    expect(authorInputs[0].clientDm).toEqual([{ role: "client", content: "I only want equity partnerships" }]);
    // The DM is read on every turn now, not only here: the client's answers are
    // commitments the negotiator scores from, and gating the read on "a turn
    // where I may ask" meant it argued their case having never read what they
    // said. Both seats therefore read — what stays pinned is the SCOPE: every
    // read pairs the ACTING user with their OWN signal, never the
    // counterparty's, and never another user's private thread.
    const ownSignal: Record<string, string> = { "u-src": "intent-src", "u-cand": "intent-cand" };
    expect(stubs.clientDmQueries.length).toBeGreaterThan(0);
    for (const query of stubs.clientDmQueries) {
      expect(Object.keys(query).sort()).toEqual(["intentId", "userId"]);
      expect(query.intentId).toBe(ownSignal[query.userId]);
    }

    // The legacy blind enqueue is untouched — retirement is the delivery lane's.
    expect(stubs.questionerEnqueues).toHaveLength(1);
    expect(stubs.questionerEnqueues[0].purpose).toBe("stalled_followup");

    expect(events.filter((e) => e.type === "negotiation_parked")).toHaveLength(1);
    const parked = events.find((e) => e.type === "negotiation_parked")!;
    expect(parked.opportunityId).toBe("opp-1");
    expect(parked.askRounds).toBe(1);
    expect(parked.stallReason).toBe("turn_cap");
  });

  it("stalls terminally at the ask-rounds cap: no authoring, no park, telemetry only", async () => {
    // The negotiation has already spent the whole negotiation-wide cap across
    // both sides. Seeded from the constant: under the checklist protocol the
    // cap is both principals' budgets plus one, not a fixed three.
    const CAP = CHECKLIST_NEGOTIATION_ASK_ROUNDS_CAP;
    const priorMessages = [priorMsg("u-src", "propose", 0)];
    for (let i = 0; i < CAP; i++) {
      // Alternate the asking seat so neither side's own budget binds first.
      priorMessages.push(priorMsg(i % 2 === 0 ? "u-cand" : "u-src", "ask_user", priorMessages.length));
      priorMessages.push(priorMsg(i % 2 === 0 ? "u-cand" : "u-src", "counter", priorMessages.length));
    }
    const stubs = mkStubs({ priorMessages });
    agentScript = [counterTurn, counterTurn];
    const events: Array<Record<string, unknown>> = [];
    await runGraph(stubs, events);

    expect(authorInputs).toHaveLength(0);
    expect(stubs.createdMessages.map((m) => m.parts[0].data.action)).not.toContain("ask_user");
    expect(events.filter((e) => e.type === "negotiation_parked")).toHaveLength(0);
    const terminal = events.filter((e) => e.type === "negotiation_ask_cap_terminal");
    expect(terminal).toHaveLength(1);
    expect(terminal[0].askRounds).toBe(CAP);
    expect(terminal[0].askRoundsCap).toBe(CAP);
    // The stall itself is unchanged — the legacy enqueue still fires.
    expect(stubs.questionerEnqueues).toHaveLength(1);
  });

  it("does not park when the negotiator reports no gap", async () => {
    authorResult = null;
    const stubs = mkStubs();
    const events: Array<Record<string, unknown>> = [];
    await runGraph(stubs, events);

    expect(authorInputs).toHaveLength(1);
    expect(stubs.createdMessages).toHaveLength(2);
    expect(events.filter((e) => e.type === "negotiation_parked")).toHaveLength(0);
  });

  it("drops an unsafe gap question instead of parking (names the counterparty)", async () => {
    authorResult = {
      reason: "consequential_disclosure_permission",
      question: { ...gapQuestion, prompt: "May I tell Bob your budget range?" },
    };
    const stubs = mkStubs();
    await runGraph(stubs);

    expect(authorInputs).toHaveLength(1);
    expect(stubs.createdMessages).toHaveLength(2);
    expect(stubs.createdMessages.map((m) => m.parts[0].data.action)).not.toContain("ask_user");
  });

  it("does not park an accepted negotiation", async () => {
    agentScript = [
      { ...counterTurn, action: "propose" },
      { ...counterTurn, action: "accept" },
    ];
    const stubs = mkStubs();
    await runGraph(stubs);

    expect(authorInputs).toHaveLength(0);
    expect(stubs.createdMessages).toHaveLength(2);
  });

  it("does not park an explicitly rejected negotiation", async () => {
    agentScript = [
      { ...counterTurn, action: "propose" },
      { ...counterTurn, action: "reject" },
    ];
    const stubs = mkStubs();
    await runGraph(stubs);

    expect(authorInputs).toHaveLength(0);
    expect(stubs.createdMessages).toHaveLength(2);
  });

  it("keeps finalizing when the park write fails", async () => {
    const stubs = mkStubs();
    let calls = 0;
    const originalCreate = stubs.database.createMessage.bind(stubs.database);
    (stubs.database as { createMessage: typeof originalCreate }).createMessage = async (p: Parameters<typeof originalCreate>[0]) => {
      calls += 1;
      if (calls === 3) throw new Error("db down");
      return originalCreate(p);
    };
    await runGraph(stubs);

    expect(stubs.stateWrites).toContain("completed");
    expect(stubs.opportunityStatuses).toContain("stalled");
    expect(stubs.questionerEnqueues).toHaveLength(1);
  });
});

describe("ask-rounds cap config", () => {
  it("cap is 3, and the checklist protocol raises it to both principals' budgets plus one", () => {
    expect(negotiationAskRoundsCap()).toBe(DEFAULT_NEGOTIATION_ASK_ROUNDS_CAP);
    expect(negotiationAskRoundsCap({ checklist: false })).toBe(DEFAULT_NEGOTIATION_ASK_ROUNDS_CAP);
    expect(negotiationAskRoundsCap({ checklist: true })).toBe(CHECKLIST_NEGOTIATION_ASK_ROUNDS_CAP);
  });
});

describe("countNegotiationAskRounds — one substrate with hasPriorAskUser", () => {
  const messages = [
    priorMsg("u-src", "propose", 0),
    priorMsg("u-cand", "ask_user", 1),
    priorMsg("u-cand", "counter", 2),
    priorMsg("u-src", "ask_user", 3),
  ];

  it("counts ask_user parks negotiation-wide, both sides combined", () => {
    expect(countNegotiationAskRounds(messages)).toBe(2);
    expect(countNegotiationAskRounds([])).toBe(0);
    expect(countNegotiationAskRounds([priorMsg("u-src", "counter", 0)])).toBe(0);
  });

  it("keeps hasPriorAskUser per-side over the same messages", () => {
    expect(hasPriorAskUser(messages, "u-src")).toBe(true);
    expect(hasPriorAskUser(messages, "u-cand")).toBe(true);
    expect(hasPriorAskUser(messages.slice(0, 2), "u-src")).toBe(false);
  });
});
