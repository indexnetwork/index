/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, it, expect } from "bun:test";

import { DiscoveryNegotiationDigestSchema } from "../negotiation-digest.schema.js";

const baseDigest = {
  counterpartyHint: "AI infra founder, Berlin",
  indexContext: "AI founders and engineers",
  outcomeRole: "opportunity" as const,
  outcomeReason: null,
  keyTake: "Aligned on roles after one counter.",
  suggestedRoles: { ownUser: "agent" as const, otherUser: "patient" as const },
};

describe("DiscoveryNegotiationDigestSchema", () => {
  it("clamps counterpartyHint > 120 chars instead of rejecting", () => {
    const parsed = DiscoveryNegotiationDigestSchema.safeParse({
      ...baseDigest,
      counterpartyHint: "x".repeat(200),
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.counterpartyHint.length).toBe(120);
    }
  });

  it("clamps keyTake > 180 chars instead of rejecting", () => {
    const parsed = DiscoveryNegotiationDigestSchema.safeParse({
      ...baseDigest,
      keyTake: "y".repeat(250),
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.keyTake.length).toBe(180);
    }
  });

  it("clamps indexContext > 120 chars instead of rejecting", () => {
    const parsed = DiscoveryNegotiationDigestSchema.safeParse({
      ...baseDigest,
      indexContext: "z".repeat(200),
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.indexContext.length).toBe(120);
    }
  });

  it("preserves short strings unchanged", () => {
    const parsed = DiscoveryNegotiationDigestSchema.parse(baseDigest);
    expect(parsed.counterpartyHint).toBe(baseDigest.counterpartyHint);
    expect(parsed.indexContext).toBe(baseDigest.indexContext);
    expect(parsed.keyTake).toBe(baseDigest.keyTake);
  });

  it("still rejects empty strings (preserves min(1))", () => {
    expect(
      DiscoveryNegotiationDigestSchema.safeParse({ ...baseDigest, counterpartyHint: "" }).success,
    ).toBe(false);
    expect(
      DiscoveryNegotiationDigestSchema.safeParse({ ...baseDigest, keyTake: "" }).success,
    ).toBe(false);
    expect(
      DiscoveryNegotiationDigestSchema.safeParse({ ...baseDigest, indexContext: "" }).success,
    ).toBe(false);
  });

  it("rejects non-string input for the clamped fields", () => {
    expect(
      DiscoveryNegotiationDigestSchema.safeParse({ ...baseDigest, counterpartyHint: 42 }).success,
    ).toBe(false);
  });
});
