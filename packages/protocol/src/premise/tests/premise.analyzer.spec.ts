// Env must be set before any imports that transitively call createModel
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect, beforeAll } from "bun:test";
import { PremiseAnalyzer } from "../premise.analyzer.js";

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
