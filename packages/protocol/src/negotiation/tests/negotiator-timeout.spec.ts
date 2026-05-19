/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, it, expect } from "bun:test";
import { IndexNegotiator } from "../negotiation.agent.js";
import type { UserNegotiationContext, SeedAssessment } from "../negotiation.state.js";

const sourceUser: UserNegotiationContext = {
  id: 'user-alice',
  intents: [{ id: 'i1', title: 'Hire ML eng', description: 'Senior LLM engineer for AI startup', confidence: 0.9 }],
  profile: { name: 'Alice Chen', bio: 'CTO at AI startup', skills: ['product'] },
};

const otherUser: UserNegotiationContext = {
  id: 'user-bob',
  intents: [{ id: 'i2', title: 'Find AI role', description: 'Founding engineer at AI company', confidence: 0.85 }],
  profile: { name: 'Bob Martinez', bio: 'ML engineer, 5y LLM systems', skills: ['PyTorch', 'LangChain'] },
};

const seedAssessment: SeedAssessment = {
  reasoning: 'Strong skill match',
  valencyRole: 'patient',
};

const indexContext = { networkId: 'net-1', prompt: 'AI founders & engineers' };

describe('IndexNegotiator turn timeout', () => {
  it('throws when the per-turn timeout fires before the LLM responds', async () => {
    const negotiator = new IndexNegotiator({ turnTimeoutMs: 1 });
    await expect(
      negotiator.invoke({
        ownUser: sourceUser,
        otherUser,
        indexContext,
        seedAssessment,
        history: [],
      })
    ).rejects.toBeDefined();
  }, 30_000);

  it('completes normally with a generous timeout', async () => {
    const negotiator = new IndexNegotiator({ turnTimeoutMs: 60_000 });
    const result = await negotiator.invoke({
      ownUser: sourceUser,
      otherUser,
      indexContext,
      seedAssessment,
      history: [],
    });
    expect(result.action).toBeDefined();
    expect(['propose', 'counter', 'accept', 'reject']).toContain(result.action);
  }, 60_000);
});
