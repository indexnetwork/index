/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, expect, it } from "bun:test";
import { SemanticVerifier } from "../intent.verifier.js";

describe('SemanticVerifier', () => {
  const verifier = new SemanticVerifier();
  const context = "User is a Junior Developer. Skills: JavaScript, HTML.";

  it('should verify a high-quality commissive intent', async () => {
    // High clarity, High Sincerity, High Authority (within skills)
    const content = "I will write a simple HTML landing page.";
    const result = await verifier.invoke(content, context);

    expect(result.classification).toBe("COMMISSIVE");
    expect(result.felicity_scores.clarity).toBeGreaterThan(70);
    expect(result.felicity_scores.authority).toBeGreaterThan(70);
  }, 30000);

  it('should flag authority issues', async () => {
    // Low Authority (Junior Dev trying to do something impossible/advanced)
    const content = "I will rewrite the Linux kernel in assembly this weekend.";
    const result = await verifier.invoke(content, context);

    // Should still be COMMISSIVE (Speech Act) but low scores/flagged
    expect(result.classification).toBe("COMMISSIVE");
    expect(result.felicity_scores.authority).toBeLessThan(50);
    expect(result.flags.length).toBeGreaterThan(0);
  }, 30000);

  it('should identify vague intents', async () => {
    const content = "I should probably code something.";
    const result = await verifier.invoke(content, context);

    expect(result.felicity_scores.clarity).toBeLessThan(50);
  }, 30000);
});
