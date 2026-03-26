/** Config */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect, mock, beforeEach } from "bun:test";

import type { Opportunity, OpportunityControllerDatabase } from "../../lib/protocol/interfaces/database.interface";
import { OpportunityService } from "../opportunity.service";

// ─────────────────────────────────────────────────────────────────────────────
// Test data
// ─────────────────────────────────────────────────────────────────────────────

const USER_A = "user-a-001";
const USER_B = "user-b-002";
const INTRODUCER = "user-introducer-003";
const OPP_ID = "opp-001";

const twoActorOpportunity: Opportunity = {
  id: OPP_ID,
  detection: { source: "opportunity_graph", timestamp: new Date().toISOString() },
  actors: [
    { indexId: "idx-1", userId: USER_A, role: "patient" },
    { indexId: "idx-1", userId: USER_B, role: "agent" },
  ],
  interpretation: {
    category: "collaboration",
    reasoning: "Shared interests.",
    confidence: 0.85,
    signals: [],
  },
  context: { indexId: "idx-1" },
  confidence: "0.85",
  status: "pending",
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: null,
};

const threeActorOpportunity: Opportunity = {
  ...twoActorOpportunity,
  id: "opp-002",
  actors: [
    { indexId: "idx-1", userId: USER_A, role: "party" },
    { indexId: "idx-1", userId: USER_B, role: "party" },
    { indexId: "idx-1", userId: INTRODUCER, role: "introducer" },
  ],
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock database
// ─────────────────────────────────────────────────────────────────────────────

function createMockDb(opportunity: Opportunity | null) {
  return {
    getOpportunity: mock(() => Promise.resolve(opportunity)),
    updateOpportunityStatus: mock(() =>
      Promise.resolve(opportunity ? { ...opportunity, status: "accepted" } : null)
    ),
    acceptSiblingOpportunities: mock(() => Promise.resolve()),
    upsertContactMembership: mock(() => Promise.resolve()),
  } as unknown as OpportunityControllerDatabase;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("OpportunityService.updateOpportunityStatus", () => {
  it("calls upsertContactMembership with counterpart when accepting a 2-actor opportunity", async () => {
    const db = createMockDb(twoActorOpportunity);
    const service = new OpportunityService(db);

    const result = await service.updateOpportunityStatus(OPP_ID, "accepted", USER_A);

    expect(result).not.toHaveProperty("error");
    expect((result as { counterpartUserId?: string }).counterpartUserId).toBe(USER_B);
    expect(db.upsertContactMembership).toHaveBeenCalledTimes(1);
    expect(db.upsertContactMembership).toHaveBeenCalledWith(USER_A, USER_B, { restore: true });
  });

  it("calls upsertContactMembership with non-introducer counterpart in 3-actor opportunity", async () => {
    const db = createMockDb(threeActorOpportunity);
    const service = new OpportunityService(db);

    const result = await service.updateOpportunityStatus("opp-002", "accepted", USER_A);

    expect(result).not.toHaveProperty("error");
    expect((result as { counterpartUserId?: string }).counterpartUserId).toBe(USER_B);
    expect(db.upsertContactMembership).toHaveBeenCalledTimes(1);
    expect(db.upsertContactMembership).toHaveBeenCalledWith(USER_A, USER_B, { restore: true });
  });

  it("does NOT call upsertContactMembership when rejecting", async () => {
    const db = createMockDb(twoActorOpportunity);
    const service = new OpportunityService(db);

    await service.updateOpportunityStatus(OPP_ID, "rejected", USER_A);

    expect(db.upsertContactMembership).not.toHaveBeenCalled();
  });

  it("returns 404 when opportunity not found", async () => {
    const db = createMockDb(null);
    const service = new OpportunityService(db);

    const result = await service.updateOpportunityStatus("nonexistent", "accepted", USER_A);

    expect(result).toHaveProperty("error");
    expect((result as { status: number }).status).toBe(404);
    expect(db.upsertContactMembership).not.toHaveBeenCalled();
  });

  it("returns 403 when user is not an actor", async () => {
    const db = createMockDb(twoActorOpportunity);
    const service = new OpportunityService(db);

    const result = await service.updateOpportunityStatus(OPP_ID, "accepted", "stranger");

    expect(result).toHaveProperty("error");
    expect((result as { status: number }).status).toBe(403);
    expect(db.upsertContactMembership).not.toHaveBeenCalled();
  });
});
