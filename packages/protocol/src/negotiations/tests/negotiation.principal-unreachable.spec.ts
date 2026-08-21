import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NegotiationStallGapAuthor } from "../negotiation.stall-gap.js";
import { assessAskAdmissibility, renderChecklistSection, type ChecklistDraftItem, type ChecklistItem } from "../negotiation.checklist.contracts.js";
import type { NegotiationTurn } from "../negotiation.state.js";
import type { QuestionerEnqueuePayload } from "../../questions/question.input.js";
import { stubScreenerReachOut } from "./screen.stub.js";

/**
 * An unreachable principal is never consulted.
 *
 * Some accounts have nobody behind them — seed personas today, and a suspended
 * or deleted account would be the same operational fact. Their agent must not
 * park on `ask_user`: no answer can arrive, so the negotiation would wait out
 * the whole consultation expiry and the authored question would rot unread.
 *
 * What this pins:
 *  - the ACTING seat's unreachability withholds the grant, so a scripted
 *    ask_user is refused even when a dimension is unknown, pivotal and the
 *    principal's own to settle,
 *  - the refusal is traced as `principal_unreachable`, never as a spent budget
 *    — nothing was spent,
 *  - it is strictly per seat: the reachable side of the same negotiation still
 *    asks, and spends its own budget doing so,
 *  - two unreachable principals simply run a consultation-free negotiation.
 *    That is the intended shape of a seed-vs-seed match, not an error,
 *  - the prompt tells the agent the truth (no channel here) and never that its
 *    principal is seeded or a test account — the counterparty's own user can
 *    read these turns.
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

const CHECKLIST: ChecklistDraftItem[] = [
  dimension("Mutual want", "mutual_want", "ok", "Alice's intent seeks an ML engineer; Bob's seeks applied ML work"),
  dimension("Location", "fit", "unknown"),
  dimension("Stage fit", "fit", "unknown"),
];

/**
 * The same dimensions with one genuinely in conflict. A decline needs one —
 * the verdict law is enforced at the turn node now, so a scripted decline over
 * an unknowns-only checklist would be refused as inadmissible and the script
 * would never reach its end.
 */
const CONFLICTED_CHECKLIST: ChecklistDraftItem[] = [
  dimension("Mutual want", "mutual_want", "ok", "Alice's intent seeks an ML engineer; Bob's seeks applied ML work"),
  dimension("Location", "fit", "conflict", "Bob's profile places him in Lisbon; the signal asks for Berlin"),
  dimension("Stage fit", "fit", "unknown"),
];

const ANSWERHOOD = { ok_when: "the client says remote is fine", conflict_when: "the client says Berlin only" };

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

const askTurn = (checklist: ChecklistDraftItem[] = CHECKLIST) =>
  turn("ask_user", "one unknown stands between me and the decision", {
    askUser: {
      reason: "unresolved_owner_constraint",
      question: QUESTION,
      dimension: "Location",
      answerhood: ANSWERHOOD,
    },
    checklist,
  } as Partial<NegotiationTurn>);

function mkStubs(opts?: { unreachableUserIds?: string[] }) {
  const createdMessages: Array<{ senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }> = [];
  const stateWrites: Array<{ taskId: string; state: string }> = [];
  const unreachable = new Set(opts?.unreachableUserIds ?? []);
  const reachabilityReads: string[] = [];

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
    getMessagesForConversation: async () => [] as FakeMessage[],
    getNegotiationMessages: async () => [] as FakeMessage[],
    getOpportunityUserAnswers: async () => [],
    getNegotiationTaskForOpportunity: async () => null,
    getLatestNegotiationTaskForConversation: async () => null,
    getTask: async () => null,
    getUserContext: async () => ({ text: "Alice builds AI startups" }),
    getTasksForUser: async () => [],
    getArtifactsForTask: async () => [],
    isPrincipalUnreachable: async (userId: string) => {
      reachabilityReads.push(userId);
      return unreachable.has(userId);
    },
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

  return { database, dispatcher, timeoutQueue, questionerEnqueue, createdMessages, stateWrites, questionerEnqueues, reachabilityReads };
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

/** Every action persisted to the shared record, in order. */
function persistedActions(stubs: ReturnType<typeof mkStubs>) {
  return stubs.createdMessages.map((message) => message.parts[0].data.action);
}

let agentInputs: NegotiationAgentInput[] = [];
let agentScript: NegotiationTurn[] = [];

// The outreach screen runs before first contact on every negotiation; stub it
// so these cases exercise the turns they are about rather than a live model.
const restoreScreenStub = stubScreenerReachOut();
afterAll(() => { restoreScreenStub(); });

describe("an unreachable principal is never consulted", () => {
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
    for (const key of ["NEGOTIATION_SCREEN_MODE"]) {
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
  });

  afterEach(() => {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });

  it("refuses the acting seat's ask even when the dimension is unknown, pivotal and the principal's own", async () => {
    // BOTH principals unreachable, where this used to name only the acting
    // one. The claim is unchanged — an unreachable principal is never
    // consulted — but the record it asserts over is the whole negotiation, and
    // the conclusion floor now fires a guaranteed ask for any REACHABLE seat
    // that leaves an askable unknown standing. With a reachable counterparty
    // the "no ask_user anywhere" assertion would be failed by the other side's
    // legitimate consultation, which this test says nothing about. Making both
    // sides unreachable keeps the assertion true of exactly what it means, and
    // pins the floor's inertness in this corner at the same time: nothing
    // reachable, nothing fires.
    const stubs = mkStubs({ unreachableUserIds: ["u-src", "u-cand"] });
    agentScript = [askTurn(), turn("decline", "not for me")];
    await runGraph(stubs);

    // The seat never sees the vocabulary, and the drafted ask never lands.
    expect(agentInputs[0].canAskUser).not.toBe(true);
    expect(agentInputs[0].ownUser.principalUnreachable).toBe(true);
    // Refused, then carried by the opening rule into the outreach this turn
    // was always going to be — the seat does not stall on the missing channel.
    expect(persistedActions(stubs)[0]).toBe("outreach");
    expect(persistedActions(stubs)).not.toContain("ask_user");
    // Nothing parked, and nobody was asked anything.
    expect(stubs.stateWrites.some((write) => write.state === "input_required")).toBe(false);
    expect(stubs.questionerEnqueues).toHaveLength(0);
  });

  it("leaves the reachable seat of the same negotiation asking on its own budget", async () => {
    const stubs = mkStubs({ unreachableUserIds: ["u-src"] });
    agentScript = [
      // The unreachable initiator opens instead of consulting.
      turn("outreach", "opening", { message: "hi", checklist: CHECKLIST } as Partial<NegotiationTurn>),
      // The reachable counterparty asks, and its ask is admitted.
      askTurn(),
    ];
    await runGraph(stubs);

    expect(agentInputs[0].ownUser.principalUnreachable).toBe(true);
    expect(agentInputs[0].canAskUser).not.toBe(true);

    expect(agentInputs[1].ownUser.id).toBe("u-cand");
    expect(agentInputs[1].ownUser.principalUnreachable).toBeUndefined();
    expect(agentInputs[1].canAskUser).toBe(true);

    expect(persistedActions(stubs)).toEqual(["outreach", "ask_user"]);
    expect(stubs.stateWrites.some((write) => write.state === "input_required")).toBe(true);
    expect(stubs.questionerEnqueues).toHaveLength(1);
  });

  it("runs a seed-vs-seed match with zero consultations rather than failing it", async () => {
    const stubs = mkStubs({ unreachableUserIds: ["u-src", "u-cand"] });
    agentScript = [
      askTurn(),
      askTurn(),
      turn("decline", "the record puts Bob in the wrong city", { checklist: CONFLICTED_CHECKLIST } as Partial<NegotiationTurn>),
    ];
    const result = await runGraph(stubs);

    expect(agentInputs.every((input) => input.canAskUser !== true)).toBe(true);
    expect(persistedActions(stubs)).not.toContain("ask_user");
    expect(stubs.questionerEnqueues).toHaveLength(0);
    // A consultation-free negotiation is a negotiation, not an error.
    expect(result.error).toBeFalsy();
  });

  it("treats a host without the reachability port as every principal being reachable", async () => {
    const stubs = mkStubs();
    delete (stubs.database as unknown as Record<string, unknown>).isPrincipalUnreachable;
    agentScript = [askTurn()];
    await runGraph(stubs);

    expect(agentInputs[0].ownUser.principalUnreachable).toBeUndefined();
    expect(agentInputs[0].canAskUser).toBe(true);
    expect(persistedActions(stubs)[0]).toBe("ask_user");
  });
});

describe("the refusal names its own condition", () => {
  const admissible = {
    checklist: [
      { name: "Location", kind: "fit", result: "unknown", basis: "" },
    ] as ChecklistItem[],
    dimension: "Location",
    answerhood: ANSWERHOOD,
    askedDimensions: [] as string[],
    questionsSpent: 0,
  };

  it("refuses an unreachable principal's ask as `principal_unreachable`, not `budget_spent`", () => {
    expect(assessAskAdmissibility({ ...admissible, principalUnreachable: true }))
      .toEqual({ admissible: false, reason: "principal_unreachable" });
  });

  it("outranks every other refusal, because nothing was spent or repeated", () => {
    const verdict = assessAskAdmissibility({
      ...admissible,
      principalUnreachable: true,
      questionsSpent: 99,
      askedDimensions: ["Location"],
      dimension: "Nonexistent",
    });
    expect(verdict).toEqual({ admissible: false, reason: "principal_unreachable" });
  });

  it("changes nothing for a reachable principal", () => {
    expect(assessAskAdmissibility(admissible).admissible).toBe(true);
    expect(assessAskAdmissibility({ ...admissible, principalUnreachable: false }).admissible).toBe(true);
  });
});

describe("the prompt tells the truth and only the truth", () => {
  const checklist: ChecklistItem[] = [{ name: "Location", kind: "fit", result: "unknown", basis: "" }];

  it("replaces the budget line with the missing channel", () => {
    const rendered = renderChecklistSection({ checklist, questionsSpent: 0, principalUnreachable: true });
    expect(rendered).toContain("cannot be consulted in this negotiation");
    expect(rendered).not.toContain("Questions your client has already been asked");
  });

  it("never names the reason — a counterparty's user can read these turns", () => {
    const rendered = renderChecklistSection({ checklist, questionsSpent: 0, principalUnreachable: true });
    for (const leak of ["synthetic", "seed", "persona", "test account", "fake"]) {
      expect(rendered.toLowerCase()).not.toContain(leak);
    }
  });

  it("renders the budget line byte-for-byte as before for a reachable client", () => {
    expect(renderChecklistSection({ checklist, questionsSpent: 1 }))
      .toEqual(renderChecklistSection({ checklist, questionsSpent: 1, principalUnreachable: false }));
  });
});

/**
 * The prompt half, at the agent seam. `CapturingNegotiator` mirrors
 * `negotiation.agent.ask-user.spec.ts`: the `callModel` seam, no live provider.
 */
class CapturingNegotiator extends IndexNegotiator {
  calls = 0;
  systemPrompts: string[] = [];
  constructor(private outputs: unknown[]) {
    super({ turnTimeoutMs: 1000 });
  }
  protected override async callModel(
    _model: unknown,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    this.systemPrompts.push(chatMessages[0].content);
    const out = this.outputs[Math.min(this.calls, this.outputs.length - 1)];
    this.calls += 1;
    return out;
  }
}

const agentBaseInput: NegotiationAgentInput = {
  ownUser: { id: "u-init", intents: [], profile: { name: "Alice" } },
  otherUser: { id: "u-cp", intents: [], profile: { name: "Bob" } },
  indexContext: { networkId: "net-1", prompt: "" },
  seedAssessment: { reasoning: "seed", valencyRole: "peer" },
  history: [{ action: "counter", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null }],
  seat: "initiator",
  protocolVersion: "v2",
};

const counterOutput = {
  action: "counter",
  assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
  message: null,
};

describe("IndexNegotiator — the honest rule replaces the ask-user block", () => {
  async function unreachablePrompt(overrides: Partial<NegotiationAgentInput> = {}): Promise<string> {
    const agent = new CapturingNegotiator([counterOutput]);
    await agent.invoke({
      ...agentBaseInput,
      // The graph withholds the grant on the same fact; passing it anyway
      // pins that the agent refuses it a second time rather than trusting it.
      canAskUser: true,
      ownUser: { ...agentBaseInput.ownUser, principalUnreachable: true },
      ...overrides,
    });
    return agent.systemPrompts[0];
  }

  it("withholds the action from both the prompt and the generation schema", async () => {
    const prompt = await unreachablePrompt();
    expect(prompt).not.toContain('"ask_user"');
    expect(prompt).not.toContain("AT MOST ONE client consultation");
  });

  it("says the one true thing: there is no channel here", async () => {
    const prompt = await unreachablePrompt();
    expect(prompt).toContain("YOU CANNOT CONSULT Alice DURING THIS NEGOTIATION");
    expect(prompt).toContain("no answer can arrive");
    // The record is the principal's knowledge — the anti-stall half.
    expect(prompt).toContain("IS their knowledge for this negotiation");
    expect(prompt).toContain("Never stall, park, or defer for their input");
  });

  it("keeps the counterparty channel open — `question` is unaffected", async () => {
    const prompt = await unreachablePrompt();
    expect(prompt).toContain('If the fact you want belongs to the COUNTERPARTY, "question" is still the right action');
  });

  it("never leaks why, in any wording a counterparty's user could read", async () => {
    const prompt = (await unreachablePrompt({ checklist: [] })).toLowerCase();
    for (const leak of ["synthetic", "seed persona", "test account", "fake", "not a real user", "simulated"]) {
      expect(prompt).not.toContain(leak);
    }
  });

  it("carries the verdict law under the checklist protocol, so an unknown never ends the negotiation", async () => {
    const prompt = await unreachablePrompt();
    expect(prompt).toContain("carried as an open unknown");
    expect(prompt).toContain("An unknown is not a conflict");
    expect(prompt).toContain("the cheaper next experiment");
  });

  it("says none of it to a reachable principal", async () => {
    const agent = new CapturingNegotiator([counterOutput]);
    await agent.invoke({ ...agentBaseInput, canAskUser: false });
    expect(agent.systemPrompts[0]).not.toContain("YOU CANNOT CONSULT");
  });
});
