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
  test("nobody moves between rounds", () => {
    const opportunity = toOpportunity(detail(null, 2, 12), "u");
    expect(opportunity.awaiting).toBe("nobody");
    expect(opportunity.resumed).toBeUndefined();
  });

  test("a seat handed a fresh round after earlier turns is resumed", () => {
    const opportunity = toOpportunity(detail("u", 2, 12), "u");
    expect(opportunity).toMatchObject({ awaiting: "you", resumed: true, remainingTurns: 12 });
  });

  test("an opening turn and a round in progress are not resumed", () => {
    expect(toOpportunity(detail("u", 0, 12), "u").resumed).toBeUndefined();
    expect(toOpportunity(detail("u", 3, 9), "u")).toMatchObject({ awaiting: "you", remainingTurns: 9 });
    expect(toOpportunity(detail("c", 3, 9), "u").awaiting).toBe("them");
  });
});
