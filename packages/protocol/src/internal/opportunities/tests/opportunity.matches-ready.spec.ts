import { describe, expect, test } from "bun:test";

import { matchesReadyNode } from "../opportunity.graph.matches-ready.js";
import type { OpportunityGraphDeps, OpportunityState } from "../opportunity.graph.shared.js";

/**
 * Discovery's whole hand-off to the signal's agent. Without the callback the
 * node — and the conditional edge in front of it — is a no-op: matches persist
 * and nobody is ever woken. That is a silent failure, so it is pinned here.
 */
const state = (opportunities: Array<{ id: string; actors: unknown[] }>) => ({
  userId: "alice",
  triggerIntentId: "intent-1",
  opportunities,
} as unknown as OpportunityState);

const twoActors = (intent: string) => [
  { userId: "alice", intent, networkId: "network-1", role: "peer" },
  { userId: "bob", intent: "intent-bob", networkId: "network-1", role: "peer" },
];

describe("matches_ready", () => {
  test("emits one event per signal, however many opportunities the batch held", async () => {
    const emitted: Array<{ userId: string; intentId: string }> = [];
    const deps = { matchesReady: async (input: { userId: string; intentId: string }) => { emitted.push(input); } } as unknown as OpportunityGraphDeps;

    await matchesReadyNode(state([
      { id: "opportunity-1", actors: twoActors("intent-1") },
      { id: "opportunity-2", actors: twoActors("intent-1") },
    ]), deps);

    expect(emitted).toEqual([{ userId: "alice", intentId: "intent-1" }]);
  });

  test("a failed wake fails the node — a persisted batch nobody was woken for is not a success", async () => {
    const deps = { matchesReady: async () => { throw new Error("redis unavailable"); } } as unknown as OpportunityGraphDeps;
    await expect(matchesReadyNode(state([{ id: "opportunity-1", actors: twoActors("intent-1") }]), deps))
      .rejects.toThrow(/Could not wake 1 of 1/);
  });

  test("without the host callback the batch is silently stranded — no host may leave it unset", async () => {
    const result = await matchesReadyNode(state([{ id: "opportunity-1", actors: twoActors("intent-1") }]), {} as OpportunityGraphDeps);
    // No trace, no event: this is exactly the shape a missing composition wire
    // produces, and the reason every host must pass `matchesReady`.
    expect(result).toEqual({});
  });
});
