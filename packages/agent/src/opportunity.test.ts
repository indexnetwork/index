import { describe, expect, test } from "bun:test";

import type { NegotiationDetail } from "@indexnetwork/client";

import { toOpportunity } from "./host.ts";

function detail(awaitingUserId: string | null, turnCount: number, remainingTurns: number): NegotiationDetail {
  return {
    id: "n1", opportunityId: "o1", intentId: "i", awaitingUserId, outcome: null, settledAt: null, turnCount,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", introducer: null,
    counterparty: { userId: "c", intentId: "ci", name: "Counterpart", avatar: null, bio: null, location: null, statement: "" },
    turns: [],
    protocol: { guidance: "", availableActions: [], blockedReason: null, maxTurns: 12, remainingTurns, messageLimit: 4000 },
  } as NegotiationDetail;
}

describe("toOpportunity", () => {
  test("nobody moves between rounds, so the pair reads as paused", () => {
    expect(toOpportunity(detail(null, 2, 12), "u")).toMatchObject({ awaiting: "nobody", paused: true });
  });

  test("a seat holding the turn is not paused, and counts turns left in its round", () => {
    const opportunity = toOpportunity(detail("u", 2, 12), "u");
    expect(opportunity).toMatchObject({ awaiting: "you", remainingTurns: 12 });
    expect(opportunity.paused).toBeUndefined();
    expect(toOpportunity(detail("c", 3, 9), "u")).toMatchObject({ awaiting: "them", remainingTurns: 9 });
  });

  test("a settled negotiation is not paused", () => {
    expect(toOpportunity({ ...detail(null, 3, 9), outcome: "agreed" }, "u").paused).toBeUndefined();
  });
});
