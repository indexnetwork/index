/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { IndexNegotiator } from "../negotiation.agent.js";
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

  it('returns propose action on opening turn for a good match', async () => {
    const result = await negotiator.invoke({
      ownUser: mlUser,
      otherUser: engineerUser,
      indexContext,
      seedAssessment,
      history: [],
    });

    expect(result.action).toBe('propose');
  }, 60000);

  it('constrains to accept/reject on final turn', async () => {
    const history = [
      { action: 'propose' as const, assessment: { reasoning: 'Good match', suggestedRoles: { ownUser: 'peer' as const, otherUser: 'peer' as const } } },
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

    expect(['accept', 'reject']).toContain(result.action);
  }, 60000);
});
