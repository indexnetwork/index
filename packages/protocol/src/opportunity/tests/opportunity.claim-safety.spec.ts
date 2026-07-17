import { describe, expect, it } from "bun:test";

import { hasUnsupportedOpportunityClaim, stripUnsupportedOpportunityClaims } from "../opportunity.claim-safety.js";

describe("opportunity claim safety", () => {
  const dangerous = [
    "Alice attended Edge Esmeralda last year.",
    "Alice will attend Edge Esmeralda.",
    "Alice attended edge esmeralda.",
    "Alice is attending Edge Esmeralda.",
    "Alice and Bob will both be at Edge Esmeralda.",
    "Alice and Bob are going to Edge Esmeralda.",
    "Alice participated in Edge Esmeralda.",
    "Alice was a participant in Edge Esmeralda.",
    "Alice went to Edge Esmeralda.",
    "Alice took part in Edge Esmeralda.",
    "Alice was present at Edge Esmeralda.",
    "They are co-attendees at the summit.",
    "Their co-attendance makes an in-person meeting easy.",
    "Both were at the event in Berlin.",
    "They were both at Edge Esmeralda.",
    "They met in the same session.",
    "They shared the same place and time.",
    "Alice is a member of the founders network.",
    "Alice is part of the Edge community.",
    "Alice is an Edge Esmeralda network member.",
    "Alice is a community member.",
    "They are fellow members of the community.",
    "Bob is a resident of Berlin.",
    "They co-reside in Berlin.",
    "Alice and Bob shared a workshop.",
    "Bob is an Edge City resident.",
    "Bob lives in Berlin.",
    "Bob is based in Berlin.",
    "Bob calls Berlin home.",
    "Bob resides in Berlin.",
    "They are co-residents.",
    "They are co-residents in the village.",
    "Alice belongs to the event community.",
    "Alice joined Edge Esmeralda.",
    "Alice is affiliated with Edge Esmeralda.",
    "They know each other from the network.",
    "They crossed paths at the event.",
  ];

  for (const claim of dangerous) {
    it(`detects: ${claim}`, () => {
      expect(hasUnsupportedOpportunityClaim(claim)).toBe(true);
      expect(stripUnsupportedOpportunityClaims(claim)).toBe("");
    });
  }

  it("strips only unsafe sentences from mixed prose", () => {
    const result = stripUnsupportedOpportunityClaims(
      "Alice builds privacy tooling. Both were at the same event. Bob is seeking a security reviewer.",
    );
    expect(result).toBe(
      "Alice builds privacy tooling. Bob is seeking a security reviewer.",
    );
  });

  it("does not flag generic non-affiliation uses", () => {
    const safe = [
      "They are comparing a membership model for the product.",
      "The team members need a better planning tool.",
      "Bob designs resident-memory optimization for databases.",
      "They both work on event scheduling software.",
      "Bob builds attendee management software.",
      "Bob builds onboarding for members of cooperatives.",
      "Alice joined Bob to build the product.",
      "The platform serves community members.",
      "The product helps residents of Berlin find services.",
    ];
    for (const text of safe) {
      expect(hasUnsupportedOpportunityClaim(text)).toBe(false);
      expect(stripUnsupportedOpportunityClaims(text)).toBe(text);
    }
  });
});
