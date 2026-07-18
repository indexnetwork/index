/** Config */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect, mock } from "bun:test";

import type { Opportunity, OpportunityControllerDatabase } from '@indexnetwork/protocol';
import { OpportunityService } from "../opportunity.service";
import type { UptakeAcceptanceGuardLike } from "../../lib/opportunity/uptake-acceptance.guard";
import type { OutcomeFeedbackRecorderLike, PreparedOutcomeCapture } from "../../lib/opportunity/outcome-feedback.recorder";

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
  it("returns the uptake advisory before creating a DM, mutating status, or adding contacts", async () => {
    const db = createMockDb(twoActorOpportunity);
    const guard = {
      check: mock(async () => ({
        error: "Resolve the pending uptake questions or explicitly continue anyway.",
        status: 409 as const,
        advisory: {
          code: "unresolved_uptake_questions" as const,
          advisoryOnly: true as const,
          opportunityId: OPP_ID,
          questions: [{ id: "q-1", title: "Capacity", prompt: "Can they deliver?", options: [], multiSelect: false }],
          acknowledgedUptakeQuestionIds: [],
        },
      })),
    } satisfies UptakeAcceptanceGuardLike;
    const service = new OpportunityService(db, undefined, guard);

    const result = await service.updateOpportunityStatus(OPP_ID, "accepted", USER_A);

    expect(result).toMatchObject({ status: 409, advisory: { code: "unresolved_uptake_questions" } });
    expect(guard.check).toHaveBeenCalledWith({ opportunityId: OPP_ID, userId: USER_A, networkId: undefined, acknowledgedUptakeQuestionIds: undefined });
    expect(db.getOrCreateDM).not.toHaveBeenCalled();
    expect(db.stampOpportunityActorAction).not.toHaveBeenCalled();
    expect(db.upsertContactMembership).not.toHaveBeenCalled();
  });

  it('sanitizes unsafe reasoning in mutation responses', async () => {
    const unsafe = {
      ...twoActorOpportunity,
      interpretation: {
        ...twoActorOpportunity.interpretation,
        reasoning: 'Yusuf, an attendee of the Edge Esmeralda network, is a strong match.',
      },
    };
    const db = createMockDb(unsafe);
    const service = new OpportunityService(db);

    const result = await service.updateOpportunityStatus(OPP_ID, 'accepted', USER_A);

    expect('error' in result).toBe(false);
    if ('error' in result) throw new Error(result.error);
    expect(result.opportunity.interpretation.reasoning).toBe('Connection opportunity');
  });

  it("passes acknowledgement IDs into the acceptance guard", async () => {
    const db = createMockDb(twoActorOpportunity);
    const guard = { check: mock(async () => null) } satisfies UptakeAcceptanceGuardLike;
    const service = new OpportunityService(db, undefined, guard);

    await service.updateOpportunityStatus(OPP_ID, "accepted", USER_A, {
      acknowledgedUptakeQuestionIds: ["q-1", "q-2"],
    });

    expect(guard.check).toHaveBeenCalledWith(expect.objectContaining({
      acknowledgedUptakeQuestionIds: ["q-1", "q-2"],
    }));
    expect(db.stampOpportunityActorAction).toHaveBeenCalled();
  });

  it("does not run the uptake guard for non-accepted status changes", async () => {
    const db = createMockDb(twoActorOpportunity);
    const guard = { check: mock(async () => null) } satisfies UptakeAcceptanceGuardLike;
    const service = new OpportunityService(db, undefined, guard);

    await service.updateOpportunityStatus(OPP_ID, "rejected", USER_A);

    expect(guard.check).not.toHaveBeenCalled();
  });
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

  it("rejects a network-scoped accept unless every participant is anchored in scope", async () => {
    const crossNetwork = {
      ...twoActorOpportunity,
      actors: [
        { networkId: "idx-1", userId: USER_A, role: "patient" },
        { networkId: "idx-2", userId: USER_B, role: "agent" },
      ],
    };
    const db = createMockDb(crossNetwork);
    const service = new OpportunityService(db);

    const result = await service.updateOpportunityStatus(OPP_ID, "accepted", USER_A, { networkScopeId: "idx-1" });

    expect(result).toMatchObject({ error: "Opportunity not found", status: 404 });
    expect(db.getOrCreateDM).not.toHaveBeenCalled();
    expect(db.stampOpportunityActorAction).not.toHaveBeenCalled();
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

const preparedCapture: PreparedOutcomeCapture = {
  event: {
    recipientUserId: USER_A,
    intentId: "intent-owner-a",
    intentFingerprint: "fingerprint-a",
    opportunityId: OPP_ID,
    networkId: "idx-1",
    action: "accepted",
    candidateSnapshot: "safe snapshot",
    snapshotHash: "snapshot-hash",
    dedupKey: "counterpart-hash",
    idempotencyKey: "idempotency-hash",
  },
  scope: {
    recipientUserId: USER_A,
    intentId: "intent-owner-a",
    intentFingerprint: "fingerprint-a",
  },
};

function recorderStub(): OutcomeFeedbackRecorderLike & {
  prepare: ReturnType<typeof mock>;
  triggerMine: ReturnType<typeof mock>;
} {
  return {
    prepare: mock(async () => preparedCapture),
    triggerMine: mock(() => {}),
  };
}

describe("OpportunityService.updateOpportunityStatus — atomic Lens B capture", () => {
  it("successful winning action inserts one event in-transition and mines once after commit", async () => {
    const recorder = recorderStub();
    const db = createMockDb(twoActorOpportunity);
    db.stampOpportunityActorAction = mock(async (_id, _userId, _status, _acceptedBy, outbox) => {
      expect(outbox).toBeDefined();
      outbox!.result.inserted = true; // adapter reports NEW same-txn insert
      return { ...twoActorOpportunity, status: "accepted" };
    });
    const service = new OpportunityService(db, undefined, { check: async () => null }, recorder);

    const result = await service.updateOpportunityStatus(OPP_ID, "accepted", USER_A, {
      actionProvenance: "user_session",
    });

    expect(result).not.toHaveProperty("error");
    expect(recorder.prepare).toHaveBeenCalledTimes(1);
    expect(db.stampOpportunityActorAction).toHaveBeenCalledTimes(1);
    expect(recorder.triggerMine).toHaveBeenCalledTimes(1);
    expect(recorder.triggerMine).toHaveBeenCalledWith(preparedCapture.scope);
  });

  it("duplicate action launches no duplicate mining pass", async () => {
    const recorder = recorderStub();
    const db = createMockDb(twoActorOpportunity);
    db.stampOpportunityActorAction = mock(async (_id, _userId, _status, _acceptedBy, outbox) => {
      expect(outbox).toBeDefined();
      outbox!.result.inserted = false; // unique idempotency key already exists
      return { ...twoActorOpportunity, status: "accepted" };
    });
    const service = new OpportunityService(db, undefined, { check: async () => null }, recorder);

    await service.updateOpportunityStatus(OPP_ID, "accepted", USER_A, {
      actionProvenance: "user_session",
    });

    expect(recorder.triggerMine).not.toHaveBeenCalled();
  });

  it("rolled-back action produces no post-commit mining trigger", async () => {
    const recorder = recorderStub();
    const db = createMockDb(twoActorOpportunity);
    db.stampOpportunityActorAction = mock(async (_id, _userId, _status, _acceptedBy, outbox) => {
      expect(outbox).toBeDefined();
      // Simulate the same transaction throwing: status + event both roll back.
      throw new Error("transaction rolled back");
    });
    const service = new OpportunityService(db, undefined, { check: async () => null }, recorder);

    await expect(service.updateOpportunityStatus(OPP_ID, "accepted", USER_A, {
      actionProvenance: "user_session",
    })).rejects.toThrow("transaction rolled back");
    expect(recorder.triggerMine).not.toHaveBeenCalled();
  });

  it("API-key provenance is forwarded to eligibility and never produces an outbox", async () => {
    const recorder = recorderStub();
    recorder.prepare = mock(async (input) => input.provenance === "user_session" ? preparedCapture : null);
    const db = createMockDb(twoActorOpportunity);
    const service = new OpportunityService(db, undefined, { check: async () => null }, recorder);

    await service.updateOpportunityStatus(OPP_ID, "accepted", USER_A, {
      actionProvenance: "api_key",
    });

    expect(recorder.prepare).toHaveBeenCalledWith(expect.objectContaining({ provenance: "api_key" }));
    expect(db.stampOpportunityActorAction).toHaveBeenCalledWith(OPP_ID, USER_A, "accepted", USER_A);
    expect(recorder.triggerMine).not.toHaveBeenCalled();
  });
});
