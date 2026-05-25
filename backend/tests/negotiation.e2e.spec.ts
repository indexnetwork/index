import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect } from "bun:test";
import { NegotiationGraphFactory } from "@indexnetwork/protocol";
import type { NegotiationGraphDatabase } from "@indexnetwork/protocol";
import { conversationDatabaseAdapter } from "../src/adapters/database.adapter";

// Prerequisites: requires DATABASE_URL and OPENROUTER_API_KEY in .env.test
// Run with: cd backend && bun test tests/negotiation.e2e.spec.ts

const noopDispatcher = {
  dispatch: async () => ({ handled: false as const, reason: "no_agent" as const }),
  hasPersonalAgent: async () => false,
};

describe("Negotiation E2E", () => {
  it("runs a full negotiation with real agents and A2A persistence", async () => {
    const factory = new NegotiationGraphFactory(
      conversationDatabaseAdapter as unknown as NegotiationGraphDatabase,
      noopDispatcher,
    );
    const graph = factory.createGraph();

    const result = await graph.invoke({
      sourceUser: {
        id: "e2e-source",
        intents: [{ id: "i1", title: "Looking for ML engineer", description: "Need ML expertise for recommendation system", confidence: 0.9 }],
        profile: { name: "Alice", bio: "Product manager building AI startup", skills: ["product management", "AI strategy"] },
      },
      candidateUser: {
        id: "e2e-candidate",
        intents: [{ id: "i2", title: "Seeking PM co-founder", description: "ML engineer looking for product-minded co-founder", confidence: 0.85 }],
        profile: { name: "Bob", bio: "Senior ML engineer with 8 years experience", skills: ["machine learning", "PyTorch"] },
      },
      indexContext: { networkId: "e2e-index", prompt: "AI startup co-founders" },
      seedAssessment: { reasoning: "Complementary skills", valencyRole: "Peer" },
      maxTurns: 4,
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
  }, 120_000);
});
