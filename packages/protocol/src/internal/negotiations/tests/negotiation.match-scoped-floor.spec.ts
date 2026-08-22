import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator } from "../negotiation.agent.js";

/**
 * A negotiation owns its own turn state; the conversation only supplies context.
 *
 * Two agents share one DM forever (`getOrCreateDM` keys on the agent pair), so a
 * fresh match lands in a room that already holds concluded negotiations for other
 * matches. The floor and the opening requirement must be derived from the match
 * under negotiation — never from the room — or a new match silently inherits the
 * turn parity of an unrelated one and the counterparty can accept before the
 * initiator has spoken.
 */

type TaskRecord = {
  id: string;
  conversationId: string;
  state: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
};

const INITIATOR = "u-init";
const COUNTERPARTY = "u-counter";

function priorTurnMessage(opts: {
  id: string;
  taskId: string;
  senderId: string;
  action: string;
  createdAt: Date;
}) {
  return {
    id: opts.id,
    senderId: opts.senderId,
    role: "agent" as const,
    taskId: opts.taskId,
    parts: [{
      kind: "data" as const,
      data: {
        action: opts.action,
        assessment: {
          reasoning: "prior",
          suggestedRoles: { ownUser: "peer", otherUser: "peer" },
        },
      },
    }],
    createdAt: opts.createdAt,
  };
}

function mkStubs(opts: {
  priorMessages: ReturnType<typeof priorTurnMessage>[];
  tasks: Record<string, TaskRecord>;
}) {
  const created: Array<{ senderId: string; parts: unknown[]; taskId?: string }> = [];
  let counter = 0;

  const database = {
    createConversation: async () => ({ id: "conv-1" }),
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string, metadata: Record<string, unknown>) => ({
      id: "task-new", conversationId, state: "submitted", metadata,
    }),
    createMessage: async (p: { senderId: string; parts: unknown[]; taskId?: string }) => {
      created.push(p);
      return {
        id: `msg-new-${++counter}`,
        senderId: p.senderId,
        parts: p.parts,
        taskId: p.taskId ?? null,
        createdAt: new Date(),
      };
    },
    updateTaskState: async () => {},
    createArtifact: async () => {},
    setTaskTurnContext: async () => {},
    updateOpportunityStatus: async () => {},
    getOpportunityUserAnswers: async () => [],
    getArtifactsForTask: async () => [],
    getUserContext: async () => null,
    getMessagesForConversation: async () => opts.priorMessages,
    // In-memory stand-in for the messages⋈tasks join: a message belongs to the
    // negotiation whose task carries that opportunityId.
    getNegotiationMessages: async (opportunityId: string) => opts.priorMessages.filter(
      (m) => opts.tasks[m.taskId]?.metadata?.opportunityId === opportunityId,
    ),
    getTask: async (taskId: string) => opts.tasks[taskId] ?? null,
    getNegotiationTaskForOpportunity: async () => null,
    getLatestNegotiationTaskForConversation: async () => null,
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async () => ({ handled: false, reason: "no_agent" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  return { database, dispatcher, created };
}

function actionOf(parts: unknown[]): string | undefined {
  const part = (parts as Array<{ kind?: string; data?: { action?: string } }>)
    .find((p) => p.kind === "data");
  return part?.data?.action;
}

// The outreach screen runs before first contact on every negotiation; stub it
// so these cases exercise the turns they are about rather than a live model.
describe("negotiation floor is scoped to the match, not the conversation", () => {
  let origInvoke: typeof IndexNegotiator.prototype.invoke;
  let origVersion: string | undefined;
  let origScreen: string | undefined;

  beforeAll(() => {
    origInvoke = IndexNegotiator.prototype.invoke;
    // Both sides are willing. The counterparty seat's `accept` is what
    // terminates a negotiation on turn 0 when the floor is wrong.
    IndexNegotiator.prototype.invoke = async function () {
      return {
        action: "accept" as const,
        assessment: {
          reasoning: "stub",
          suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const },
        },
        message: "yes",
      };
    };
  });

  afterAll(() => {
    IndexNegotiator.prototype.invoke = origInvoke;
  });

  it("a fresh match opens with its initiator even when the room's last turn was the initiator's", async () => {
    // A concluded negotiation for a DIFFERENT match, whose last turn was the
    // initiator's. Conversation-scoped parity would hand the floor straight to
    // the counterparty — who may accept, terminating before any opening.
    const stubs = mkStubs({
      priorMessages: [
        priorTurnMessage({
          id: "msg-old-1", taskId: "task-old", senderId: `agent:${COUNTERPARTY}`,
          action: "outreach", createdAt: new Date(Date.now() - 120_000),
        }),
        priorTurnMessage({
          id: "msg-old-2", taskId: "task-old", senderId: `agent:${INITIATOR}`,
          action: "accept", createdAt: new Date(Date.now() - 60_000),
        }),
      ],
      tasks: {
        "task-old": {
          id: "task-old",
          conversationId: "conv-1",
          state: "completed",
          metadata: { type: "negotiation", opportunityId: "opp-old" },
          createdAt: new Date(Date.now() - 180_000),
          updatedAt: new Date(Date.now() - 60_000),
        },
      },
    });

    const graph = new NegotiationGraphFactory(stubs.database, stubs.dispatcher).createGraph();
    await graph.invoke({
      sourceUser: { id: INITIATOR, intents: [], profile: { name: "Alice" } },
      candidateUser: { id: COUNTERPARTY, intents: [], profile: { name: "Bob" } },
      indexContext: { networkId: "net-1", prompt: "" },
      seedAssessment: { reasoning: "new match", valencyRole: "peer" },
      opportunityId: "opp-new",
      initiatorUserId: INITIATOR,
      maxTurns: 2,
    } as Partial<typeof NegotiationGraphState.State>);

    expect(stubs.created.length).toBeGreaterThan(0);
    // The initiator speaks first on its own match.
    expect(stubs.created[0].senderId).toBe(`agent:${INITIATOR}`);
    // And it must open, not close.
    expect(actionOf(stubs.created[0].parts)).toBe("outreach");
    // A real exchange, not a single-turn accept.
    expect(stubs.created.length).toBe(2);
    expect(stubs.created[1].senderId).toBe(`agent:${COUNTERPARTY}`);
  }, 30_000);

  it("within one match, the floor still passes to the other side", async () => {
    // Same match resumed (e.g. after an ask_user pause or a timeout park):
    // prior turns belong to THIS opportunity, so normal alternation applies and
    // no second opening is forced.
    const stubs = mkStubs({
      priorMessages: [
        priorTurnMessage({
          id: "msg-cur-1", taskId: "task-cur", senderId: `agent:${INITIATOR}`,
          action: "outreach", createdAt: new Date(Date.now() - 60_000),
        }),
      ],
      tasks: {
        "task-cur": {
          id: "task-cur",
          conversationId: "conv-1",
          state: "completed",
          metadata: { type: "negotiation", opportunityId: "opp-new" },
          createdAt: new Date(Date.now() - 120_000),
          updatedAt: new Date(Date.now() - 60_000),
        },
      },
    });

    const graph = new NegotiationGraphFactory(stubs.database, stubs.dispatcher).createGraph();
    await graph.invoke({
      sourceUser: { id: INITIATOR, intents: [], profile: { name: "Alice" } },
      candidateUser: { id: COUNTERPARTY, intents: [], profile: { name: "Bob" } },
      indexContext: { networkId: "net-1", prompt: "" },
      seedAssessment: { reasoning: "same match", valencyRole: "peer" },
      opportunityId: "opp-new",
      initiatorUserId: INITIATOR,
      maxTurns: 2,
    } as Partial<typeof NegotiationGraphState.State>);

    expect(stubs.created.length).toBe(1);
    expect(stubs.created[0].senderId).toBe(`agent:${COUNTERPARTY}`);
    expect(actionOf(stubs.created[0].parts)).toBe("accept");
  }, 30_000);
});
