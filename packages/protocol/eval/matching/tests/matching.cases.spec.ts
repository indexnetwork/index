import { describe, it, expect } from "bun:test";
import { CASES } from "../matching.cases.js";
import type { Domain, Scorecard } from "../matching.types.js";

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

  it("every case has at least one explicit domain category", () => {
    const allowed = new Set<Domain>(["technology", "research", "arts", "funding", "location", "community", "sports"]);
    for (const c of CASES) {
      expect(c.domains.length).toBeGreaterThan(0);
      for (const domain of c.domains) expect(allowed.has(domain)).toBe(true);
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

  it("has enough query_primary coverage to make rule metrics meaningful", () => {
    const queryCases = CASES.filter((c) => c.rule === "query_primary");
    expect(queryCases.length).toBeGreaterThanOrEqual(7);
    expect(new Set(queryCases.flatMap((c) => c.domains)).size).toBeGreaterThanOrEqual(4);
  });

  it("includes the tier-3 historical cases", () => {
    expect(CASES.some((c) => c.rule === "historical")).toBe(true);
    expect(CASES.filter((c) => c.tier === 3).length).toBe(5);
  });

  it("committed baseline covers every corpus case", async () => {
    // Cases added to the corpus but not yet captured by a live `--update-baseline`
    // run. Every entry here must still be missing from the baseline (stale entries
    // fail below) — remove ids from this set when the baseline is next refreshed.
    const BASELINE_PENDING_CASE_IDS = new Set<string>([
      "event_network/co-membership-is-not-attendance", // added in #1144 without a baseline run
    ]);

    const baseline = (await Bun.file(new URL("../baselines/matching.baseline.json", import.meta.url)).json()) as Scorecard;
    const baselineIds = new Set(baseline.cases.map((c) => c.caseId));
    const corpusIds = new Set(CASES.map((c) => c.id));

    const missing = CASES.map((c) => c.id).filter((id) => !baselineIds.has(id) && !BASELINE_PENDING_CASE_IDS.has(id));
    expect(missing).toEqual([]);

    // Keep the allowlist honest: pending ids must exist in the corpus and must
    // actually be absent from the baseline.
    const stale = [...BASELINE_PENDING_CASE_IDS].filter((id) => !corpusIds.has(id) || baselineIds.has(id));
    expect(stale).toEqual([]);
  });
});
