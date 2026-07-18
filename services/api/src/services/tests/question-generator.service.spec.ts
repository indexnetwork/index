import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, it, expect } from "bun:test";
import { QuestionGeneratorService } from "../question-generator.service";
import type { Question, QuestionGenerationResult, QuestionerInput } from "@indexnetwork/protocol";

const baseInput = {
  query: "x",
  userContext: "",
  negotiationDigests: [],
  summary: { totalCandidates: 0, opportunitiesFound: 0, noOpportunityCount: 0, timeoutCount: 0, roleDistribution: {} },
  now: new Date().toISOString(),
};

describe("QuestionGeneratorService", () => {
  it("delegates to the injected agent in discovery mode with the input as context", async () => {
    const q: Question = {
      title: "T",
      prompt: "P?",
      options: [
        { label: "a", description: "x" },
        { label: "b", description: "y" },
      ],
      multiSelect: false,
    };
    const result: QuestionGenerationResult = { questions: [q], strategies: ["refine_intent"], underspecificationTypes: [null] };
    let seen: QuestionerInput | undefined;
    const svc = new QuestionGeneratorService({
      invoke: async (input: QuestionerInput) => {
        seen = input;
        return result;
      },
    });
    const got = await svc.generate(baseInput);
    expect(got).toEqual(result);
    expect(seen?.mode).toBe("discovery");
    expect(seen?.context).toEqual(baseInput);
  });

  it("returns null when the underlying agent throws", async () => {
    const svc = new QuestionGeneratorService({
      invoke: async () => {
        throw new Error("boom");
      },
    });
    const got = await svc.generate(baseInput);
    expect(got).toBeNull();
  });

  it("defers construction of the default agent until first call", async () => {
    const svc = new QuestionGeneratorService();
    // We don't make a real LLM call in unit tests; replace the lazy slot with a fake.
    (svc as unknown as { agent: { invoke: () => Promise<null> } }).agent = {
      invoke: async () => null,
    };
    const got = await svc.generate(baseInput);
    expect(got).toBeNull();
  });

  it("forwards the abort signal to the agent", async () => {
    const controller = new AbortController();
    let seenSignal: AbortSignal | undefined;
    const svc = new QuestionGeneratorService({
      invoke: async (_input: QuestionerInput, options?: { signal?: AbortSignal }) => {
        seenSignal = options?.signal;
        return null;
      },
    });
    await svc.generate(baseInput, { signal: controller.signal });
    expect(seenSignal).toBe(controller.signal);
  });
});
