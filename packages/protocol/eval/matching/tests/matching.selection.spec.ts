import { describe, expect, it } from "bun:test";
import { CASES } from "../matching.cases.js";
import { formatCaseList, hasRule, parseTier, selectCases } from "../matching.selection.js";

describe("parseTier", () => {
  it("accepts supported tiers", () => {
    expect(parseTier("1")).toBe(1);
    expect(parseTier("4")).toBe(4);
  });

  it("rejects invalid tiers", () => {
    expect(() => parseTier("5")).toThrow("--tier");
  });
});

describe("selectCases", () => {
  it("filters by rule", () => {
    const selected = selectCases(CASES, { rule: "location" });
    expect(selected.length).toBeGreaterThan(0);
    expect(selected.every((c) => c.rule === "location")).toBe(true);
  });

  it("filters by exact case id or prefix", () => {
    const exact = selectCases(CASES, { caseId: "location/known-mismatch-penalized" });
    expect(exact).toHaveLength(1);

    const prefix = selectCases(CASES, { caseId: "location/" });
    expect(prefix.length).toBeGreaterThan(1);
    expect(prefix.every((c) => c.id.startsWith("location/"))).toBe(true);
  });

  it("filters by tier", () => {
    const tier4 = selectCases(CASES, { tier: 4 });
    expect(tier4.length).toBe(14);
    expect(tier4.every((c) => c.tier === 4)).toBe(true);
  });

  it("composes filters", () => {
    const selected = selectCases(CASES, { rule: "location", tier: 4 });
    expect(selected.length).toBe(2);
    expect(selected.every((c) => c.rule === "location" && c.tier === 4)).toBe(true);
  });
});

describe("formatCaseList", () => {
  it("renders case ids and tiers", () => {
    const output = formatCaseList(selectCases(CASES, { rule: "same_side" }));
    expect(output).toContain("Matching eval cases");
    expect(output).toContain("same_side");
    expect(output).toContain("[t");
  });
});

describe("hasRule", () => {
  it("detects known rules", () => {
    expect(hasRule(CASES, "location")).toBe(true);
    expect(hasRule(CASES, "missing-rule")).toBe(false);
  });
});
