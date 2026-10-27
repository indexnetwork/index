import { describe, expect, test } from "bun:test";
import type { NegotiateInput, NegotiateResult } from "@indexnetwork/agent";

import { createMoralmodHook, type TurnExposureEvent } from "./hook.ts";
import type { AssessmentClient } from "./consult.ts";

const RESULT = {
  run_id: "run-9",
  assessment: {
    ordered_action_ids: ["a", "b"],
    participant_map: { "user-1": "native-u", peer: "native-p" },
    settings: { n_samples: 2 },
    actions: [
      { action_id: "a", value: [1, 1], welfare: [1, 1], severity: [0, 0], utilities: { "user-1": [1, 1], peer: [1, 1] } },
      { action_id: "b", value: [5, 5], welfare: [1, 1], severity: [0, 0], utilities: { "user-1": [1, 1], peer: [1, 1] } },
    ],
  },
};

const client = (result: typeof RESULT | null, log?: string[]): AssessmentClient => ({
  consult: async () => { log?.push("consult"); return result; },
});

const input = (): NegotiateInput => ({
  user: { id: "user-1", name: "Seren", profileConfirmed: true },
  intent: { id: "i", statement: "Meet robotics researchers." },
  brief: "Brief.",
  opportunity: { id: "opp-1", counterpart: "C", status: "negotiating", awaiting: "you", turnCount: 1, turns: [], maxTurns: 12, remainingTurns: 11, actions: ["propose"], intent: { statement: "s" } } as NegotiateInput["opportunity"],
  model: {} as never,
});

function harness(arm: "on" | "off" | "shadow" | null, result: typeof RESULT | null, turnMessage = "Plain message.") {
  const events: TurnExposureEvent[] = [];
  const consults: string[] = [];
  const nextInputs: (NegotiateInput | undefined)[] = [];
  const hook = createMoralmodHook({
    arm: async () => arm,
    client: client(result, consults),
    templateId: "aggregate-value-mean-hold-v1",
    deadlineMs: 1_000,
    maxConcurrent: 2,
    emit: async (event) => { events.push(event); },
  });
  const next = async (override?: NegotiateInput): Promise<NegotiateResult> => {
    nextInputs.push(override);
    override?.assessment?.onSelection?.({ selectedActionId: override.assessment.preferredActionId, divergence: "none", reason: null });
    return { turn: { action: "propose", message: turnMessage } };
  };
  return { hook, events, consults, nextInputs, next };
}

describe("moralmod hook", () => {
  test("off arm passes through untouched", async () => {
    const { hook, events, consults, nextInputs, next } = harness("off", RESULT);
    const result = await hook(input(), next);
    expect(result).toEqual({ turn: { action: "propose", message: "Plain message." } });
    expect(consults).toEqual([]);
    expect(events).toEqual([]);
    expect(nextInputs).toEqual([undefined]);
  });

  test("a failed consult falls back to the plain negotiator and reports it", async () => {
    const { hook, events, nextInputs, next } = harness("on", null);
    const result = await hook(input(), next);
    expect(result).toEqual({ turn: { action: "propose", message: "Plain message." } });
    expect(nextInputs).toEqual([undefined]);
    expect(events.length).toBe(1);
    expect(events[0]).toMatchObject({ outcome: "fallback", fallbackReason: "unavailable", arm: "on", opportunityId: "opp-1", runId: null });
  });

  test("an assessed turn carries the guidance and reports the selection", async () => {
    const { hook, events, nextInputs, next } = harness("on", RESULT);
    const result = await hook(input(), next);
    expect(result).toEqual({ turn: { action: "propose", message: "Plain message." } });
    const guidance = nextInputs[0]?.assessment;
    expect(guidance?.preferredActionId).toBe("b");
    expect(guidance?.text).toContain("PRIVATE MORALMOD ASSESSMENT");
    expect(events[0]).toMatchObject({ outcome: "assessed", runId: "run-9", selection: { selectedActionId: "b", divergence: "none", reason: null } });
  });

  test("a leaking message is held, never submitted", async () => {
    const { hook, events, next } = harness("on", RESULT, "MoralMod scores this at 5.");
    const result = await hook(input(), next);
    expect("stall" in result).toBe(true);
    expect(events[0]).toMatchObject({ outcome: "fallback", fallbackReason: "publication_blocked" });
  });

  test("shadow arm consults and reports but never changes the turn", async () => {
    const { hook, events, consults, nextInputs, next } = harness("shadow", RESULT);
    const result = await hook(input(), next);
    expect(result).toEqual({ turn: { action: "propose", message: "Plain message." } });
    expect(consults).toEqual(["consult"]);
    expect(nextInputs).toEqual([undefined]);
    await Bun.sleep(1);
    expect(events[0]).toMatchObject({ outcome: "shadow", arm: "shadow", runId: "run-9" });
  });

  test("shadow turns never wait on the consult", async () => {
    const events: TurnExposureEvent[] = [];
    let settle: (value: typeof RESULT) => void = () => {};
    const hook = createMoralmodHook({
      arm: async () => "shadow",
      client: { consult: () => new Promise((resolve) => { settle = resolve; }) },
      templateId: "aggregate-value-mean-hold-v1",
      deadlineMs: 60_000,
      maxConcurrent: 2,
      emit: async (event) => { events.push(event); },
    });
    const result = await hook(input(), async () => ({ turn: { action: "propose", message: "Fast." } }));
    expect(result).toEqual({ turn: { action: "propose", message: "Fast." } });
    expect(events).toEqual([]);
    settle(RESULT);
    await Bun.sleep(1);
    expect(events[0]).toMatchObject({ outcome: "shadow", runId: "run-9" });
    expect(typeof (events[0] as { durationMs?: number }).durationMs).toBe("number");
  });

  test("waiting for a consult slot counts against the deadline", async () => {
    const events: TurnExposureEvent[] = [];
    const hook = createMoralmodHook({
      arm: async () => "on",
      client: { consult: () => new Promise(() => {}) },
      templateId: "aggregate-value-mean-hold-v1",
      deadlineMs: 40,
      maxConcurrent: 1,
      emit: async (event) => { events.push(event); },
    });
    const blocked = hook(input(), async () => ({ turn: { action: "propose", message: "A." } }));
    const started = Date.now();
    const result = await hook(input(), async () => ({ turn: { action: "propose", message: "B." } }));
    expect(Date.now() - started).toBeLessThan(2_000);
    expect(result).toEqual({ turn: { action: "propose", message: "B." } });
    expect(events.some((event) => event.outcome === "fallback" && event.fallbackReason === "deadline")).toBe(true);
    void blocked;
  });

  test("a stall that names the mechanism is sanitized before the principal reads it", async () => {
    const { hook, events, next } = harness("on", RESULT);
    void next;
    const result = await hook(input(), async (override) => {
      override?.assessment?.onSelection?.({ selectedActionId: null, divergence: "tie", reason: "Exact top tie under selected template." });
      return { stall: { reason: "Configured MoralMod template has an exact top tie; clarification required.", suggestedAsk: "Which MoralMod option do you prefer?" } };
    });
    expect("stall" in result).toBe(true);
    if ("stall" in result) {
      expect(result.stall.reason).not.toMatch(/moral\s*mod/i);
      expect(result.stall.suggestedAsk ?? "").not.toMatch(/moral\s*mod/i);
    }
    expect(events[0]).toMatchObject({ outcome: "assessed" });
  });

  test("an assessed run that throws falls back to the plain negotiator", async () => {
    const { hook, events } = harness("on", RESULT);
    const result = await hook(input(), async (override) => {
      if (override?.assessment) throw new Error("provider rejected the tool schema");
      return { turn: { action: "propose", message: "Plain again." } };
    });
    expect(result).toEqual({ turn: { action: "propose", message: "Plain again." } });
    expect(events.some((event) => event.outcome === "fallback" && event.fallbackReason === "error")).toBe(true);
  });

  test("an aborted turn rethrows instead of falling back", async () => {
    const controller = new AbortController();
    const hook = createMoralmodHook({
      arm: async () => "on",
      client: { consult: async (_request, options) => { controller.abort(); options.signal?.throwIfAborted(); return RESULT; } },
      templateId: "aggregate-value-mean-hold-v1",
      deadlineMs: 1_000,
      maxConcurrent: 1,
      emit: async () => {},
    });
    const aborted = { ...input(), signal: controller.signal };
    expect(hook(aborted, async () => ({ turn: { action: "propose", message: "X." } }))).rejects.toThrow();
  });
});
