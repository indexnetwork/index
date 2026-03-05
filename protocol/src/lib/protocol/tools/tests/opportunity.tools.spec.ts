import { config } from "dotenv";
config({ path: ".env.development", override: true });

import { describe, expect, it } from "bun:test";
import type { Opportunity } from "../../interfaces/database.interface";
import { buildMinimalOpportunityCard } from "../opportunity.tools";

describe("buildMinimalOpportunityCard - IND-113", () => {
  const mockOpportunity = {
    id: "opp-123",
    status: "pending",
    interpretation: {
      reasoning:
        "Seref Yarar introduced you to Lucy Chen, who is actively seeking a product co-founder.",
      confidence: 0.85,
    },
    actors: [
      { userId: "viewer-456", role: "party" },
      { userId: "counterpart-789", role: "party" },
      { userId: "introducer-abc", role: "introducer" },
    ],
    detection: {
      source: "manual",
      createdByName: "Seref Yarar",
    },
  } as unknown as Opportunity;

  it("should not include introducer name in mainText when introducerName is passed", () => {
    const card = buildMinimalOpportunityCard(
      mockOpportunity,
      "viewer-456",
      "counterpart-789",
      "Lucy Chen",
      null,
      "Seref Yarar",
      null,
      undefined,
      undefined,
    );
    expect(card.mainText).not.toContain("Seref Yarar");
    expect(card.mainText).not.toContain("Seref");
    expect(card.mainText).toContain("Lucy Chen");
    expect(typeof card.mainText).toBe("string");
    expect(card.mainText.length).toBeGreaterThan(0);
  });

  it("should include counterpart name in mainText", () => {
    const card = buildMinimalOpportunityCard(
      mockOpportunity,
      "viewer-456",
      "counterpart-789",
      "Lucy Chen",
      null,
      "Seref Yarar",
      null,
      undefined,
      undefined,
    );
    expect(card.mainText).toContain("Lucy Chen");
  });

  it("should return safe card when interpretation or reasoning is missing", () => {
    const oppNoInterpretation = {
      id: "opp-no-interp",
      status: "pending",
      actors: [{ userId: "viewer-1", role: "party" }, { userId: "counterpart-1", role: "party" }],
      detection: { source: "manual" },
    } as unknown as Opportunity;
    const card = buildMinimalOpportunityCard(
      oppNoInterpretation,
      "viewer-1",
      "counterpart-1",
      "Alice",
      null,
      undefined,
      null,
      undefined,
      undefined,
    );
    expect(card).toBeDefined();
    expect(typeof card.mainText).toBe("string");
    expect(card.opportunityId).toBe("opp-no-interp");
    expect(card.name).toBe("Alice");
  });
});
