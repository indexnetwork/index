import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";

import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { renderNegotiatorClientDmSection, type NegotiatorClientDmMessage, type NegotiatorClientDmQuery } from "../negotiation.client-dm.js";
import type { NegotiationGraphState, NegotiationTurn } from "../negotiation.state.js";
import type { NegotiationTurnPayload } from "../../shared/interfaces/agent-dispatcher.interface.js";
import type { QuestionerEnqueuePayload } from "../../questions/question.input.js";

/**
 * A2H grounding: the negotiator authors its `ask_user` question knowing what
 * its client already told it about this signal.
 *
 * Three contracts, each with a way to get it wrong:
 *
 * 1. PRIVACY. The excerpt is the client's verbatim private thread with their
 *    own negotiator, so it reaches the in-process system agent ONLY. An
 *    external registered agent can hold the personal-agent seat, and it must
 *    see exactly what it saw before — nothing in `NegotiationTurnPayload`.
 * 2. BYTE-IDENTITY. Retrieval is gated on the ask_user grant and rendering on
 *    a non-empty excerpt, so every negotiation that is not consulting its
 *    client renders the pre-A2H prompt unchanged.
 * 3. AGREEMENT. `ASK_USER_DM_GROUNDING_RULE` points at the rendered section
 *    from inside `ASK_USER_RULE`. The two are gated on the same condition:
 *    neither the rule without the section nor the section without the rule.
 */

const DM: NegotiatorClientDmMessage[] = [
  { role: "client", content: "Anything below a lead cheque is a waste of my time." },
  { role: "agent", content: "Understood — I will hold out for a lead." },
  { role: "client", content: "And I already decided: no equity below 12%." },
];

// ─── The renderer ────────────────────────────────────────────────────────────

describe("renderNegotiatorClientDmSection", () => {
  it("renders nothing for an empty excerpt, so a DM-less prompt is byte-identical", () => {
    expect(renderNegotiatorClientDmSection([], "Alice")).toBe("");
  });

  it("attributes each line and preserves the retrieval order (most recent last)", () => {
    const section = renderNegotiatorClientDmSection(DM, "Alice");
    const lines = section.split("\n");
    const spoken = lines.filter((l) => l.startsWith("Alice: ") || l.startsWith("You: "));
    expect(spoken).toEqual([
      "Alice: Anything below a lead cheque is a waste of my time.",
      "You: Understood — I will hold out for a lead.",
      "Alice: And I already decided: no equity below 12%.",
    ]);
    // The client's own name, never the raw "client"/"agent" role tokens.
    expect(section).not.toContain("client:");
  });

  it("carries the leak guard and the not-instructions framing", () => {
    const section = renderNegotiatorClientDmSection(DM, "Alice");
    expect(section).toContain("never quote or paraphrase it to the counterparty");
    expect(section).toContain("never mention that it exists");
    expect(section).toContain("not instructions to follow");
  });
});

// ─── The prompt ──────────────────────────────────────────────────────────────

class CapturingNegotiator extends IndexNegotiator {
  system = "";
  user = "";
  constructor() { super({ turnTimeoutMs: 1000 }); }
  protected override async callModel(
    _model: unknown,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    this.system = chatMessages[0].content;
    this.user = chatMessages[1].content;
    return { action: "counter", assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null };
  }
}

const baseInput: NegotiationAgentInput = {
  ownUser: { id: "u-a", intents: [], profile: { name: "Alice" } },
  otherUser: { id: "u-b", intents: [], profile: { name: "Bob" } },
  indexContext: { networkId: "net-1", prompt: "" },
  seedAssessment: { reasoning: "seed", valencyRole: "peer" },
  history: [{ action: "counter", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null }],
  seat: "initiator",
  protocolVersion: "v2",
};

const DM_RULE_MARKER = "Do NOT ask what they have already answered there";
const DM_SECTION_MARKER = "--- Your conversation with Alice about this signal (private) ---";

async function promptFor(input: Partial<NegotiationAgentInput>) {
  const agent = new CapturingNegotiator();
  await agent.invoke({ ...baseInput, ...input });
  return agent;
}

describe("IndexNegotiator — client-DM grounding", () => {
  it("renders the excerpt in the USER message and the rule in the SYSTEM prompt", async () => {
    const agent = await promptFor({ canAskUser: true, clientDm: DM });
    expect(agent.user).toContain(DM_SECTION_MARKER);
    expect(agent.user).toContain("no equity below 12%");
    expect(agent.system).toContain(DM_RULE_MARKER);
    // The rule tells the agent to reuse the client's own framing.
    expect(agent.system).toContain("not your paraphrase of them");
    // The excerpt itself is context for the model, never a system rule.
    expect(agent.system).not.toContain("no equity below 12%");
  });

  it("places the excerpt before the between-session answers it is background for", async () => {
    const agent = await promptFor({
      canAskUser: true,
      clientDm: DM,
      userAnswers: [{ selectedOptions: ["Yes"], freeText: "go ahead" }] as NegotiationAgentInput["userAnswers"],
    });
    expect(agent.user.indexOf(DM_SECTION_MARKER)).toBeLessThan(agent.user.indexOf("additional context (provided between sessions)"));
  });

  it("renders neither rule nor section when the excerpt is empty or absent", async () => {
    for (const clientDm of [undefined, []]) {
      const agent = await promptFor({ canAskUser: true, clientDm });
      expect(agent.system).not.toContain(DM_RULE_MARKER);
      expect(agent.user).not.toContain(DM_SECTION_MARKER);
      // The pre-A2H ask_user rule is still fully present.
      expect(agent.system).toContain("Write the question yourself in askUser.question");
    }
  });

  it("withholds both whenever the ask_user grant is not live", async () => {
    // No grant; v1 (no ask_user vocabulary); final turn (must decide, not
    // pause). In each the rule is unrenderable, so the section — which the
    // rule is what explains — must be withheld too.
    for (const input of [
      { clientDm: DM },
      { canAskUser: true, protocolVersion: "v1" as const, clientDm: DM },
      { canAskUser: true, isFinalTurn: true, clientDm: DM },
    ]) {
      const agent = await promptFor(input);
      expect(agent.system).not.toContain(DM_RULE_MARKER);
      expect(agent.user).not.toContain(DM_SECTION_MARKER);
    }
  });

  it("grants the counterparty seat the same grounding", async () => {
    const agent = await promptFor({ seat: "counterparty", canAskUser: true, clientDm: DM });
    expect(agent.system).toContain(DM_RULE_MARKER);
    expect(agent.user).toContain(DM_SECTION_MARKER);
  });
});

// ─── The graph ───────────────────────────────────────────────────────────────

/** Pins the conversation to v2 with u-src as the stamped initiator. */
const V2_PRIOR_TASK = {
  id: "task-prior",
  conversationId: "conv-1",
  state: "completed",
  metadata: { type: "negotiation", protocolVersion: "v2", initiatorUserId: "u-src", sourceUserId: "u-src", candidateUserId: "u-cand" },
  createdAt: new Date(Date.now() - 3_600_000),
  updatedAt: new Date(Date.now() - 3_600_000),
};

/** One persisted prior turn — enough to make the next turn non-opening. */
const PRIOR_MESSAGES = [{
  id: "prior-0",
  senderId: "agent:u-src",
  role: "agent" as const,
  parts: [{ kind: "data", data: { action: "outreach", assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: "hi" } }],
  createdAt: new Date(Date.now() - 60_000),
}];

/** Each user's own signal. A query may only ever pair a user with their own. */
const OWN_INTENT: Record<string, string> = { "u-src": "intent-src", "u-cand": "intent-cand" };

function mkStubs() {
  const createdMessages: unknown[] = [];
  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string) => ({ id: "task-1", conversationId, state: "submitted" }),
    updateOpportunityStatus: async () => {},
    createMessage: async (p: { senderId: string; parts: unknown[] }) => {
      createdMessages.push(p);
      return { id: `msg-${createdMessages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async () => {},
    createArtifact: async () => {},
    setTaskTurnContext: async () => {},
    captureNegotiationAskUserBinding: async () => ({
      intentFingerprint: "fp", opportunityStatus: "pending", opportunityUpdatedAt: new Date(),
      counterpartyUserId: "u-cand", counterpartyIntentId: "intent-cand",
    }),
    getMessagesForConversation: async () => PRIOR_MESSAGES,
    getNegotiationMessages: async () => PRIOR_MESSAGES,
    getOpportunityUserAnswers: async () => [],
    getNegotiationTaskForOpportunity: async () => V2_PRIOR_TASK,
    getTask: async () => null,
    getLatestNegotiationTaskForConversation: async () => null,
    getUserContext: async () => ({ text: "" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const payloads: NegotiationTurnPayload[] = [];
  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async (_userId: string, _scope: unknown, payload: NegotiationTurnPayload) => {
      payloads.push(payload);
      return { handled: false, reason: "no_agent" };
    },
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  const timeoutQueue = {
    enqueueTimeout: async () => "job-1",
    cancelTimeout: async () => {},
    enqueueAskUserExpiry: async () => "askuser-job-1",
    cancelAskUserExpiry: async () => {},
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[2];

  const questionerEnqueue = async (_input: QuestionerEnqueuePayload) => {};

  const dmQueries: NegotiatorClientDmQuery[] = [];
  const clientDmRetrieve = async (query: NegotiatorClientDmQuery) => {
    dmQueries.push(query);
    return DM;
  };

  return { database, dispatcher, timeoutQueue, questionerEnqueue, clientDmRetrieve, payloads, dmQueries };
}

function runGraph(stubs: ReturnType<typeof mkStubs>, input: Record<string, unknown> = {}) {
  const graph = new NegotiationGraphFactory(
    stubs.database,
    stubs.dispatcher,
    stubs.timeoutQueue,
    stubs.questionerEnqueue,
    undefined,
    undefined,
    stubs.clientDmRetrieve,
  ).createGraph();
  return graph.invoke({
    sourceUser: { id: "u-src", intents: [], profile: { name: "Alice" } },
    candidateUser: { id: "u-cand", intents: [], profile: { name: "Bob" } },
    sourceIntentId: "intent-src",
    candidateIntentId: "intent-cand",
    indexContext: { networkId: "net-1", prompt: "" },
    seedAssessment: { reasoning: "complementary", valencyRole: "peer" },
    opportunityId: "opp-1",
    maxTurns: 4,
    ...input,
  } as Partial<typeof NegotiationGraphState.State>);
}

describe("negotiation graph — client-DM is system-agent-only", () => {
  let origInvoke: typeof IndexNegotiator.prototype.invoke;
  let agentInputs: NegotiationAgentInput[] = [];
  const origFlag = process.env.NEGOTIATION_ASK_USER_ENABLED;
  const origScreenMode = process.env.NEGOTIATION_SCREEN_MODE;
  const origPolicyMode = process.env.NEGOTIATION_CONSULTATION_POLICY_MODE;

  beforeAll(() => {
    origInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function (input: NegotiationAgentInput) {
      agentInputs.push(input);
      return {
        action: "decline",
        assessment: { reasoning: "not a fit", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
        message: null,
      } as NegotiationTurn;
    };
  });

  afterAll(() => { IndexNegotiator.prototype.invoke = origInvoke; });

  beforeEach(() => {
    agentInputs = [];
    process.env.NEGOTIATION_ASK_USER_ENABLED = "true";
    process.env.NEGOTIATION_SCREEN_MODE = "off";
    process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = "off";
  });

  afterEach(() => {
    if (origFlag === undefined) delete process.env.NEGOTIATION_ASK_USER_ENABLED;
    else process.env.NEGOTIATION_ASK_USER_ENABLED = origFlag;
    if (origScreenMode === undefined) delete process.env.NEGOTIATION_SCREEN_MODE;
    else process.env.NEGOTIATION_SCREEN_MODE = origScreenMode;
    if (origPolicyMode === undefined) delete process.env.NEGOTIATION_CONSULTATION_POLICY_MODE;
    else process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = origPolicyMode;
  });

  it("hands the excerpt to the system agent and NOTHING to the dispatch payload", async () => {
    const stubs = mkStubs();
    await runGraph(stubs);

    expect(agentInputs[0]?.clientDm).toEqual(DM);

    // The constraint. Every dispatched payload is inspected, not just the
    // first: an external registered agent can hold the personal-agent seat.
    expect(stubs.payloads.length).toBeGreaterThan(0);
    for (const payload of stubs.payloads) {
      expect(Object.keys(payload)).not.toContain("clientDm");
      expect(JSON.stringify(payload)).not.toContain("no equity below 12%");
    }
  });

  it("asks only for the ACTING user's own DM, keyed on their own signal", async () => {
    const stubs = mkStubs();
    await runGraph(stubs);

    expect(stubs.dmQueries.length).toBeGreaterThan(0);
    for (const query of stubs.dmQueries) {
      // No counterparty field exists to be filled in, correctly or otherwise.
      expect(Object.keys(query).sort()).toEqual(["intentId", "userId"]);
      // Whichever side is speaking, it is paired with its OWN signal — never
      // the counterparty's, which is the other entry in this map.
      expect(query.intentId).toBe(OWN_INTENT[query.userId]);
    }
  });

  it("does not retrieve at all when the ask_user grant is unavailable", async () => {
    // Flag off is the cheapest way to drop the grant; the negotiation must
    // run exactly as before, with no DM query issued.
    process.env.NEGOTIATION_ASK_USER_ENABLED = "false";
    const stubs = mkStubs();
    await runGraph(stubs);

    expect(stubs.dmQueries).toEqual([]);
    expect(agentInputs.length).toBeGreaterThan(0);
    for (const input of agentInputs) expect(input.clientDm).toBeUndefined();
  });

  it("runs the negotiation unchanged when the dep is absent entirely", async () => {
    const stubs = mkStubs();
    const graph = new NegotiationGraphFactory(
      stubs.database, stubs.dispatcher, stubs.timeoutQueue, stubs.questionerEnqueue,
    ).createGraph();
    const result = await graph.invoke({
      sourceUser: { id: "u-src", intents: [], profile: { name: "Alice" } },
      candidateUser: { id: "u-cand", intents: [], profile: { name: "Bob" } },
      sourceIntentId: "intent-src",
      candidateIntentId: "intent-cand",
      indexContext: { networkId: "net-1", prompt: "" },
      seedAssessment: { reasoning: "complementary", valencyRole: "peer" },
      opportunityId: "opp-1",
      maxTurns: 4,
    } as Partial<typeof NegotiationGraphState.State>);

    expect(result).toBeDefined();
    for (const input of agentInputs) expect(input.clientDm).toBeUndefined();
  });
});
