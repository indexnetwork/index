import { describe, it, expect } from "bun:test";

/**
 * Test the dedup logic extracted as a pure function.
 * The ChatAgent calls this inside normalizeToolResult.
 */
import { deduplicateQuestions } from "../chat.question-dedup.js";

describe("deduplicateQuestions", () => {
  it("returns all questions when surfacedIds is empty", () => {
    const questions = [
      { id: "q-1", title: "Q1" },
      { id: "q-2", title: "Q2" },
    ];
    const { fresh, newIds } = deduplicateQuestions(questions, new Set());
    expect(fresh).toHaveLength(2);
    expect(newIds).toEqual(["q-1", "q-2"]);
  });

  it("filters out already-surfaced questions", () => {
    const questions = [
      { id: "q-1", title: "Q1" },
      { id: "q-2", title: "Q2" },
      { id: "q-3", title: "Q3" },
    ];
    const { fresh, newIds } = deduplicateQuestions(questions, new Set(["q-1", "q-3"]));
    expect(fresh).toHaveLength(1);
    expect(fresh[0].id).toBe("q-2");
    expect(newIds).toEqual(["q-2"]);
  });

  it("passes through questions without an id (inline-generated)", () => {
    const questions = [
      { title: "Inline Q", prompt: "?", options: [] },
      { id: "q-1", title: "Pending Q" },
    ];
    const { fresh, newIds } = deduplicateQuestions(questions, new Set(["q-1"]));
    expect(fresh).toHaveLength(1);
    expect(fresh[0].title).toBe("Inline Q");
    expect(newIds).toEqual([]);
  });

  it("returns empty when all are already surfaced", () => {
    const questions = [{ id: "q-1", title: "Q1" }];
    const { fresh, newIds } = deduplicateQuestions(questions, new Set(["q-1"]));
    expect(fresh).toEqual([]);
    expect(newIds).toEqual([]);
  });
});
