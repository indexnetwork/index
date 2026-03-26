import { config } from "dotenv";
config({ path: ".env.development" });

import { describe, it, expect, mock } from "bun:test";
import { NegotiationGraphFactory } from "../src/lib/protocol/graphs/negotiation.graph";
import type { NegotiationDatabase } from "../src/lib/protocol/interfaces/database.interface";
import type { UserNegotiationContext, SeedAssessment } from "../src/lib/protocol/states/negotiation.state";

const sourceUser: UserNegotiationContext = {
  id: "user-source",
  intents: [{ id: "i1", title: "Looking for ML engineer", description: "Need ML expertise", confidence: 0.9 }],
  profile: { name: "Alice", bio: "PM at startup", skills: ["product"] },
};

const candidateUser: UserNegotiationContext = {
  id: "user-candidate",
  intents: [{ id: "i2", title: "Seeking PM", description: "ML eng seeking product co-founder", confidence: 0.85 }],
  profile: { name: "Bob", bio: "ML engineer", skills: ["ML"] },
};

const seed: SeedAssessment = { score: 78, reasoning: "Complementary skills", valencyRole: "Peer" };

function createMockDeps(proposerAction = "propose" as const, responderAction = "accept" as const) {
  const database: NegotiationDatabase = {
    createConversation: mock(() => Promise.resolve({ id: "conv-1" })),
    createMessage: mock(() => Promise.resolve({ id: "msg-1", senderId: "agent", role: "agent", parts: [], createdAt: new Date() })),
    createTask: mock(() => Promise.resolve({ id: "task-1", conversationId: "conv-1", state: "submitted" })),
    updateTaskState: mock(() => Promise.resolve({ id: "task-1", conversationId: "conv-1", state: "working" })),
    createArtifact: mock(() => Promise.resolve({ id: "art-1" })),
  };
  const proposer: ConstructorParameters<typeof NegotiationGraphFactory>[1] = {
    invoke: mock(() => Promise.resolve({
      action: proposerAction,
      assessment: { fitScore: 80, reasoning: "Good match", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
    })),
  };
  const responder: ConstructorParameters<typeof NegotiationGraphFactory>[2] = {
    invoke: mock(() => Promise.resolve({
      action: responderAction,
      assessment: { fitScore: 75, reasoning: "Agreed, good fit", suggestedRoles: { ownUser: "peer" as const, otherUser: "peer" as const } },
    })),
  };
  return { database, proposer, responder };
}

describe("NegotiationGraph", () => {
  it("produces opportunity when responder accepts", async () => {
    const deps = createMockDeps("propose", "accept");
    const factory = new NegotiationGraphFactory(
      deps.database,
      deps.proposer,
      deps.responder,
    );
    const graph = factory.createGraph();
    const result = await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext: { indexId: "idx-1", prompt: "AI co-founders" },
      seedAssessment: seed,
    });

    expect(result.outcome).not.toBeNull();
    expect(result.outcome!.hasOpportunity).toBe(true);
    expect(result.outcome!.turnCount).toBe(2);
    expect(deps.database.createArtifact).toHaveBeenCalled();
  }, 30_000);

  it("rejects when responder rejects", async () => {
    const deps = createMockDeps("propose", "reject");
    const factory = new NegotiationGraphFactory(
      deps.database,
      deps.proposer,
      deps.responder,
    );
    const graph = factory.createGraph();
    const result = await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext: { indexId: "idx-1", prompt: "AI co-founders" },
      seedAssessment: seed,
    });

    expect(result.outcome).not.toBeNull();
    expect(result.outcome!.hasOpportunity).toBe(false);
  }, 30_000);

  it("rejects when turn cap is exceeded", async () => {
    const deps = createMockDeps("counter", "counter");
    const factory = new NegotiationGraphFactory(
      deps.database,
      deps.proposer,
      deps.responder,
    );
    const graph = factory.createGraph();
    const result = await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext: { indexId: "idx-1", prompt: "AI co-founders" },
      seedAssessment: seed,
      maxTurns: 4,
    });

    expect(result.outcome).not.toBeNull();
    expect(result.outcome!.hasOpportunity).toBe(false);
    expect(result.outcome!.reason).toBe("turn_cap");
    expect(result.turnCount).toBeLessThanOrEqual(4);
  }, 30_000);
});
