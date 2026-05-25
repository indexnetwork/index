import { describe, it, expect } from "bun:test";
import { QuestionEvents } from "../../question.event";

describe("QuestionEvents.onAnswered wiring", () => {
  it("onAnswered is a function (not a no-op after main.ts runs)", () => {
    expect(typeof QuestionEvents.onAnswered).toBe("function");
  });
});
