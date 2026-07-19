/**
 * Provider-free specs for canary manifest parsing, exclusion rules, budget
 * caps, and resolution against the live committed corpora (IND-447).
 */
import { describe, expect, test } from "bun:test";
import path from "path";
import { CANARY_MANIFEST_ARTIFACT_TYPE, CANARY_MANIFEST_SCHEMA_VERSION, CANARY_MAX_REQUESTED_RUN_SLOTS, CANARY_MAX_RUNS_PER_CASE, CANARY_MAX_TOTAL_CASES, CANARY_SUITES, parseCanaryManifest, resolveCanaryManifest, type CanaryManifest, type CanarySuiteCorpus, type CanarySuiteName } from "../canary.manifest.js";
import { canaryCorpora } from "../canary.suites.js";

const MANIFEST_PATH = path.resolve(import.meta.dir, "../canary.manifest.json");

function validManifest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    artifactType: CANARY_MANIFEST_ARTIFACT_TYPE,
    schemaVersion: CANARY_MANIFEST_SCHEMA_VERSION,
    description: "test manifest",
    runsPerCase: 2,
    alpha: 0.05,
    suites: { matching: { cases: ["a/b"] } },
    ...overrides,
  };
}

function corpus(suite: CanarySuiteName, caseIds: string[]): Partial<Record<CanarySuiteName, CanarySuiteCorpus>> {
  return { [suite]: { suite, caseIds } };
}

describe("parseCanaryManifest", () => {
  test("accepts a valid manifest", () => {
    const manifest = parseCanaryManifest(validManifest());
    expect(manifest.runsPerCase).toBe(2);
    expect(manifest.suites.matching?.cases).toEqual(["a/b"]);
  });

  test("rejects a wrong artifactType and schemaVersion", () => {
    expect(() => parseCanaryManifest(validManifest({ artifactType: "index-eval/other" }))).toThrow(/Invalid canary manifest/);
    expect(() => parseCanaryManifest(validManifest({ schemaVersion: 2 }))).toThrow(/Invalid canary manifest/);
  });

  test("rejects unknown fields (strict schema)", () => {
    expect(() => parseCanaryManifest(validManifest({ maxBudget: 100 }))).toThrow(/Invalid canary manifest/);
  });

  test("rejects an empty suite selection", () => {
    expect(() => parseCanaryManifest(validManifest({ suites: {} }))).toThrow(/at least one suite/);
  });

  test("rejects the HyDE canonical study with a pointed message", () => {
    expect(() => parseCanaryManifest(validManifest({ suites: { hyde: { cases: ["x"] } } }))).toThrow(/HyDE canonical study.*never on a cron/);
  });

  test("rejects other excluded and unknown suites", () => {
    expect(() => parseCanaryManifest(validManifest({ suites: { clarification: { cases: ["x"] } } }))).toThrow(/excluded from routine canary scheduling/);
    expect(() => parseCanaryManifest(validManifest({ suites: { nonsense: { cases: ["x"] } } }))).toThrow(/unknown suite "nonsense"/);
  });

  test("rejects runsPerCase outside 1..cap", () => {
    expect(() => parseCanaryManifest(validManifest({ runsPerCase: 0 }))).toThrow(/Invalid canary manifest/);
    expect(() => parseCanaryManifest(validManifest({ runsPerCase: CANARY_MAX_RUNS_PER_CASE + 1 }))).toThrow(/Invalid canary manifest/);
  });

  test("rejects duplicate case ids within a suite", () => {
    expect(() => parseCanaryManifest(validManifest({ suites: { matching: { cases: ["a/b", "a/b"] } } }))).toThrow(/declares case "a\/b" twice/);
  });

  test("rejects an out-of-range alpha", () => {
    expect(() => parseCanaryManifest(validManifest({ alpha: 0 }))).toThrow(/Invalid canary manifest/);
    expect(() => parseCanaryManifest(validManifest({ alpha: 1 }))).toThrow(/Invalid canary manifest/);
  });
});

describe("resolveCanaryManifest", () => {
  test("resolves existing unambiguous cases and computes slots", () => {
    const manifest = parseCanaryManifest(validManifest({ suites: { matching: { cases: ["a/b", "c/d"] } } })) as CanaryManifest;
    const selection = resolveCanaryManifest(manifest, corpus("matching", ["a/b", "c/d", "e/f"]));
    expect(selection.totalCases).toBe(2);
    expect(selection.requestedRunSlots).toBe(4);
    expect(selection.suites).toEqual([{ suite: "matching", caseIds: ["a/b", "c/d"] }]);
  });

  test("rejects a case id absent from the corpus", () => {
    const manifest = parseCanaryManifest(validManifest()) as CanaryManifest;
    expect(() => resolveCanaryManifest(manifest, corpus("matching", ["other/case"]))).toThrow(/does not exist in the matching corpus/);
  });

  test("rejects a case id that is a prefix of another corpus case (--case ambiguity)", () => {
    const manifest = parseCanaryManifest(validManifest({ suites: { matching: { cases: ["a/b"] } } })) as CanaryManifest;
    expect(() => resolveCanaryManifest(manifest, corpus("matching", ["a/b", "a/b-variant"]))).toThrow(/ambiguous under the matching harness/);
  });

  test("enforces the total-case cap", () => {
    const ids = Array.from({ length: CANARY_MAX_TOTAL_CASES + 1 }, (_, i) => `rule/case-${i}x`);
    const manifest = parseCanaryManifest(validManifest({ runsPerCase: 1, suites: { matching: { cases: ids } } })) as CanaryManifest;
    expect(() => resolveCanaryManifest(manifest, corpus("matching", ids))).toThrow(/over the hard cap of/);
  });

  test("enforces the requested-run-slot cap", () => {
    const count = Math.floor(CANARY_MAX_REQUESTED_RUN_SLOTS / CANARY_MAX_RUNS_PER_CASE) + 1;
    const ids = Array.from({ length: count }, (_, i) => `rule/case-${i}x`);
    const manifest = parseCanaryManifest(
      validManifest({ runsPerCase: CANARY_MAX_RUNS_PER_CASE, suites: { matching: { cases: ids } } }),
    ) as CanaryManifest;
    expect(() => resolveCanaryManifest(manifest, corpus("matching", ids))).toThrow(/run slots/);
  });
});

describe("committed canary manifest", () => {
  test("parses and resolves against the live committed corpora within caps", async () => {
    const manifest = parseCanaryManifest(await Bun.file(MANIFEST_PATH).json());
    const selection = resolveCanaryManifest(manifest, canaryCorpora());
    expect(selection.totalCases).toBeGreaterThan(0);
    expect(selection.totalCases).toBeLessThanOrEqual(CANARY_MAX_TOTAL_CASES);
    expect(selection.requestedRunSlots).toBeLessThanOrEqual(CANARY_MAX_REQUESTED_RUN_SLOTS);
    // Every baseline-backed suite participates in the committed canary.
    expect(selection.suites.map((entry) => entry.suite).sort()).toEqual([...CANARY_SUITES].sort());
  });

  test("never selects the full corpus of any suite (canary is a subset by design)", async () => {
    const manifest = parseCanaryManifest(await Bun.file(MANIFEST_PATH).json());
    const corpora = canaryCorpora();
    for (const [suite, selection] of Object.entries(manifest.suites)) {
      expect(selection!.cases.length).toBeLessThan(corpora[suite as CanarySuiteName].caseIds.length);
    }
  });
});
