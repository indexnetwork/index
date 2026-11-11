import { describe, expect, it } from "vitest";

import { focusedGroup, intentsToRefresh, withoutAnswered, type PersonalQuestion } from "./personal-questions";

const card = (groupId: string, questionIds: string[], intentIds: string[]): PersonalQuestion => ({
  groupId, id: questionIds[0], intentId: intentIds[0], question: `${groupId}?`, scope: "intent", matches: [], questionIds, intentIds,
});

describe("withoutAnswered", () => {
  it("hides the whole group as soon as any of its questions is answered", () => {
    const cards = [card("g1", ["a1", "b1"], ["a", "b"]), card("g2", ["c1"], ["c"])];
    expect(withoutAnswered(cards, new Set(["b1"])).map((c) => c.groupId)).toEqual(["g2"]);
  });
});

describe("intentsToRefresh", () => {
  it("is every intent the answered group stood for", () => {
    const cards = [card("g1", ["a1", "b1"], ["a", "b"])];
    expect(intentsToRefresh(cards, "a1", "a")).toEqual(["a", "b"]);
    expect(intentsToRefresh(cards, "zz", "z")).toEqual(["z"]);
  });
});

describe("focusedGroup", () => {
  const cards = [card("g1", ["a1", "b1"], ["a", "b"])];
  it("finds a group by any of its questions", () => {
    expect(focusedGroup(cards, "b1")).toBe("g1");
  });
  it("is null for an unknown or missing id", () => {
    expect(focusedGroup(cards, "nope")).toBeNull();
    expect(focusedGroup(cards, null)).toBeNull();
  });
});
