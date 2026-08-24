import { describe, expect, it } from "vitest";

import type { IntentCycleSnapshot } from "@/services/conversation";
import { DEFAULT_RADAR_BUCKET, radarBucketBadgeTone, radarBucketForOpportunity } from "@/lib/radar-buckets";

type Negotiation = IntentCycleSnapshot["negotiations"][number];

function negotiation(overrides: Partial<Pick<Negotiation, "state" | "pause">>): Pick<Negotiation, "state" | "pause"> {
  return { state: "working", pause: null, ...overrides };
}

describe("Radar responsibility buckets", () => {
  it("opens on agent handling", () => {
    expect(DEFAULT_RADAR_BUCKET).toBe("agent-handling");
  });

  it.each([
    ["pending", undefined, "needs-you"],
    ["latent", undefined, "agent-handling"],
    ["draft", undefined, "agent-handling"],
    ["negotiating", undefined, "agent-handling"],
    ["pending", negotiation({ state: "working" }), "needs-you"],
  ] as const)("maps %s without a blocking pause to %s", (status, task, bucket) => {
    expect(radarBucketForOpportunity(status, task)).toBe(bucket);
  });

  it.each([
    ["needs_principal", "yours", "needs-you"],
    ["needs_principal", "theirs", "waiting"],
    ["counterparty_silent", "theirs", "waiting"],
    ["ready_for_verdict", "yours", "agent-handling"],
    ["turn_cap", "yours", "agent-handling"],
    ["open_failed", "theirs", "agent-handling"],
  ] as const)("maps paused %s owned by %s to %s", (reason, by, bucket) => {
    expect(radarBucketForOpportunity(
      "negotiating",
      negotiation({ state: "paused", pause: { reason, by } }),
    )).toBe(bucket);
  });

  it.each([
    ["accepted", "connected"],
    ["rejected", "closed"],
    ["expired", "closed"],
    ["stalled", "closed"],
  ] as const)("gives terminal %s precedence over stale task data", (status, bucket) => {
    expect(radarBucketForOpportunity(status, negotiation({
      state: "paused",
      pause: { reason: "needs_principal", by: "yours" },
    }))).toBe(bucket);
  });

  it("falls back to opportunity status when cycle data is unavailable", () => {
    expect(radarBucketForOpportunity("pending")).toBe("needs-you");
    expect(radarBucketForOpportunity("accepted")).toBe("connected");
  });

  it("gives only a non-zero Needs you badge an attention tone", () => {
    expect(radarBucketBadgeTone("needs-you", 1, false)).toBe("bg-amber-200 text-amber-950");
    expect(radarBucketBadgeTone("needs-you", 3, true)).toBe("bg-amber-200 text-amber-950");
    expect(radarBucketBadgeTone("needs-you", 0, false)).toBe("bg-gray-100 text-gray-500");
    expect(radarBucketBadgeTone("agent-handling", 2, true)).toBe("bg-white/20 text-white");
  });
});
