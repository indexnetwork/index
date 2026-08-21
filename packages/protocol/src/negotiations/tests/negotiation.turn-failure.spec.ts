import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState, type NegotiationTurn } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NegotiationStallGapAuthor, type NegotiationStallGap, type StallGapAuthorInput } from "../negotiation.stall-gap.js";
import { MAX_CONSECUTIVE_TURN_FAILURES } from "../negotiation.turn-failure.js";
import { stubScreenerReachOut } from "./screen.stub.js";

/**
 * Failed turns: not a decision, not a turn, never silent.
 *
 * The incident this pins, observed on the sandbox minutes after the checklist
 * negotiations shipped: a negotiation displayed "Stalled — agents ran out of
 * turns. The dialogue hit its 6-turn budget without agreement." with exactly
 * ONE message in the thread. The responder's model call had exceeded the
 * per-turn abort ceiling; the failure spent a turn, wrote nothing, and
 * finalize reported an exhausted budget for a dialogue that never happened.
 *
 * Pins:
 * - a responder that throws every turn ends the negotiation `agent_error`
 *   after the bound, with the outreach still the only message, the turn count
 *   NOT run down to the cap, and a durable failure trace on the task,
 * - a transient failure (throw once, succeed after) neither ends the
 *   negotiation nor spends a turn,
 * - a genuine out-of-turns stall is untouched: `turn_cap`, and the post-stall
 *   park still runs,
 * - an error-stalled run does NOT park: there is no dialogue to draw a gap
 *   from, and the failure is ours rather than an information need of theirs.
 */

type FakeTurn = { senderId: string; taskId?: string; parts: Array<{ kind: string; data: NegotiationTurn }> };

const outreachTurn: NegotiationTurn = {
  action: "outreach",
  assessment: { reasoning: "Their ML work fits the hire", suggestedRoles: { ownUser: "patient", otherUser: "agent" } },
  message: "Hi — my client is hiring independent ML engineers.",
};
const counterTurn: NegotiationTurn = {
  action: "counter",
  assessment: { reasoning: "still apart", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
  message: null,
};

/** The exact rejection `AbortSignal.timeout` produces when a turn overruns. */
const TURN_TIMEOUT_ERROR = "The operation timed out.";

function mkStubs(opts?: { failStateWriteAfterMessage?: boolean }) {
  const createdMessages: FakeTurn[] = [];
  const stateWrites: Array<{ state: string; statusMessage?: unknown }> = [];
  const opportunityStatuses: string[] = [];
  const failedTurnWrites: Array<Array<Record<string, unknown>>> = [];
  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string) => ({ id: "task-1", conversationId, state: "submitted" }),
    updateOpportunityStatus: async (_id: string, status: string) => { opportunityStatuses.push(status); },
    createMessage: async (p: FakeTurn) => {
      createdMessages.push(p);
      return { id: `msg-${createdMessages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async (_taskId: string, state: string, statusMessage?: unknown) => {
      // Simulates a throw AFTER the turn reached the conversation — the shape
      // the ask_user park machinery has (persist the turn, then park it).
      if (opts?.failStateWriteAfterMessage && state === "working" && createdMessages.length > 0) {
        throw new Error("park machinery exploded");
      }
      stateWrites.push({ state, statusMessage });
    },
    setTaskFailedTurns: async (_taskId: string, failedTurns: Array<Record<string, unknown>>) => { failedTurnWrites.push(failedTurns); },
    createArtifact: async () => ({ id: "artifact-1" }),
    setTaskTurnContext: async () => {},
    getMessagesForConversation: async () => [],
    getNegotiationMessages: async () => [],
    getOpportunityUserAnswers: async () => [],
    getNegotiationTaskForOpportunity: async () => null,
    getLatestNegotiationTaskForConversation: async () => null,
    getUserContext: async () => ({ text: "user ctx" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async () => ({ handled: false, reason: "no_agent" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  return { database, dispatcher, createdMessages, stateWrites, opportunityStatuses, failedTurnWrites };
}

async function runGraph(stubs: ReturnType<typeof mkStubs>, maxTurns = 6) {
  const graph = new NegotiationGraphFactory(stubs.database, stubs.dispatcher).createGraph();
  return graph.invoke({
    sourceUser: { id: "u-src", intents: [{ id: "intent-src", title: "Hire ML", description: "Hire independent ML engineers", confidence: 1 }], profile: { name: "Alice", bio: "PM" } },
    candidateUser: { id: "u-cand", intents: [], profile: { name: "Bob", bio: "ML engineer" } },
    sourceIntentId: "intent-src",
    indexContext: { networkId: "net-1", prompt: "" },
    seedAssessment: { reasoning: "x", valencyRole: "peer" },
    opportunityId: "opp-1",
    maxTurns,
  } as Partial<typeof NegotiationGraphState.State>);
}

/** Scripted seam: what each seat's agent does when asked for a turn. */
let onInvoke: (input: NegotiationAgentInput) => Promise<NegotiationTurn> = async () => outreachTurn;
let authorCalls: StallGapAuthorInput[] = [];
let authorResult: NegotiationStallGap | null = null;

// The outreach screen runs before first contact on every negotiation; stub it
// so these cases exercise the turns they are about rather than a live model.
const restoreScreenStub = stubScreenerReachOut();
afterAll(() => { restoreScreenStub(); });

describe("negotiation graph — failed turns", () => {
  let origInvoke: typeof IndexNegotiator.prototype.invoke;
  let origAuthor: typeof NegotiationStallGapAuthor.prototype.author;
  const origScreenMode = process.env.NEGOTIATION_SCREEN_MODE;
  const origVersion = process.env.NEGOTIATION_PROTOCOL_VERSION;

  beforeAll(() => {
    origInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = function (input: NegotiationAgentInput) { return onInvoke(input); };
    origAuthor = NegotiationStallGapAuthor.prototype.author;
    NegotiationStallGapAuthor.prototype.author = async function (input: StallGapAuthorInput) {
      authorCalls.push(input);
      return authorResult;
    };
  });

  afterAll(() => {
    IndexNegotiator.prototype.invoke = origInvoke;
    NegotiationStallGapAuthor.prototype.author = origAuthor;
  });

  beforeEach(() => {
    authorCalls = [];
    authorResult = null;
    process.env.NEGOTIATION_SCREEN_MODE = "off";
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
  });

  afterEach(() => {
    if (origScreenMode === undefined) delete process.env.NEGOTIATION_SCREEN_MODE; else process.env.NEGOTIATION_SCREEN_MODE = origScreenMode;
    if (origVersion === undefined) delete process.env.NEGOTIATION_PROTOCOL_VERSION; else process.env.NEGOTIATION_PROTOCOL_VERSION = origVersion;
  });

  it("ends error-stalled when the responder fails every turn, with the outreach still the only message", async () => {
    const stubs = mkStubs();
    let responderAttempts = 0;
    onInvoke = async (input) => {
      if (input.seat === "counterparty") {
        responderAttempts += 1;
        throw new Error(TURN_TIMEOUT_ERROR);
      }
      return outreachTurn;
    };

    const result = await runGraph(stubs);

    // The responder was retried, and the bound — not the turn budget — is what
    // ended the run.
    expect(responderAttempts).toBe(MAX_CONSECUTIVE_TURN_FAILURES);
    // One landed turn, so one message: the outreach. No park message, no
    // synthesized decision.
    expect(stubs.createdMessages).toHaveLength(1);
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("outreach");
    expect(authorCalls).toHaveLength(0);

    // The outcome tells the truth: an agent error, not an exhausted budget.
    expect(result.outcome?.reason).toBe("agent_error");
    expect(result.outcome?.turnCount).toBe(1);
    expect(result.outcome?.hasOpportunity).toBe(false);

    // Recoverable, never declined.
    expect(stubs.opportunityStatuses[stubs.opportunityStatuses.length - 1]).toBe("stalled");
    expect(stubs.opportunityStatuses).not.toContain("rejected");

    // Durable trace: one record per failure, naming the seat that could not
    // produce a turn and the error that stopped it.
    const lastWrite = stubs.failedTurnWrites[stubs.failedTurnWrites.length - 1];
    expect(stubs.failedTurnWrites).toHaveLength(MAX_CONSECUTIVE_TURN_FAILURES);
    expect(lastWrite).toHaveLength(MAX_CONSECUTIVE_TURN_FAILURES);
    expect(lastWrite[0]).toMatchObject({ seat: "counterparty", turnIndex: 1, error: TURN_TIMEOUT_ERROR });
    expect(typeof lastWrite[0].at).toBe("string");

    // …and the terminal task status says why the task is over.
    const completion = stubs.stateWrites.find((w) => w.state === "completed");
    expect(completion?.statusMessage).toMatchObject({
      reason: "negotiation_agent_error",
      consecutiveTurnFailures: MAX_CONSECUTIVE_TURN_FAILURES,
      seat: "counterparty",
      lastError: TURN_TIMEOUT_ERROR,
    });
  });

  it("absorbs a transient failure: the negotiation continues and the failed turn spends no budget", async () => {
    const stubs = mkStubs();
    let failed = false;
    let landedTurns = 0;
    onInvoke = async (input) => {
      if (input.seat === "counterparty" && !failed) {
        failed = true;
        throw new Error(TURN_TIMEOUT_ERROR);
      }
      landedTurns += 1;
      return input.history.length === 0 ? outreachTurn : counterTurn;
    };

    const result = await runGraph(stubs, 3);

    expect(failed).toBe(true);
    // Three turns landed and were persisted — the failure took none of them.
    expect(landedTurns).toBe(3);
    expect(stubs.createdMessages).toHaveLength(3);
    expect(result.outcome?.turnCount).toBe(3);
    // It ran out of turns for real, so it says so.
    expect(result.outcome?.reason).toBe("turn_cap");
    // The failure is still recorded, even though it changed nothing.
    expect(stubs.failedTurnWrites).toHaveLength(1);
    expect(stubs.failedTurnWrites[0]).toHaveLength(1);
  });

  it("never retries a turn that already reached the conversation", async () => {
    const stubs = mkStubs({ failStateWriteAfterMessage: true });
    let invocations = 0;
    onInvoke = async () => { invocations += 1; return outreachTurn; };

    const result = await runGraph(stubs);

    // One attempt, one message: a retry here would have persisted the same
    // turn twice and handed the floor to a seat that had already spoken.
    expect(invocations).toBe(1);
    expect(stubs.createdMessages).toHaveLength(1);
    // The turn is on the record, so it counts — and the run still ends
    // honestly as an agent error rather than as a spent budget.
    expect(result.outcome?.turnCount).toBe(1);
    expect(result.outcome?.reason).toBe("agent_error");
    expect(stubs.failedTurnWrites).toHaveLength(1);
  });

  it("leaves a genuine out-of-turns stall alone: turn_cap, and the park still runs", async () => {
    const stubs = mkStubs();
    authorResult = {
      reason: "unresolved_owner_constraint",
      question: {
        title: "Timing",
        prompt: "When could you realistically start?",
        options: [
          { label: "This quarter", description: "A retry pushes for an immediate start." },
          { label: "Later this year", description: "A retry proposes a slower ramp-up." },
        ],
        multiSelect: false,
      },
    };
    onInvoke = async (input) => (input.history.length === 0 ? outreachTurn : counterTurn);

    const result = await runGraph(stubs, 2);

    expect(result.outcome?.reason).toBe("turn_cap");
    expect(result.outcome?.turnCount).toBe(2);
    // Two turns plus the park message.
    expect(stubs.createdMessages).toHaveLength(3);
    expect(stubs.createdMessages[2].parts[0].data.action).toBe("ask_user");
    expect(authorCalls[0]?.stallReason).toBe("turn_cap");
    // Nothing failed, so nothing was recorded.
    expect(stubs.failedTurnWrites).toHaveLength(0);
    const completion = stubs.stateWrites.find((w) => w.state === "completed");
    expect(completion?.statusMessage).toBeUndefined();
  });
});
