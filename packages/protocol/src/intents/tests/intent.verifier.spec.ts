import { afterAll, describe, expect, it, mock } from "bun:test";

mock.module("../../shared/agent/model.config", () => ({
  createStructuredModel: () => ({
    invoke: async (messages: Array<{ content?: unknown }>) => {
      const prompt = String(messages.at(-1)?.content ?? "");
      if (prompt.includes("rewrite the Linux kernel")) {
        return {
          reasoning: "This is a future commitment beyond the stated junior developer context.",
          classification: "COMMISSIVE",
          felicity_scores: { clarity: 85, authority: 20, sincerity: 75 },
          semantic_entropy: 0.3,
          referential_anchor: null,
          referential_breadth: "moderate",
          missing_selectional_constraints: [],
          specificity_warning: null,
          flags: ["SKILL_MISMATCH"],
        };
      }
      if (prompt.includes("should probably code something")) {
        return {
          reasoning: "The hedge and absent outcome leave the commitment underspecified.",
          classification: "COMMISSIVE",
          felicity_scores: { clarity: 25, authority: 80, sincerity: 30 },
          semantic_entropy: 0.9,
          referential_anchor: null,
          referential_breadth: "broad",
          missing_selectional_constraints: ["outcome", "domain", "concrete_need"],
          specificity_warning: "Name a concrete outcome and domain.",
          flags: ["WEAK_COMMITMENT", "VAGUE_INTENT", "BROAD_ATTRIBUTIVE_REFERENCE"],
        };
      }
      return {
        reasoning: "A bounded HTML task is a clear future commitment within the stated skills.",
        classification: "COMMISSIVE",
        felicity_scores: { clarity: 85, authority: 85, sincerity: 90 },
        semantic_entropy: 0.2,
        referential_anchor: null,
        referential_breadth: "narrow",
        missing_selectional_constraints: [],
        specificity_warning: null,
        flags: [],
      };
    },
  }),
}));

const { SemanticVerifier } = await import("../../intents/intent.verifier.js");

afterAll(() => mock.restore());

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
