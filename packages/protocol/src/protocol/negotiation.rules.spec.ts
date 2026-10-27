import { describe, expect, test } from "bun:test";

import { negotiationTurnSchema } from "./negotiation.rules.js";

describe("negotiationTurnSchema clientTurnId", () => {
  const turn = { action: "propose", message: "A concrete reason to meet." };

  test("accepts a valid uuid clientTurnId and retains it", () => {
    const clientTurnId = "3b2f8a2e-6d1a-4f0b-9c3d-7e5a1b2c3d4e";
    const parsed = negotiationTurnSchema.safeParse({ ...turn, clientTurnId });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.clientTurnId).toBe(clientTurnId);
  });

  test("stays valid without a clientTurnId", () => {
    const parsed = negotiationTurnSchema.safeParse(turn);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.clientTurnId).toBeUndefined();
  });

  test("rejects a non-uuid clientTurnId", () => {
    expect(negotiationTurnSchema.safeParse({ ...turn, clientTurnId: "not-a-uuid" }).success).toBe(false);
  });
});
