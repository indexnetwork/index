/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, it, expect } from "bun:test";
import { NegotiationInsightsGenerator } from "../insight.generator.js";
import { assertLLM } from "../../shared/agent/tests/llm-assert.js";

describe('NegotiationInsightsGenerator', () => {
  const generator = new NegotiationInsightsGenerator();

  it('returns null for empty negotiation history', async () => {
    const result = await generator.invoke({
      totalCount: 0,
      opportunityCount: 0,
      noOpportunityCount: 0,
      inProgressCount: 0,
      roleDistribution: {},
      counterparties: [],
      reasoningExcerpts: [],
    });
    expect(result).toBeNull();
  }, 30000);

  it('returns a non-empty string for a user with negotiation history', async () => {
    const result = await generator.invoke({
      totalCount: 12,
      opportunityCount: 8,
      noOpportunityCount: 3,
      inProgressCount: 1,
      roleDistribution: { helper: 7, seeker: 4, peer: 1 },
      counterparties: ['Alice Chen', 'Bob Martinez', 'Sam Park'],
      reasoningExcerpts: ['Strong ML background aligns with what Alice needs', 'Bob seeks product expertise'],
    });

    expect(typeof result).toBe('string');
    expect(result!.length).toBeGreaterThan(50);
  }, 60000);

  it('generates insightful prose addressing the user', async () => {
    const result = await generator.invoke({
      totalCount: 5,
      opportunityCount: 3,
      noOpportunityCount: 2,
      inProgressCount: 0,
      roleDistribution: { helper: 5 },
      counterparties: ['Carol Lee', 'David Kim'],
      reasoningExcerpts: ['User helped with ML architecture advice'],
    });

    expect(typeof result).toBe('string');

    await assertLLM(
      result,
      'The text must be addressed to the user in second person ("you", "your"), written as flowing prose (no bullet points), 2-4 sentences, and mention the helper role or that others seek this person out.',
    );
  }, 120000);
});
