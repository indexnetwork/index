import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect } from "bun:test";
import { randomUUID } from "node:crypto";
import { NegotiationGraphFactory, requestContext } from "@indexnetwork/protocol";
import type { NegotiationGraphDatabase } from "@indexnetwork/protocol";
import { conversationDatabaseAdapter } from "../src/adapters/database.adapter";

// Prerequisites: requires DATABASE_URL and OPENROUTER_API_KEY in .env.test
// Run with: cd services/api && bun test tests/negotiation.e2e.spec.ts

const noopDispatcher = {
  dispatch: async () => ({ handled: false as const, reason: "no_agent" as const }),
  hasExternalAgent: async () => false,
};

describe("Negotiation E2E", () => {
  it("runs a full negotiation with real agents and A2A persistence", async () => {
    const factory = new NegotiationGraphFactory(
      conversationDatabaseAdapter as unknown as NegotiationGraphDatabase,
      noopDispatcher,
    );
    const graph = factory.createGraph();

    // Per-run unique ids: fixed ids accumulate DM history across runs, turning
    // later runs into continuations that legitimately resolve in one turn and
    // break the fresh-negotiation assertions below.
    const sourceId = `e2e-source-${Date.now()}`;
    const candidateId = `e2e-candidate-${Date.now()}`;

    // IND-398: run this fresh negotiation with the screen gate in shadow mode
    // and a trace collector, so the screenDecision metadata + negotiation_screen
    // trace event can be asserted below. Random UUID: the opportunity row does
    // not exist, so status flips update 0 rows (already .catch-guarded).
    const origScreenMode = process.env.NEGOTIATION_SCREEN_MODE;
    process.env.NEGOTIATION_SCREEN_MODE = "shadow";
    const opportunityId = randomUUID();
    const traceEvents: Array<Record<string, unknown>> = [];

    const result = await requestContext.run(
      { traceEmitter: ((e: Record<string, unknown>) => { traceEvents.push(e); }) as never },
      () => graph.invoke({
        opportunityId,
      sourceUser: {
        id: sourceId,
        intents: [{ id: "i1", title: "Looking for ML engineer", description: "Need ML expertise for recommendation system", confidence: 0.9 }],
        profile: { name: "Alice", bio: "Product manager building AI startup", skills: ["product management", "AI strategy"] },
      },
      candidateUser: {
        id: candidateId,
        intents: [{ id: "i2", title: "Seeking PM co-founder", description: "ML engineer looking for product-minded co-founder", confidence: 0.85 }],
        profile: { name: "Bob", bio: "Senior ML engineer with 8 years experience", skills: ["machine learning", "PyTorch"] },
      },
      indexContext: { networkId: "e2e-index", prompt: "AI startup co-founders" },
      seedAssessment: { reasoning: "Complementary skills", valencyRole: "Peer" },
      maxTurns: 4,
      }),
    ).finally(() => {
      if (origScreenMode === undefined) delete process.env.NEGOTIATION_SCREEN_MODE;
      else process.env.NEGOTIATION_SCREEN_MODE = origScreenMode;
    });

    // Verify outcome exists
    expect(result.outcome).not.toBeNull();
    expect(typeof result.outcome!.hasOpportunity).toBe("boolean");
    expect(result.outcome!.turnCount).toBeGreaterThanOrEqual(2);
    expect(result.outcome!.turnCount).toBeLessThanOrEqual(4);
    expect(result.outcome!.reasoning).toBeTruthy();

    // Verify A2A records were created
    expect(result.conversationId).toBeTruthy();
    expect(result.taskId).toBeTruthy();
    expect(result.messages.length).toBeGreaterThanOrEqual(2);

    // IND-396: every new negotiation task carries the initiator seat stamp.
    const task = await conversationDatabaseAdapter.getTask(result.taskId);
    const metadata = (task?.metadata ?? {}) as Record<string, unknown>;
    expect(metadata.initiatorUserId).toBe(sourceId);
    expect(metadata.sourceUserId).toBe(sourceId);
    // IND-397: fresh tasks are version-stamped (v1 unless env opts into v2).
    expect(metadata.protocolVersion).toBe(process.env.NEGOTIATION_PROTOCOL_VERSION === "v2" ? "v2" : "v1");

    // IND-398: shadow screen ran before the first turn — decision persisted on
    // task metadata and surfaced as a negotiation_screen trace event, and the
    // negotiation proceeded regardless of the verdict.
    const screen = metadata.screenDecision as Record<string, unknown> | undefined;
    expect(screen).toBeTruthy();
    expect(["reach_out", "pass"]).toContain(screen!.decision);
    expect(screen!.mode).toBe("shadow");
    expect(typeof (screen!.evidence as Record<string, unknown>).intentAlignment).toBe("string");

    const screenEvents = traceEvents.filter((e) => e.type === "negotiation_screen");
    expect(screenEvents.length).toBe(1);
    expect(screenEvents[0].opportunityId).toBe(opportunityId);
    expect(["reach_out", "pass"]).toContain(screenEvents[0].decision);
  }, 120_000);

  it("runs a full v2 negotiation: seat-scoped actions, counterparty-only accept (IND-397)", async () => {
    const origVersion = process.env.NEGOTIATION_PROTOCOL_VERSION;
    process.env.NEGOTIATION_PROTOCOL_VERSION = "v2";
    try {
      const factory = new NegotiationGraphFactory(
        conversationDatabaseAdapter as unknown as NegotiationGraphDatabase,
        noopDispatcher,
      );
      const graph = factory.createGraph();

      // Fresh user ids per run so the DM conversation has no prior turns
      // (version stamping is inheritance-based).
      const runTag = Date.now();
      const initiatorId = `e2e-v2-init-${runTag}`;
      const counterpartyId = `e2e-v2-cp-${runTag}`;

      const result = await graph.invoke({
        sourceUser: {
          id: initiatorId,
          intents: [{ id: "i1", title: "Looking for ML engineer", description: "Need ML expertise for recommendation system", confidence: 0.9 }],
          profile: { name: "Alice", bio: "Product manager building AI startup", skills: ["product management", "AI strategy"] },
        },
        candidateUser: {
          id: counterpartyId,
          intents: [{ id: "i2", title: "Seeking PM co-founder", description: "ML engineer looking for product-minded co-founder", confidence: 0.85 }],
          profile: { name: "Bob", bio: "Senior ML engineer with 8 years experience", skills: ["machine learning", "PyTorch"] },
        },
        indexContext: { networkId: "e2e-index", prompt: "AI startup co-founders" },
        seedAssessment: { reasoning: "Complementary skills", valencyRole: "Peer" },
        maxTurns: 4,
        initiatorUserId: initiatorId,
      });

      expect(result.outcome).not.toBeNull();

      // Version stamp on the task
      const task = await conversationDatabaseAdapter.getTask(result.taskId);
      const metadata = (task?.metadata ?? {}) as Record<string, unknown>;
      expect(metadata.protocolVersion).toBe("v2");
      expect(metadata.initiatorUserId).toBe(initiatorId);

      // Seat rules on the wire: turn 0 is the initiator's outreach; the
      // initiator never accepts; every action is v2 vocabulary.
      const turns = result.messages.map((m) => {
        const dp = (m.parts as Array<{ kind?: string; data?: { action?: string } }>).find((p) => p.kind === "data");
        return { senderId: m.senderId, action: dp?.data?.action };
      });
      expect(turns.length).toBeGreaterThanOrEqual(2);
      expect(turns[0].senderId).toBe(`agent:${initiatorId}`);
      expect(turns[0].action).toBe("outreach");
      const v2Vocabulary = ["outreach", "counter", "question", "withdraw", "accept", "decline"];
      for (const t of turns) {
        expect(v2Vocabulary).toContain(t.action ?? "");
        if (t.senderId === `agent:${initiatorId}`) {
          expect(t.action).not.toBe("accept");
        } else {
          expect(["accept", "decline", "counter", "question"]).toContain(t.action ?? "");
        }
      }

      // Outcome consistency: an opportunity exists only when the counterparty accepted.
      const lastTurn = turns[turns.length - 1];
      if (result.outcome!.hasOpportunity) {
        expect(lastTurn.action).toBe("accept");
        expect(lastTurn.senderId).toBe(`agent:${counterpartyId}`);
      }
    } finally {
      if (origVersion === undefined) delete process.env.NEGOTIATION_PROTOCOL_VERSION;
      else process.env.NEGOTIATION_PROTOCOL_VERSION = origVersion;
    }
  }, 180_000);
});
