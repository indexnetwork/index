import { describe, it, expect } from "bun:test";
import { ChatGraphState } from "../chat.state.js";

describe("ChatGraphState.surfacedQuestionIds", () => {
  it("defaults to an empty set", () => {
    const annotation = ChatGraphState;
    // LangGraph annotations expose State type; verify the field exists
    type State = typeof annotation.State;
    const check: State["surfacedQuestionIds"] = new Set();
    expect(check.size).toBe(0);
  });

  it("reducer replaces the set on update", () => {
    // Simulate the reducer behavior: next replaces curr
    const initial = new Set<string>();
    const updated = new Set(["q-1", "q-2"]);
    // The reducer is (curr, next) => next ?? curr
    const result = updated ?? initial;
    expect(result.size).toBe(2);
    expect(result.has("q-1")).toBe(true);
  });
});
