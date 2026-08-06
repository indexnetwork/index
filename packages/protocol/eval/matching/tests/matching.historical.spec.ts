import { describe, it, expect } from "bun:test";

import { historicalMatchingCaseProjection, historicalModelSafeProjection } from "../../discovery-env-matrix/historical-quality.corpus.js";
import { HISTORICAL_CASES, HISTORICAL_QUALITY_CASES } from "../matching.historical.js";

describe("tier-3 historical corpus", () => {
  it("aggregates the five audited cases in stable order and projects compatibility cases", () => {
    expect(HISTORICAL_QUALITY_CASES.map(({ id }) => id)).toEqual([
      "historical/builder-and-operator",
      "historical/co-researchers-structure",
      "historical/songwriting-duo",
      "historical/first-check-investor",
      "historical/domain-expert-and-ml",
    ]);
    expect(HISTORICAL_CASES).toEqual(
      HISTORICAL_QUALITY_CASES.map(historicalMatchingCaseProjection),
    );
    expect(HISTORICAL_QUALITY_CASES[3]!.reportNames).toEqual({
      "h4-a": "Larry Page",
      "h4-b": "Andy Bechtolsheim",
    });
  });

  it("keeps audit-only strings out of the model-safe projection and exact matching input", () => {
    const auditKeys = [
      "historicalQuality",
      "claimProvenance",
      "semanticNegatives",
      "anonymizationReview",
      "outcomeCitationIds",
      "citationIds",
      "basisClaimIds",
      "violatedRequirement",
    ];

    for (const historicalCase of HISTORICAL_QUALITY_CASES) {
      const serializations = [
        JSON.stringify(historicalModelSafeProjection(historicalCase)),
        JSON.stringify(historicalMatchingCaseProjection(historicalCase).input),
      ];
      const outcomeCitations = new Set(historicalCase.historicalQuality.outcomeCitationIds);
      const forbidden = [
        ...Object.values(historicalCase.reportNames ?? {}),
        ...historicalCase.historicalQuality.citations.flatMap((citation) => [
          citation.url,
          citation.excerpt,
          ...(outcomeCitations.has(citation.id) ? [citation.title] : []),
        ]),
        ...Object.values(historicalCase.historicalQuality.semanticNegatives),
        ...auditKeys,
      ];

      for (const serialized of serializations) {
        for (const value of forbidden) expect(serialized).not.toContain(value);
      }
    }
  });

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

  it("uses at most two indexes per case and preserves only audited network contexts", () => {
    for (const c of HISTORICAL_CASES) {
      const nets = new Set(c.input.entities.map((e) => e.networkId));
      expect(nets.size).toBeLessThanOrEqual(2);
      const ctxKeys = Object.keys(c.input.networkContexts ?? {});
      for (const networkId of ctxKeys) expect(nets.has(networkId)).toBe(true);
    }
    expect(HISTORICAL_CASES.slice(0, 4).every((c) => Object.keys(c.input.networkContexts ?? {}).length === 1)).toBe(true);
    expect(HISTORICAL_CASES[4]!.input.networkContexts).toBeUndefined();
  });
});
