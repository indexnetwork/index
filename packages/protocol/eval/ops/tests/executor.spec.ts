import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { LocalProcessRunExecutor } from "../ops.executor.js";
import { FsRunStore } from "../ops.store.js";
import type { RunSpec } from "../ops.types.js";

const SPEC: RunSpec = { kind: "eval", harness: "matching", profile: "default", flags: {} };
const FAKE = path.join(import.meta.dir, "fake-harness.ts");

let dir: string;
let store: FsRunStore;
let executor: LocalProcessRunExecutor;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ops-exec-"));
  store = new FsRunStore({ rootDir: dir });
  executor = new LocalProcessRunExecutor({ store, cwd: process.cwd() });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function createRecord(argv: string[], env: Record<string, string> = {}) {
  return store.create({ spec: SPEC, argv, env, profileFingerprint: "f", experimental: false, workload: 1 });
}

describe("LocalProcessRunExecutor", () => {
  it("captures stdout to the log and maps exit code 0 to passed", async () => {
    const record = await createRecord(["bun", FAKE, "--emit", "hello", "--exit", "0"]);

    const finished = await executor.start(record);

    expect(finished.status).toBe("passed");
    expect(finished.exitCode).toBe(0);
    expect(await Bun.file(store.logPath(record.id)).text()).toContain("hello");
  });

  it("maps exit code 1 to regression", async () => {
    const record = await createRecord(["bun", FAKE, "--exit", "1"]);
    expect((await executor.start(record)).status).toBe("regression");
  });

  it("maps exit code 3 to insufficient-evidence", async () => {
    const record = await createRecord(["bun", FAKE, "--exit", "3"]);
    expect((await executor.start(record)).status).toBe("insufficient-evidence");
  });

  it("injects the profile environment into the child", async () => {
    const record = await createRecord(
      ["bun", "-e", "console.log(process.env.DISCOVERY_PROFILE_SOURCE ?? 'unset')"],
      { DISCOVERY_PROFILE_SOURCE: "user_context" },
    );

    await executor.start(record);

    expect(await Bun.file(store.logPath(record.id)).text()).toContain("user_context");
  });

  it("cancels a running child with SIGINT", async () => {
    const record = await createRecord(["bun", FAKE, "--sleep", "10000"]);
    const started = executor.start(record);
    await Bun.sleep(300);

    await executor.cancel(record.id);
    const finished = await started;

    expect(finished.status).toBe("cancelled");
  });
});
