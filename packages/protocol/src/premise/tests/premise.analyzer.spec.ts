import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";

mock.module("../../shared/agent/model.config", () => ({
  createStructuredModel: () => ({
    invoke: async (messages: Array<{ content?: unknown }>) => {
      const prompt = String(messages.at(-1)?.content ?? "");
      if (prompt.includes("10 years of experience")) {
        return {
          reasoning: "Specific experience is an assertive capability claim.",
          speechActType: "ASSERTIVE",
          felicityAuthority: 85,
          felicitySincerity: 90,
          felicityClarity: 85,
          semanticEntropy: 0.15,
        };
      }
      if (prompt.includes("I work in tech")) {
        return {
          reasoning: "The self-description is broad and underspecified.",
          speechActType: "DECLARATIVE",
          felicityAuthority: 60,
          felicitySincerity: 80,
          felicityClarity: 40,
          semanticEntropy: 0.9,
        };
      }
      if (prompt.includes("senior ML engineer")) {
        return {
          reasoning: "The role, organisation, location, and specialty are specific.",
          speechActType: "DECLARATIVE",
          felicityAuthority: 90,
          felicitySincerity: 90,
          felicityClarity: 90,
          semanticEntropy: 0.05,
        };
      }
      return {
        reasoning: "The role and location identify the speaker's current status.",
        speechActType: "DECLARATIVE",
        felicityAuthority: 80,
        felicitySincerity: 90,
        felicityClarity: 80,
        semanticEntropy: 0.15,
      };
    },
  }),
}));

const { PremiseAnalyzer } = await import("../premise.analyzer.js");

afterAll(() => mock.restore());

describe("PremiseAnalyzer", () => {
  let analyzer: PremiseAnalyzer;

  beforeAll(() => {
    analyzer = new PremiseAnalyzer();
  });

  it("classifies an identity statement as DECLARATIVE", async () => {
    const result = await analyzer.invoke("I am a climate-tech founder based in Berlin");

    expect(result.speechActType).toBe("DECLARATIVE");
    expect(result.felicityClarity).toBeGreaterThan(50);
    expect(result.semanticEntropy).toBeLessThan(0.7);
  }, 30_000);

  it("classifies a capability statement as ASSERTIVE", async () => {
    const result = await analyzer.invoke("I have 10 years of experience building distributed database systems in Rust");

    expect(result.speechActType).toBe("ASSERTIVE");
    expect(result.felicityAuthority).toBeGreaterThan(50);
    expect(result.felicityClarity).toBeGreaterThan(60);
  }, 30_000);

  it("scores a vague premise with high entropy", async () => {
    const result = await analyzer.invoke("I work in tech");

    expect(result.semanticEntropy).toBeGreaterThan(0.6);
    expect(result.felicityClarity).toBeLessThan(50);
  }, 30_000);

  it("scores a specific premise with low entropy", async () => {
    const result = await analyzer.invoke(
      "I am a senior ML engineer at Google Brain in Mountain View, specializing in transformer architectures"
    );

    expect(result.semanticEntropy).toBeLessThan(0.3);
    expect(result.felicityClarity).toBeGreaterThan(70);
  }, 30_000);
});
