import { describe, expect, it } from "bun:test";

import { CASES } from "../discovery-retrieval.cases.js";
import { formatCaseList, formatCaseSummary, hasRule, parseTier, selectCases } from "../discovery-retrieval.selection.js";

describe("discovery retrieval selection", () => {
  it("selects cases by exact-or-prefix id, rule, and tier", () => {
    expect(selectCases(CASES, { caseId: CASES[0]!.id.slice(0, 8) })).toEqual([CASES[0]]);
    expect(selectCases(CASES, { rule: "location_constraint" }).every((c) => c.rule === "location_constraint")).toBe(true);
    expect(() => parseTier("2")).toThrow();
  });

  it("formats the corpus and identifies known rules", () => {
    expect(formatCaseSummary(CASES)).toContain(`total:${CASES.length}`);
    expect(formatCaseList(CASES)).toContain(CASES[0]!.id);
    expect(hasRule(CASES, "premise_distractor")).toBe(true);
    expect(hasRule(CASES, "unknown")).toBe(false);
  });
});
