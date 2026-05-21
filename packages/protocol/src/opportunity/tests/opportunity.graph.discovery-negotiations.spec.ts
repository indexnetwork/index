import { config } from "dotenv";
config({ path: ".env.test" });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key";

import { describe, it, expect } from "bun:test";
import { buildDiscoverySummary, toDiscoveryNegotiation } from "../negotiation-summary.builder.js";
import type { NegotiationOutcome, NegotiationTurn } from "../../negotiation/negotiation.state.js";

// Smoke test for the public surface the negotiate node exposes via the builder;
// the graph-level wiring is exercised end-to-end in Task 9's integration test.
describe("discovery negotiations builder integration", () => {
  it("produces a stable state-update shape consumable by the question generator", () => {
    const turns: NegotiationTurn[] = [
      {
        action: "propose",
        assessment: { reasoning: "hi", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
      },
      {
        action: "accept",
        assessment: { reasoning: "ok", suggestedRoles: { ownUser: "peer", otherUser: "peer" } },
      },
    ];
    const outcome: NegotiationOutcome = {
      hasOpportunity: true,
      agreedRoles: [
        { userId: "u-s", role: "peer" },
        { userId: "u-c", role: "peer" },
      ],
      reasoning: "shipped",
      turnCount: 2,
    };
    const negotiation = toDiscoveryNegotiation({
      candidateUserId: "u-c",
      counterpartyHint: "founder",
      indexContext: "AI",
      turns,
      outcome,
    });
    const summary = buildDiscoverySummary([
      { candidateUserId: "u-c", counterpartyHint: "founder", indexContext: "AI", turns, outcome },
    ]);
    expect(negotiation.outcome.hasOpportunity).toBe(true);
    expect(summary.opportunitiesFound).toBe(1);
    expect(summary.roleDistribution).toEqual({ peer: 2 });
  });
});
