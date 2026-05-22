/** Config */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect, mock } from "bun:test";

import type { Opportunity, OpportunityControllerDatabase } from '@indexnetwork/protocol';
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
    { networkId: "idx-1", userId: USER_A, role: "patient" },
    { networkId: "idx-1", userId: USER_B, role: "agent" },
  ],
  interpretation: {
    category: "collaboration",
    reasoning: "Shared interests.",
    confidence: 0.85,
    signals: [],
  },
  context: { networkId: "idx-1" },
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
    { networkId: "idx-1", userId: USER_A, role: "party" },
    { networkId: "idx-1", userId: USER_B, role: "party" },
    { networkId: "idx-1", userId: INTRODUCER, role: "introducer" },
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
    stampOpportunityActorAction: mock(() =>
      Promise.resolve(opportunity ? { ...opportunity, status: "accepted" } : null)
    ),
    acceptSiblingOpportunities: mock(() => Promise.resolve()),
    upsertContactMembership: mock(() => Promise.resolve()),
    getOrCreateDM: mock(() => Promise.resolve({ id: "conv-backfill-001" })),
    unhideConversation: mock(() => Promise.resolve()),
  } as unknown as OpportunityControllerDatabase;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("OpportunityService.updateOpportunityStatus", () => {
  it("creates DM and adds contacts both ways when accepting a 2-actor opportunity", async () => {
    const db = createMockDb(twoActorOpportunity);
    const service = new OpportunityService(db);

    const result = await service.updateOpportunityStatus(OPP_ID, "accepted", USER_A);

    expect(result).not.toHaveProperty("error");
    expect((result as { counterpartUserId?: string }).counterpartUserId).toBe(USER_B);

    // DM created between the pair
    expect(db.getOrCreateDM).toHaveBeenCalledWith(USER_A, USER_B);

    // Contact added both ways: accepter gets counterpart (restore:true),
    // counterpart gets accepter (restore:false — honours prior opt-out)
    expect(db.upsertContactMembership).toHaveBeenCalledTimes(2);
    expect(db.upsertContactMembership).toHaveBeenCalledWith(USER_A, USER_B, { restore: true });
    expect(db.upsertContactMembership).toHaveBeenCalledWith(USER_B, USER_A, { restore: false });
  });

  it("creates DM and adds contacts both ways with non-introducer counterpart in 3-actor opportunity", async () => {
    const db = createMockDb(threeActorOpportunity);
    const service = new OpportunityService(db);

    const result = await service.updateOpportunityStatus("opp-002", "accepted", USER_A);

    expect(result).not.toHaveProperty("error");
    expect((result as { counterpartUserId?: string }).counterpartUserId).toBe(USER_B);

    expect(db.getOrCreateDM).toHaveBeenCalledWith(USER_A, USER_B);
    expect(db.upsertContactMembership).toHaveBeenCalledTimes(2);
    expect(db.upsertContactMembership).toHaveBeenCalledWith(USER_A, USER_B, { restore: true });
    expect(db.upsertContactMembership).toHaveBeenCalledWith(USER_B, USER_A, { restore: false });
  });

  it("does NOT call upsertContactMembership when rejecting", async () => {
    const db = createMockDb(twoActorOpportunity);
    const service = new OpportunityService(db);

    await service.updateOpportunityStatus(OPP_ID, "rejected", USER_A);

    expect(db.upsertContactMembership).not.toHaveBeenCalled();
  });

  it("does NOT call getOrCreateDM when rejecting", async () => {
    const db = createMockDb(twoActorOpportunity);
    const service = new OpportunityService(db);

    await service.updateOpportunityStatus(OPP_ID, "rejected", USER_A);

    expect(db.getOrCreateDM).not.toHaveBeenCalled();
  });

  it("accepts 'stalled' status and does NOT create a contact membership", async () => {
    const db = createMockDb(twoActorOpportunity);
    const service = new OpportunityService(db);

    const result = await service.updateOpportunityStatus(OPP_ID, "stalled", USER_A);

    expect(result).not.toHaveProperty("error");
    expect(db.updateOpportunityStatus).toHaveBeenCalledWith(OPP_ID, "stalled");
    expect(db.upsertContactMembership).not.toHaveBeenCalled();
    expect(db.acceptSiblingOpportunities).not.toHaveBeenCalled();
  });

  it("returns 404 when opportunity not found", async () => {
    const db = createMockDb(null);
    const service = new OpportunityService(db);

    const result = await service.updateOpportunityStatus("nonexistent", "accepted", USER_A);

    expect(result).toHaveProperty("error");
    expect((result as { status: number }).status).toBe(404);
    expect(db.upsertContactMembership).not.toHaveBeenCalled();
  });

  it("returns 500 and does not flip status when getOrCreateDM throws", async () => {
    const db = {
      getOpportunity: mock(() => Promise.resolve(twoActorOpportunity)),
      updateOpportunityStatus: mock(() =>
        Promise.resolve({ ...twoActorOpportunity, status: "accepted" })
      ),
      stampOpportunityActorAction: mock(() =>
        Promise.resolve({ ...twoActorOpportunity, status: "accepted" })
      ),
      acceptSiblingOpportunities: mock(() => Promise.resolve()),
      upsertContactMembership: mock(() => Promise.resolve()),
      getOrCreateDM: mock(() => Promise.reject(new Error("pg: connection error"))),
      unhideConversation: mock(() => Promise.resolve()),
    } as unknown as OpportunityControllerDatabase;
    const service = new OpportunityService(db);

    const result = await service.updateOpportunityStatus(OPP_ID, "accepted", USER_A);

    expect(result).toHaveProperty("error");
    expect((result as { status: number }).status).toBe(500);
    expect(db.updateOpportunityStatus).not.toHaveBeenCalled();
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
