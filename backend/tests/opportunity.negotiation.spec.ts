import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect, mock } from "bun:test";
import type { NegotiationGraphLike } from "@indexnetwork/protocol";

describe("Opportunity Graph — Negotiation Integration", () => {
  it("negotiateNode filters candidates by negotiation outcome", async () => {
    const mockNegotiationGraph: NegotiationGraphLike = {
      invoke: mock((input) => {
        const isFirstCandidate = input.candidateUser.id === "candidate-1";
        return Promise.resolve({
          outcome: {
            hasOpportunity: isFirstCandidate,
            agreedRoles: isFirstCandidate
              ? [{ userId: "source", role: "peer" as const }, { userId: "candidate-1", role: "peer" as const }]
              : [],
            reasoning: isFirstCandidate ? "Good match" : "No fit",
            turnCount: 2,
          },
        });
      }),
    };

    const { negotiateCandidates } = await import("@indexnetwork/protocol");

    const candidates = [
      { userId: "candidate-1", reasoning: "OK", valencyRole: "Peer" },
      { userId: "candidate-2", reasoning: "Weak", valencyRole: "Agent" },
    ];

    const sourceUser = {
      id: "source",
      intents: [{ id: "i1", title: "Test", description: "Test intent", confidence: 0.9 }],
      profile: { name: "Alice" },
    };

    const results = await negotiateCandidates(
      mockNegotiationGraph,
      sourceUser,
      candidates.map((c) => ({
        ...c,
        candidateUser: {
          id: c.userId,
          intents: [{ id: "i2", title: "Test", description: "Counter intent", confidence: 0.8 }],
          profile: { name: c.userId },
        },
      })),
      { networkId: "idx-1", prompt: "Test" },
    );

    expect(results).toHaveLength(1);
    expect(results[0].userId).toBe("candidate-1");
    expect(results[0].turnCount).toBe(2);
  }, 30_000);
});
