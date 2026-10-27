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
    expect(events[0]).toMatchObject({ outcome: "shadow", arm: "shadow", runId: "run-9" });
  });
});
