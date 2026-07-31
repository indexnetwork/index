import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
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

    const listed = await store.list();
    expect(listed.map((r) => r.id)).toEqual([second.id, first.id]);
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
});
