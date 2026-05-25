/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect } from "bun:test";
import { generateInviteMessage } from "../contact.inviter.js";
import { assertLLM } from "../../shared/agent/tests/llm-assert.js";

describe('generateInviteMessage', () => {
  it('generates a human, specific invite message', async () => {
    const result = await generateInviteMessage({
      recipientName: 'Alice Chen',
      senderName: 'Bob Martinez',
      opportunityInterpretation: 'Both are building LLM-powered developer tools and have complementary skills — Alice has strong ML infra background, Bob has product distribution experience.',
      senderIntents: ['Looking for a co-founder with ML engineering background'],
      recipientIntents: ['Seeking a product-focused co-founder for my AI devtools startup'],
    });

    expect(typeof result.message).toBe('string');
    expect(result.message.length).toBeGreaterThan(20);

    await assertLLM(
      result,
      'The message should sound like a real person texting, not a formal email. It should reference one specific concrete detail (LLM tools, ML infra, or product distribution), be 2-3 sentences max, and NOT contain formal phrases like "Would you be open to" or "I noticed we have similar interests".',
    );
  }, 60000);

  it('mentions referrer name when provided', async () => {
    const result = await generateInviteMessage({
      recipientName: 'Alice Chen',
      senderName: 'Bob Martinez',
      opportunityInterpretation: 'Both are in the climate tech space — Alice on carbon capture hardware, Bob on climate fintech.',
      senderIntents: ['Connect with climate tech engineers'],
      recipientIntents: ['Find climate fintech collaborators'],
      referrerName: 'Sam Park',
    });

    expect(result.message.toLowerCase()).toContain('sam');
  }, 60000);
});
