import { describe, it, expect } from "bun:test";
import { CASES } from "../matching.cases.js";

describe("matching corpus", () => {
  it("has unique case ids", () => {
    const ids = CASES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every expectation references an entity present in the case input", () => {
    for (const c of CASES) {
      const entityIds = new Set(c.input.entities.map((e) => e.userId));
      for (const exp of c.expect) {
        expect(entityIds.has(exp.candidateId)).toBe(true);
      }
    }
  });

  it("every case has at least one expectation and a discoverer entity", () => {
    for (const c of CASES) {
      expect(c.expect.length).toBeGreaterThan(0);
      // Some rules mask the discoverer; just require the discoverer id is set.
      expect(c.input.discovererId.length).toBeGreaterThan(0);
    }
  });

  it("score bands are well-formed (min<=max, within 0..100)", () => {
    for (const c of CASES) {
      for (const exp of c.expect) {
        if (!exp.scoreBand) continue;
        const [min, max] = exp.scoreBand;
        expect(min).toBeGreaterThanOrEqual(0);
        expect(max).toBeLessThanOrEqual(100);
        expect(min).toBeLessThanOrEqual(max);
      }
    }
  });
});
