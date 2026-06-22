import { describe, it, expect } from "bun:test";
import { hasAtLeastOneSocial, shouldAutoGenerateProfile } from "../src/controllers/auth.controller";

describe("hasAtLeastOneSocial", () => {
  it("returns true for non-empty array", () => {
    expect(hasAtLeastOneSocial([{ id: "1", userId: "u", label: "linkedin", value: "x" }])).toBe(true);
  });

  it("returns false for empty array", () => {
    expect(hasAtLeastOneSocial([])).toBe(false);
  });

  it("returns false for null", () => {
    expect(hasAtLeastOneSocial(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(hasAtLeastOneSocial(undefined)).toBe(false);
  });

  it("returns false for non-array object", () => {
    expect(hasAtLeastOneSocial({ linkedin: "foo" })).toBe(false);
  });

  it("returns false for string", () => {
    expect(hasAtLeastOneSocial("linkedin")).toBe(false);
  });
});

describe("shouldAutoGenerateProfile", () => {
  it("returns true when user has name, socials, and no profile", () => {
    expect(
      shouldAutoGenerateProfile({
        name: "Alice",
        socials: [{ id: "1", userId: "u", label: "linkedin", value: "alice" }],
        profile: null,
      })
    ).toBe(true);
  });

  it("returns false when user has no name", () => {
    expect(
      shouldAutoGenerateProfile({
        name: null,
        socials: [{ id: "1", userId: "u", label: "linkedin", value: "alice" }],
        profile: null,
      })
    ).toBe(false);
  });

  it("returns false when name is whitespace-only", () => {
    expect(
      shouldAutoGenerateProfile({
        name: "   ",
        socials: [{ id: "1", userId: "u", label: "linkedin", value: "alice" }],
        profile: null,
      })
    ).toBe(false);
  });

  it("returns false when user has no socials", () => {
    expect(
      shouldAutoGenerateProfile({
        name: "Alice",
        socials: [],
        profile: null,
      })
    ).toBe(false);
  });

  it("returns false when socials is null", () => {
    expect(
      shouldAutoGenerateProfile({
        name: "Alice",
        socials: null,
        profile: null,
      })
    ).toBe(false);
  });

  it("returns false when user already has a profile", () => {
    expect(
      shouldAutoGenerateProfile({
        name: "Alice",
        socials: [{ id: "1", userId: "u", label: "linkedin", value: "alice" }],
        profile: { identity: { name: "Alice" } },
      })
    ).toBe(false);
  });

  it("returns true with multiple socials and no profile", () => {
    expect(
      shouldAutoGenerateProfile({
        name: "Bob",
        socials: [
          { id: "1", userId: "u", label: "linkedin", value: "bob" },
          { id: "2", userId: "u", label: "twitter", value: "bob" },
        ],
        profile: undefined,
      })
    ).toBe(true);
  });
});
