import { describe, expect, test } from "bun:test";

import { publicationCheck } from "./publication.ts";

describe("publicationCheck", () => {
  test("passes a plain negotiation message", () => {
    expect(publicationCheck(["I propose a short call about robotics mentoring."])).toBe("passed");
  });
  test("blocks naming MoralMod", () => {
    expect(publicationCheck(["MoralMod rates this highly."])).toBe("blocked");
  });
  test("blocks utility-score talk", () => {
    expect(publicationCheck(["The utility scores favour accepting."])).toBe("blocked");
  });
  test("blocks numeric confidence claims", () => {
    expect(publicationCheck(["Confidence is 55% on this one."])).toBe("blocked");
  });
  test("blocks zero-width obfuscation", () => {
    expect(publicationCheck(["Moral​Mod says yes."])).toBe("blocked");
  });
  test("blocks a leaked run identifier", () => {
    expect(publicationCheck(["Reference run-12345678 for details."], ["run-12345678"])).toBe("blocked");
  });
});
