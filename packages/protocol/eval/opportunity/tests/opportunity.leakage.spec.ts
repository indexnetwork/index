import { describe, it, expect } from "bun:test";

import { hasUuid, hasInternalLabel, hasMarkdown, hasGreetingPrefix } from "../opportunity.leakage.js";

describe("hasUuid", () => {
  it("detects a UUID", () => {
    expect(hasUuid("see 5f0a2c14-6b3e-4f9a-8c21-9d7e1b2a4c6f for details")).toBe(true);
  });
  it("ignores ordinary text and numbers", () => {
    expect(hasUuid("You raised $2M in 2024 with 3 mutual intents.")).toBe(false);
  });
});

describe("hasInternalLabel", () => {
  it("flags internal labels and field names", () => {
    expect(hasInternalLabel("The source user overlaps with the candidate")).toBe(true);
    expect(hasInternalLabel("matched on intentId")).toBe(true);
  });
  it("passes clean copy", () => {
    expect(hasInternalLabel("Ava is raising a seed round and Ben invests at seed.")).toBe(false);
  });
});

describe("hasMarkdown", () => {
  it("flags emphasis, links, code, and bullets", () => {
    expect(hasMarkdown("**bold** opener")).toBe(true);
    expect(hasMarkdown("see [this](http://x)")).toBe(true);
    expect(hasMarkdown("- a bullet")).toBe(true);
    expect(hasMarkdown("`code`")).toBe(true);
  });
  it("passes plain prose", () => {
    expect(hasMarkdown("Saw we're both working on climate hardware — would love to compare notes.")).toBe(false);
  });
});

describe("hasGreetingPrefix", () => {
  it("flags salutation prefixes", () => {
    expect(hasGreetingPrefix("Hey Sarah, saw your post")).toBe(true);
    expect(hasGreetingPrefix("Hi there, quick note")).toBe(true);
  });
  it("passes a body-only greeting", () => {
    expect(hasGreetingPrefix("Saw we're both into ZK proofs — keen to chat.")).toBe(false);
  });
});
