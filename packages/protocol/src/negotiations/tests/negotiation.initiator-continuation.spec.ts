import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";

import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState, type NegotiationTurn } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { buildAttributedDialogue } from "../negotiation.graph.shared.js";
import type { AttributedPriorDialogue, SeededAttribution } from "../negotiation.attribution.js";
import type { NegotiationGraphDatabase } from "../../shared/interfaces/database.interface.js";
import type { AgentDispatcher } from "../../shared/interfaces/agent-dispatcher.interface.js";

/**
 * The initiator seat re-opened on every one of its turns.
 *
 * Observed on dev (task 31da5811, one session, six turns):
 * `outreach, question, outreach, counter, outreach, accept` — turns 1/3/5 are
 * all initiator outreach, each a freshly reworded opening. The sibling
 * negotiation on a DM with no earlier messages behaved correctly, which is the
 * discriminator: the defect needs attributed prior dialogue to be active.
 *
 * Root cause: the turn node persisted each turn with the current task id but
 * dropped `taskId` from the message it appended to graph state. Since
 * `buildAttributedDialogue` matches this session's turns by that id, the
 * "[Current opportunity — under negotiation now]" block was always empty — and
 * because the attributed rendering REPLACES the flat history in the prompt,
 * every turn after the opening was blind to the exchange it was answering. The
 * prompt then told it the signal was new and to make its own case for it, so
 * the initiator did the only opening thing its seat allows: outreach again.
 */

function turn(action: string, reasoning: string, message?: string): NegotiationTurn {
  return {
    action: action as NegotiationTurn["action"],
    assessment: { reasoning, suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
    message: message ?? null,
  };
}

const sourceUser = {
  id: "user-source",
  intents: [{ id: "i-src", title: "Linguistics researchers", description: "d", confidence: 0.9 }],
  profile: { name: "Alice", bio: "CTO", skills: ["typescript"] },
};
const candidateUser = {
  id: "user-candidate",
  intents: [{ id: "i-cand", title: "NLP collaborators", description: "d", confidence: 0.9 }],
  profile: { name: "Bob", bio: "Researcher", skills: ["nlp"] },
};

const COUNTERPARTY_QUESTION = "How have you applied NLP in production?";

/**
 * A DM that already carries one concluded negotiation on a DIFFERENT
 * opportunity — the condition that turns on attributed prior dialogue, and the
 * only structural difference between the broken dev task and its healthy
 * sibling.
 */
function createDatabase(opts?: { emptyDm?: boolean }) {
  const earlierMessages = opts?.emptyDm ? [] : [
    {
      id: "m-earlier-1",
      senderId: `agent:${candidateUser.id}`,
      role: "agent" as const,
      parts: [{ kind: "data" as const, data: turn("outreach", "earlier opening", "Earlier pitch") }],
      createdAt: new Date(Date.now() - 500_000),
      taskId: "task-earlier",
    },
    {
      id: "m-earlier-2",
      senderId: `agent:${sourceUser.id}`,
      role: "agent" as const,
      parts: [{ kind: "data" as const, data: turn("accept", "earlier close", "Earlier accept") }],
      createdAt: new Date(Date.now() - 490_000),
      taskId: "task-earlier",
    },
  ];

  let msgCounter = 0;
  const createdMessages: Array<{ taskId?: string | null; action: string }> = [];

  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    getMessagesForConversation: async () => earlierMessages,
    // This negotiation's own scope (opp-current) starts empty: the session
    // opens the exchange itself.
    getNegotiationMessages: async () => [],
    getNegotiationTaskForOpportunity: async () => null,
    getLatestNegotiationTaskForConversation: async () => null,
    getTask: async (id: string) => (id === "task-earlier"
      ? {
          id: "task-earlier",
          conversationId: "conv-1",
          state: "completed",
          metadata: {
            opportunityId: "opp-earlier",
            sourceIntentId: "i-earlier",
            intentSnapshots: [{ userId: candidateUser.id, intentId: "i-earlier", title: "TypeScript collaboration", description: "" }],
          },
          createdAt: new Date(Date.now() - 510_000),
          updatedAt: new Date("2026-08-18T02:03:16Z"),
        }
      : null),
    getArtifactsForTask: async (id: string) => (id === "task-earlier"
      ? [{ id: "art-earlier", name: "negotiation-outcome", parts: [{ kind: "data", data: { hasOpportunity: true, turnCount: 2 } }], metadata: null }]
      : []),
    createTask: async () => ({ id: "task-current", conversationId: "conv-1", state: "submitted" }),
    createNegotiationTaskForAttempt: async () => ({ id: "task-current", conversationId: "conv-1", state: "submitted" }),
    // Deliberately does NOT echo taskId back: the graph must carry the id it
    // already knows, not depend on the adapter's projection.
    createMessage: async (p: { senderId: string; parts: unknown[] }) => {
      const data = (p.parts as Array<{ data?: { action?: string } }>)[0]?.data;
      createdMessages.push({ action: data?.action ?? "unknown" });
      return { id: `msg-${++msgCounter}`, senderId: p.senderId, role: "agent" as const, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async () => ({ id: "task-current", conversationId: "conv-1", state: "working" }),
    createArtifact: async () => ({ id: "art-new" }),
    setTaskTurnContext: async () => {},
    getOpportunityUserAnswers: async () => [],
    getTasksForUser: async () => [],
    getUserContext: async () => ({ text: "" }),
    updateOpportunityStatus: async () => ({ id: "opp-current", status: "negotiating" }),
  } as unknown as NegotiationGraphDatabase;

  return { database, createdMessages };
}

function createDispatcher() {
  return {
    dispatch: async () => ({ handled: false as const, reason: "no_agent" as const }),
    hasExternalAgent: async () => false,
  } as unknown as AgentDispatcher;
}

/**
 * What the agent can actually READ of this exchange, mirroring the prompt's own
 * selection rule: when attributed dialogue is supplied it REPLACES the flat
 * history, so an empty `current` block means a transcript-blind turn no matter
 * what `history` contains.
 */
function visibleExchange(input: NegotiationAgentInput): NegotiationTurn[] {
  const attributed = input.priorDialogue as AttributedPriorDialogue | undefined;
  return attributed ? attributed.current : input.history;
}

/**
 * Stands in for the real negotiator's judgement without a model: it replies
 * when it can see the counterparty's question, and re-opens when it cannot —
 * exactly the choice a transcript-blind initiator seat is left with, since
 * `outreach` is the only opening move in its vocabulary.
 */
function scriptNegotiator(captured: NegotiationAgentInput[]) {
  return async function (this: IndexNegotiator, input: NegotiationAgentInput): Promise<NegotiationTurn> {
    captured.push(input);
    const visible = visibleExchange(input);
    if (input.seat === "counterparty") {
      return visible.some((t) => t.action === "question" || t.action === "counter")
        ? turn("accept", "converged", "Happy to proceed")
        : turn("question", "need detail", COUNTERPARTY_QUESTION);
    }
    if (visible.length === 0) return turn("outreach", "opening", "Opening pitch");
    return visible.some((t) => t.action === "question")
      ? turn("counter", "answering the question", "Here is how we applied it")
      : turn("outreach", "re-opening because nothing to answer", "Freshly reworded pitch");
  };
}

async function runNegotiation(opts?: { emptyDm?: boolean }) {
  const captured: NegotiationAgentInput[] = [];
  const original = IndexNegotiator.prototype.invoke;
  IndexNegotiator.prototype.invoke = scriptNegotiator(captured) as typeof original;
  try {
    const { database, createdMessages } = createDatabase(opts);
    const graph = new NegotiationGraphFactory(database, createDispatcher()).createGraph();
    const result = await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext: { networkId: "net-1", prompt: "AI research" },
      seedAssessment: { reasoning: "seed", valencyRole: "peer" },
      opportunityId: "opp-current",
      maxTurns: 6,
    } as Partial<typeof NegotiationGraphState.State>);
    return { captured, createdMessages, result };
  } finally {
    IndexNegotiator.prototype.invoke = original;
  }
}

function actionsOf(result: { messages?: Array<{ parts: unknown[] }> }): string[] {
  return (result.messages ?? []).map((m) => {
    const dataPart = (m.parts as Array<{ kind?: string; data?: { action?: string } }>).find((p) => p.kind === "data");
    return dataPart?.data?.action ?? "unknown";
  });
}

// The outreach screen runs before first contact on every negotiation; stub it
// so these cases exercise the turns they are about rather than a live model.
describe("initiator continuation — this session's turns reach the next prompt", () => {
  let priorVersion: string | undefined;

  beforeEach(() => {
  });

  afterEach(() => {
  });

  it("the initiator replies to a question on its second turn instead of re-opening", async () => {
    const { captured, result } = await runNegotiation();

    expect(actionsOf(result)).toEqual(["outreach", "question", "counter", "accept"]);
    // The regression signature: outreach recurring after the opening turn.
    expect(actionsOf(result).slice(1)).not.toContain("outreach");

    const initiatorSecondTurn = captured.filter((i) => i.seat === "initiator")[1];
    expect(initiatorSecondTurn).toBeDefined();
    const visible = visibleExchange(initiatorSecondTurn!);
    expect(visible.map((t) => t.action)).toEqual(["outreach", "question"]);
    expect(visible[1].message).toBe(COUNTERPARTY_QUESTION);
  }, 30_000);

  it("the counterparty seat, which was already healthy, still sees the exchange", async () => {
    const { captured } = await runNegotiation();

    const counterpartyTurns = captured.filter((i) => i.seat === "counterparty");
    expect(counterpartyTurns.length).toBeGreaterThan(0);
    expect(visibleExchange(counterpartyTurns[0]!).map((t) => t.action)).toEqual(["outreach"]);
  }, 30_000);

  it("a DM with no earlier negotiation (the healthy sibling) is unaffected", async () => {
    const { captured, result } = await runNegotiation({ emptyDm: true });

    // No attributed dialogue at all — the flat history path, which never lost
    // the transcript. Same outcome, reached a different way.
    expect(captured[1]?.priorDialogue).toBeUndefined();
    expect(actionsOf(result)).toEqual(["outreach", "question", "counter", "accept"]);
  }, 30_000);
});

describe("buildAttributedDialogue — session turns are matched by task id", () => {
  const seeded: SeededAttribution = { earlier: [], unattributed: [], currentSeeded: [] };

  function stateWith(messages: Array<{ id: string; taskId?: string | null; action: string }>) {
    return {
      taskId: "task-current",
      priorAttribution: seeded,
      messages: messages.map((m) => ({
        id: m.id,
        senderId: `agent:${sourceUser.id}`,
        role: "agent" as const,
        parts: [{ kind: "data" as const, data: turn(m.action, m.action) }],
        createdAt: new Date(),
        ...(m.taskId !== undefined ? { taskId: m.taskId } : {}),
      })),
    } as unknown as Parameters<typeof buildAttributedDialogue>[0];
  }

  it("includes turns stamped with the current task id", () => {
    const dialogue = buildAttributedDialogue(stateWith([
      { id: "a", taskId: "task-current", action: "outreach" },
      { id: "b", taskId: "task-current", action: "question" },
    ]));
    expect(dialogue?.current.map((t) => t.action)).toEqual(["outreach", "question"]);
  });

  it("drops turns whose task id is missing — the defect this fix removes", () => {
    const dialogue = buildAttributedDialogue(stateWith([
      { id: "a", action: "outreach" },
      { id: "b", action: "question" },
    ]));
    expect(dialogue).toBeNull();
  });

  it("keeps another task's turns out of the current block", () => {
    const dialogue = buildAttributedDialogue(stateWith([
      { id: "a", taskId: "task-other", action: "outreach" },
      { id: "b", taskId: "task-current", action: "question" },
    ]));
    expect(dialogue?.current.map((t) => t.action)).toEqual(["question"]);
  });
});

/** Captures the chat messages the negotiator would send, without a live model. */
class CapturingNegotiator extends IndexNegotiator {
  captured: Array<{ role: string; content: string }> | null = null;
  constructor() {
    super({ turnTimeoutMs: 1000 });
  }
  protected override async callModel(_model: unknown, chatMessages: Array<{ role: string; content: string }>): Promise<unknown> {
    this.captured = chatMessages;
    return { action: "counter", assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null };
  }
}

function midExchangeInput(overrides?: Partial<NegotiationAgentInput>): NegotiationAgentInput {
  return {
    ownUser: { id: sourceUser.id, intents: [], profile: { name: "Alice" } },
    otherUser: { id: candidateUser.id, intents: [], profile: { name: "Bob" } },
    indexContext: { networkId: "net-1", prompt: "" },
    seedAssessment: { reasoning: "seed", valencyRole: "peer" },
    history: [turn("outreach", "opening", "Opening pitch"), turn("question", "asking", COUNTERPARTY_QUESTION)],
    seat: "initiator",
    protocolVersion: "v2",
    ...overrides,
  } as NegotiationAgentInput;
}

describe("negotiator prompt — a turn mid-exchange is not told the signal is new", () => {
  it("renders the running exchange and drops the make-your-own-case framing", async () => {
    const agent = new CapturingNegotiator();
    await agent.invoke(midExchangeInput({
      priorDialogue: {
        earlier: [{ opportunityId: "opp-earlier", opportunityTitle: "TypeScript collaboration", outcome: "accepted", concludedAt: "2026-08-18T02:03:16Z", turns: [turn("outreach", "earlier")] }],
        unattributed: [],
        current: [turn("outreach", "opening", "Opening pitch"), turn("question", "asking", COUNTERPARTY_QUESTION)],
      },
    }));
    const userMessage = agent.captured!.find((m) => m.role === "user")!.content;

    expect(userMessage).toContain("[Current opportunity — under negotiation now]");
    expect(userMessage).toContain(COUNTERPARTY_QUESTION);
    expect(userMessage).toContain("already under way");
    expect(userMessage).not.toContain("This signal is NEW");
    expect(userMessage).toContain("Evaluate the latest arguments and respond.");
  });

  it("the genuine opening turn keeps the new-signal framing", async () => {
    const agent = new CapturingNegotiator();
    await agent.invoke(midExchangeInput({
      history: [],
      priorDialogue: {
        earlier: [{ opportunityId: "opp-earlier", opportunityTitle: "TypeScript collaboration", outcome: "accepted", concludedAt: "2026-08-18T02:03:16Z", turns: [turn("outreach", "earlier")] }],
        unattributed: [],
        current: [],
      },
    }));
    const userMessage = agent.captured!.find((m) => m.role === "user")!.content;

    expect(userMessage).toContain("This signal is NEW");
    expect(userMessage).not.toContain("already under way");
    expect(userMessage).toContain("This is the opening turn. Make the outreach case.");
  });

  it("a continuation of this negotiation keeps its own continuing-dialogue framing", async () => {
    const agent = new CapturingNegotiator();
    await agent.invoke(midExchangeInput({ isContinuation: true }));
    const userMessage = agent.captured!.find((m) => m.role === "user")!.content;

    expect(userMessage).toContain("You are continuing a prior dialogue");
    expect(userMessage).not.toContain("This signal is NEW");
  });
});
