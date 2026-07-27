import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import type { NegotiationGraphDatabase } from "../../shared/interfaces/database.interface.js";
import type { AgentDispatcher } from "../../shared/interfaces/agent-dispatcher.interface.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import type { NegotiationTurn } from "../negotiation.state.js";

/**
 * IND-611 prerequisite — an honest turn-0 refusal must stand.
 *
 * Before this change the graph ran the turn-0 opening force BEFORE the IND-564
 * opening-withdraw guard:
 *
 *   turnLog.warn('Agent returned unexpected action on turn 0, forcing to outreach')
 *   turn.action = 'outreach'
 *
 * so a v2 initiator that judged the match not worth making had its refusal
 * rewritten into an outreach while its `reasoning` survived intact — an
 * outreach message sent to the counterparty carrying reasoning that argues
 * against the match. It also made the guard below it dead code on turn 0.
 *
 * The order is now inverted. This spec pins both halves:
 *  - a turn-0 `withdraw` is NOT rewritten: no message is persisted, the
 *    negotiation ends in the quiet `screened_out` outcome with turnCount 0,
 *  - a genuinely malformed turn-0 opening (`counter`) is STILL coerced to the
 *    opening action, so the original force keeps doing its real job.
 *
 * Harness mirrors negotiation.continuation-withdraw.spec.ts (the house pattern
 * for graph-level turn-action policy): stubbed database/dispatcher, scripted
 * agent turns, no live provider.
 */

type FakeMessage = {
  id: string;
  senderId: string;
  role: "agent";
  parts: unknown[];
  createdAt: Date;
};

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

describe("negotiation graph — turn-0 refusal is not force-rewritten (IND-611)", () => {
  const origVersion = process.env.NEGOTIATION_PROTOCOL_VERSION;
  const origScreen = process.env.NEGOTIATION_SCREEN_MODE;

  beforeEach(() => {
    agentScript = [];
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    process.env.NEGOTIATION_SCREEN_MODE = "off"; // isolate the turn node from the screen gate
    IndexNegotiator.prototype.invoke = async function (_input: NegotiationAgentInput) {
      const turn = agentScript.shift();
      if (!turn) throw new Error("agent script exhausted");
      return turn;
    };
  });

  afterEach(() => {
    if (origVersion === undefined) delete process.env.NEGOTIATION_PROTOCOL_VERSION; else process.env.NEGOTIATION_PROTOCOL_VERSION = origVersion;
    if (origScreen === undefined) delete process.env.NEGOTIATION_SCREEN_MODE; else process.env.NEGOTIATION_SCREEN_MODE = origScreen;
  });

  afterAll(() => {
    IndexNegotiator.prototype.invoke = origInvoke;
  });

  it("fresh v2 negotiation + turn-0 withdraw ⇒ refusal stands, quiet screened_out, no outreach sent", async () => {
    const stubs = mkStubs();
    agentScript = [{
      action: "withdraw",
      assessment: { reasoning: "this match is not worth Alice's attention", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
      message: null,
    }];

    const result = await runGraph(stubs);

    // The critical regression: no outreach carrying anti-match reasoning is
    // persisted into the shared thread.
    expect(stubs.createdMessages.length).toBe(0);
    expect(result.outcome?.hasOpportunity).toBe(false);
    expect(result.outcome?.reason).toBe("screened_out");
    expect(result.outcome?.turnCount).toBe(0);
    // The refusal's own reasoning survives into the outcome (what the
    // owner-only gate-decision card renders).
    expect(result.outcome?.reasoning).toContain("not worth Alice's attention");
    expect(stubs.statusUpdates).toEqual([
      { opportunityId: "opp-1", status: "negotiating" },
      { opportunityId: "opp-1", status: "rejected" },
    ]);
  }, 30_000);

  it("the refused turn is never rewritten to the opening action", async () => {
    const stubs = mkStubs();
    agentScript = [{
      action: "withdraw",
      assessment: { reasoning: "no genuine fit", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
      message: null,
    }];

    const result = await runGraph(stubs);

    expect(result.lastTurn?.action).toBe("withdraw");
    expect(result.lastTurn?.action).not.toBe("outreach");
  }, 30_000);

  it("a malformed turn-0 opening (counter) is STILL coerced to outreach", async () => {
    const stubs = mkStubs();
    agentScript = [
      { action: "counter", assessment: { reasoning: "opening in the wrong locution", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: "hello" },
      { action: "decline", assessment: { reasoning: "not for us", suggestedRoles: { ownUser: "peer", otherUser: "peer" } }, message: null },
    ];

    const result = await runGraph(stubs);

    expect(stubs.createdMessages.length).toBeGreaterThanOrEqual(1);
    expect(stubs.createdMessages[0].parts[0].data.action).toBe("outreach");
    expect(result.outcome?.reason).not.toBe("screened_out");
  }, 30_000);

  /**
   * The cross-PR case neither IND-610 nor IND-611 could catch alone.
   *
   * IND-611 added a second route to `screened_out` (a turn-0 refusal). The
   * outcome-reasoning precedence still preferred the screen record, which was
   * correct while the screen node was the only route. With a `reach_out`
   * screen followed by a turn-0 withdraw, the outcome would carry the screen's
   * argument FOR the match — and IND-610's owner-only gate card renders that
   * field verbatim under "Your agent did not reach out".
   *
   * Dev runs NEGOTIATION_SCREEN_MODE=enforce, so this path is reachable in
   * practice, and the `evaluator` stance makes turn-0 refusals more likely.
   */
  it("a reach_out screen overtaken by a turn-0 withdraw reports the REFUSAL's reasoning, not the screen's", async () => {
    const stubs = mkStubs();
    agentScript = [{
      action: "withdraw",
      assessment: { reasoning: "Bob's ML work does not actually serve Alice's stated need", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
      message: null,
    }];

    // The screen let this through and said why. The agent then refused.
    const result = await runGraph(stubs, {
      screenDecision: {
        decision: "reach_out",
        reasoning: "strong overlap — worth spending Alice's name on",
        evidence: { counterpartyPremiseFit: "both in ML", intentAlignment: "aligned" },
        mode: "enforce",
        screenedAt: new Date().toISOString(),
        durationMs: 12,
      },
    });

    expect(result.outcome?.reason).toBe("screened_out");
    // The honest text is the refusal's own.
    expect(result.outcome?.reasoning).toContain("does not actually serve");
    // The screen's pro-match argument must never be published as the reason
    // the agent did not reach out.
    expect(result.outcome?.reasoning).not.toContain("worth spending Alice's name");
  }, 30_000);
});
