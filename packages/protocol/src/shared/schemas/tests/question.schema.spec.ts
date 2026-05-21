import { describe, it, expect } from "bun:test";

import {
  QuestionOptionSchema,
  QuestionSchema,
  QuestionStrategySchema,
  QuestionWithStrategySchema,
  QuestionGeneratorResponseSchema,
} from "../question.schema.js";

const okOption = { label: "Stay focused", description: "Higher risk but cleaner narrative" };

const okQuestion = {
  title: "Stage",
  prompt: "Are you pre- or post-revenue?",
  options: [okOption, { label: "Pivot", description: "Wider candidate pool" }],
  multiSelect: false,
};

describe("QuestionOptionSchema", () => {
  it("accepts well-formed options", () => {
    expect(() => QuestionOptionSchema.parse(okOption)).not.toThrow();
  });
  it("rejects option label longer than 120 chars", () => {
    const long = { label: "x".repeat(121), description: "ok" };
    expect(() => QuestionOptionSchema.parse(long)).toThrow();
  });
  it("rejects option description longer than 280 chars", () => {
    const long = { label: "ok", description: "x".repeat(281) };
    expect(() => QuestionOptionSchema.parse(long)).toThrow();
  });
  it("rejects empty label", () => {
    expect(() => QuestionOptionSchema.parse({ label: "", description: "ok" })).toThrow();
  });
});

describe("QuestionSchema", () => {
  it("accepts a single-select question with 2 options", () => {
    expect(() => QuestionSchema.parse(okQuestion)).not.toThrow();
  });

  it("accepts a multi-select question with 4 options", () => {
    const four = {
      ...okQuestion,
      multiSelect: true,
      options: [
        { label: "a", description: "d1" },
        { label: "b", description: "d2" },
        { label: "c", description: "d3" },
        { label: "d", description: "d4" },
      ],
    };
    expect(() => QuestionSchema.parse(four)).not.toThrow();
  });

  it("rejects title longer than 12 chars", () => {
    expect(() => QuestionSchema.parse({ ...okQuestion, title: "x".repeat(13) })).toThrow();
  });

  it("rejects fewer than 2 options", () => {
    expect(() => QuestionSchema.parse({ ...okQuestion, options: [okOption] })).toThrow();
  });

  it("rejects more than 4 options", () => {
    const five = Array.from({ length: 5 }, (_, i) => ({ label: `o${i}`, description: `d${i}` }));
    expect(() => QuestionSchema.parse({ ...okQuestion, options: five })).toThrow();
  });

  it("rejects prompt longer than 400 chars", () => {
    expect(() => QuestionSchema.parse({ ...okQuestion, prompt: "x".repeat(401) })).toThrow();
  });

  it("rejects empty prompt", () => {
    expect(() => QuestionSchema.parse({ ...okQuestion, prompt: "" })).toThrow();
  });

  it("rejects missing multiSelect", () => {
    const { multiSelect: _, ...rest } = okQuestion;
    expect(() => QuestionSchema.parse(rest)).toThrow();
  });
});

describe("QuestionStrategySchema", () => {
  const strategies = [
    "refine_intent",
    "surface_missing_detail",
    "open_adjacent_thread",
    "reflective_summary",
    "surface_emergent_knowledge",
  ];

  for (const s of strategies) {
    it(`accepts strategy "${s}"`, () => {
      expect(() => QuestionStrategySchema.parse(s)).not.toThrow();
    });
  }

  it("rejects an unknown strategy", () => {
    expect(() => QuestionStrategySchema.parse("guess_lottery_numbers")).toThrow();
  });
});

describe("QuestionWithStrategySchema", () => {
  it("accepts a question with a valid strategy", () => {
    expect(() => QuestionWithStrategySchema.parse({ ...okQuestion, strategy: "refine_intent" })).not.toThrow();
  });
  it("rejects a question with an invalid strategy", () => {
    expect(() => QuestionWithStrategySchema.parse({ ...okQuestion, strategy: "bogus" })).toThrow();
  });
});

describe("QuestionGeneratorResponseSchema", () => {
  it("accepts an empty questions array", () => {
    expect(() => QuestionGeneratorResponseSchema.parse({ questions: [] })).not.toThrow();
  });
  it("accepts up to 3 questions", () => {
    const three = Array.from({ length: 3 }, (_, i) => ({
      ...okQuestion,
      title: `T${i}`,
      strategy: "refine_intent" as const,
    }));
    expect(() => QuestionGeneratorResponseSchema.parse({ questions: three })).not.toThrow();
  });
  it("rejects more than 3 questions", () => {
    const four = Array.from({ length: 4 }, (_, i) => ({
      ...okQuestion,
      title: `T${i}`,
      strategy: "refine_intent" as const,
    }));
    expect(() => QuestionGeneratorResponseSchema.parse({ questions: four })).toThrow();
  });
});
