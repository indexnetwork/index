import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it } from "bun:test";

import { loadNegotiationContext, type NegotiationContextDatabase } from "../negotiation-context.loader.js";
import type { NegotiationTaskRow } from "../../../platform/database/negotiation.js";

const OPPORTUNITY_ID = "opp-123";

function turnMessage(
  verb: "outreach" | "counter" | "question",
  message: string,
): { id: string; senderId: string; role: "user" | "agent"; parts: unknown[]; createdAt: Date } {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    senderId: "agent-1",
    role: "agent",
    parts: [{ kind: "data", data: { verb, message, reasoning: `why: ${message}` } }],
    createdAt: new Date(),
  };
}

function baseTask(overrides: Partial<NegotiationTaskRow> = {}): NegotiationTaskRow {
  return {
    id: "task-1",
    conversationId: "conv-1",
    state: "working",
    brief: "brief",
    metadata: {
      type: "negotiation",
      opportunityId: OPPORTUNITY_ID,
      sourceUserId: "u-source",
      candidateUserId: "u-candidate",
      initiatorUserId: "u-source",
      networkId: "net-1",
      intentId: "intent-1",
      round: 1,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function buildDb(overrides: Partial<NegotiationContextDatabase> = {}): NegotiationContextDatabase {
  return {
    getNegotiationTaskForOpportunity: async () => null,
    getNegotiationMessages: async () => [],
    getArtifactsForTask: async () => [],
    ...overrides,
  };
}

describe("loadNegotiationContext", () => {
  it("returns null for draft status without querying the database", async () => {
    let taskLookups = 0;
    const db = buildDb({
      getNegotiationTaskForOpportunity: async () => {
        taskLookups += 1;
        return null;
      },
    });

    const result = await loadNegotiationContext(db, OPPORTUNITY_ID, "draft");

    expect(result).toBeNull();
    expect(taskLookups).toBe(0);
  });

  it("returns null for latent status without querying the database", async () => {
    const db = buildDb();
    const result = await loadNegotiationContext(db, OPPORTUNITY_ID, "latent");
    expect(result).toBeNull();
  });

  it("returns null for expired status", async () => {
    const db = buildDb();
    const result = await loadNegotiationContext(db, OPPORTUNITY_ID, "expired");
    expect(result).toBeNull();
  });

  it("returns null when no negotiation task exists for the opportunity", async () => {
    const db = buildDb({ getNegotiationTaskForOpportunity: async () => null });
    const result = await loadNegotiationContext(db, OPPORTUNITY_ID, "pending");
    expect(result).toBeNull();
  });

  it("returns the transcript and turn count for an in-progress negotiation", async () => {
    const db = buildDb({
      getNegotiationTaskForOpportunity: async () => baseTask(),
      getNegotiationMessages: async () => [
        turnMessage("outreach", "Opening pitch"),
        turnMessage("counter", "Different angle"),
      ],
    });

    const result = await loadNegotiationContext(db, OPPORTUNITY_ID, "negotiating");

    expect(result).not.toBeNull();
    expect(result!.status).toBe("negotiating");
    expect(result!.conversationId).toBe("conv-1");
    expect(result!.turnCount).toBe(2);
    expect(result!.turns).toHaveLength(2);
  });

  it("surfaces the pause reason once the negotiation has paused", async () => {
    const db = buildDb({
      getNegotiationTaskForOpportunity: async () =>
        baseTask({
          state: "paused",
          metadata: { ...baseTask().metadata, pause: { reason: "counterparty_silent" } },
        }),
      getNegotiationMessages: async () => [turnMessage("outreach", "Opening pitch")],
    });

    const result = await loadNegotiationContext(db, OPPORTUNITY_ID, "stalled");

    expect(result!.pause?.reason).toBe("counterparty_silent");
  });

  it("drops turns that fail to parse against the new turn schema", async () => {
    const db = buildDb({
      getNegotiationTaskForOpportunity: async () => baseTask(),
      getNegotiationMessages: async () => [
        turnMessage("outreach", "Opening pitch"),
        { id: "bad", senderId: "agent-1", role: "agent", parts: [{ kind: "data", data: { action: "propose" } }], createdAt: new Date() },
      ],
    });

    const result = await loadNegotiationContext(db, OPPORTUNITY_ID, "pending");

    expect(result!.turns).toHaveLength(1);
  });
});
