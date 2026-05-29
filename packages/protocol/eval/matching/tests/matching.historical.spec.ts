import { describe, it, expect } from "bun:test";
import { HISTORICAL_CASES } from "../matching.historical.js";

describe("tier-3 historical corpus", () => {
  it("has five cases, all tier 3 / rule historical", () => {
    expect(HISTORICAL_CASES.length).toBe(5);
    for (const c of HISTORICAL_CASES) {
      expect(c.tier).toBe(3);
      expect(c.rule).toBe("historical");
      expect(c.domains.length).toBeGreaterThan(0);
    }
  });

  it("each case is a discoverer + one matching partner + three rejected distractors", () => {
    for (const c of HISTORICAL_CASES) {
      const ids = new Set(c.input.entities.map((e) => e.userId));
      expect(ids.has(c.input.discovererId)).toBe(true);
      expect(c.input.entities.length).toBe(5);
      expect(c.expect.filter((e) => e.match).length).toBe(1);
      expect(c.expect.filter((e) => !e.match).length).toBe(3);
    }
  });

  it("partner band sits at/above 60..100; distractor bands sit at/below 29", () => {
    for (const c of HISTORICAL_CASES) {
      for (const exp of c.expect) {
        expect(exp.scoreBand).toBeDefined();
        const [min, max] = exp.scoreBand!;
        if (exp.match) {
          expect(min).toBeGreaterThanOrEqual(60);
          expect(max).toBe(100);
        } else {
          expect(max).toBeLessThanOrEqual(29);
        }
      }
    }
  });

  it("every expectation references an entity present in the case", () => {
    for (const c of HISTORICAL_CASES) {
      const ids = new Set(c.input.entities.map((e) => e.userId));
      for (const exp of c.expect) expect(ids.has(exp.candidateId)).toBe(true);
    }
  });

  it("uses report-only real names while keeping protocol input anonymized", () => {
    for (const c of HISTORICAL_CASES) {
      expect(c.reportNames).toBeDefined();
      const discovererName = c.reportNames![c.input.discovererId];
      expect(discovererName).toBeTruthy();
      expect(c.input.entities.find((e) => e.userId === c.input.discovererId)?.profile.name).toBe("(source user)");
    }
  });

  it("keeps historical inputs scoped to pre-opportunity profiles", () => {
    const forbidden = /cofounder of apple|apple computer|beatles|google|alphafold|nobel|lasker|mrna vaccine|covid/i;
    for (const c of HISTORICAL_CASES) {
      const text = JSON.stringify(c.input);
      expect(text).not.toMatch(forbidden);
    }
  });

  it("uses at most two indexes per case, and every index used has a context entry", () => {
    for (const c of HISTORICAL_CASES) {
      const nets = new Set(c.input.entities.map((e) => e.networkId));
      expect(nets.size).toBeLessThanOrEqual(2);
      const ctxKeys = new Set(Object.keys(c.input.networkContexts ?? {}));
      for (const n of nets) expect(ctxKeys.has(n)).toBe(true);
    }
  });
});
