import { config } from "dotenv";
config({ path: ".env.development", override: true });

import { describe, expect, it } from "bun:test";
import { stripIntroducerMentions } from "../opportunity.sanitize";

describe("stripIntroducerMentions", () => {
  it("removes introducer mention at start of sentence", () => {
    const text = "Seref Yarar introduced you to Lucy, who is actively seeking a product co-founder.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).not.toContain("Seref Yarar");
    expect(result).toContain("Lucy");
    expect(result).toBe("Lucy, who is actively seeking a product co-founder.");
  });

  it("removes introducer mention with 'thinks you should meet' pattern", () => {
    const text = "Bob thinks you should meet Alice because your skills align.";
    const result = stripIntroducerMentions(text, "Bob");
    expect(result).not.toContain("Bob");
    expect(result).toBe("Alice because your skills align.");
  });

  it("removes introducer mention with 'connected you' pattern", () => {
    const text = "Alice connected you to Bob, who needs your help.";
    const result = stripIntroducerMentions(text, "Alice");
    expect(result).not.toContain("Alice");
    expect(result).toBe("Bob, who needs your help.");
  });

  it("handles text without introducer mention (no change)", () => {
    const text = "Lucy is seeking a co-founder for her marketplace.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).toBe(text);
  });

  it("handles case-insensitive matching", () => {
    const text = "SEREF YARAR introduced you to Lucy.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).not.toContain("SEREF YARAR");
  });

  it("handles first name only matching", () => {
    const text = "Seref introduced you to Lucy, who needs help.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).not.toContain("Seref");
    expect(result).toBe("Lucy, who needs help.");
  });

  it("removes common introducer patterns with 'to'", () => {
    const text = "Jane introduced you to Mark. Mark is looking for a designer.";
    const result = stripIntroducerMentions(text, "Jane");
    expect(result).toBe("Mark. Mark is looking for a designer.");
  });

  it("trims whitespace after removal", () => {
    const text = "Seref introduced you to Lucy.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).toBe("Lucy.");
  });

  it("returns original text if introducerName is empty", () => {
    const text = "Some text here.";
    const result = stripIntroducerMentions(text, "");
    expect(result).toBe(text);
  });

  it("returns original text if introducerName is undefined", () => {
    const text = "Some text here.";
    const result = stripIntroducerMentions(text, undefined);
    expect(result).toBe(text);
  });
});
