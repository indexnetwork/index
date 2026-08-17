import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it } from "bun:test";
import { stripIntroducerMentions } from "../opportunity.presentation.js";

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

// ─── Edge cases ─────────────────────────────────────────────────────────────


describe("stripIntroducerMentions - Edge Cases", () => {
  it("handles multiple introducer mentions in same text", () => {
    const text = "Seref Yarar introduced you to Lucy. Seref Yarar also thought you would work well together.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).not.toContain("Seref Yarar");
    expect(result).toContain("Lucy");
  });

  it("handles introducer name appearing in the middle of text", () => {
    const text = "Lucy is a great match. Seref introduced you to her. She needs your skills.";
    const result = stripIntroducerMentions(text, "Seref");
    expect(result).not.toContain("Seref");
    expect(result).toContain("Lucy");
  });

  it("handles pattern 'suggested you connect with'", () => {
    const text = "Alice suggested you connect with Bob, who is building a startup.";
    const result = stripIntroducerMentions(text, "Alice");
    expect(result).not.toContain("Alice");
    expect(result).toContain("Bob");
  });

  it("handles pattern 'recommended you meet'", () => {
    const text = "Carol recommended you meet Dave for a potential collaboration.";
    const result = stripIntroducerMentions(text, "Carol");
    expect(result).not.toContain("Carol");
    expect(result).toContain("Dave");
  });

  it("handles pattern 'thinks you and X should meet'", () => {
    const text = "Eve thinks you and Frank should meet to discuss AI.";
    const result = stripIntroducerMentions(text, "Eve");
    expect(result).not.toContain("Eve");
    expect(result).toContain("Frank");
  });

  it("handles introducer with only first name", () => {
    const text = "Alex introduced you to Jordan.";
    const result = stripIntroducerMentions(text, "Alex");
    expect(result).not.toContain("Alex");
    expect(result).toContain("Jordan");
  });

  it("handles introducer with middle name", () => {
    const text = "John Michael Smith introduced you to Jane.";
    const result = stripIntroducerMentions(text, "John Michael Smith");
    expect(result).not.toContain("John");
    expect(result).not.toContain("Michael");
    expect(result).not.toContain("Smith");
  });

  it("handles text with special characters after introducer pattern", () => {
    const text = "Seref introduced you to Lucy!!! She is amazing.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).toContain("Lucy!!!");
  });

  it("preserves text when introducer name is part of another word", () => {
    const text = "Seref introduced you to Lucy. This is a different word containing Serefname.";
    const result = stripIntroducerMentions(text, "Seref");
    // Should remove "Seref" but not "Serefname" (word boundary check)
    expect(result).not.toMatch(/\bSeref\b/);
    expect(result).toContain("Serefname");
  });

  it("handles empty text", () => {
    const result = stripIntroducerMentions("", "Seref");
    expect(result).toBe("");
  });

  it("handles text with only full introducer pattern", () => {
    const text = "Seref Yarar introduced you to Lucy.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).toBe("Lucy.");
  });

  it("handles text with only first name introducer pattern", () => {
    const text = "Seref introduced you to Lucy.";
    const result = stripIntroducerMentions(text, "Seref");
    expect(result).toBe("Lucy.");
  });

  it("handles unicode characters in names", () => {
    const text = "José introduced you to María.";
    const result = stripIntroducerMentions(text, "José");
    expect(result).not.toContain("José");
    expect(result).toContain("María");
  });

  it("handles pattern variations with different spacing", () => {
    const text1 = "Seref  introduced   you   to   Lucy.";
    const result1 = stripIntroducerMentions(text1, "Seref");
    expect(result1).toContain("Lucy");

    const text2 = "Bob thinks   you should   meet Alice.";
    const result2 = stripIntroducerMentions(text2, "Bob");
    expect(result2).toContain("Alice");
  });

  it("handles real-world example from IND-113", () => {
    const text = "Seref Yarar introduced you to Lucy, who is actively seeking a product co-founder for a niche APAC marketplace. With your expertise in UX, product, and AI, this could be an ideal collaboration to transform complex challenges into user-centric solutions.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).not.toContain("Seref");
    expect(result).not.toContain("Yarar");
    expect(result).not.toContain("introduced you");
    expect(result).toContain("Lucy");
    expect(result).toContain("APAC marketplace");
    expect(result).toStartWith("Lucy, who is actively");
  });

  it("handles counterpart with same first name as introducer", () => {
    // Edge case: introducer "David Smith", counterpart "David Johnson".
    // We strip only full-name phrase and sentence-start for fullName, not for firstName,
    // so counterpart name is preserved to avoid over-stripping valid first names.
    const text = "David Smith introduced you to David Johnson.";
    const result = stripIntroducerMentions(text, "David Smith");
    expect(result).not.toContain("David Smith");
    expect(result).toContain("David Johnson");
  });

  it("handles pattern with 'introduced you directly to'", () => {
    const text = "Seref introduced you directly to Lucy.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).toBe("Lucy.");
  });

  it("preserves punctuation and formatting", () => {
    const text = "Seref introduced you to Lucy; she is a product manager.";
    const result = stripIntroducerMentions(text, "Seref");
    expect(result).toBe("Lucy; she is a product manager.");
  });
});
