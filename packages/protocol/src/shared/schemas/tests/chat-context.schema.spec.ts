import { describe, it, expect } from "bun:test";

import { ChatContextDigestSchema } from "../chat-context.schema.js";

describe("ChatContextDigestSchema", () => {
  it("accepts an empty digest with all four arrays empty", () => {
    const parsed = ChatContextDigestSchema.parse({
      statedFacts: [],
      openQuestions: [],
      rejectionReasons: [],
      surfacedFindings: [],
    });
    expect(parsed.statedFacts).toEqual([]);
    expect(parsed.openQuestions).toEqual([]);
    expect(parsed.rejectionReasons).toEqual([]);
    expect(parsed.surfacedFindings).toEqual([]);
  });

  it("accepts a fully-populated digest", () => {
    const parsed = ChatContextDigestSchema.parse({
      statedFacts: ["Pre-revenue", "Based in Berlin"],
      openQuestions: ["What stage?"],
      rejectionReasons: ["All US-based candidates"],
      surfacedFindings: ["District X venues book out 6 weeks ahead"],
    });
    expect(parsed.statedFacts).toHaveLength(2);
  });

  it("rejects statedFacts longer than 20 entries", () => {
    const oversized = Array.from({ length: 21 }, (_, i) => `fact-${i}`);
    expect(() =>
      ChatContextDigestSchema.parse({
        statedFacts: oversized,
        openQuestions: [],
        rejectionReasons: [],
        surfacedFindings: [],
      }),
    ).toThrow();
  });

  it("rejects openQuestions longer than 10 entries", () => {
    const oversized = Array.from({ length: 11 }, (_, i) => `q-${i}`);
    expect(() =>
      ChatContextDigestSchema.parse({
        statedFacts: [],
        openQuestions: oversized,
        rejectionReasons: [],
        surfacedFindings: [],
      }),
    ).toThrow();
  });

  it("rejects rejectionReasons longer than 10 entries", () => {
    const oversized = Array.from({ length: 11 }, (_, i) => `r-${i}`);
    expect(() =>
      ChatContextDigestSchema.parse({
        statedFacts: [],
        openQuestions: [],
        rejectionReasons: oversized,
        surfacedFindings: [],
      }),
    ).toThrow();
  });

  it("rejects surfacedFindings longer than 20 entries", () => {
    const oversized = Array.from({ length: 21 }, (_, i) => `f-${i}`);
    expect(() =>
      ChatContextDigestSchema.parse({
        statedFacts: [],
        openQuestions: [],
        rejectionReasons: [],
        surfacedFindings: oversized,
      }),
    ).toThrow();
  });

  it("rejects entries longer than 140 chars", () => {
    const tooLong = "x".repeat(141);
    expect(() =>
      ChatContextDigestSchema.parse({
        statedFacts: [tooLong],
        openQuestions: [],
        rejectionReasons: [],
        surfacedFindings: [],
      }),
    ).toThrow();
  });

  it("accepts entries at exactly 140 chars", () => {
    const atLimit = "x".repeat(140);
    const parsed = ChatContextDigestSchema.parse({
      statedFacts: [atLimit],
      openQuestions: [],
      rejectionReasons: [],
      surfacedFindings: [],
    });
    expect(parsed.statedFacts[0]).toHaveLength(140);
  });

  it("rejects missing fields", () => {
    expect(() =>
      ChatContextDigestSchema.parse({
        statedFacts: [],
        openQuestions: [],
      }),
    ).toThrow();
  });
});
