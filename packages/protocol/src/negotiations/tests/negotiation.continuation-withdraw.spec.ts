import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import type { NegotiationGraphDatabase } from "../../shared/interfaces/database.interface.js";
import type { AgentDispatcher } from "../../shared/interfaces/agent-dispatcher.interface.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import type { NegotiationTurn } from "../negotiation.state.js";

/**
 * IND-564 — never emit `withdraw` as an opening move.
 *
 * `withdraw` retracts an outreach. Emitted before one exists, it would drop a
 * spurious "connection withdrawn" message into the shared dm_pair thread for a
 * connection the counterparty was never offered, so the graph maps it to the
 * quiet screen-out outcome instead:
 *  - no message persisted into the shared conversation,
 *  - turnCount stays 0,
 *  - the opportunity is quietly `rejected` with reason `screened_out`.
 *
 * The guard's subject is an outreach that was never MADE, not one this task did
 * not make. `outreachOpened` alone answers only for the current task, and a
 * continuation of a CONTACTED negotiation — an error-stalled run recovered
 * through `negotiation-run-existing` — has an outreach on the counterparty's
 * thread from an earlier session. A withdraw there retracts a real message and
 * persists as the real move it is; routing it to `screened_out` would tell the
 * owner no contact was ever made, directly above the message that was.
 *
 * `withdraw` is therefore legal after an in-task `outreach` OR after any turn
 * this negotiation persisted in an earlier session.
 */

type FakeMessage = {
  id: string;
  senderId: string;
  role: "agent";
  parts: unknown[];
  createdAt: Date;
};

function priorMsg(senderUserId: string, action: string, idx: number): FakeMessage {
  return {
    id: `prior-${idx}`,
    senderId: `agent:${senderUserId}`,
    role: "agent",
    parts: [{ kind: "data", data: { action, assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null } }],
    createdAt: new Date(Date.now() - (100 - idx) * 1000),
  };
}

function mkStubs(priorMessages: FakeMessage[] = []) {
  const createdMessages: Array<{ senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }> = [];
  const statusUpdates: Array<{ opportunityId: string; status: string }> = [];
  const artifacts: Array<Record<string, unknown>> = [];
  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string) => ({ id: "task-new", conversationId, state: "submitted" }),
    createMessage: async (p: { senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }) => {
      createdMessages.push(p);
      return { id: `msg-${createdMessages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async () => ({ id: "task-new", conversationId: "conv-1", state: "working" }),
    createArtifact: async (a: Record<string, unknown>) => { artifacts.push(a); return { id: "art-1" }; },
    setTaskTurnContext: async () => {},
    updateOpportunityStatus: async (opportunityId: string, status: string) => {
      statusUpdates.push({ opportunityId, status });
      return { id: opportunityId, status };
    },
    getNegotiationTaskForOpportunity: async () => null,
    getOpportunityUserAnswers: async () => [],
    getMessagesForConversation: async () => priorMessages,
    getNegotiationMessages: async () => priorMessages,
    getLatestNegotiationTaskForConversation: async () => null,
    getUserContext: async () => null,
    getTask: async () => null,
    getArtifactsForTask: async () => [],
  } as unknown as NegotiationGraphDatabase;

  const dispatcher = {
    dispatch: async () => ({ handled: false as const, reason: "no_agent" as const }),
    hasExternalAgent: async () => false,
  } as unknown as AgentDispatcher;

  return { database, dispatcher, createdMessages, statusUpdates, artifacts };
}

const sourceUser = {
  id: "u-src",
  intents: [{ id: "intent-src", title: "Build AI", description: "Find a collaborator", confidence: 1 }],
  profile: { name: "Alice", bio: "PM", skills: ["product"] },
};
const candidateUser = {
  id: "u-cand",
  intents: [{ id: "intent-cand", title: "Apply ML", description: "Join an AI product", confidence: 1 }],
  profile: { name: "Bob", bio: "ML engineer", skills: ["ml"] },
};
const seed = { reasoning: "complementary", valencyRole: "peer" };
const indexContext = { networkId: "net-1", prompt: "AI network" };

let agentScript: NegotiationTurn[] = [];
const origInvoke = IndexNegotiator.prototype.invoke;

async function runGraph(stubs: ReturnType<typeof mkStubs>, input: Record<string, unknown> = {}) {
  const graph = new NegotiationGraphFactory(stubs.database, stubs.dispatcher).createGraph();
  return graph.invoke({
    sourceUser,
    candidateUser,
    sourceIntentId: "intent-src",
    candidateIntentId: "intent-cand",
    indexContext,
    seedAssessment: seed,
    opportunityId: "opp-1",
    maxTurns: 6,
    ...input,
  } as Partial<typeof NegotiationGraphState.State>);
}

// The outreach screen runs before first contact on every negotiation; stub it
// so these cases exercise the turns they are about rather than a live model.
describe("negotiation graph — opening-move withdraw guard (IND-564)", () => {

  beforeEach(() => {
    agentScript = [];
    IndexNegotiator.prototype.invoke = async function (_input: NegotiationAgentInput) {
      const turn = agentScript.shift();
      if (!turn) throw new Error("agent script exhausted");
      return turn;
    };
  });

  afterEach(() => {
  });

  afterAll(() => {
    IndexNegotiator.prototype.invoke = origInvoke;
  });

  it("continuation of a CONTACTED negotiation + first-turn withdraw ⇒ a real retraction, not a screen-out", async () => {
    // Prior dialogue from an EARLIER task (seeded): u-src outreached, u-cand
    // countered. Last speaker is u-cand ⇒ u-src (the initiator) speaks first
    // in this continuation and immediately withdraws. There IS an outreach to
    // retract — it is on the counterparty's thread — so the withdraw is a move,
    // not a spurious message, and the negotiation ended in the open.
    const stubs = mkStubs([priorMsg("u-src", "outreach", 0), priorMsg("u-cand", "counter", 1)]);
    agentScript = [{
      action: "withdraw",
      assessment: { reasoning: "the new signal is a poor fit", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
      message: "on reflection, not a fit",
    }];

    const result = await runGraph(stubs);

    expect(stubs.createdMessages.length).toBe(1);
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("withdraw");
    // A negotiation the counterparty already heard from can never be recorded
    // as one where neither side reached out.
    expect(result.outcome?.hasOpportunity).toBe(false);
    expect(result.outcome?.reason).not.toBe("screened_out");
    // Reject-like, so the opportunity still ends `rejected` — openly.
    expect(stubs.statusUpdates).toEqual([
      { opportunityId: "opp-1", status: "negotiating" },
      { opportunityId: "opp-1", status: "rejected" },
    ]);
  }, 30_000);

  it("continuation whose only prior turn is a consult park + withdraw ⇒ still the quiet screen-out", async () => {
    // An `ask_user` park is persisted, but it was addressed to the client's own
    // principal: no outreach exists to retract, so the guard still applies and
    // nothing lands in the shared thread.
    const stubs = mkStubs([priorMsg("u-src", "ask_user", 0)]);
    agentScript = [{
      action: "withdraw",
      assessment: { reasoning: "the client's answer settled it against reaching out", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
      message: "not proceeding",
    }];

    const result = await runGraph(stubs);

    expect(stubs.createdMessages.length).toBe(0);
    expect(result.outcome?.reason).toBe("screened_out");
    expect(result.outcome?.turnCount).toBe(0);
    expect(result.outcome?.reasoning).toContain("settled it against reaching out");
    expect(stubs.statusUpdates).toEqual([
      { opportunityId: "opp-1", status: "negotiating" },
      { opportunityId: "opp-1", status: "rejected" },
    ]);
  }, 30_000);

  it("withdraw AFTER an in-task outreach is legal — the withdraw message persists", async () => {
    // Fresh negotiation: turn 0 opens outreach (guard-forced), turn 1 the
    // counterparty counters, turn 2 the initiator withdraws — now legal.
    const stubs = mkStubs();
    agentScript = [
      { action: "outreach", assessment: { reasoning: "reaching out", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: "hi" },
      { action: "counter", assessment: { reasoning: "some concerns", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: "but why" },
      { action: "withdraw", assessment: { reasoning: "decided against", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: "we'll pass" },
    ];

    const result = await runGraph(stubs);

    // All three turns persisted, including the (legal) withdraw.
    expect(stubs.createdMessages.length).toBe(3);
    expect(stubs.createdMessages[2].parts[0].data.action).toBe("withdraw");
    // A legitimate withdraw is a normal reject-like outcome, NOT a screen-out.
    expect(result.outcome?.hasOpportunity).toBe(false);
    expect(result.outcome?.reason).not.toBe("screened_out");
    // Opportunity rejected via the normal reject-like mapping.
    expect(stubs.statusUpdates).toEqual([
      { opportunityId: "opp-1", status: "negotiating" },
      { opportunityId: "opp-1", status: "rejected" },
    ]);
  }, 30_000);

  it("continuation + first-turn counter (not withdraw) is untouched — the turn persists", async () => {
    const stubs = mkStubs([priorMsg("u-src", "outreach", 0), priorMsg("u-cand", "counter", 1)]);
    agentScript = [
      { action: "counter", assessment: { reasoning: "still interested, one concern", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: "what about X" },
      { action: "decline", assessment: { reasoning: "ok not for us", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null },
    ];

    const result = await runGraph(stubs);

    // The opening counter is a normal turn — it persists into the thread.
    expect(stubs.createdMessages.length).toBeGreaterThanOrEqual(1);
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("counter");
    expect(result.outcome?.reason).not.toBe("screened_out");
  }, 30_000);
});
