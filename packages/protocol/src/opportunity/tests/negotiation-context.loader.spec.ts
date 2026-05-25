import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it } from "bun:test";

import {
  loadNegotiationContext,
  type NegotiationContextDatabase,
} from "../negotiation-context.loader.js";
import type { NegotiationOutcome } from "../../negotiation/negotiation.state.js";

const OPPORTUNITY_ID = "opp-123";

function turnMessage(
  action: "propose" | "accept" | "reject" | "counter" | "question",
  reasoning: string,
): { id: string; senderId: string; role: "user" | "agent"; parts: unknown[]; createdAt: Date } {
  return {
    id: `msg-${Math.random().toString(36).slice(2, 8)}`,
    senderId: "agent-1",
    role: "agent",
    parts: [
      {
        kind: "data",
        data: {
          action,
          assessment: {
            reasoning,
            suggestedRoles: { ownUser: "peer", otherUser: "peer" },
          },
          message: `says: ${action}`,
        },
      },
    ],
    createdAt: new Date(),
  };
}

function outcomeArtifact(
  hasOpportunity: boolean,
  reason?: "turn_cap" | "timeout",
): { id: string; name: string | null; parts: unknown[]; metadata: Record<string, unknown> | null } {
  const outcome: NegotiationOutcome = {
    hasOpportunity,
    agreedRoles: [{ userId: "u1", role: "peer" }],
    reasoning: hasOpportunity ? "Roles aligned." : "Not a match.",
    turnCount: 4,
    ...(reason ? { reason } : {}),
  };
  return {
    id: "art-1",
    name: "negotiation-outcome",
    parts: [{ kind: "data", data: outcome }],
    metadata: null,
  };
}

function buildDb(overrides: Partial<NegotiationContextDatabase> = {}): NegotiationContextDatabase {
  return {
    getNegotiationTaskForOpportunity: async () => null,
    getMessagesForConversation: async () => [],
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

  it("returns turn counters only for `negotiating` without fetching artifacts", async () => {
    let artifactFetches = 0;
    const db = buildDb({
      getNegotiationTaskForOpportunity: async () => ({
        id: "task-1",
        conversationId: "conv-1",
        state: "working",
        metadata: { type: "negotiation", opportunityId: OPPORTUNITY_ID, maxTurns: 8 },
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      getMessagesForConversation: async () => [
        turnMessage("propose", "Start with a pitch."),
        turnMessage("counter", "Suggest a different angle."),
      ],
      getArtifactsForTask: async () => {
        artifactFetches += 1;
        return [];
      },
    });

    const result = await loadNegotiationContext(db, OPPORTUNITY_ID, "negotiating");

    expect(result).not.toBeNull();
    expect(result!.status).toBe("negotiating");
    expect(result!.turnCount).toBe(2);
    expect(result!.turnCap).toBe(8);
    expect(result!.turns).toBeUndefined();
    expect(result!.outcome).toBeUndefined();
    expect(artifactFetches).toBe(0);
  });

  it("returns full context for `pending` including turns and outcome", async () => {
    const db = buildDb({
      getNegotiationTaskForOpportunity: async () => ({
        id: "task-1",
        conversationId: "conv-1",
        state: "completed",
        metadata: { type: "negotiation", opportunityId: OPPORTUNITY_ID, maxTurns: 6 },
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      getMessagesForConversation: async () => [
        turnMessage("propose", "Pitch the alignment."),
        turnMessage("accept", "Looks good."),
      ],
      getArtifactsForTask: async () => [outcomeArtifact(true)],
    });

    const result = await loadNegotiationContext(db, OPPORTUNITY_ID, "pending");

    expect(result).not.toBeNull();
    expect(result!.status).toBe("pending");
    expect(result!.turnCount).toBe(2);
    expect(result!.turnCap).toBe(6);
    expect(result!.turns).toHaveLength(2);
    expect(result!.outcome?.hasOpportunity).toBe(true);
  });

  it("includes `reason: turn_cap` in outcome for stalled negotiations", async () => {
    const db = buildDb({
      getNegotiationTaskForOpportunity: async () => ({
        id: "task-1",
        conversationId: "conv-1",
        state: "completed",
        metadata: { type: "negotiation", opportunityId: OPPORTUNITY_ID, maxTurns: 6 },
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      getMessagesForConversation: async () => [
        turnMessage("propose", "Pitch."),
        turnMessage("counter", "Counter."),
        turnMessage("counter", "Counter again."),
      ],
      getArtifactsForTask: async () => [outcomeArtifact(false, "turn_cap")],
    });

    const result = await loadNegotiationContext(db, OPPORTUNITY_ID, "stalled");

    expect(result!.outcome?.reason).toBe("turn_cap");
    expect(result!.outcome?.hasOpportunity).toBe(false);
    expect(result!.turns).toHaveLength(3);
  });

  it("defaults turnCap to 0 when task metadata omits maxTurns", async () => {
    const db = buildDb({
      getNegotiationTaskForOpportunity: async () => ({
        id: "task-1",
        conversationId: "conv-1",
        state: "completed",
        metadata: { type: "negotiation", opportunityId: OPPORTUNITY_ID },
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      getMessagesForConversation: async () => [turnMessage("propose", "pitch")],
      getArtifactsForTask: async () => [outcomeArtifact(true)],
    });

    const result = await loadNegotiationContext(db, OPPORTUNITY_ID, "accepted");

    expect(result!.turnCap).toBe(0);
  });

  it("returns full context without outcome when artifact is missing", async () => {
    const db = buildDb({
      getNegotiationTaskForOpportunity: async () => ({
        id: "task-1",
        conversationId: "conv-1",
        state: "completed",
        metadata: { type: "negotiation", opportunityId: OPPORTUNITY_ID, maxTurns: 6 },
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
      getMessagesForConversation: async () => [turnMessage("propose", "pitch")],
      getArtifactsForTask: async () => [],
    });

    const result = await loadNegotiationContext(db, OPPORTUNITY_ID, "rejected");

    expect(result!.outcome).toBeUndefined();
    expect(result!.turns).toHaveLength(1);
  });
});
