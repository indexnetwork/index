import { describe, expect, it } from "bun:test";

import { envEntry, maskValue } from "../check-feature-flag";

const EXAMPLE = [
  "# 13. Pool questions",
  "# POOL_QUESTIONS_MODE=off",
  "# Requires POOL_QUESTIONS_MODE=on, NEGOTIATOR_CHAT_ENABLED=true, and an index.",
  "",
  "DATABASE_URL=postgresql://user:hunter2@db.example.com/protocol_prod?sslmode=verify-full",
  "EMPTY_FLAG=",
].join("\n");

describe("maskValue", () => {
  it("prints short flag-shaped values verbatim", () => {
    for (const value of ["on", "off", "shadow", "0", "2", "true", "pool-discovery"]) {
      expect(maskValue(value)).toBe(value);
    }
  });

  it("redacts anything that is not flag-shaped, so secrets never reach a transcript", () => {
    const url = "postgresql://user:hunter2@db.example.com/protocol_prod?sslmode=verify-full";
    const masked = maskValue(url);
    expect(masked).not.toContain("hunter2");
    expect(masked).not.toContain("db.example.com");
    expect(masked).toBe(`<redacted: ${url.length} chars — not a flag-shaped value>`);
  });

  it("redacts long opaque tokens even without punctuation", () => {
    expect(maskValue("a".repeat(40))).toContain("redacted");
  });

  it("reports an empty value rather than redacting it", () => {
    expect(maskValue("")).toBe("<empty>");
    expect(maskValue("   ")).toBe("<empty>");
  });
});

describe("envEntry", () => {
  it("prefers an active entry and reports a commented one as commented", () => {
    expect(envEntry("FLAG=on", "FLAG")).toBe("on");
    expect(envEntry("# FLAG=off", "FLAG")).toBe("commented: off");
    expect(envEntry(EXAMPLE, "POOL_QUESTIONS_MODE")).toBe("commented: off");
  });

  it("ignores a flag mentioned inside prose on a comment line", () => {
    expect(envEntry("# Requires POOL_QUESTIONS_MODE=on, and an index.", "POOL_QUESTIONS_MODE")).toBeNull();
  });

  it("does not match a flag whose name is a suffix of another", () => {
    expect(envEntry("LEGACY_FLAG=on", "FLAG")).toBeNull();
    expect(envEntry("# LEGACY_FLAG=on", "FLAG")).toBeNull();
  });

  it("treats the flag name as a literal, never a pattern", () => {
    expect(envEntry(EXAMPLE, "POOL_QUESTIONS_.*")).toBeNull();
    expect(envEntry("FLAG=on", "F.AG")).toBeNull();
  });

  it("redacts a secret found in an env file", () => {
    expect(envEntry(EXAMPLE, "DATABASE_URL")).not.toContain("hunter2");
  });

  it("reports an explicitly empty assignment", () => {
    expect(envEntry(EXAMPLE, "EMPTY_FLAG")).toBe("<empty>");
  });

  it("returns null for an absent flag", () => {
    expect(envEntry(EXAMPLE, "NOT_PRESENT")).toBeNull();
  });
});
