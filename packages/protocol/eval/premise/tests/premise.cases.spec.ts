import { describe, it, expect } from "bun:test";

import { CASES } from "../premise.cases.js";
import { formatCaseList, formatCaseSummary, hasRule, parseComponent, parseTier, selectCases } from "../premise.selection.js";

describe("corpus invariants", () => {
  it("has unique case ids", () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every case declares matching component-specific expectations", () => {
    for (const c of CASES) {
      expect(c.id).toContain("/");
      if (c.component === "analyze") {
        const e = c.expect;
        const hasAny = e.speechActType || e.authorityBand || e.sincerityBand || e.clarityBand || e.entropyBand || e.reasoningCriteria;
        expect(Boolean(hasAny)).toBe(true);
      } else {
        const e = c.expect;
        const hasAny = e.expectEmpty || e.minPremises !== undefined || e.maxPremises !== undefined || e.minAssertive !== undefined || e.minContextual !== undefined;
        expect(Boolean(hasAny)).toBe(true);
      }
    }
  });
});

describe("parseTier / parseComponent", () => {
  it("accepts supported tiers and rejects others", () => {
    expect(parseTier("1")).toBe(1);
    expect(parseTier(undefined)).toBeUndefined();
    expect(() => parseTier("3")).toThrow();
  });

  it("accepts known components and rejects others", () => {
    expect(parseComponent("decompose")).toBe("decompose");
    expect(parseComponent("analyze")).toBe("analyze");
    expect(() => parseComponent("bogus")).toThrow();
  });
});

describe("selectCases", () => {
  it("filters by component, rule, tier, and id prefix", () => {
    expect(selectCases(CASES, { component: "analyze" }).every((c) => c.component === "analyze")).toBe(true);
    expect(selectCases(CASES, { rule: "speech_act" }).every((c) => c.rule === "speech_act")).toBe(true);
    expect(selectCases(CASES, { tier: 1 }).every((c) => c.tier === 1)).toBe(true);
    expect(selectCases(CASES, { caseId: "atomicity/" }).every((c) => c.id.startsWith("atomicity/"))).toBe(true);
  });
});

describe("formatting + hasRule", () => {
  it("summary and list render counts and ids", () => {
    expect(formatCaseSummary(CASES)).toContain(`total:${CASES.length}`);
    expect(formatCaseSummary(CASES)).toContain("by component");
    expect(formatCaseList(CASES)).toContain(CASES[0].id);
  });

  it("hasRule detects known and unknown rules", () => {
    expect(hasRule(CASES, "speech_act")).toBe(true);
    expect(hasRule(CASES, "nope")).toBe(false);
  });
});
