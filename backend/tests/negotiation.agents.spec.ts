import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect } from "bun:test";
import { IndexNegotiator } from "@indexnetwork/protocol";
import type { UserNegotiationContext, SeedAssessment, NegotiationTurn } from "@indexnetwork/protocol";

const sourceUser: UserNegotiationContext = {
  id: "user-source",
  intents: [{ id: "i1", title: "Looking for ML engineer", description: "Need ML expertise for recommendation system", confidence: 0.9 }],
  profile: { name: "Alice", bio: "Product manager at a startup", skills: ["product management", "AI strategy"] },
};

const candidateUser: UserNegotiationContext = {
  id: "user-candidate",
  intents: [{ id: "i2", title: "Seeking PM collaboration", description: "ML engineer looking for product-minded co-founder", confidence: 0.85 }],
  profile: { name: "Bob", bio: "Senior ML engineer", skills: ["machine learning", "PyTorch", "recommendations"] },
};

const seedAssessment: SeedAssessment = {
  reasoning: "Strong complementary skills between product management and ML engineering",
  valencyRole: "Peer",
};

describe("IndexNegotiator (proposer)", () => {
  it("generates a valid proposal turn", async () => {
    const negotiator = new IndexNegotiator();
    const result = await negotiator.invoke({
      ownUser: sourceUser,
      otherUser: candidateUser,
      indexContext: { networkId: "idx-1", prompt: "AI startup co-founders" },
      seedAssessment,
      history: [],
    });

    expect(result.action).toBe("propose");
    expect(result.assessment.reasoning).toBeTruthy();
    expect(["agent", "patient", "peer"]).toContain(result.assessment.suggestedRoles.ownUser);
    expect(["agent", "patient", "peer"]).toContain(result.assessment.suggestedRoles.otherUser);
  }, 30_000);
});

describe("IndexNegotiator (responder)", () => {
  it("evaluates a proposal and responds with accept, reject, or counter", async () => {
    const negotiator = new IndexNegotiator();

    const proposal: NegotiationTurn = {
      action: "propose",
      assessment: {
        reasoning: "Strong complementary skills — Alice needs ML, Bob needs product leadership",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
      },
    };

    const result = await negotiator.invoke({
      ownUser: candidateUser,
      otherUser: sourceUser,
      indexContext: { networkId: "idx-1", prompt: "AI startup co-founders" },
      seedAssessment,
      history: [proposal],
    });

    expect(["propose", "accept", "reject", "counter"]).toContain(result.action);
    expect(result.assessment.reasoning).toBeTruthy();
  }, 30_000);
});
