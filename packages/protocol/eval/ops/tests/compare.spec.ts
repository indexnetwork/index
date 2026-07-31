import { describe, expect, it } from "bun:test";

import { compareArtifacts } from "../ops.compare.js";

function envelope(options: {
  corpus?: string;
  config?: string;
  passes: number;
  runs: number;
}) {
  const { corpus = "corpus-a", config = "config-a", passes, runs } = options;
  return {
    artifactType: "index-eval/run-report",
    schemaVersion: 2,
    harness: "matching",
    harnessVersion: "1",
    corpusFingerprint: corpus,
    configFingerprint: config,
    selection: { fullCorpus: true, filters: {} },
    payload: {
      generatedAt: "2026-07-31T00:00:00.000Z",
      model: "google/gemini-2.5-flash",
      runs,
      aggregatePassRate: passes / runs,
      rules: [{ rule: "r", caseCount: 1, passRate: passes / runs }],
      cases: [{ caseId: "a/b", rule: "r", runs, passes, passRate: passes / runs, flaky: false }],
    },
  } as never;
}

describe("compareArtifacts", () => {
  it("refuses to compare across differing corpus fingerprints", () => {
    const outcome = compareArtifacts(
      envelope({ corpus: "corpus-a", passes: 10, runs: 10 }),
      envelope({ corpus: "corpus-b", passes: 10, runs: 10 }),
    );

    expect(outcome.comparable).toBe(false);
    if (outcome.comparable) throw new Error("unreachable");
    expect(outcome.findings.map((f) => f.dimension)).toContain("corpusFingerprint");
  });

  it("refuses to compare across differing scoring configuration", () => {
    const outcome = compareArtifacts(
      envelope({ config: "config-a", passes: 10, runs: 10 }),
      envelope({ config: "config-b", passes: 10, runs: 10 }),
    );

    expect(outcome.comparable).toBe(false);
  });

  it("reports a regression when the subject is significantly worse", () => {
    const outcome = compareArtifacts(
      envelope({ passes: 20, runs: 20 }),
      envelope({ passes: 2, runs: 20 }),
    );

    if (!outcome.comparable) throw new Error("expected a comparable outcome");
    expect(outcome.regressions.regressions.map((r) => r.id)).toContain("a/b");
    expect(outcome.improvements.regressions).toEqual([]);
    expect(outcome.aggregate.delta).toBeLessThan(0);
  });

  it("reports an improvement by evaluating the reversed direction", () => {
    const outcome = compareArtifacts(
      envelope({ passes: 2, runs: 20 }),
      envelope({ passes: 20, runs: 20 }),
    );

    if (!outcome.comparable) throw new Error("expected a comparable outcome");
    expect(outcome.regressions.regressions).toEqual([]);
    expect(outcome.improvements.regressions.map((r) => r.id)).toContain("a/b");
    expect(outcome.aggregate.delta).toBeGreaterThan(0);
  });
});
