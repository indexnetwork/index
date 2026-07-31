import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { FsRunStore, statusFromExitCode } from "../ops.store.js";
import type { RunSpec } from "../ops.types.js";

const SPEC: RunSpec = { kind: "eval", harness: "matching", profile: "default", flags: { runs: 1 } };

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ops-store-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("statusFromExitCode", () => {
  it("maps the documented harness exit codes", () => {
    expect(statusFromExitCode(0)).toBe("passed");
    expect(statusFromExitCode(1)).toBe("regression");
    expect(statusFromExitCode(2)).toBe("execution-error");
    expect(statusFromExitCode(3)).toBe("insufficient-evidence");
    expect(statusFromExitCode(137)).toBe("crashed");
  });
});

describe("FsRunStore", () => {
  it("creates a queued record readable after a fresh instance", async () => {
    const store = new FsRunStore({ rootDir: dir });
    const created = await store.create({
      spec: SPEC,
      argv: ["bun", "run", "eval:matching"],
      env: {},
      profileFingerprint: "f",
      experimental: false,
      workload: 40,
    });

    expect(created.status).toBe("queued");

    const reloaded = await new FsRunStore({ rootDir: dir }).get(created.id);
    expect(reloaded?.id).toBe(created.id);
    expect(reloaded?.spec.harness).toBe("matching");
  });

  it("lists newest first", async () => {
    const store = new FsRunStore({ rootDir: dir });
    const first = await store.create({ spec: SPEC, argv: [], env: {}, profileFingerprint: "f", experimental: false, workload: 1 });
    await Bun.sleep(2);
    const second = await store.create({ spec: SPEC, argv: [], env: {}, profileFingerprint: "f", experimental: false, workload: 1 });

    const { records, issues } = await store.list();
    expect(records.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(issues).toEqual([]);
  });

  it("reconciles a running record whose process is gone", async () => {
    const store = new FsRunStore({ rootDir: dir });
    const created = await store.create({ spec: SPEC, argv: [], env: {}, profileFingerprint: "f", experimental: false, workload: 1 });
    // pid 0 is never a live child process here.
    await store.update(created.id, { status: "running", pid: 0, startedAt: new Date().toISOString() });

    const reconciled = await new FsRunStore({ rootDir: dir }).reconcile();

    expect(reconciled.map((r) => r.id)).toEqual([created.id]);
    expect((await store.get(created.id))?.status).toBe("interrupted");
  });

  it("leaves finished records untouched during reconciliation", async () => {
    const store = new FsRunStore({ rootDir: dir });
    const created = await store.create({ spec: SPEC, argv: [], env: {}, profileFingerprint: "f", experimental: false, workload: 1 });
    await store.update(created.id, { status: "passed", exitCode: 0 });

    expect(await store.reconcile()).toEqual([]);
    expect((await store.get(created.id))?.status).toBe("passed");
  });

  it("leaves a running record with a live process alone during reconciliation", async () => {
    const LIVE_PID = 99999;
    const store = new FsRunStore({ rootDir: dir, isProcessAlive: (pid) => pid === LIVE_PID });
    const created = await store.create({ spec: SPEC, argv: [], env: {}, profileFingerprint: "f", experimental: false, workload: 1 });
    await store.update(created.id, { status: "running", pid: LIVE_PID, startedAt: new Date().toISOString() });

    const reconciled = await store.reconcile();

    expect(reconciled).toEqual([]);
    const persisted = await store.get(created.id);
    expect(persisted?.status).toBe("running");
    expect(persisted?.pid).toBe(LIVE_PID);
  });

  it("surfaces corrupt meta.json as an issue without crashing list", async () => {
    const store = new FsRunStore({ rootDir: dir });
    const healthy = await store.create({ spec: SPEC, argv: [], env: {}, profileFingerprint: "f", experimental: false, workload: 1 });

    // Create a directory with a corrupt meta.json
    const corruptId = "corrupt-run-id";
    await mkdir(path.join(dir, corruptId), { recursive: true });
    await Bun.write(path.join(dir, corruptId, "meta.json"), "{ incomplete json");

    const { records, issues } = await store.list();

    // The healthy record should still be returned
    expect(records.map((r) => r.id)).toEqual([healthy.id]);
    // The corrupt file should be surfaced as an issue
    expect(issues.length).toBe(1);
    expect(issues[0].path).toBe(`${corruptId}/meta.json`);
    expect(issues[0].message).toContain("JSON");
  });
});
