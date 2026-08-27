import { describe, expect, test } from "bun:test";

import { matchesReadyNode } from "../opportunity.graph.matches-ready.js";
import type { OpportunityGraphDeps, OpportunityState } from "../opportunity.graph.shared.js";

/**
 * Discovery's whole hand-off to the signal's agent. Without the callback the
 * node — and the conditional edge in front of it — is a no-op: candidates are
 * recorded and nobody is ever woken. That is a silent failure, so it is
 * pinned here.
 */
const candidate = (over: Record<string, unknown> = {}) => ({
  id: "cand-1",
  networkId: "network-1",
  intentA: "intent-1", userA: "alice",
  intentB: "intent-bob", userB: "bob",
  ...over,
});

const state = (candidatesEmitted: unknown[]) => ({
  userId: "alice",
  triggerIntentId: "intent-1",
  candidatesEmitted,
} as unknown as OpportunityState);

describe("matches_ready", () => {
  test("wakes BOTH seats of a pair, not just the discovering side", async () => {
    const emitted: Array<{ userId: string; intentId: string }> = [];
    const deps = { matchesReady: async (input: { userId: string; intentId: string }) => { emitted.push(input); } } as unknown as OpportunityGraphDeps;

    await matchesReadyNode(state([candidate()]), deps);

    // One candidate is one row shared by two signals; each principal's agent
    // decides for itself whether to reach out. This is also why createAndOpen
    // locks on the pair.
    expect(emitted).toEqual([
      { userId: "alice", intentId: "intent-1" },
      { userId: "bob", intentId: "intent-bob" },
    ]);
  });

  test("emits one event per signal, however many candidates the batch held", async () => {
    const emitted: Array<{ userId: string; intentId: string }> = [];
    const deps = { matchesReady: async (input: { userId: string; intentId: string }) => { emitted.push(input); } } as unknown as OpportunityGraphDeps;

    await matchesReadyNode(state([
      candidate({ id: "cand-1", intentB: "intent-bob", userB: "bob" }),
      candidate({ id: "cand-2", intentB: "intent-cara", userB: "cara" }),
    ]), deps);

    // Alice sits on both pairs and is woken once: kickoff is a batch, and a
    // per-candidate wake would give the agent one round of one negotiation
    // each time.
    expect(emitted.filter((e) => e.intentId === "intent-1")).toHaveLength(1);
    expect(emitted.map((e) => e.intentId).sort()).toEqual(["intent-1", "intent-bob", "intent-cara"]);
  });

  test("a failed wake fails the node — a recorded batch nobody was woken for is not a success", async () => {
    const deps = { matchesReady: async () => { throw new Error("redis unavailable"); } } as unknown as OpportunityGraphDeps;
    await expect(matchesReadyNode(state([candidate()]), deps))
      .rejects.toThrow(/Could not wake 2 of 2/);
  });

  test("without the host callback the batch is silently stranded — no host may leave it unset", async () => {
    const result = await matchesReadyNode(state([candidate()]), {} as OpportunityGraphDeps);
    // No trace, no event: this is exactly the shape a missing composition wire
    // produces, and the reason every host must pass `matchesReady`.
    expect(result).toEqual({});
  });
});
