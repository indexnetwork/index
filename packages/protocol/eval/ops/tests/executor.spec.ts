import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { appendFile, mkdtemp, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { LocalProcessRunExecutor, tailLog } from "../ops.executor.js";
import { FsRunStore, type RunStore } from "../ops.store.js";
import type { RunRecord, RunSpec } from "../ops.types.js";

const SPEC: RunSpec = { kind: "eval", harness: "matching", profile: "default", flags: {} };
const FAKE = path.join(import.meta.dir, "fake-harness.ts");

let dir: string;
let store: FsRunStore;
let executor: LocalProcessRunExecutor;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "ops-exec-"));
  store = new FsRunStore({ evalDir: dir });
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

    const cancelled = await executor.cancel(record.id);
    const finished = await started;

    expect(finished.status).toBe("cancelled");
    // cancel() must report the settled record: a "running" answer would tell the UI nothing happened.
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.endedAt).not.toBeNull();
  });

  it("records the report path relative to eval/ when the harness writes one", async () => {
    const created = await createRecord(["bun", FAKE, "--emit", "reporting"]);
    const record = await store.update(created.id, {
      argv: [...created.argv, "--report", store.reportPath(created.id)],
    });

    const finished = await executor.start(record);

    expect(finished.artifactPath).toBe(path.join(".ops-runs", created.id, "report.json"));
  });

  it("leaves the report path null when the harness writes no report", async () => {
    const record = await createRecord(["bun", FAKE, "--exit", "0"]);

    expect((await executor.start(record)).artifactPath).toBeNull();
  });

  it("does not relabel a run that already exited as cancelled", async () => {
    // Hold the terminal update open so cancel() lands in the window between the child
    // exiting and start() finishing its bookkeeping.
    let reachedTerminalUpdate!: () => void;
    const atTerminalUpdate = new Promise<void>((resolve) => {
      reachedTerminalUpdate = resolve;
    });
    let releaseTerminalUpdate!: () => void;
    const terminalUpdateReleased = new Promise<void>((resolve) => {
      releaseTerminalUpdate = resolve;
    });
    let updates = 0;
    const gated: RunStore = {
      ...delegateTo(store),
      update: async (id: string, patch: Partial<RunRecord>) => {
        updates += 1;
        if (updates === 2) {
          reachedTerminalUpdate();
          await terminalUpdateReleased;
        }
        return store.update(id, patch);
      },
    };
    const gatedExecutor = new LocalProcessRunExecutor({ store: gated, cwd: process.cwd() });
    const record = await createRecord(["bun", FAKE, "--emit", "done", "--exit", "0"]);

    const started = gatedExecutor.start(record);
    await atTerminalUpdate;
    const cancelled = gatedExecutor.cancel(record.id);
    releaseTerminalUpdate();

    expect((await cancelled).status).toBe("passed");
    expect((await started).status).toBe("passed");
  });
});

/** Forwards every RunStore method to `inner`, so a test only overrides what it cares about. */
function delegateTo(inner: RunStore): RunStore {
  return {
    create: (input) => inner.create(input),
    update: (id, patch) => inner.update(id, patch),
    get: (id) => inner.get(id),
    list: () => inner.list(),
    logPath: (id) => inner.logPath(id),
    reportPath: (id) => inner.reportPath(id),
    artifactPathFor: (id) => inner.artifactPathFor(id),
    reconcile: () => inner.reconcile(),
  };
}

describe("tailLog", () => {
  let logPath: string;
  let controller: AbortController;

  beforeEach(() => {
    logPath = path.join(dir, "tail.log");
    controller = new AbortController();
  });

  afterEach(() => {
    controller.abort();
  });

  it("replays what was already written before following new output", async () => {
    await Bun.write(logPath, "already here\n");

    const iterator = tailLog(logPath, controller.signal)[Symbol.asyncIterator]();
    const first = await iterator.next();

    expect(first.value).toBe("already here\n");
    await iterator.return?.(undefined);
  });

  it("follows appended output on an initially empty log", async () => {
    await Bun.write(logPath, "");
    const iterator = tailLog(logPath, controller.signal)[Symbol.asyncIterator]();

    const pending = iterator.next();
    await Bun.sleep(20);
    await appendFile(logPath, "appended later\n");

    expect((await pending).value).toBe("appended later\n");
    await iterator.return?.(undefined);
  });

  it("yields bytes written before an abort and then returns promptly", async () => {
    await Bun.write(logPath, "pre-abort\n");
    const iterator = tailLog(logPath, controller.signal)[Symbol.asyncIterator]();
    controller.abort();

    const startedAt = Date.now();
    const first = await iterator.next();
    const second = await iterator.next();

    expect(first.value).toBe("pre-abort\n");
    expect(second.done).toBe(true);
    expect(Date.now() - startedAt).toBeLessThan(150);
  });

  it("keeps a multi-byte character intact across a poll boundary", async () => {
    // Scorecards emit ✅ and box-drawing characters; a naive per-slice decode mangles them.
    const encoded = new TextEncoder().encode("a✅b\n");
    await Bun.write(logPath, encoded.slice(0, 2));
    const iterator = tailLog(logPath, controller.signal)[Symbol.asyncIterator]();

    const first = await iterator.next();
    await appendFile(logPath, Buffer.from(encoded.slice(2)));
    const second = await iterator.next();

    expect(first.value).toBe("a");
    expect(second.value).toBe("✅b\n");
    expect(`${first.value}${second.value}`).not.toContain("\uFFFD");
    await iterator.return?.(undefined);
  });

  it("resumes from the top when the log is truncated", async () => {
    await Bun.write(logPath, "first generation\n");
    const iterator = tailLog(logPath, controller.signal)[Symbol.asyncIterator]();
    await iterator.next();

    await truncate(logPath, 0);
    await appendFile(logPath, "restarted\n");

    expect((await iterator.next()).value).toBe("restarted\n");
    await iterator.return?.(undefined);
  });
});
