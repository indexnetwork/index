import { afterAll, describe, expect, it, mock } from "bun:test";

mock.module("../../shared/agent/model.config", () => ({
  createStructuredModel: () => ({
    invoke: async (messages: Array<{ content?: unknown }>) => {
      const systemPrompt = String(messages[0]?.content ?? "");
      return {
        action: systemPrompt.includes("FINAL turn") ? "accept" : "propose",
        assessment: {
          reasoning: "The ML-engineering experience directly satisfies the startup's stated hiring need.",
          suggestedRoles: { ownUser: "patient", otherUser: "agent" },
        },
        message: null,
      };
    },
  }),
}));

const { IndexNegotiator } = await import("../negotiation.agent.js");

afterAll(() => mock.restore());
import type { UserNegotiationContext, SeedAssessment } from "../negotiation.state.js";

const mlUser: UserNegotiationContext = {
  id: 'user-alice',
  intents: [
    { id: 'i1', title: 'Hire ML Engineer', description: 'Looking for a senior ML engineer with LLM production experience', confidence: 0.9 },
  ],
  profile: { name: 'Alice Chen', bio: 'CTO at AI startup', skills: ['product', 'fundraising'] },
};

const engineerUser: UserNegotiationContext = {
  id: 'user-bob',
  intents: [
    { id: 'i2', title: 'Find AI startup role', description: 'Seeking a founding engineer role at an AI company', confidence: 0.85 },
  ],
  profile: { name: 'Bob Martinez', bio: 'ML Engineer, 5 years LLM systems', skills: ['PyTorch', 'LangChain', 'CUDA'] },
};

const seedAssessment: SeedAssessment = {
  reasoning: 'Strong skill match — Bob has the LLM production experience Alice needs.',
  valencyRole: 'patient',
};

const indexContext = { networkId: 'net-1', prompt: 'AI founders and engineers looking to connect' };

describe('IndexNegotiator', () => {
  const negotiator = new IndexNegotiator();

  it('returns a valid turn with action and assessment on first turn', async () => {
    const result = await negotiator.invoke({
      ownUser: mlUser,
      otherUser: engineerUser,
      indexContext,
      seedAssessment,
      history: [],
    });

    expect(['propose', 'accept', 'reject', 'counter']).toContain(result.action);
    expect(typeof result.assessment.reasoning).toBe('string');
    expect(result.assessment.reasoning.length).toBeGreaterThan(0);
    expect(['agent', 'patient', 'peer']).toContain(result.assessment.suggestedRoles.ownUser);
    expect(['agent', 'patient', 'peer']).toContain(result.assessment.suggestedRoles.otherUser);
    // fitScore should NOT be present
    expect((result.assessment as Record<string, unknown>).fitScore).toBeUndefined();
  }, 60000);

  it('returns an initiator-valid action on an opening turn', async () => {
    const result = await negotiator.invoke({
      ownUser: mlUser,
      otherUser: engineerUser,
      indexContext,
      seedAssessment,
      history: [],
    });

    expect(['outreach', 'counter', 'question', 'withdraw']).toContain(result.action);
  }, 60000);

  it('constrains a final counterparty turn to accept or decline', async () => {
    const history = [
      { action: 'outreach' as const, assessment: { reasoning: 'Good match', suggestedRoles: { ownUser: 'peer' as const, otherUser: 'peer' as const } } },
      { action: 'counter' as const, assessment: { reasoning: 'Not convinced', suggestedRoles: { ownUser: 'peer' as const, otherUser: 'peer' as const } } },
    ];

    const result = await negotiator.invoke({
      ownUser: mlUser,
      otherUser: engineerUser,
      indexContext,
      seedAssessment,
      history,
      isFinalTurn: true,
    });

    expect(['accept', 'decline']).toContain(result.action);
  }, 60000);
});
