import { describe, it, expect } from "bun:test";

import { QuestionOptionSchema, QuestionSchema, QuestionStrategySchema, QuestionWithStrategySchema, QuestionGeneratorResponseSchema, QuestionModeSchema, QuestionDetectionSchema, QuestionActorSchema, QuestionAnswerSchema } from "../question.schema.js";

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

describe("QuestionDetection", () => {
  it("accepts a valid detection object", () => {
    const result = QuestionDetectionSchema.safeParse({
      mode: "discovery",
      sourceType: "opportunity",
      sourceId: "abc-123",
      timestamp: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("accepts optional triggeredBy", () => {
    const result = QuestionDetectionSchema.safeParse({
      mode: "intent",
      sourceType: "intent",
      sourceId: "abc-123",
      triggeredBy: "intent-456",
      timestamp: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
    expect(result.data!.triggeredBy).toBe("intent-456");
  });

  it("rejects an invalid mode", () => {
    const result = QuestionDetectionSchema.safeParse({
      mode: "invalid",
      sourceType: "opportunity",
      sourceId: "abc-123",
      timestamp: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("QuestionActor", () => {
  it("accepts a minimal actor (userId + role only)", () => {
    const result = QuestionActorSchema.safeParse({
      userId: "user-1",
      role: "subject",
    });
    expect(result.success).toBe(true);
    expect(result.data!.networkId).toBeUndefined();
  });

  it("accepts an actor with networkId", () => {
    const result = QuestionActorSchema.safeParse({
      userId: "user-1",
      networkId: "net-1",
      role: "subject",
    });
    expect(result.success).toBe(true);
    expect(result.data!.networkId).toBe("net-1");
  });
});

describe("QuestionAnswer", () => {
  it("accepts a valid answer with selected options", () => {
    const result = QuestionAnswerSchema.safeParse({
      selectedOptions: ["Berlin"],
      answeredBy: "user-1",
      answeredAt: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
    expect(result.data!.freeText).toBeUndefined();
  });

  it("accepts an answer with freeText", () => {
    const result = QuestionAnswerSchema.safeParse({
      selectedOptions: [],
      freeText: "Custom answer",
      answeredBy: "user-1",
      answeredAt: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
    expect(result.data!.freeText).toBe("Custom answer");
  });

  it("requires answeredBy", () => {
    const result = QuestionAnswerSchema.safeParse({
      selectedOptions: ["Berlin"],
      answeredAt: "2026-05-24T12:00:00.000Z",
    });
    expect(result.success).toBe(false);
  });
});

describe("QuestionMode", () => {
  it.each(["discovery", "intent", "profile", "negotiation"])("accepts '%s'", (mode) => {
    const result = QuestionModeSchema.safeParse(mode);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown mode", () => {
    const result = QuestionModeSchema.safeParse("unknown");
    expect(result.success).toBe(false);
  });
});
