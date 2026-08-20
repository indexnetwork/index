import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NegotiationStallGapAuthor } from "../negotiation.stall-gap.js";
import { assessDeclineAdmissibility, type ChecklistDraftItem, type ChecklistItem } from "../negotiation.checklist.contracts.js";
import type { NegotiationTurn } from "../negotiation.state.js";
import type { QuestionerEnqueuePayload } from "../../questions/question.input.js";

/**
 * The copy loop, and the two rules that let it happen.
 *
 * Observed live on the sandbox: a counterparty asked what a phrase in the
 * client's own signal meant. The answering agent could not consult its
 * principal (unreachable) and its record did not settle the phrase, so with no
 * legal move left it copied the question back word for word. Both models then
 * locked — reproducing text already in context is close to deterministic — and
 * turns 2/4 and 3/5 of that negotiation were byte-identical pairs. It ended on
 * a decline citing "repeated lack of clarity ... despite five inquiries",
 * against a checklist that held unknowns and not one conflict.
 *
 * What this pins:
 *  - a drafted turn that repeats a message already on the record is never
 *    persisted; the turn is re-issued once, told what it repeated,
 *  - a second repeat ends the negotiation as `repetition` — not a decline,
 *    because nobody decided anything — and the transcript holds no
 *    byte-identical pair,
 *  - distinct messages flow through untouched,
 *  - the prompt gives the corner its missing legal move: state what the record
 *    does and does not hold,
 *  - a decline needs a conflict. An unknown never ends a negotiation, and where
 *    the turn cap forces a verdict the violation is at least recorded.
 *
 * Harness mirrors `negotiation.checklist-turn.spec.ts`: stubbed
 * database/dispatcher, scripted agent turns, no live provider.
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

/** Three dimensions, one scored, two open — and nothing in conflict. */
const OPEN_CHECKLIST: ChecklistDraftItem[] = [
  dimension("Mutual want", "mutual_want", "ok", "Alice's intent seeks an ML engineer; Bob's seeks applied ML work"),
  dimension("Studio operations", "fit", "unknown"),
  dimension("Stage fit", "fit", "unknown"),
];

/** The same three, with one dimension genuinely in conflict. */
const CONFLICTED_CHECKLIST: ChecklistDraftItem[] = [
  dimension("Mutual want", "mutual_want", "ok", "Alice's intent seeks an ML engineer; Bob's seeks applied ML work"),
  dimension("Studio operations", "fit", "conflict", "Bob's profile states he has never worked in a studio"),
  dimension("Stage fit", "fit", "unknown"),
];

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

const OPENING = "Alice is hiring an ML engineer with studio operations experience.";
const THE_QUESTION = "What do you mean by studio operations experience?";
const THE_HONEST_ANSWER = "Alice's signal says studio operations experience; it does not specify further.";

function mkStubs(opts?: { priorMessages?: FakeMessage[] }) {
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

  return { database, dispatcher, timeoutQueue, questionerEnqueue, createdMessages, stateWrites, questionerEnqueues, opportunityStatuses };
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
    maxTurns: 6,
    ...input,
  } as Partial<typeof NegotiationGraphState.State>);
}

/** Every action persisted to the shared record, in order. */
function persistedActions(stubs: ReturnType<typeof mkStubs>) {
  return stubs.createdMessages.map((message) => message.parts[0].data.action);
}

/** Every message persisted to the shared record, in order. */
function persistedMessages(stubs: ReturnType<typeof mkStubs>) {
  return stubs.createdMessages.map((message) => message.parts[0].data.message ?? null);
}

/** The failure exactly as the DB proved it: two turns with the same text. */
function hasIdenticalMessagePair(stubs: ReturnType<typeof mkStubs>): boolean {
  const messages = persistedMessages(stubs).filter((message): message is string => typeof message === "string" && message.trim().length > 0);
  return new Set(messages.map((message) => message.trim())).size !== messages.length;
}

let agentInputs: NegotiationAgentInput[] = [];
let agentScript: NegotiationTurn[] = [];

describe("the copy loop at the turn seam", () => {
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

  it("discards a duplicate draft and re-issues the turn once, telling it what it repeated", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      said("question", THE_QUESTION),
      // The observed failure: the initiator hands the question back verbatim.
      said("question", THE_QUESTION),
      // The re-issue, which is what actually lands.
      said("counter", THE_HONEST_ANSWER),
      turn("accept", "the record is enough to meet on"),
    ];
    await runGraph(stubs);

    // The duplicate never reached the conversation; the re-issue did.
    expect(persistedMessages(stubs)).toEqual([OPENING, THE_QUESTION, THE_HONEST_ANSWER, null]);
    expect(persistedActions(stubs)).toEqual(["outreach", "question", "counter", "accept"]);
    expect(hasIdenticalMessagePair(stubs)).toBe(false);

    // Exactly one extra draft, and it was told what to stop repeating.
    expect(agentInputs).toHaveLength(5);
    expect(agentInputs[2].antiEcho).toBeUndefined();
    expect(agentInputs[3].antiEcho).toEqual({ repeatedMessage: THE_QUESTION });
    // The re-issue is still the SAME turn: same seat, same history, no extra
    // turn spent on it.
    expect(agentInputs[3].seat).toBe(agentInputs[2].seat);
    expect(agentInputs[3].history).toHaveLength(agentInputs[2].history.length);
  });

  it("ends the negotiation as `repetition` when the re-issue repeats too, and never as a decline", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      said("question", THE_QUESTION),
      said("question", THE_QUESTION),
      // Told not to echo, it echoes anyway. Twice is not a slip.
      said("question", THE_QUESTION),
    ];
    const result = await runGraph(stubs);

    // Nothing after the counterparty's question was persisted, and the record
    // holds no byte-identical pair — the shape the DB proved on the live row.
    expect(persistedMessages(stubs)).toEqual([OPENING, THE_QUESTION]);
    expect(hasIdenticalMessagePair(stubs)).toBe(false);

    // The honest outcome: nobody decided anything.
    expect(result.outcome?.reason).toBe("repetition");
    expect(result.outcome?.hasOpportunity).toBe(false);
    // The failed turn is not counted as one — the two turns that landed are.
    expect(result.outcome?.turnCount).toBe(2);
    // And the opportunity is stalled, never rejected: a stall is retryable and
    // says nothing about the match; `rejected` would be a verdict nobody gave.
    expect(stubs.opportunityStatuses.at(-1)).toBe("stalled");
  });

  it("leaves distinct messages completely alone", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      said("question", THE_QUESTION),
      said("counter", THE_HONEST_ANSWER),
      turn("accept", "good enough to meet on"),
    ];
    await runGraph(stubs);

    expect(persistedActions(stubs)).toEqual(["outreach", "question", "counter", "accept"]);
    // One draft per turn: no re-issue was triggered, and no turn saw an
    // anti-echo instruction.
    expect(agentInputs).toHaveLength(4);
    expect(agentInputs.every((input) => input.antiEcho === undefined)).toBe(true);
  });

  it("exempts a TERMINAL turn — the guard stops loops, and a turn that ends the negotiation cannot loop", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      // An accept that closes by restating the outreach it is accepting. Under
      // a guard that covered terminal turns this would be refused and a
      // successful match would end as a stall — the guard destroying exactly
      // the outcome it exists to protect.
      said("accept", OPENING),
    ];
    const result = await runGraph(stubs);

    expect(persistedActions(stubs)).toEqual(["outreach", "accept"]);
    expect(result.outcome?.hasOpportunity).toBe(true);
    // No re-issue was attempted.
    expect(agentInputs).toHaveLength(2);
  });

  it("exempts turns that carry no message — there is nothing on the record for them to duplicate", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      // Two message-less turns in a row are not a copy loop; they are two
      // agents reasoning without addressing each other's text.
      turn("counter", "not yet convinced", { checklist: OPEN_CHECKLIST } as Partial<NegotiationTurn>),
      turn("counter", "not yet convinced", { checklist: OPEN_CHECKLIST } as Partial<NegotiationTurn>),
      turn("accept", "convinced"),
    ];
    await runGraph(stubs);

    expect(persistedActions(stubs)).toEqual(["outreach", "counter", "counter", "accept"]);
    expect(agentInputs).toHaveLength(4);
  });
});

describe("a decline needs a conflict — the verdict law, mechanically", () => {
  const authored: ChecklistItem[] = OPEN_CHECKLIST as ChecklistItem[];

  it("refuses a decline over a checklist that holds only unknowns, and names them", () => {
    expect(assessDeclineAdmissibility({ checklist: authored })).toEqual({
      admissible: false,
      reason: "no_conflict_dimension",
      unknowns: ["Studio operations", "Stage fit"],
    });
  });

  it("admits a decline that has a conflict behind it", () => {
    expect(assessDeclineAdmissibility({ checklist: CONFLICTED_CHECKLIST as ChecklistItem[] }))
      .toEqual({ admissible: true });
  });

  it("fails open on an unauthored checklist — there is no law to have violated", () => {
    expect(assessDeclineAdmissibility({ checklist: [] })).toEqual({ admissible: true });
    // Too few dimensions, and no mutual want: not an authored checklist.
    expect(assessDeclineAdmissibility({
      checklist: [dimension("Stage fit", "fit", "unknown")] as ChecklistItem[],
    })).toEqual({ admissible: true });
  });
});

describe("the verdict law at the turn seam", () => {
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

  it("refuses a mid-flight decline that has no conflict behind it, and keeps the dialogue open", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      // The observed decline: "repeated lack of clarity", over unknowns.
      said("decline", "I have asked repeatedly and nothing was clarified."),
      said("counter", "one more angle"),
      turn("accept", "settled"),
    ];
    await runGraph(stubs);

    // Coerced to the conservative non-terminal fallback, and the message that
    // was written to end the negotiation does not travel on it.
    expect(persistedActions(stubs)).toEqual(["outreach", "counter", "counter", "accept"]);
    expect(persistedMessages(stubs)[1]).toBeNull();
    // The negotiation did not end there.
    expect(stubs.opportunityStatuses.at(-1)).toBe("pending");
  });

  it("admits the decline the moment a dimension is actually in conflict", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      said("decline", "Bob has never worked in a studio; this is not the person.", CONFLICTED_CHECKLIST),
    ];
    await runGraph(stubs);

    expect(persistedActions(stubs)).toEqual(["outreach", "decline"]);
    expect(persistedMessages(stubs)[1]).toBe("Bob has never worked in a studio; this is not the person.");
    expect(stubs.opportunityStatuses.at(-1)).toBe("rejected");
  });

  it("lets the final turn's forced verdict stand — the cap wins, and the row still says a decline landed", async () => {
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      // maxTurns 2 makes this the final turn: the seat's only moves are accept
      // and decline, so refusing the decline could only manufacture an accept.
      said("decline", "nothing was ever clarified"),
    ];
    const result = await runGraph(stubs, { maxTurns: 2 });

    expect(persistedActions(stubs)).toEqual(["outreach", "decline"]);
    expect(result.outcome?.hasOpportunity).toBe(false);
    expect(stubs.opportunityStatuses.at(-1)).toBe("rejected");
  }, 10_000);

  it("leaves `advocate` untouched — no checklist, no law", async () => {
    process.env.NEGOTIATOR_STANCE = "advocate";
    const stubs = mkStubs();
    agentScript = [
      said("outreach", OPENING),
      said("decline", "not a fit"),
    ];
    await runGraph(stubs);

    expect(persistedActions(stubs)).toEqual(["outreach", "decline"]);
    expect(stubs.opportunityStatuses.at(-1)).toBe("rejected");
  });
});

/**
 * The prompt half, at the agent seam. `CapturingNegotiator` mirrors
 * `negotiation.principal-unreachable.spec.ts`: the `callModel` seam, no live
 * provider.
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
    action: "question",
    assessment: { reasoning: "need to know", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
    message: THE_QUESTION,
  }],
  seat: "initiator",
  protocolVersion: "v2",
};

describe("the prompt gives the corner its missing move", () => {
  const stanceKey = "NEGOTIATOR_STANCE";
  let originalStance: string | undefined;

  beforeAll(() => { originalStance = process.env[stanceKey]; });
  afterAll(() => {
    if (originalStance === undefined) delete process.env[stanceKey];
    else process.env[stanceKey] = originalStance;
  });

  async function promptFor(overrides: Partial<NegotiationAgentInput> = {}) {
    const agent = new CapturingNegotiator([counterOutput]);
    await agent.invoke({ ...agentBaseInput, ...overrides });
    return { system: agent.systemPrompts[0], user: agent.userMessages[0] };
  }

  it("tells an unreachable principal's agent to state the limit of the record instead of echoing", async () => {
    process.env[stanceKey] = "skeptic";
    const { system } = await promptFor({
      ownUser: { ...agentBaseInput.ownUser, principalUnreachable: true },
    });
    // The exact corner the live failure hit: the counterparty asked something
    // only the client could settle, and the record does not settle it.
    expect(system).toContain("WHEN THE COUNTERPARTY ASKS YOU SOMETHING ONLY Alice COULD SETTLE AND YOUR RECORD DOES NOT SETTLE IT");
    expect(system).toContain("is a COMPLETE and honest answer");
    expect(system).toContain("Never repeat, mirror, or hand their question back to them");
    // Under the checklist protocol the same move is stated in checklist terms.
    expect(system).toContain("name it as an open unknown to them in plain words");
  });

  it("never renders the rule for a reachable principal", async () => {
    process.env[stanceKey] = "skeptic";
    const { system } = await promptFor({ canAskUser: false });
    expect(system).not.toContain("YOU CANNOT CONSULT");
    expect(system).not.toContain("WHEN THE COUNTERPARTY ASKS YOU SOMETHING ONLY");
  });

  it("quotes the repeated text back on a re-issue, and offers moves rather than a verdict", async () => {
    process.env[stanceKey] = "skeptic";
    const { user } = await promptFor({ antiEcho: { repeatedMessage: THE_QUESTION } });
    expect(user).toContain("REPEATED A MESSAGE ALREADY IN THIS NEGOTIATION, WORD FOR WORD");
    expect(user).toContain(THE_QUESTION);
    expect(user).toContain("do not ask it back at them");
    // The re-issue must not push toward ending it — that would manufacture the
    // false decline the guard exists to prevent.
    expect(user).toContain("Never end a negotiation merely because something stayed unknown.");
  });

  it("says nothing about echoing on an ordinary turn", async () => {
    process.env[stanceKey] = "skeptic";
    const { user } = await promptFor();
    expect(user).not.toContain("WORD FOR WORD");
  });
});
