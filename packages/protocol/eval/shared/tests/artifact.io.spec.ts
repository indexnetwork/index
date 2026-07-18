import { describe, expect, it } from "bun:test";
import { mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { EVAL_BASELINE_ARTIFACT_TYPE, buildEvalArtifact } from "../artifact.js";
import { assertEvalWritePlan, readEvalArtifact, writeEvalArtifact } from "../artifact.io.js";
import { buildScorecard } from "../scorecard.js";
import type { CaseResultLike } from "../types.js";
import { makeSuccessfulExecution, makeTestMeta } from "./artifact.fixtures.js";

const caseResult = (caseId: string, passes: number, runs = 3): CaseResultLike => ({
  caseId,
  rule: "g",
  runs,
  passes,
  passRate: passes / runs,
  flaky: passes > 0 && passes < runs,
  scoredRunIds: Array.from({ length: runs }, (_, runIndex) => `${encodeURIComponent(caseId)}::run:${runIndex + 1}`),
});

const envelope = (passes = 3) =>
  buildEvalArtifact(
    EVAL_BASELINE_ARTIFACT_TYPE,
    buildScorecard([caseResult("a", passes)], { model: "test/model", runs: 3 }),
    makeTestMeta({ runs: 3, execution: makeSuccessfulExecution(["a"], 3) }),
  );

const freshDir = async (): Promise<string> => {
  const dir = join(tmpdir(), `eval-artifact-io-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(dir, { recursive: true });
  return dir;
};

describe("writeEvalArtifact + readEvalArtifact", () => {
  it("round-trips through an atomic write with no temp residue", async () => {
    const dir = await freshDir();
    const p = join(dir, "baseline.json");
    await writeEvalArtifact(p, envelope());
    const back = await readEvalArtifact(p, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE, expectedHarness: "test-harness" });
    expect(back!.payload.cases[0].caseId).toBe("a");
    expect(await readdir(dir)).toEqual(["baseline.json"]);
    await rm(dir, { recursive: true, force: true });
  });

  it("returns null for a missing file", async () => {
    expect(await readEvalArtifact(join(tmpdir(), `missing-${Date.now()}.json`), { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).toBeNull();
  });

  it("fails actionably on corrupt/truncated JSON", async () => {
    const dir = await freshDir();
    const p = join(dir, "baseline.json");
    await Bun.write(p, JSON.stringify(envelope()).slice(0, 40));
    await expect(readEvalArtifact(p, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).rejects.toThrow(/not valid JSON.*corrupt or truncated/);
    await rm(dir, { recursive: true, force: true });
  });

  it("fails actionably on a stale (unknown) schema version, naming the file", async () => {
    const dir = await freshDir();
    const p = join(dir, "baseline.json");
    await Bun.write(p, JSON.stringify({ ...envelope(), schemaVersion: 0 }));
    await expect(readEvalArtifact(p, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).rejects.toThrow(/baseline\.json.*schema version 0/);
    await rm(dir, { recursive: true, force: true });
  });

  it("refuses to overwrite an existing artifact without force", async () => {
    const dir = await freshDir();
    const p = join(dir, "baseline.json");
    await writeEvalArtifact(p, envelope(3));
    await expect(writeEvalArtifact(p, envelope(2))).rejects.toThrow(/Refusing to overwrite.*--force/);
    const back = await readEvalArtifact(p, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE });
    expect(back!.payload.cases[0].passes).toBe(3); // original intact
    await writeEvalArtifact(p, envelope(2), { force: true });
    const replaced = await readEvalArtifact(p, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE });
    expect(replaced!.payload.cases[0].passes).toBe(2);
    await rm(dir, { recursive: true, force: true });
  });

  it("allows exactly one simultaneous non-force writer without overwriting the winner", async () => {
    const dir = await freshDir();
    const p = join(dir, "contended-report.json");
    const settled = await Promise.allSettled([
      writeEvalArtifact(p, envelope(3)),
      writeEvalArtifact(p, envelope(2)),
    ]);

    expect(settled.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(String(rejected[0].reason)).toMatch(/Refusing to overwrite.*--force/);
    const back = await readEvalArtifact(p, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE });
    expect([2, 3]).toContain(back!.payload.cases[0].passes);
    expect(await readdir(dir)).toEqual(["contended-report.json"]);
    await rm(dir, { recursive: true, force: true });
  });

  it("never lets an invalid artifact replace a previous valid one", async () => {
    const dir = await freshDir();
    const p = join(dir, "baseline.json");
    await writeEvalArtifact(p, envelope(3));
    const corrupted = { ...envelope(2), completeness: { ...envelope(2).completeness, totalPasses: 999 } };
    await expect(writeEvalArtifact(p, corrupted, { force: true })).rejects.toThrow(/completeness\.totalPasses/);
    const back = await readEvalArtifact(p, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE });
    expect(back!.payload.cases[0].passes).toBe(3); // previous valid artifact untouched
    expect(await readdir(dir)).toEqual(["baseline.json"]); // no temp residue
    await rm(dir, { recursive: true, force: true });
  });

  it("cleans up its temp file when the rename target is unusable", async () => {
    const dir = await freshDir();
    const asDir = join(dir, "collision.json");
    await mkdir(asDir); // rename onto an existing directory fails
    await expect(writeEvalArtifact(asDir, envelope(), { force: true })).rejects.toThrow();
    expect((await readdir(dir)).filter((f) => f.includes(".tmp"))).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  it("creates missing parent directories", async () => {
    const dir = await freshDir();
    const p = join(dir, "nested/deeper/baseline.json");
    await writeEvalArtifact(p, envelope());
    expect(await readEvalArtifact(p, { expectedType: EVAL_BASELINE_ARTIFACT_TYPE })).not.toBeNull();
    await rm(dir, { recursive: true, force: true });
  });
});

describe("assertEvalWritePlan", () => {
  it("rejects an output that would overwrite an input", async () => {
    const dir = await freshDir();
    const baseline = join(dir, "baseline.json");
    await expect(assertEvalWritePlan({ inputs: [baseline], outputs: [baseline] }))
      .rejects.toThrow(/would overwrite an input artifact/);
    await rm(dir, { recursive: true, force: true });
  });

  it("allows the sanctioned in-place baseline update while still requiring consent", async () => {
    const dir = await freshDir();
    const baseline = join(dir, "baseline.json");
    // Non-existent baseline: fine without force.
    await assertEvalWritePlan({ inputs: [baseline], outputs: [{ path: baseline, updatesInput: true }] });
    // Existing baseline: refused without force, allowed with force.
    await writeEvalArtifact(baseline, envelope());
    await expect(assertEvalWritePlan({ inputs: [baseline], outputs: [{ path: baseline, updatesInput: true }] }))
      .rejects.toThrow(/--force/);
    await assertEvalWritePlan({ inputs: [baseline], outputs: [{ path: baseline, updatesInput: true }], force: true });
    await rm(dir, { recursive: true, force: true });
  });

  it("rejects the same output declared twice (partial multi-output protection)", async () => {
    const p = join(tmpdir(), `dup-${Date.now()}.json`);
    await expect(assertEvalWritePlan({ outputs: [p, p] })).rejects.toThrow(/declared twice/);
  });

  it("reports every existing destination before anything is written", async () => {
    const dir = await freshDir();
    const a = join(dir, "a.json");
    const b = join(dir, "b.json");
    const c = join(dir, "c.json");
    await Bun.write(a, "{}");
    await Bun.write(b, "{}");
    const err = await assertEvalWritePlan({ outputs: [a, b, c] }).catch((e: unknown) => e as Error);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain(a);
    expect((err as Error).message).toContain(b);
    expect((err as Error).message).not.toContain(c);
    await assertEvalWritePlan({ outputs: [a, b, c], force: true });
    await rm(dir, { recursive: true, force: true });
  });
});
