import { describe, it, expect } from "bun:test";

import { CASES } from "../profile.cases.js";
import { formatCaseList, formatCaseSummary, hasRule, parseTier, selectCases } from "../profile.selection.js";

describe("corpus invariants", () => {
  it("has unique case ids", () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every case has an id with a prefix and a non-empty input", () => {
    for (const c of CASES) {
      expect(c.id).toContain("/");
      expect(c.input.length).toBeGreaterThan(0);
    }
  });

  it("privacy is exercised by at least one dedicated rule case", () => {
    expect(CASES.some((c) => c.rule === "privacy")).toBe(true);
  });
});

describe("parseTier", () => {
  it("accepts supported tiers and rejects others", () => {
    expect(parseTier("1")).toBe(1);
    expect(parseTier("2")).toBe(2);
    expect(parseTier(undefined)).toBeUndefined();
    expect(() => parseTier("3")).toThrow();
  });
});

describe("selectCases", () => {
  it("filters by rule, tier, and id prefix", () => {
    expect(selectCases(CASES, { rule: "privacy" }).every((c) => c.rule === "privacy")).toBe(true);
    expect(selectCases(CASES, { tier: 1 }).every((c) => c.tier === 1)).toBe(true);
    expect(selectCases(CASES, { caseId: "extraction/" }).every((c) => c.id.startsWith("extraction/"))).toBe(true);
  });
});

describe("formatting + hasRule", () => {
  it("summary and list render counts and ids", () => {
    expect(formatCaseSummary(CASES)).toContain(`total:${CASES.length}`);
    expect(formatCaseList(CASES)).toContain(CASES[0].id);
  });

  it("hasRule detects known and unknown rules", () => {
    expect(hasRule(CASES, "privacy")).toBe(true);
    expect(hasRule(CASES, "nope")).toBe(false);
  });
});
