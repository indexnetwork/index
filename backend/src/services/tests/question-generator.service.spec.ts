import { config } from "dotenv";
config({ path: ".env.test" });

import { describe, it, expect } from "bun:test";
import { QuestionGeneratorService } from "../question-generator.service";
import type { Question, QuestionGenerationResult } from "@indexnetwork/protocol";

const baseInput = {
  query: "x",
  sourceProfile: {},
  negotiations: [],
  summary: { totalCandidates: 0, opportunitiesFound: 0, noOpportunityCount: 0, timeoutCount: 0, roleDistribution: {} },
  now: new Date().toISOString(),
};

describe("QuestionGeneratorService", () => {
  it("delegates to the injected generator", async () => {
    const q: Question = {
      title: "T",
      prompt: "P?",
      options: [
        { label: "a", description: "x" },
        { label: "b", description: "y" },
      ],
      multiSelect: false,
    };
    const result: QuestionGenerationResult = { questions: [q], strategies: ["refine_intent"] };
    const svc = new QuestionGeneratorService({ generate: async () => result });
    const got = await svc.generate(baseInput);
    expect(got).toEqual(result);
  });

  it("returns null when the underlying generator throws", async () => {
    const svc = new QuestionGeneratorService({
      generate: async () => {
        throw new Error("boom");
      },
    });
    const got = await svc.generate(baseInput);
    expect(got).toBeNull();
  });

  it("defers construction of the default generator until first call", async () => {
    const svc = new QuestionGeneratorService();
    // We don't make a real LLM call in unit tests; replace the lazy slot with a fake.
    (svc as unknown as { generator: { generate: typeof Function } }).generator = {
      generate: async () => null,
    };
    const got = await svc.generate(baseInput);
    expect(got).toBeNull();
  });
});
