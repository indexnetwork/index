import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NegotiationScreener, type NegotiationScreenerInput, type ScreenDecision } from "../negotiation.screen.js";
import type { NegotiationTurn } from "../negotiation.state.js";

/**
 * IND-563 — the outreach screen runs on continuations, with two guarantees not
 * covered by the fresh-run routing suite (negotiation.screen-routing.spec.ts):
 *
 * 1. A regular continuation (a new opportunity reusing an existing dm_pair
 *    conversation) forwards its prior dialogue to the screener, so the gate
 *    judges the NEW signal on its own merits.
 * 2. An EXACT ask_user resume (continuationExecution present) is NEVER
 *    re-screened — the successor task is the same logical negotiation resumed
 *    mid-flight after the client answered, and re-screening it in enforce mode
 *    could wrongly kill it.
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

const SETTLEMENT_ID = "negotiation-question-settlement-v1-task-paused";

/** Canceled prior task pinning the exact ask_user pause on conv-1. */
const EXACT_PRIOR_TASK = {
  id: "task-paused",
  conversationId: "conv-1",
  state: "canceled",
  metadata: {
    type: "negotiation",
    protocolVersion: "v2",
    initiatorUserId: "u-src",
    sourceUserId: "u-src",
    candidateUserId: "u-cand",
    opportunityId: "opp-1",
    networkId: "net-1",
    questionSettlement: { version: 1, settlementId: SETTLEMENT_ID, taskId: "task-paused" },
  },
  createdAt: new Date(Date.now() - 60_000),
  updatedAt: new Date(),
};

/** Preclaimed successor task holding the fenced continuation lease. */
const EXACT_SUCCESSOR_TASK = {
  id: "task-successor",
  conversationId: "conv-1",
  state: "submitted",
  metadata: {
    continuationExecution: {
      version: 1,
      priorTaskId: "task-paused",
      settlementId: SETTLEMENT_ID,
      successorTaskId: "task-successor",
      token: "tok-1",
      fence: 1,
      status: "claimed",
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      claimedAt: new Date().toISOString(),
      heartbeatAt: new Date().toISOString(),
    },
  },
  createdAt: new Date(),
  updatedAt: new Date(),
};

const EXACT_CONTINUATION_EXECUTION = {
  taskId: "task-paused",
  settlementId: SETTLEMENT_ID,
  opportunityId: "opp-1",
  userId: "u-src",
  recipientIntentId: "intent-src",
  networkId: "net-1",
  intentFingerprint: "fp-src",
  opportunityStatus: "pending",
  opportunityUpdatedAt: "2026-01-01T00:00:00.000Z",
  counterpartyUserId: "u-cand",
  counterpartyIntentId: "intent-cand",
  successorTaskId: "task-successor",
  conversationId: "conv-1",
  token: "tok-1",
  fence: 1,
  leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function mkStubs(opts?: { priorMessages?: FakeMessage[]; exact?: boolean }) {
  const createdMessages: Array<{ senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }> = [];
  const tasksById = new Map<string, Record<string, unknown>>();
  if (opts?.exact) {
    tasksById.set("task-paused", EXACT_PRIOR_TASK);
    tasksById.set("task-successor", EXACT_SUCCESSOR_TASK);
  }
  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string) => ({ id: "task-new", conversationId, state: "submitted" }),
    createMessage: async (p: { senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }) => {
      createdMessages.push(p);
      return { id: `msg-${createdMessages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async () => ({ id: "task-successor", conversationId: "conv-1", state: "working" }),
    createArtifact: async () => ({ id: "art-1" }),
    setTaskTurnContext: async () => {},
    setTaskScreenDecision: async () => {},
    updateOpportunityStatus: async () => ({ id: "opp-1", status: "pending" }),
    getNegotiationTaskForOpportunity: async () => null,
    getOpportunityUserAnswers: async () => [],
    getMessagesForConversation: async () => opts?.priorMessages ?? [],
    getLatestNegotiationTaskForConversation: async () => null,
    getUserContext: async () => ({ text: "Bob builds ML systems." }),
    getTask: async (id: string) => tasksById.get(id) ?? null,
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async () => ({ handled: false, reason: "no_agent" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  return { database, dispatcher, createdMessages };
}

async function runGraph(stubs: ReturnType<typeof mkStubs>, input: Record<string, unknown> = {}) {
  const graph = new NegotiationGraphFactory(stubs.database, stubs.dispatcher).createGraph();
  return graph.invoke({
    sourceUser: { id: "u-src", intents: [{ id: "intent-src", title: "Build AI", description: "collab", confidence: 1 }], profile: { name: "Alice", bio: "PM" } },
    candidateUser: { id: "u-cand", intents: [{ id: "intent-cand", title: "Apply ML", description: "join", confidence: 1 }], profile: { name: "Bob", bio: "ML engineer" } },
    sourceIntentId: "intent-src",
    candidateIntentId: "intent-cand",
    indexContext: { networkId: "net-1", prompt: "AI network" },
    seedAssessment: { reasoning: "complementary", valencyRole: "peer" },
    opportunityId: "opp-1",
    maxTurns: 4,
    ...input,
  } as Partial<typeof NegotiationGraphState.State>);
}

const screenerInputs: NegotiationScreenerInput[] = [];
let screenerResult: ScreenDecision = {
  decision: "reach_out",
  reasoning: "solid fit",
  outreachAngle: "shared ML focus",
  evidence: { counterpartyPremiseFit: "fits", intentAlignment: "aligned" },
};

describe("negotiation graph — screen on continuations (IND-563)", () => {
  let origScreenerInvoke: typeof NegotiationScreener.prototype.invoke;
  let origAgentInvoke: typeof IndexNegotiator.prototype.invoke;
  const origEnv = process.env.NEGOTIATION_SCREEN_MODE;
  const origVersion = process.env.NEGOTIATION_PROTOCOL_VERSION;

  beforeAll(() => {
    origScreenerInvoke = NegotiationScreener.prototype.invoke;
    NegotiationScreener.prototype.invoke = async function (input: NegotiationScreenerInput) {
      screenerInputs.push(input);
      return screenerResult;
    };
    origAgentInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function (input: NegotiationAgentInput) {
      // Counterparty (u-cand) accepts to finalize the resumed negotiation fast.
      return {
        action: (input.ownUser.id === "u-cand" ? "accept" : "counter") as NegotiationTurn["action"],
        assessment: { reasoning: "stub", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
        message: null,
      };
    };
  });

  afterAll(() => {
    NegotiationScreener.prototype.invoke = origScreenerInvoke;
    IndexNegotiator.prototype.invoke = origAgentInvoke;
  });

  beforeEach(() => {
    screenerInputs.length = 0;
    screenerResult = {
      decision: "reach_out",
      reasoning: "solid fit",
      outreachAngle: "shared ML focus",
      evidence: { counterpartyPremiseFit: "fits", intentAlignment: "aligned" },
    };
    delete process.env.NEGOTIATION_SCREEN_MODE;
    delete process.env.NEGOTIATION_PROTOCOL_VERSION;
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.NEGOTIATION_SCREEN_MODE; else process.env.NEGOTIATION_SCREEN_MODE = origEnv;
    if (origVersion === undefined) delete process.env.NEGOTIATION_PROTOCOL_VERSION; else process.env.NEGOTIATION_PROTOCOL_VERSION = origVersion;
  });

  it("regular continuation forwards prior dialogue to the screener", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "shadow";
    const stubs = mkStubs({ priorMessages: [priorMsg("u-src", "outreach", 0), priorMsg("u-cand", "decline", 1)] });

    await runGraph(stubs);

    expect(screenerInputs.length).toBe(1);
    expect(screenerInputs[0].isContinuation).toBe(true);
    expect(screenerInputs[0].priorDialogue?.map((t) => t.action)).toEqual(["outreach", "decline"]);
  }, 30_000);

  it("enforce: a continuation `pass` is screened out — no NEW message in the shared thread", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "enforce";
    screenerResult = {
      decision: "pass",
      reasoning: "the new signal rehashes a settled decline",
      evidence: { counterpartyPremiseFit: "weak", intentAlignment: "none" },
    };
    const stubs = mkStubs({ priorMessages: [priorMsg("u-src", "outreach", 0), priorMsg("u-cand", "decline", 1)] });

    const result = await runGraph(stubs);

    expect(screenerInputs.length).toBe(1);
    // Zero NEW turns persisted — the counterparty is never re-engaged.
    expect(stubs.createdMessages.length).toBe(0);
    expect(result.outcome?.hasOpportunity).toBe(false);
    expect(result.outcome?.reason).toBe("screened_out");
  }, 30_000);

  it("exact ask_user resume (continuationExecution) is never re-screened, even in enforce mode", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "enforce";
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    screenerResult = {
      decision: "pass",
      reasoning: "would wrongly kill a mid-flight negotiation if this ran",
      evidence: { counterpartyPremiseFit: "weak", intentAlignment: "none" },
    };
    // Resume the SAME negotiation: source opened outreach, candidate speaks next.
    const stubs = mkStubs({
      priorMessages: [priorMsg("u-src", "outreach", 0)],
      exact: true,
    });

    const result = await runGraph(stubs, {
      resumeFromTaskId: "task-paused",
      continuationSettlementId: SETTLEMENT_ID,
      continuationExecution: EXACT_CONTINUATION_EXECUTION,
    });

    // The screen gate never ran on the resume.
    expect(screenerInputs.length).toBe(0);
    // The negotiation resumed on the exact successor task and settled normally.
    expect(result.taskId).toBe("task-successor");
    expect(result.outcome?.reason).not.toBe("screened_out");
  }, 30_000);
});
