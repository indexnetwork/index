import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { NegotiationScreener, type NegotiationScreenerInput, type ScreenDecision } from "../negotiation.screen.js";
import { requestContext } from "../../shared/observability/request-context.js";
import type { NegotiationTurn } from "../negotiation.state.js";

/**
 * IND-398 — screen node routing + shadow semantics (graph level).
 *
 * Pins:
 * - off (default): screen node skipped entirely — no screener call, no
 *   metadata write,
 * - shadow: fresh runs screen exactly once, decision persisted to
 *   metadata.screenDecision, negotiation always proceeds (even on `pass`),
 * - continuations never screen (even in shadow),
 * - screen failure fails OPEN: negotiation proceeds, failedOpen recorded,
 * - enforce (pre-P2.2): runs identically to shadow, mode recorded truthfully,
 * - `negotiation_screen` trace event emitted when an opportunityId is present,
 * - screener inputs: client = initiator side, counterparty context fetched,
 *   discoveryQuery forwarded for source-side clients.
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

function mkStubs(opts?: {
  priorMessages?: FakeMessage[];
  userContextText?: string;
  omitSetTaskScreenDecision?: boolean;
}) {
  const createdMessages: Array<{ senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }> = [];
  const screenWrites: Array<{ taskId: string; record: Record<string, unknown> }> = [];
  const userContextLookups: string[] = [];
  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string) => ({ id: "task-new", conversationId, state: "submitted" }),
    updateOpportunityStatus: async () => {},
    createMessage: async (p: { senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }) => {
      createdMessages.push(p);
      return { id: `msg-${createdMessages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async () => {},
    createArtifact: async () => {},
    setTaskTurnContext: async () => {},
    ...(opts?.omitSetTaskScreenDecision ? {} : {
      setTaskScreenDecision: async (taskId: string, record: Record<string, unknown>) => {
        screenWrites.push({ taskId, record });
      },
    }),
    getMessagesForConversation: async () => opts?.priorMessages ?? [],
    getOpportunityUserAnswers: async () => [],
    getNegotiationTaskForOpportunity: async () => null,
    getLatestNegotiationTaskForConversation: async () => null,
    getUserContext: async (userId: string) => {
      userContextLookups.push(userId);
      return opts?.userContextText != null ? { text: opts.userContextText } : null;
    },
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async () => ({ handled: false, reason: "no_agent" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  return { database, dispatcher, createdMessages, screenWrites, userContextLookups };
}

async function runGraph(stubs: ReturnType<typeof mkStubs>, input: Record<string, unknown> = {}) {
  const graph = new NegotiationGraphFactory(stubs.database, stubs.dispatcher).createGraph();
  return graph.invoke({
    sourceUser: { id: "u-src", intents: [], profile: { name: "Alice" } },
    candidateUser: { id: "u-cand", intents: [], profile: { name: "Bob" } },
    indexContext: { networkId: "net-1", prompt: "" },
    seedAssessment: { reasoning: "complementary", valencyRole: "peer" },
    maxTurns: 1,
    ...input,
  } as Partial<typeof NegotiationGraphState.State>);
}

const screenerInputs: NegotiationScreenerInput[] = [];
let screenerResult: ScreenDecision | (() => ScreenDecision) = {
  decision: "reach_out",
  reasoning: "solid fit",
  outreachAngle: "shared ML focus",
  evidence: { counterpartyPremiseFit: "fits", intentAlignment: "aligned" },
};
let screenerError: Error | null = null;

describe("negotiation graph — screen node routing (IND-398)", () => {
  let origScreenerInvoke: typeof NegotiationScreener.prototype.invoke;
  let origAgentInvoke: typeof IndexNegotiator.prototype.invoke;
  const origEnv = process.env.NEGOTIATION_SCREEN_MODE;

  beforeAll(() => {
    origScreenerInvoke = NegotiationScreener.prototype.invoke;
    NegotiationScreener.prototype.invoke = async function (input: NegotiationScreenerInput) {
      screenerInputs.push(input);
      if (screenerError) throw screenerError;
      return typeof screenerResult === "function" ? screenerResult() : screenerResult;
    };
    origAgentInvoke = IndexNegotiator.prototype.invoke;
    IndexNegotiator.prototype.invoke = async function (input: NegotiationAgentInput) {
      return {
        action: (input.isFinalTurn ? "accept" : "propose") as NegotiationTurn["action"],
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
    screenerError = null;
    screenerResult = {
      decision: "reach_out",
      reasoning: "solid fit",
      outreachAngle: "shared ML focus",
      evidence: { counterpartyPremiseFit: "fits", intentAlignment: "aligned" },
    };
    delete process.env.NEGOTIATION_SCREEN_MODE;
  });

  afterEach(() => {
    if (origEnv === undefined) delete process.env.NEGOTIATION_SCREEN_MODE;
    else process.env.NEGOTIATION_SCREEN_MODE = origEnv;
  });

  it("off (default): screen node is skipped — no screener call, no metadata write", async () => {
    const stubs = mkStubs();
    const result = await runGraph(stubs);

    expect(screenerInputs.length).toBe(0);
    expect(stubs.screenWrites.length).toBe(0);
    expect(result.outcome).not.toBeNull();
  });

  it("shadow: fresh run screens once, persists the decision, and proceeds to turns", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "shadow";
    const stubs = mkStubs({ userContextText: "Bob builds ML systems." });

    const result = await runGraph(stubs);

    expect(screenerInputs.length).toBe(1);
    expect(stubs.screenWrites.length).toBe(1);
    expect(stubs.screenWrites[0].taskId).toBe("task-new");
    expect(stubs.screenWrites[0].record.decision).toBe("reach_out");
    expect(stubs.screenWrites[0].record.mode).toBe("shadow");
    expect(stubs.screenWrites[0].record.failedOpen).toBeUndefined();
    expect(typeof stubs.screenWrites[0].record.screenedAt).toBe("string");
    // Negotiation ran normally after the screen
    expect(stubs.createdMessages.length).toBeGreaterThanOrEqual(1);
    expect(result.outcome).not.toBeNull();
  });

  it("shadow: a `pass` decision NEVER blocks — negotiation still proceeds", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "shadow";
    screenerResult = {
      decision: "pass",
      reasoning: "vague overlap",
      evidence: { counterpartyPremiseFit: "weak", intentAlignment: "none" },
    };
    const stubs = mkStubs();

    const result = await runGraph(stubs);

    expect(stubs.screenWrites[0].record.decision).toBe("pass");
    expect(stubs.createdMessages.length).toBeGreaterThanOrEqual(1);
    expect(result.outcome).not.toBeNull();
  });

  it("shadow: continuations never screen", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "shadow";
    const stubs = mkStubs({
      priorMessages: [priorMsg("u-src", "propose", 0), priorMsg("u-cand", "counter", 1)],
    });

    const result = await runGraph(stubs);

    expect(screenerInputs.length).toBe(0);
    expect(stubs.screenWrites.length).toBe(0);
    expect(result.outcome).not.toBeNull();
  });

  it("shadow: screen failure fails OPEN — proceeds with failedOpen reach_out recorded", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "shadow";
    screenerError = new Error("provider timeout");
    const stubs = mkStubs();

    const result = await runGraph(stubs);

    expect(stubs.screenWrites.length).toBe(1);
    expect(stubs.screenWrites[0].record.decision).toBe("reach_out");
    expect(stubs.screenWrites[0].record.failedOpen).toBe(true);
    expect(String(stubs.screenWrites[0].record.error)).toContain("provider timeout");
    expect(stubs.createdMessages.length).toBeGreaterThanOrEqual(1);
    expect(result.outcome).not.toBeNull();
  });

  it("enforce (pre-P2.2): runs identically to shadow — proceeds, mode recorded truthfully", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "enforce";
    screenerResult = {
      decision: "pass",
      reasoning: "not worth the client's name",
      evidence: { counterpartyPremiseFit: "weak", intentAlignment: "none" },
    };
    const stubs = mkStubs();

    const result = await runGraph(stubs);

    expect(stubs.screenWrites[0].record.mode).toBe("enforce");
    expect(stubs.screenWrites[0].record.decision).toBe("pass");
    // Enforcement lands in P2.2 — until then even a pass proceeds.
    expect(stubs.createdMessages.length).toBeGreaterThanOrEqual(1);
    expect(result.outcome).not.toBeNull();
  });

  it("emits a negotiation_screen trace event when an opportunityId is present", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "shadow";
    const stubs = mkStubs();
    const events: Array<Record<string, unknown>> = [];

    await requestContext.run(
      { traceEmitter: ((e: Record<string, unknown>) => { events.push(e); }) as never },
      () => runGraph(stubs, { opportunityId: "opp-1" }),
    );

    const screenEvents = events.filter((e) => e.type === "negotiation_screen");
    expect(screenEvents.length).toBe(1);
    expect(screenEvents[0].opportunityId).toBe("opp-1");
    expect(screenEvents[0].decision).toBe("reach_out");
    expect(screenEvents[0].mode).toBe("shadow");
    expect(screenEvents[0].failedOpen).toBe(false);
    expect(typeof screenEvents[0].durationMs).toBe("number");
  });

  it("screener inputs: client = source (initiator), counterparty context fetched, discoveryQuery forwarded", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "shadow";
    const stubs = mkStubs({ userContextText: "Bob builds ML systems." });

    await runGraph(stubs, { discoveryQuery: "ML engineers" });

    expect(screenerInputs.length).toBe(1);
    expect(screenerInputs[0].clientUser.id).toBe("u-src");
    expect(screenerInputs[0].counterpartyUser.id).toBe("u-cand");
    expect(screenerInputs[0].counterpartyContext).toBe("Bob builds ML systems.");
    expect(screenerInputs[0].discoveryQuery).toBe("ML engineers");
    expect(stubs.userContextLookups).toContain("u-cand");
  });

  it("tolerates a database without setTaskScreenDecision (optional method) — still proceeds", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "shadow";
    const stubs = mkStubs({ omitSetTaskScreenDecision: true });

    const result = await runGraph(stubs);

    expect(screenerInputs.length).toBe(1);
    expect(stubs.createdMessages.length).toBeGreaterThanOrEqual(1);
    expect(result.outcome).not.toBeNull();
  });
});
