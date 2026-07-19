import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";
import { z } from "zod";
import { NegotiationGraphFactory } from "../negotiation.graph.js";
import { NegotiationGraphState } from "../negotiation.state.js";
import { IndexNegotiator, type NegotiationAgentInput } from "../negotiation.agent.js";
import { createNegotiationTools } from "../negotiation.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import { requestContext } from "../../shared/observability/request-context.js";

/**
 * IND-428 — deadlock→bargaining shift (graph level).
 *
 * Pins:
 * - flag ON + v2: the system agent receives `bargaining` exactly from the
 *   turn where the trailing counter/question run reaches the threshold; the
 *   shift record is persisted ONCE per session via setTaskDeadlockShift and
 *   the `negotiation_deadlock_shift` trace event fires once,
 * - flag OFF (default): deadlocked histories draft with agent inputs that are
 *   deep-equal to the flag-on run minus the `bargaining` field — no record,
 *   no trace event (disabled-path equivalence),
 * - v1 + flag ON: never shifts (checked alongside the protocol version),
 * - externally dispatched turns never receive the stance and never persist a
 *   record,
 * - fail-open: a throwing (or absent) setTaskDeadlockShift never breaks the
 *   negotiation,
 * - privacy: get_negotiation never projects `metadata.deadlockShift`.
 */

function mkStubs(opts?: {
  setTaskDeadlockShiftThrows?: boolean;
  omitSetTaskDeadlockShift?: boolean;
}) {
  const createdMessages: Array<{ senderId: string; parts: Array<{ kind: string; data: unknown }> }> = [];
  const deadlockWrites: Array<{ taskId: string; record: Record<string, unknown> }> = [];
  const database = {
    getOrCreateDM: async () => ({ id: "conv-1" }),
    createTask: async (conversationId: string) => ({ id: "task-1", conversationId, state: "submitted" }),
    updateOpportunityStatus: async () => {},
    createMessage: async (p: { senderId: string; parts: Array<{ kind: string; data: unknown }> }) => {
      createdMessages.push(p);
      return { id: `msg-${createdMessages.length}`, senderId: p.senderId, parts: p.parts, createdAt: new Date() };
    },
    updateTaskState: async () => {},
    createArtifact: async () => {},
    setTaskTurnContext: async () => {},
    ...(opts?.omitSetTaskDeadlockShift ? {} : {
      setTaskDeadlockShift: async (taskId: string, record: Record<string, unknown>) => {
        if (opts?.setTaskDeadlockShiftThrows) throw new Error("metadata store down");
        deadlockWrites.push({ taskId, record });
      },
    }),
    getMessagesForConversation: async () => [],
    getOpportunityUserAnswers: async () => [],
    getNegotiationTaskForOpportunity: async () => null,
    getLatestNegotiationTaskForConversation: async () => null,
    getUserContext: async () => null,
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[0];

  const dispatcher = {
    hasExternalAgent: async () => false,
    dispatch: async () => ({ handled: false, reason: "no_agent" }),
  } as unknown as ConstructorParameters<typeof NegotiationGraphFactory>[1];

  return { database, dispatcher, createdMessages, deadlockWrites };
}

async function runGraph(
  stubs: ReturnType<typeof mkStubs>,
  input: Record<string, unknown> = {},
  traceEvents?: Array<Record<string, unknown>>,
) {
  const graph = new NegotiationGraphFactory(stubs.database, stubs.dispatcher).createGraph();
  const invoke = () => graph.invoke({
    sourceUser: { id: "u-src", intents: [], profile: { name: "Alice" } },
    candidateUser: { id: "u-cand", intents: [], profile: { name: "Bob" } },
    indexContext: { networkId: "net-1", prompt: "" },
    seedAssessment: { reasoning: "complementary", valencyRole: "peer" },
    opportunityId: "opp-1",
    maxTurns: 5,
    ...input,
  } as Partial<typeof NegotiationGraphState.State>);
  if (!traceEvents) return invoke();
  return requestContext.run({ traceEmitter: ((e: Record<string, unknown>) => traceEvents.push(e)) as never }, invoke);
}

/** Scripted system-agent: captures every input, returns actions in order. */
function patchAgent(actions: string[]) {
  const inputs: NegotiationAgentInput[] = [];
  let call = 0;
  const orig = IndexNegotiator.prototype.invoke;
  IndexNegotiator.prototype.invoke = async function (input: NegotiationAgentInput) {
    inputs.push(input);
    const action = actions[Math.min(call++, actions.length - 1)];
    return {
      action,
      assessment: { reasoning: `r-${action}`, suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
      message: null,
    } as never;
  };
  return { inputs, restore: () => { IndexNegotiator.prototype.invoke = orig; } };
}

const ENV_KEYS = [
  "NEGOTIATION_DEADLOCK_SHIFT_ENABLED",
  "NEGOTIATION_DEADLOCK_THRESHOLD",
  "NEGOTIATION_PROTOCOL_VERSION",
  "NEGOTIATION_SCREEN_MODE",
  "NEGOTIATION_ASK_USER_ENABLED",
] as const;
const origEnv: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const k of ENV_KEYS) origEnv[k] = process.env[k];
});
afterAll(() => {
  for (const k of ENV_KEYS) {
    if (origEnv[k] === undefined) delete process.env[k]; else process.env[k] = origEnv[k];
  }
});
beforeEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
});

// With threshold 2 and maxTurns 5: turn 0 outreach (run 0), turn 1 (run 0),
// turn 2 (run 1), turn 3 (run 2 → deadlocked), turn 4 (run 3 → deadlocked).
const SCRIPT = ["outreach", "counter", "counter", "counter", "counter"];

describe("negotiation graph — deadlock→bargaining shift (IND-428)", () => {
  it("flag ON: bargaining stance from the threshold turn, record persisted once, trace event once", async () => {
    process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED = "true";
    process.env.NEGOTIATION_DEADLOCK_THRESHOLD = "2";
    const stubs = mkStubs();
    const { inputs, restore } = patchAgent(SCRIPT);
    const events: Array<Record<string, unknown>> = [];
    try {
      await runGraph(stubs, {}, events);
    } finally {
      restore();
    }

    expect(inputs).toHaveLength(5);
    expect(inputs[0].bargaining).toBeUndefined();
    expect(inputs[1].bargaining).toBeUndefined();
    expect(inputs[2].bargaining).toBeUndefined();
    expect(inputs[3].bargaining).toEqual({ consecutiveNonConvergent: 2 });
    expect(inputs[4].bargaining).toEqual({ consecutiveNonConvergent: 3 });

    // Record persisted exactly once (first shifted turn), with the full shape.
    expect(stubs.deadlockWrites).toHaveLength(1);
    expect(stubs.deadlockWrites[0].taskId).toBe("task-1");
    expect(stubs.deadlockWrites[0].record).toMatchObject({
      reason: "consecutive_non_convergent",
      consecutiveNonConvergent: 2,
      threshold: 2,
      shiftedAtTurn: 3,
    });
    expect(typeof stubs.deadlockWrites[0].record.detectedAt).toBe("string");
    expect(["initiator", "counterparty"]).toContain(stubs.deadlockWrites[0].record.seat as string);

    const shiftEvents = events.filter((e) => e.type === "negotiation_deadlock_shift");
    expect(shiftEvents).toHaveLength(1);
    expect(shiftEvents[0]).toMatchObject({
      opportunityId: "opp-1",
      turnIndex: 3,
      consecutiveNonConvergent: 2,
      threshold: 2,
    });

    // The stance never leaks into the persisted turn payloads.
    for (const msg of stubs.createdMessages) {
      expect(JSON.stringify(msg.parts)).not.toContain("bargaining");
      expect(JSON.stringify(msg.parts)).not.toContain("deadlock");
    }
  });

  it("question turns count toward the run", async () => {
    process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED = "true";
    process.env.NEGOTIATION_DEADLOCK_THRESHOLD = "2";
    const stubs = mkStubs();
    const { inputs, restore } = patchAgent(["outreach", "question", "counter", "counter", "counter"]);
    try {
      await runGraph(stubs);
    } finally {
      restore();
    }
    expect(inputs[3].bargaining).toEqual({ consecutiveNonConvergent: 2 });
  });

  it("flag OFF (default): identical drafting inputs minus the bargaining field — no record, no event", async () => {
    process.env.NEGOTIATION_DEADLOCK_THRESHOLD = "2"; // threshold alone must not activate anything

    const offStubs = mkStubs();
    const off = patchAgent(SCRIPT);
    const offEvents: Array<Record<string, unknown>> = [];
    try {
      await runGraph(offStubs, {}, offEvents);
    } finally {
      off.restore();
    }

    process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED = "true";
    const onStubs = mkStubs();
    const on = patchAgent(SCRIPT);
    try {
      await runGraph(onStubs);
    } finally {
      on.restore();
    }

    // Flag off: no bargaining field anywhere, no persistence, no trace event.
    for (const input of off.inputs) expect("bargaining" in input).toBe(false);
    expect(offStubs.deadlockWrites).toHaveLength(0);
    expect(offEvents.filter((e) => e.type === "negotiation_deadlock_shift")).toHaveLength(0);

    // Disabled-path equivalence: every flag-off drafting input is deep-equal
    // to the flag-on input once the bargaining field is removed — the legacy
    // path is exactly preserved.
    expect(on.inputs).toHaveLength(off.inputs.length);
    const scrub = (i: NegotiationAgentInput) => {
      const { bargaining: _bargaining, ...rest } = i;
      return JSON.parse(JSON.stringify(rest));
    };
    for (let i = 0; i < off.inputs.length; i++) {
      expect(scrub(off.inputs[i])).toEqual(scrub(on.inputs[i]));
    }
  });

  it("v1 + flag ON: never shifts (gated alongside the protocol version)", async () => {
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v1";
    process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED = "true";
    process.env.NEGOTIATION_DEADLOCK_THRESHOLD = "2";
    const stubs = mkStubs();
    const { inputs, restore } = patchAgent(["propose", "counter", "counter", "counter", "counter"]);
    try {
      await runGraph(stubs);
    } finally {
      restore();
    }
    for (const input of inputs) expect(input.bargaining).toBeUndefined();
    expect(stubs.deadlockWrites).toHaveLength(0);
  });

  it("externally dispatched turns never receive the stance and never persist a record", async () => {
    process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED = "true";
    process.env.NEGOTIATION_DEADLOCK_THRESHOLD = "2";
    const stubs = mkStubs();
    const payloads: Array<Record<string, unknown>> = [];
    let call = 0;
    const script = ["outreach", "counter", "counter", "counter", "withdraw"];
    (stubs as { dispatcher: unknown }).dispatcher = {
      hasExternalAgent: async () => false,
      dispatch: async (_userId: string, _scope: unknown, payload: Record<string, unknown>) => {
        payloads.push(payload);
        const action = script[Math.min(call++, script.length - 1)];
        return {
          handled: true,
          turn: {
            action,
            assessment: { reasoning: "r", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
            message: null,
          },
        };
      },
    };
    const { inputs, restore } = patchAgent(SCRIPT);
    try {
      await runGraph(stubs);
    } finally {
      restore();
    }
    expect(inputs).toHaveLength(0); // every turn handled by dispatch
    expect(payloads.length).toBeGreaterThanOrEqual(4);
    for (const p of payloads) {
      expect("bargaining" in p).toBe(false);
      expect(JSON.stringify(p)).not.toContain("deadlock");
    }
    expect(stubs.deadlockWrites).toHaveLength(0);
  });

  it("fail-open: a throwing setTaskDeadlockShift never breaks the negotiation", async () => {
    process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED = "true";
    process.env.NEGOTIATION_DEADLOCK_THRESHOLD = "2";
    const stubs = mkStubs({ setTaskDeadlockShiftThrows: true });
    const { inputs, restore } = patchAgent(SCRIPT);
    let result: { outcome?: { reason?: string } | null };
    try {
      result = await runGraph(stubs) as never;
    } finally {
      restore();
    }
    expect(inputs).toHaveLength(5);
    expect(inputs[3].bargaining).toEqual({ consecutiveNonConvergent: 2 });
    expect(result.outcome?.reason).toBe("turn_cap");
  });

  it("fail-open: an absent setTaskDeadlockShift hook still shifts and completes", async () => {
    process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED = "true";
    process.env.NEGOTIATION_DEADLOCK_THRESHOLD = "2";
    const stubs = mkStubs({ omitSetTaskDeadlockShift: true });
    const { inputs, restore } = patchAgent(SCRIPT);
    try {
      await runGraph(stubs);
    } finally {
      restore();
    }
    expect(inputs[3].bargaining).toEqual({ consecutiveNonConvergent: 2 });
  });
});

// ─── Privacy: get_negotiation projection ─────────────────────────────────────

function makeContext(userId = "u-src"): ResolvedToolContext {
  return {
    userId,
    user: { id: userId, name: "Alice", email: "a@test" } as never,
    userProfile: null,
    userNetworks: [],
    isMcp: true,
  } as unknown as ResolvedToolContext;
}

function captureTool(name: string, deps: Partial<ToolDeps>) {
  let captured: { handler: (i: { context: ResolvedToolContext; query: unknown }) => Promise<string>; querySchema?: z.ZodType } | undefined;
  const defineTool = (def: { name: string; handler: (...args: unknown[]) => unknown; querySchema?: z.ZodType }) => {
    if (def.name === name) captured = def as typeof captured;
    return def;
  };
  createNegotiationTools(defineTool as never, deps as ToolDeps);
  return captured!;
}

describe("get_negotiation — deadlockShift metadata privacy (IND-428)", () => {
  it("never projects metadata.deadlockShift into the response", async () => {
    const task = {
      id: "task-1",
      conversationId: "conv-1",
      state: "completed",
      metadata: {
        type: "negotiation",
        sourceUserId: "u-src",
        candidateUserId: "u-cand",
        protocolVersion: "v2",
        maxTurns: 6,
        deadlockShift: {
          reason: "consecutive_non_convergent",
          consecutiveNonConvergent: 4,
          threshold: 4,
          shiftedAtTurn: 5,
          seat: "initiator",
          detectedAt: "2026-07-18T00:00:00.000Z",
        },
      },
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-02"),
    };

    const tool = captureTool("get_negotiation", {
      negotiationDatabase: {
        getTask: async () => task,
        getMessagesForConversation: async () => [],
        getArtifactsForTask: async () => [],
      },
    } as never);

    const raw = await tool.handler({ context: makeContext("u-src"), query: { negotiationId: "task-1" } });
    const result = JSON.parse(raw);
    expect(result.success).toBe(true);
    expect(raw).not.toContain("deadlockShift");
    expect(raw).not.toContain("consecutive_non_convergent");
  });
});
