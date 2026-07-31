import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { decodeArtifactId, encodeArtifactId, FsArtifactSource } from "../ops.artifacts.js";

function baselineArtifact(overrides: Record<string, unknown> = {}) {
  return {
    artifactType: "index-eval/baseline",
    schemaVersion: 1,
    harness: "matching",
    harnessVersion: "1",
    source: "legacy-migration",
    createdAt: "2026-05-29T18:05:23.210Z",
    startedAt: "2026-05-29T18:05:23.210Z",
    completedAt: "2026-05-29T18:05:23.210Z",
    models: ["google/gemini-2.5-flash"],
    runs: 2,
    selection: { fullCorpus: true, filters: {} },
    corpusFingerprint: "unavailable-legacy-migration",
    configFingerprint: "unavailable-legacy-migration",
    git: { revision: "unknown", dirty: null },
    completeness: { caseCount: 1, ruleCount: 1, totalRuns: 2, totalPasses: 2, flakyCaseCount: 0 },
    payload: {
      generatedAt: "2026-05-29T18:05:23.210Z",
      model: "google/gemini-2.5-flash",
      runs: 2,
      aggregatePassRate: 1,
      rules: [{ rule: "is_a_identity", caseCount: 1, passRate: 1 }],
      cases: [{ caseId: "a/b", rule: "is_a_identity", runs: 2, passes: 2, passRate: 1, flaky: false }],
    },
    ...overrides,
  };
}

let evalDir: string;

beforeEach(async () => {
  evalDir = await mkdtemp(path.join(tmpdir(), "ops-artifacts-"));
  await mkdir(path.join(evalDir, "matching/baselines"), { recursive: true });
  await mkdir(path.join(evalDir, "matching/runs"), { recursive: true });
  await mkdir(path.join(evalDir, "hyde"), { recursive: true });
});

afterEach(async () => {
  await rm(evalDir, { recursive: true, force: true });
});

describe("FsArtifactSource", () => {
  it("indexes a committed baseline into an ArtifactRef", async () => {
    await writeFile(
      path.join(evalDir, "matching/baselines/matching.baseline.json"),
      JSON.stringify(baselineArtifact()),
    );

    const { refs, issues } = await new FsArtifactSource({ evalDir }).list();

    expect(issues).toEqual([]);
    expect(refs).toHaveLength(1);
    expect(refs[0].harness).toBe("matching");
    expect(refs[0].kind).toBe("baseline");
    expect(refs[0].aggregatePassRate).toBe(1);
    expect(refs[0].caseCount).toBe(1);
    expect(refs[0].complete).toBeNull();
    expect(refs[0].path).toBe("matching/baselines/matching.baseline.json");
  });

  it("reports a corrupt artifact as an issue instead of dropping it silently", async () => {
    await writeFile(path.join(evalDir, "matching/runs/broken.json"), "{ not json");

    const { refs, issues } = await new FsArtifactSource({ evalDir }).list();

    expect(refs).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("matching/runs/broken.json");
    expect(issues[0].message).toMatch(/json/i);
  });

  it("ignores harnesses outside the four scorecard harnesses", async () => {
    await writeFile(
      path.join(evalDir, "hyde/anything.json"),
      JSON.stringify(baselineArtifact({ harness: "hyde" })),
    );

    const { refs, issues } = await new FsArtifactSource({ evalDir }).list();

    expect(refs).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("round-trips artifact ids and rejects traversal", async () => {
    const id = encodeArtifactId("matching/runs/x.json");
    expect(decodeArtifactId(id)).toBe("matching/runs/x.json");
    expect(() => decodeArtifactId(encodeArtifactId("../../etc/passwd"))).toThrow(/outside/i);
  });
});
