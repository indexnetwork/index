import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createReadStream } from "node:fs";
import { appendFile, mkdir, mkdtemp, realpath, rm, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { LocalProcessRunExecutor, tailLog, type ExecutionStep } from "../ops.executor.js";
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

  it("runs an explicit step sequence in order, in each step's own directory and environment", async () => {
    const record = await createRecord([]);
    const steps: ExecutionStep[] = [
      { label: "flush", argv: ["bun", FAKE, "--emit", "flushed"], cwd: dir, env: { STEP_MARKER: "one" } },
      {
        label: "seed",
        argv: ["bun", "-e", "console.log(`seeded ${process.env.STEP_MARKER} in ${process.cwd()}`)"],
        cwd: dir,
        env: { STEP_MARKER: "two" },
      },
    ];

    const finished = await executor.start(record, steps);

    expect(finished.status).toBe("passed");
    const log = await Bun.file(store.logPath(record.id)).text();
    expect(log.indexOf("flushed")).toBeLessThan(log.indexOf("seeded"));
    expect(log).toContain("seeded two in");
    // The labels are in the log so a multi-step run reads back as a pipeline.
    expect(log).toContain("[eval-ops] flush:");
  });

  it("runs a single step in that step's own directory, not the executor's", async () => {
    // The registry gives discovery-ab a cwd of services/api, because its package
    // script and CLI live there and `bun run eval:discovery-ab` resolves nowhere
    // else. A step whose cwd were ignored would run the wrong package's scripts.
    const elsewhere = path.join(dir, "elsewhere");
    await mkdir(elsewhere);
    const record = await createRecord([]);

    const finished = await executor.start(record, [
      { label: "discovery-ab", argv: ["bun", "-e", "console.log(`ran in ${process.cwd()}`)"], cwd: elsewhere, env: {} },
    ]);

    expect(finished.status).toBe("passed");
    const log = await Bun.file(store.logPath(record.id)).text();
    expect(log.trim()).toBe(`ran in ${await realpath(elsewhere)}`);
    expect(log).not.toContain(await realpath(process.cwd()));
  });

  it("keeps the harness exit-code contract for a one-step plan", async () => {
    // A harness run given a step is still one command, so exit 1 is a regression
    // rather than the coarse pass/fail a multi-command pipeline reports.
    const record = await createRecord([]);

    const finished = await executor.start(record, [
      { label: "discovery-ab", argv: ["bun", FAKE, "--exit", "1"], cwd: dir, env: {} },
    ]);

    expect(finished.status).toBe("regression");
  });

  it("gives a step's environment to the child without writing it to the log", async () => {
    // discovery-ab's gate demands NEON_API_KEY, and the log is streamed to a
    // browser and kept on disk: the value must reach the child and nothing else.
    const record = await createRecord([]);

    await executor.start(record, [
      {
        label: "discovery-ab",
        argv: ["bun", "-e", "console.log(`key length ${(process.env.NEON_API_KEY ?? '').length}`)"],
        cwd: dir,
        env: { NEON_API_KEY: "napi-secret-value" },
      },
    ]);

    const log = await Bun.file(store.logPath(record.id)).text();
    expect(log).toContain(`key length ${"napi-secret-value".length}`);
    expect(log).not.toContain("napi-secret-value");
  });

  it("stops a step sequence at the first failure and reports execution-error", async () => {
    const record = await createRecord([]);
    const steps: ExecutionStep[] = [
      { label: "flush", argv: ["bun", FAKE, "--emit", "flushed", "--exit", "1"], cwd: dir, env: {} },
      { label: "seed", argv: ["bun", FAKE, "--emit", "seeded"], cwd: dir, env: {} },
    ];

    const finished = await executor.start(record, steps);

    // The harness exit-code contract does not apply to a pipeline of CLIs: a failed
    // flush is an execution error, not a "regression".
    expect(finished.status).toBe("execution-error");
    expect(finished.exitCode).toBe(1);
    expect(await Bun.file(store.logPath(record.id)).text()).not.toContain("seeded");
  });

  it("does not spawn a step when the cancel lands during that step's label write", async () => {
    // The window this closes: cancel() arriving between the loop's check and the
    // spawn sets `cancelled` while entry.proc is still null, so its kill hits
    // nothing. If the step were the flush, the operator's cancel would leave the
    // test database flushed and unseeded. A FIFO nobody is draining holds the
    // label write open for exactly that window, with no timing guesswork.
    const fifo = path.join(dir, "log.fifo");
    expect(Bun.spawnSync(["mkfifo", fifo]).exitCode).toBe(0);
    const marker = path.join(dir, "step-ran");
    const fifoStore: RunStore = { ...delegateTo(store), logPath: () => fifo };
    const fifoExecutor = new LocalProcessRunExecutor({ store: fifoStore, cwd: dir });
    const record = await createRecord([]);
    const steps: ExecutionStep[] = [
      {
        // Larger than the pipe buffer, so the write cannot complete until the test reads.
        label: "x".repeat(1_000_000),
        argv: ["bun", "-e", `await Bun.write(${JSON.stringify(marker)}, "ran")`],
        cwd: dir,
        env: {},
      },
      { label: "second", argv: ["bun", FAKE, "--emit", "second"], cwd: dir, env: {} },
    ];

    const started = fifoExecutor.start(record, steps);
    // Opening the read end releases the executor's open(fifo, "w"); a paused stream
    // reads nothing, so the label write blocks with the run already registered.
    const reader = createReadStream(fifo);
    await Bun.sleep(50);

    const cancelled = fifoExecutor.cancel(record.id);
    reader.resume();

    expect((await started).status).toBe("cancelled");
    expect((await cancelled).status).toBe("cancelled");
    expect(await Bun.file(marker).exists()).toBe(false);
    reader.destroy();
  });

  it("refuses a run with no command to execute", async () => {
    const record = await createRecord([]);
    await expect(executor.start(record)).rejects.toThrow(/no command/i);
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
