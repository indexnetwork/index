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
 * - regular continuations DO screen (IND-563): a new opportunity reusing an
 *   existing conversation must pass the outreach gate; a shadow `pass` still
 *   proceeds, an enforce `pass` screens it out with zero new messages,
 * - exact ask_user resumes (continuationExecution) are never re-screened,
 * - screen failure fails OPEN: negotiation proceeds, failedOpen recorded,
 * - enforce (P2.2): a genuine `pass` blocks before the first turn — zero
 *   messages, outcome reason `screened_out`, opportunity quietly `rejected`,
 *   no questioner/reflect enqueue, distinct trace outcome; `reach_out` and
 *   failed-open screens still proceed; shadow `pass` still never blocks,
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
  const statusUpdates: Array<{ opportunityId: string; status: string }> = [];
  const artifacts: Array<Record<string, unknown>> = [];
  const taskStates: string[] = [];
  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string) => ({ id: "task-new", conversationId, state: "submitted" }),
    updateOpportunityStatus: async (opportunityId: string, status: string) => {
      statusUpdates.push({ opportunityId, status });
    },
    createMessage: async (p: { senderId: string; parts: Array<{ kind: string; data: NegotiationTurn }> }) => {
      createdMessages.push(p);
      return { id: `msg-${createdMessages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async (_taskId: string, state: string) => {
      taskStates.push(state);
    },
    createArtifact: async (a: Record<string, unknown>) => {
      artifacts.push(a);
    },
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

  return { database, dispatcher, createdMessages, screenWrites, userContextLookups, statusUpdates, artifacts, taskStates };
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

  it("shadow: regular continuations screen once but still proceed (IND-563)", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "shadow";
    const stubs = mkStubs({
      priorMessages: [priorMsg("u-src", "propose", 0), priorMsg("u-cand", "counter", 1)],
    });

    const result = await runGraph(stubs);

    // IND-563: the continuation is screened (prior dialogue forwarded), but a
    // shadow decision never blocks — the negotiation proceeds to a turn.
    expect(screenerInputs.length).toBe(1);
    expect(screenerInputs[0].isContinuation).toBe(true);
    expect(screenerInputs[0].priorDialogue?.length).toBe(2);
    expect(stubs.screenWrites.length).toBe(1);
    expect(stubs.createdMessages.length).toBeGreaterThanOrEqual(1);
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

  it("enforce (P2.2): a `pass` blocks before the first turn — screened_out, zero messages, opportunity rejected", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "enforce";
    screenerResult = {
      decision: "pass",
      reasoning: "not worth the client's name",
      evidence: { counterpartyPremiseFit: "weak", intentAlignment: "none" },
    };
    const stubs = mkStubs();

    const result = await runGraph(stubs, { opportunityId: "opp-1" });

    // Decision recorded truthfully
    expect(stubs.screenWrites[0].record.mode).toBe("enforce");
    expect(stubs.screenWrites[0].record.decision).toBe("pass");
    // Zero turns — the counterparty is never involved
    expect(stubs.createdMessages.length).toBe(0);
    // Outcome artifact: rejected as screened_out, not stalled; screen reasoning carried
    expect(result.outcome?.hasOpportunity).toBe(false);
    expect(result.outcome?.reason).toBe("screened_out");
    expect(result.outcome?.turnCount).toBe(0);
    expect(result.outcome?.reasoning).toBe("not worth the client's name");
    expect(stubs.taskStates).toContain("completed");
    const artifactOutcome = (stubs.artifacts[0]?.parts as Array<{ data: Record<string, unknown> }>)[0]?.data;
    expect(artifactOutcome?.reason).toBe("screened_out");
    // Opportunity quietly rejected (init had flipped it to negotiating)
    expect(stubs.statusUpdates).toEqual([
      { opportunityId: "opp-1", status: "negotiating" },
      { opportunityId: "opp-1", status: "rejected" },
    ]);
  });

  it("enforce (P2.2): screened_out emits a distinct negotiation_outcome trace event and never enqueues questioner/reflect", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "enforce";
    screenerResult = {
      decision: "pass",
      reasoning: "generic overlap",
      evidence: { counterpartyPremiseFit: "weak", intentAlignment: "none" },
    };
    const stubs = mkStubs();
    const questionerCalls: unknown[] = [];
    const reflectCalls: unknown[] = [];
    const graph = new NegotiationGraphFactory(
      stubs.database,
      stubs.dispatcher,
      undefined,
      (async (job: unknown) => { questionerCalls.push(job); }) as never,
      (async (job: unknown) => { reflectCalls.push(job); }) as never,
    ).createGraph();
    const events: Array<Record<string, unknown>> = [];

    await requestContext.run(
      { traceEmitter: ((e: Record<string, unknown>) => { events.push(e); }) as never },
      () => graph.invoke({
        sourceUser: { id: "u-src", intents: [], profile: { name: "Alice" } },
        candidateUser: { id: "u-cand", intents: [], profile: { name: "Bob" } },
        indexContext: { networkId: "net-1", prompt: "" },
        seedAssessment: { reasoning: "complementary", valencyRole: "peer" },
        maxTurns: 1,
        opportunityId: "opp-1",
      } as Partial<typeof NegotiationGraphState.State>),
    );

    const outcomeEvents = events.filter((e) => e.type === "negotiation_outcome");
    expect(outcomeEvents.length).toBe(1);
    expect(outcomeEvents[0].outcome).toBe("screened_out");
    expect(outcomeEvents[0].turnCount).toBe(0);
    // Zero downstream noise: no clarifying questions, no reflection
    expect(questionerCalls.length).toBe(0);
    expect(reflectCalls.length).toBe(0);
  });

  it("enforce (P2.2): `reach_out` proceeds to turns normally", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "enforce";
    const stubs = mkStubs();

    const result = await runGraph(stubs);

    expect(stubs.screenWrites[0].record.decision).toBe("reach_out");
    expect(stubs.createdMessages.length).toBeGreaterThanOrEqual(1);
    expect(result.outcome).not.toBeNull();
    expect(result.outcome?.reason).not.toBe("screened_out");
  });

  it("enforce (P2.2): a failed screen still fails OPEN — negotiation proceeds", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "enforce";
    screenerError = new Error("provider exploded");
    const stubs = mkStubs();

    const result = await runGraph(stubs);

    expect(stubs.screenWrites[0].record.failedOpen).toBe(true);
    expect(stubs.createdMessages.length).toBeGreaterThanOrEqual(1);
    expect(result.outcome).not.toBeNull();
    expect(result.outcome?.reason).not.toBe("screened_out");
  });

  it("enforce (P2.2): a regular continuation `pass` screens out — zero new messages, rejected (IND-563)", async () => {
    process.env.NEGOTIATION_SCREEN_MODE = "enforce";
    screenerResult = {
      decision: "pass",
      reasoning: "stale premise; not worth reaching out again",
      evidence: { counterpartyPremiseFit: "weak", intentAlignment: "none" },
    };
    const stubs = mkStubs({
      priorMessages: [priorMsg("u-src", "propose", 0), priorMsg("u-cand", "counter", 1)],
    });

    const result = await runGraph(stubs, { opportunityId: "opp-1" });

    // IND-563: the continuation is screened and, on a genuine enforce `pass`,
    // blocked before any turn — no NEW message lands in the shared thread.
    expect(screenerInputs.length).toBe(1);
    expect(screenerInputs[0].isContinuation).toBe(true);
    expect(stubs.createdMessages.length).toBe(0);
    expect(result.outcome?.hasOpportunity).toBe(false);
    expect(result.outcome?.reason).toBe("screened_out");
    expect(stubs.statusUpdates).toEqual([
      { opportunityId: "opp-1", status: "negotiating" },
      { opportunityId: "opp-1", status: "rejected" },
    ]);
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
