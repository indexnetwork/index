import { describe, it, expect } from "bun:test";

import { CASES } from "../opportunity.cases.js";
import { formatCaseList, formatCaseSummary, hasRule, parseTier, selectCases } from "../opportunity.selection.js";

describe("corpus invariants", () => {
  it("has unique case ids", () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every case has an id prefix, a viewer role, and non-empty context", () => {
    for (const c of CASES) {
      expect(c.id).toContain("/");
      expect(["party", "patient", "introducer"]).toContain(c.input.viewerRole);
      expect(c.input.viewerContext.length).toBeGreaterThan(0);
      expect(c.input.otherPartyContext.length).toBeGreaterThan(0);
    }
  });

  it("covers the leakage, voice, greeting, and framing rules", () => {
    for (const rule of ["viewer_voice", "no_leakage", "greeting", "introducer_role"]) {
      expect(CASES.some((c) => c.rule === rule)).toBe(true);
    }
  });
});

describe("parseTier", () => {
  it("accepts supported tiers and rejects others", () => {
    expect(parseTier("1")).toBe(1);
    expect(parseTier(undefined)).toBeUndefined();
    expect(() => parseTier("3")).toThrow();
  });
});

describe("selectCases", () => {
  it("filters by rule, tier, and id prefix", () => {
    expect(selectCases(CASES, { rule: "no_leakage" }).every((c) => c.rule === "no_leakage")).toBe(true);
    expect(selectCases(CASES, { tier: 1 }).every((c) => c.tier === 1)).toBe(true);
    expect(selectCases(CASES, { caseId: "viewer_voice/" }).every((c) => c.id.startsWith("viewer_voice/"))).toBe(true);
  });
});

describe("formatting + hasRule", () => {
  it("summary and list render counts and ids", () => {
    expect(formatCaseSummary(CASES)).toContain(`total:${CASES.length}`);
    expect(formatCaseList(CASES)).toContain(CASES[0].id);
  });

  it("hasRule detects known and unknown rules", () => {
    expect(hasRule(CASES, "no_leakage")).toBe(true);
    expect(hasRule(CASES, "nope")).toBe(false);
  });
});
