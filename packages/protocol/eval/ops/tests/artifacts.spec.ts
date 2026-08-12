import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { decodeArtifactId, encodeArtifactId, FsArtifactSource } from "../ops.artifacts.js";
import { OPS_HARNESSES } from "../ops.registry.js";
import { makeHistoricalQualityArtifact } from "../../shared/tests/artifact.fixtures.js";

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

function runReportArtifact(overrides: Record<string, unknown> = {}) {
  const caseId = "test/case";
  const runId = `${encodeURIComponent(caseId)}::run:1`;
  const attemptId = `${runId}::attempt:1`;
  const startedAt = "2026-07-31T10:00:00.000Z";
  const completedAt = "2026-07-31T10:00:05.000Z";
  return {
    artifactType: "index-eval/run-report",
    schemaVersion: 2,
    harness: "matching",
    harnessVersion: "1",
    source: "run",
    createdAt: "2026-07-31T10:00:06.000Z",
    startedAt,
    completedAt,
    models: ["google/gemini-2.5-flash"],
    runs: 1,
    selection: { fullCorpus: true, filters: {} },
    corpusFingerprint: "a7ffc6f8bf1ed76651c14756a061d662f580ff4de43b49fa82d80a4b80f8434a",
    configFingerprint: "b5bb9d8014a0f9b1d61e21e796d78dccdf1352f23cd32812f4850b878ae4944c",
    git: { revision: "abc123def456789012345678901234567890abcd", dirty: false },
    completeness: {
      caseCount: 1,
      ruleCount: 1,
      totalRuns: 1,
      totalPasses: 1,
      flakyCaseCount: 0,
      requestedRuns: 1,
      completedRuns: 1,
      failedRuns: 0,
      recoveredRuns: 0,
      totalAttempts: 1,
      complete: true,
    },
    execution: {
      policy: "normal" as const,
      runs: [
        {
          runId,
          caseId,
          runIndex: 0,
          outcome: "success" as const,
          recovered: false,
          attempts: [
            {
              attemptId,
              runId,
              runIndex: 0,
              attemptNumber: 1,
              startedAt,
              completedAt,
              durationMs: 5000,
              outcome: "success" as const,
              retryable: false,
              backoffMs: 0,
            },
          ],
        },
      ],
    },
    payload: {
      generatedAt: completedAt,
      model: "google/gemini-2.5-flash",
      runs: 1,
      aggregatePassRate: 1,
      rules: [{ rule: "test_rule", caseCount: 1, passRate: 1 }],
      cases: [{ caseId, rule: "test_rule", runs: 1, passes: 1, passRate: 1, flaky: false, scoredRunIds: [runId] }],
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
    const artifact = baselineArtifact();
    await writeFile(
      path.join(evalDir, "matching/baselines/matching.baseline.json"),
      JSON.stringify(artifact),
    );

    const { refs, issues } = await new FsArtifactSource({ evalDir }).list();

    expect(issues).toEqual([]);
    expect(refs).toHaveLength(1);

    const ref = refs[0];
    expect(ref.id).toBe(encodeArtifactId("matching/baselines/matching.baseline.json"));
    expect(ref.harness).toBe("matching");
    expect(ref.kind).toBe("baseline");
    expect(ref.path).toBe("matching/baselines/matching.baseline.json");
    expect(ref.schemaVersion).toBe(1);
    expect(ref.createdAt).toBe("2026-05-29T18:05:23.210Z");
    expect(ref.models).toEqual(["google/gemini-2.5-flash"]);
    expect(ref.runs).toBe(2);
    expect(ref.selection).toEqual({ fullCorpus: true, filters: {} });
    expect(ref.git).toEqual({ revision: "unknown", dirty: null });
    expect(ref.corpusFingerprint).toBe("unavailable-legacy-migration");
    expect(ref.configFingerprint).toBe("unavailable-legacy-migration");
    expect(ref.aggregatePassRate).toBe(1);
    expect(ref.caseCount).toBe(1);
    expect(ref.complete).toBeNull();
    expect(ref.measurementKind).toBeNull();
    expect(ref).not.toHaveProperty("qualityCompleteness");
    expect(ref.sizeBytes).toBeGreaterThan(0);
    expect(ref.mtimeMs).toBeGreaterThan(0);
  });

  it("reports a corrupt artifact as an issue instead of dropping it silently", async () => {
    await writeFile(path.join(evalDir, "matching/runs/broken.json"), "{ not json");

    const { refs, issues } = await new FsArtifactSource({ evalDir }).list();

    expect(refs).toEqual([]);
    expect(issues).toHaveLength(1);
    expect(issues[0].path).toBe("matching/runs/broken.json");
    expect(issues[0].message).toMatch(/json/i);
  });

  it("ignores harnesses that are not registered", async () => {
    await writeFile(
      path.join(evalDir, "hyde/anything.json"),
      JSON.stringify(baselineArtifact({ harness: "hyde" })),
    );

    const { refs, issues } = await new FsArtifactSource({ evalDir }).list();

    expect(refs).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("treats a registered harness with no directory here as nothing to index, not as a problem", async () => {
    // Only matching/ exists in this fixture. discovery never gets one: its
    // CLI writes under services/api/eval and it has no baseline at all, so
    // scanning for eval/discovery/{baselines,runs} must stay silent rather
    // than reporting an issue or forcing an empty directory to be created.
    for (const harness of OPS_HARNESSES) {
      if (harness === "matching") continue;
      expect(existsSync(path.join(evalDir, harness))).toBe(false);
    }

    const { refs, issues } = await new FsArtifactSource({ evalDir }).list();

    expect(refs).toEqual([]);
    expect(issues).toEqual([]);
  });

  it("indexes a discovery run from .ops-runs even though it has no directory under eval/", async () => {
    const runId = "discovery-run";
    await mkdir(path.join(evalDir, ".ops-runs", runId), { recursive: true });
    await writeFile(
      path.join(evalDir, ".ops-runs", runId, "report.json"),
      JSON.stringify(runReportArtifact({ harness: "discovery" })),
    );

    const { refs, issues } = await new FsArtifactSource({ evalDir }).list();

    expect(issues).toEqual([]);
    expect(refs).toHaveLength(1);
    expect(refs[0].harness).toBe("discovery");
    expect(refs[0].kind).toBe("run");
  });

  it("projects a non-discovery quality artifact into the discriminated ref branch", async () => {
    const runId = "quality-run";
    await mkdir(path.join(evalDir, ".ops-runs", runId), { recursive: true });
    await writeFile(
      path.join(evalDir, ".ops-runs", runId, "report.json"),
      JSON.stringify({ ...makeHistoricalQualityArtifact(), harness: "matching" }),
    );

    const { refs, issues } = await new FsArtifactSource({ evalDir }).list();

    expect(issues).toEqual([]);
    expect(refs).toHaveLength(1);
    expect(refs[0].harness).toBe("matching");
    expect(refs[0].measurementKind).toBe("historical-quality-pilot");
    if (refs[0].measurementKind !== "historical-quality-pilot") {
      throw new Error("quality ref did not preserve its discriminator");
    }
    expect(refs[0].qualityCompleteness).toEqual({
      requestedSlots: 10,
      completedSlots: 10,
    });
  });

  it("round-trips artifact ids and rejects traversal", async () => {
    const id = encodeArtifactId("matching/runs/x.json");
    expect(decodeArtifactId(id)).toBe("matching/runs/x.json");
    expect(() => decodeArtifactId(encodeArtifactId("../../etc/passwd"))).toThrow(/outside/i);
  });

  it("indexes a run-report artifact with kind=run from the runs/ directory", async () => {
    const artifact = runReportArtifact();
    await writeFile(
      path.join(evalDir, "matching/runs/test-run.json"),
      JSON.stringify(artifact),
    );

    const { refs, issues } = await new FsArtifactSource({ evalDir }).list();

    expect(issues).toEqual([]);
    expect(refs).toHaveLength(1);
    expect(refs[0].kind).toBe("run");
    expect(refs[0].path).toBe("matching/runs/test-run.json");
    expect(refs[0].harness).toBe("matching");
    expect(refs[0].complete).toBe(true);
  });

  it("indexes artifacts from the .ops-runs directory", async () => {
    const artifact = runReportArtifact();
    const runId = "test-run-123";
    await mkdir(path.join(evalDir, ".ops-runs", runId), { recursive: true });
    await writeFile(
      path.join(evalDir, ".ops-runs", runId, "report.json"),
      JSON.stringify(artifact),
    );

    const { refs, issues } = await new FsArtifactSource({ evalDir }).list();

    expect(issues).toEqual([]);
    expect(refs).toHaveLength(1);
    expect(refs[0].path).toBe(`.ops-runs/${runId}/report.json`);
    expect(refs[0].harness).toBe("matching");
    expect(refs[0].kind).toBe("run");
  });

  it("sorts artifacts by createdAt newest-first", async () => {
    await writeFile(
      path.join(evalDir, "matching/baselines/older.json"),
      JSON.stringify(baselineArtifact({
        startedAt: "2026-05-01T10:00:00.000Z",
        completedAt: "2026-05-01T10:00:00.000Z",
        createdAt: "2026-05-01T10:00:00.000Z",
      })),
    );
    await writeFile(
      path.join(evalDir, "matching/baselines/newer.json"),
      JSON.stringify(baselineArtifact({
        startedAt: "2026-06-01T10:00:00.000Z",
        completedAt: "2026-06-01T10:00:00.000Z",
        createdAt: "2026-06-01T10:00:00.000Z",
      })),
    );
    await writeFile(
      path.join(evalDir, "matching/baselines/newest.json"),
      JSON.stringify(baselineArtifact({
        startedAt: "2026-07-01T10:00:00.000Z",
        completedAt: "2026-07-01T10:00:00.000Z",
        createdAt: "2026-07-01T10:00:00.000Z",
      })),
    );

    const { refs, issues } = await new FsArtifactSource({ evalDir }).list();

    expect(issues).toEqual([]);
    expect(refs).toHaveLength(3);
    expect(refs[0].createdAt).toBe("2026-07-01T10:00:00.000Z");
    expect(refs[1].createdAt).toBe("2026-06-01T10:00:00.000Z");
    expect(refs[2].createdAt).toBe("2026-05-01T10:00:00.000Z");
  });
});
