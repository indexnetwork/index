import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect, mock } from "bun:test";

import { NegotiationGraphFactory } from "@indexnetwork/protocol";
import type { NegotiationGraphDatabase, AgentDispatcher, UserNegotiationContext, SeedAssessment } from "@indexnetwork/protocol";

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

const seed: SeedAssessment = { reasoning: "Complementary skills", valencyRole: "peer" };

function createDeps() {
  const updateOpportunityStatus = mock(() => Promise.resolve({ id: "opp-1", status: "negotiating" as const }));
  const database = {
    createConversation: mock(() => Promise.resolve({ id: "conv-1" })),
    createMessage: mock((data: { parts: unknown[] }) => Promise.resolve({
      id: `msg-${Math.random().toString(36).slice(2, 8)}`,
      senderId: "agent",
      role: "agent" as const,
      parts: data.parts,
      createdAt: new Date(),
    })),
    createTask: mock(() => Promise.resolve({ id: "task-1", conversationId: "conv-1", state: "submitted" })),
    updateTaskState: mock(() => Promise.resolve({ id: "task-1", conversationId: "conv-1", state: "working" })),
    createArtifact: mock(() => Promise.resolve({ id: "art-1" })),
    setTaskTurnContext: mock(() => Promise.resolve()),
    getTasksForUser: mock(() => Promise.resolve([])),
    getTask: mock(() => Promise.resolve(null)),
    getMessagesForConversation: mock(() => Promise.resolve([])),
    getArtifactsForTask: mock(() => Promise.resolve([])),
    updateOpportunityStatus,
  } satisfies Partial<NegotiationGraphDatabase> as unknown as NegotiationGraphDatabase;
  const dispatcher = {
    dispatch: mock(async () => ({ handled: false as const, reason: "no_agent" as const })),
    hasPersonalAgent: mock(async () => false),
  } satisfies Partial<AgentDispatcher> as unknown as AgentDispatcher;
  return { database, dispatcher, updateOpportunityStatus };
}

describe("NegotiationGraph → opportunity status lifecycle (init)", () => {
  it("sets opportunity to 'negotiating' on init when opportunityId is present", async () => {
    const deps = createDeps();

    const factory = new NegotiationGraphFactory(deps.database, deps.dispatcher);
    const graph = factory.createGraph();
    await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext: { networkId: "idx-1", prompt: "AI co-founders" },
      seedAssessment: seed,
      opportunityId: "opp-1",
      maxTurns: 1,
    });

    const negotiatingCall = deps.updateOpportunityStatus.mock.calls.find((c: unknown[]) => c[1] === "negotiating");
    expect(negotiatingCall).toBeDefined();
    expect((negotiatingCall as unknown[])[0]).toBe("opp-1");
  }, 30_000);

  it("does NOT call updateOpportunityStatus on init when opportunityId is not set", async () => {
    const deps = createDeps();

    const factory = new NegotiationGraphFactory(deps.database, deps.dispatcher);
    const graph = factory.createGraph();
    await graph.invoke({
      sourceUser,
      candidateUser,
      indexContext: { networkId: "idx-1", prompt: "AI co-founders" },
      seedAssessment: seed,
      maxTurns: 1,
    });

    // If any call is made, none should reference opp-1 or any id (since no opportunityId in state).
    // The init branch is guarded by `if (state.opportunityId)`.
    const initCall = deps.updateOpportunityStatus.mock.calls.find((c: unknown[]) => c[1] === "negotiating");
    expect(initCall).toBeUndefined();
  }, 30_000);
});
