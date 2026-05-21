import { config } from "dotenv";
config({ path: ".env.test" });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key";

import { describe, it, expect } from "bun:test";
import { negotiateCandidates, type NegotiationCandidate } from "../negotiation.graph.js";
import type { NegotiationGraphLike } from "../negotiation.state.js";

const sourceUser = {
  id: "source-1",
  intents: [],
  profile: { name: "Source", bio: "founder", interests: [] },
};

const candidate: NegotiationCandidate = {
  userId: "cand-1",
  reasoning: "complementary expertise",
  valencyRole: "Peer",
  networkId: "net-1",
  candidateUser: {
    id: "cand-1",
    intents: [],
    profile: { name: "Cand", bio: "designer", interests: [] },
  },
};

const fakeGraph: NegotiationGraphLike = {
  invoke: async () => ({
    outcome: {
      hasOpportunity: true,
      agreedRoles: [
        { userId: "source-1", role: "peer" },
        { userId: "cand-1", role: "peer" },
      ],
      reasoning: "shipped",
      turnCount: 2,
    },
    messages: [
      {
        id: "m1",
        senderId: "agent:source-1",
        role: "agent",
        parts: [{ kind: "data", data: { action: "propose", assessment: { reasoning: "lets pair", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } }],
        createdAt: new Date(),
      },
      {
        id: "m2",
        senderId: "agent:cand-1",
        role: "agent",
        parts: [{ kind: "data", data: { action: "accept", assessment: { reasoning: "agreed", suggestedRoles: { ownUser: "peer", otherUser: "peer" } } } }],
        createdAt: new Date(),
      },
    ],
  }),
};

describe("negotiateCandidates onCandidateResolved payload", () => {
  it("passes turns and outcome to the hook for accepted candidates", async () => {
    const seen: Array<{ accepted: boolean; turns: number; hasOpportunity: boolean }> = [];
    await negotiateCandidates(
      fakeGraph,
      sourceUser,
      [candidate],
      { networkId: "", prompt: "" },
      {
        onCandidateResolved: async ({ accepted, turns, outcome }) => {
          seen.push({
            accepted: accepted !== null,
            turns: turns.length,
            hasOpportunity: outcome.hasOpportunity,
          });
        },
      },
    );
    expect(seen).toEqual([{ accepted: true, turns: 2, hasOpportunity: true }]);
  });
});
