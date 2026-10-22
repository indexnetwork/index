import { describe, expect, test } from "bun:test";

import { screens } from "./brief.ts";
import type { Decide } from "./decide.ts";

const input = (decide?: Decide) => ({
  user: { id: "u", name: "Seren", profileConfirmed: true },
  intent: { id: "i", statement: "Offering mentoring to product designers." },
  principalConversation: [],
  model: {} as never,
  ...(decide ? { decide } : {}),
});
const candidate = { statement: "Peers to swap ideas with", bio: null, location: null };

describe("screens", () => {
  test("skips a candidate the model is sure is a mismatch", async () => {
    expect(await screens(input(async () => ({ choice: "skip", probabilities: { reach: 0.05, skip: 0.95 } })), candidate)).toBe(false);
  });

  test("reaches a borderline skip, since a wrongful pass costs less than a lost match", async () => {
    expect(await screens(input(async () => ({ choice: "skip", probabilities: { reach: 0.4, skip: 0.6 } })), candidate)).toBe(true);
  });

  test("reaches when the model says reach", async () => {
    expect(await screens(input(async () => ({ choice: "reach", probabilities: { reach: 0.9, skip: 0.1 } })), candidate)).toBe(true);
  });

  test("a backend with no probabilities skips on its choice alone", async () => {
    expect(await screens(input(async () => ({ choice: "skip" })), candidate)).toBe(false);
  });

  test("an error reaches rather than dropping the person, without a retry of its own", async () => {
    let calls = 0;
    const failing: Decide = async () => { calls++; throw new Error("429"); };
    expect(await screens(input(failing), candidate)).toBe(true);
    expect(calls).toBe(1);
  });

  test("with no decision model everyone is reached", async () => {
    expect(await screens(input(), candidate)).toBe(true);
  });
});
