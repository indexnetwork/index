import { config } from "dotenv";
config({ path: ".env.development" });

import { describe, it, expect } from "bun:test";
import { NegotiationGraphFactory } from "../src/lib/protocol/graphs/negotiation.graph";
import { NegotiationProposer } from "../src/lib/protocol/agents/negotiation.proposer";
import { NegotiationResponder } from "../src/lib/protocol/agents/negotiation.responder";
import { ConversationService } from "../src/services/conversation.service";
import { TaskService } from "../src/services/task.service";

// Prerequisites: requires DATABASE_URL and OPENROUTER_API_KEY in .env.development
// Run with: cd protocol && bun test tests/negotiation.e2e.spec.ts

describe("Negotiation E2E", () => {
  it("runs a full negotiation with real agents and A2A persistence", async () => {
    const conversationService = new ConversationService();
    const taskService = new TaskService();
    const proposer = new NegotiationProposer();
    const responder = new NegotiationResponder();

    const factory = new NegotiationGraphFactory(
      conversationService,
      taskService,
      proposer,
      responder,
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
      indexContext: { indexId: "e2e-index", prompt: "AI startup co-founders" },
      seedAssessment: { score: 78, reasoning: "Complementary skills", valencyRole: "Peer" },
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
