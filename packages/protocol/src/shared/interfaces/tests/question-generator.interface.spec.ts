import { describe, it, expect } from "bun:test";
import type { QuestionGenerationResult, Question, QuestionStrategy } from "../../schemas/question.schema.js";
import type { DiscoveryQuestionInput } from "../../../opportunity/question.prompt.js";
import type { QuestionGeneratorReader } from "../question-generator.interface.js";

describe("QuestionGeneratorReader contract", () => {
  it("accepts a DiscoveryQuestionInput and returns a Promise of QuestionGenerationResult | null", async () => {
    const fake: QuestionGeneratorReader = {
      generate: async (_input: DiscoveryQuestionInput): Promise<QuestionGenerationResult | null> => null,
    };
    const result = await fake.generate({
      query: "x",
      userContext: "",
      negotiationDigests: [],
      summary: {
        totalCandidates: 0,
        opportunitiesFound: 0,
        noOpportunityCount: 0,
        timeoutCount: 0,
        roleDistribution: {},
      },
      now: new Date().toISOString(),
    });
    expect(result).toBeNull();
  });

  it("permits implementations that return a non-null QuestionGenerationResult", async () => {
    const q: Question = { title: "T", prompt: "P?", options: [{ label: "a", description: "x" }, { label: "b", description: "y" }], multiSelect: false };
    const s: QuestionStrategy[] = ["refine_intent"];
    const ok: QuestionGeneratorReader = { generate: async () => ({ questions: [q], strategies: s }) };
    const r = await ok.generate({ query: "x", userContext: "", negotiationDigests: [], summary: { totalCandidates: 0, opportunitiesFound: 0, noOpportunityCount: 0, timeoutCount: 0, roleDistribution: {} }, now: "" });
    expect(r?.questions).toHaveLength(1);
  });
});
