import { config } from "dotenv";
config({ path: ".env.test" });
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? "test-key-for-unit-tests";

import { describe, it, expect } from "bun:test";
import { QuestionGenerator } from "../question.generator.js";
import type { DiscoveryQuestionInput } from "../question.prompt.js";

function makeInput(): DiscoveryQuestionInput {
  return {
    query: "test query",
    sourceProfile: { name: "Tester" },
    negotiationDigests: [],
    summary: {
      totalCandidates: 0,
      opportunitiesFound: 0,
      noOpportunityCount: 0,
      timeoutCount: 0,
      roleDistribution: {},
    },
    now: "2026-05-15T12:00:00.000Z",
  };
}

function makeGenerator(
  invokeImpl: (input: unknown, config?: { signal?: AbortSignal }) => Promise<unknown>,
) {
  const gen = new QuestionGenerator();
  (gen as unknown as { model: { invoke: typeof invokeImpl } }).model = { invoke: invokeImpl };
  return gen;
}

const okOption = { label: "A", description: "desc-a" };

function makeQuestion(overrides: Record<string, unknown> = {}) {
  return {
    title: "T",
    prompt: "Does it?",
    options: [okOption, { label: "B", description: "desc-b" }],
    multiSelect: false,
    strategy: "refine_intent",
    ...overrides,
  };
}

describe("QuestionGenerator", () => {
  it("returns null when the LLM throws", async () => {
    const gen = makeGenerator(async () => {
      throw new Error("model down");
    });
    const result = await gen.generate(makeInput());
    expect(result).toBeNull();
  });

  it("returns null when LLM output fails Zod parse", async () => {
    const gen = makeGenerator(async () => ({ questions: "not-an-array" }));
    const result = await gen.generate(makeInput());
    expect(result).toBeNull();
  });

  it("returns null when LLM emits an empty questions array", async () => {
    const gen = makeGenerator(async () => ({ questions: [] }));
    const result = await gen.generate(makeInput());
    expect(result).toBeNull();
  });

  it("returns the parsed questions on a clean LLM output", async () => {
    const gen = makeGenerator(async () => ({
      questions: [makeQuestion({ title: "Stage" })],
    }));
    const result = await gen.generate(makeInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(1);
    expect(result!.questions[0].title).toBe("Stage");
    expect(result!.strategies).toEqual(["refine_intent"]);
  });

  it("strips the strategy field from the public questions array", async () => {
    const gen = makeGenerator(async () => ({
      questions: [makeQuestion({ title: "Stage" })],
    }));
    const result = await gen.generate(makeInput());
    expect(result).not.toBeNull();
    // strategy must NOT leak onto the public Question shape
    expect("strategy" in (result!.questions[0] as Record<string, unknown>)).toBe(false);
  });

  it("dedupes questions by title, keeping the first occurrence", async () => {
    const gen = makeGenerator(async () => ({
      questions: [
        makeQuestion({ title: "Stage", prompt: "first?" }),
        makeQuestion({ title: "Stage", prompt: "second?" }),
        makeQuestion({ title: "Timing", strategy: "surface_missing_detail" }),
      ],
    }));
    const result = await gen.generate(makeInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(2);
    expect(result!.questions[0].prompt).toBe("first?");
    expect(result!.questions.map((q) => q.title)).toEqual(["Stage", "Timing"]);
  });

  it("returns parallel strategies array in the same order as questions", async () => {
    const gen = makeGenerator(async () => ({
      questions: [
        makeQuestion({ title: "Q1", strategy: "refine_intent" }),
        makeQuestion({ title: "Q2", strategy: "surface_missing_detail" }),
        makeQuestion({ title: "Q3", strategy: "open_adjacent_thread" }),
      ],
    }));
    const result = await gen.generate(makeInput());
    expect(result!.strategies).toEqual([
      "refine_intent",
      "surface_missing_detail",
      "open_adjacent_thread",
    ]);
  });

  it("returns null when a 4-question LLM payload fails Zod parse (max 3)", async () => {
    // The schema's `.max(3)` rejects this; the parse error path returns null.
    const gen = makeGenerator(async () => ({
      questions: [
        makeQuestion({ title: "A1", strategy: "refine_intent" }),
        makeQuestion({ title: "A2", strategy: "refine_intent" }),
        makeQuestion({ title: "A3", strategy: "refine_intent" }),
        makeQuestion({ title: "B", strategy: "surface_missing_detail" }),
      ],
    }));
    const result = await gen.generate(makeInput());
    expect(result).toBeNull();
  });

  it("keeps all 3 when a Zod-valid batch has 2 same-strategy + 1 distinct (diversity satisfied)", async () => {
    // refine_intent count = 2 (at cap), surface_missing_detail = 1 — all kept.
    const gen = makeGenerator(async () => ({
      questions: [
        makeQuestion({ title: "A1", strategy: "refine_intent" }),
        makeQuestion({ title: "A2", strategy: "refine_intent" }),
        makeQuestion({ title: "B", strategy: "surface_missing_detail" }),
      ],
    }));
    const result = await gen.generate(makeInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(3);
    expect(result!.strategies).toEqual([
      "refine_intent",
      "refine_intent",
      "surface_missing_detail",
    ]);
  });

  it("forwards the AbortSignal in the RunnableConfig second arg", async () => {
    let captured: { signal?: AbortSignal } | undefined;
    const gen = makeGenerator(async (_input, config) => {
      captured = config;
      return { questions: [makeQuestion({ title: "Stage" })] };
    });
    const controller = new AbortController();
    const result = await gen.generate(makeInput(), { signal: controller.signal });
    expect(result).not.toBeNull();
    expect(captured?.signal).toBe(controller.signal);
  });

  it("omits config entirely when no signal is passed (preserves prior behavior)", async () => {
    let captured: { signal?: AbortSignal } | undefined = { signal: new AbortController().signal };
    const gen = makeGenerator(async (_input, config) => {
      captured = config;
      return { questions: [makeQuestion({ title: "Stage" })] };
    });
    await gen.generate(makeInput());
    expect(captured).toBeUndefined();
  });

  it("returns null when the in-flight model call rejects after the signal aborts", async () => {
    // Simulates LangChain's AbortError path: the LLM call rejects with the
    // signal already in aborted state. Generator must swallow and return null.
    const controller = new AbortController();
    const gen = makeGenerator(async (_input, config) => {
      controller.abort(new Error("deadline"));
      const err = new Error("aborted");
      err.name = "AbortError";
      // Reading config.signal here mirrors how withStructuredOutput inspects
      // the signal; the test would also pass without this read.
      void config?.signal?.aborted;
      throw err;
    });
    const result = await gen.generate(makeInput(), { signal: controller.signal });
    expect(result).toBeNull();
  });

  it("drops the 3rd same-strategy question (never 3 of the same)", async () => {
    // Three refine_intent in a Zod-valid 3-question batch. The diversity rule
    // caps same-strategy at MAX_SAME_STRATEGY=2, so the 3rd is dropped
    // regardless of whether a distinct alternative exists.
    const gen = makeGenerator(async () => ({
      questions: [
        makeQuestion({ title: "A1", strategy: "refine_intent" }),
        makeQuestion({ title: "A2", strategy: "refine_intent" }),
        makeQuestion({ title: "A3", strategy: "refine_intent" }),
      ],
    }));
    const result = await gen.generate(makeInput());
    expect(result).not.toBeNull();
    expect(result!.questions).toHaveLength(2);
    expect(result!.strategies).toEqual(["refine_intent", "refine_intent"]);
  });
});
