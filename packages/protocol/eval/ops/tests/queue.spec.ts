import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { ExecutionStep, RunExecutor } from "../ops.executor.js";
import { EXCLUSIVE_HARNESSES, resolveConcurrency, RunQueue } from "../ops.queue.js";
import type { OpsHarness, RunRecord, RunStatus } from "../ops.types.js";

/** The engine module that designates the two branches every A/B run shares. */
const AB_NEON_SOURCE = path.join(
  import.meta.dir, "..", "..", "..", "..", "..",
  "services", "api", "src", "cli", "discovery.neon.ts",
);

const QUEUE_SOURCE = path.join(import.meta.dir, "..", "ops.queue.ts");

function record(id: string, harness: OpsHarness = "matching"): RunRecord {
  return {
    id,
    spec:
      harness === "discovery"
        ? {
            kind: "eval",
            harness,
            profile: "default",
            flags: {},
            sides: { a: { DISCOVERY_PROFILE_SOURCE: "premise" }, b: { DISCOVERY_PROFILE_SOURCE: "user_context" } },
          }
        : { kind: "eval", harness, profile: "default", flags: {} },
    argv: [],
    env: {},
    profileFingerprint: "f",
    experimental: false,
    status: "queued",
    createdAt: new Date().toISOString(),
    startedAt: null,
    endedAt: null,
    exitCode: null,
    pid: null,
    artifactPath: null,
    workload: 1,
  };
}

describe("resolveConcurrency", () => {
  it("defaults to 1", () => {
    expect(resolveConcurrency({})).toBe(1);
  });

  it("honours a valid override", () => {
    expect(resolveConcurrency({ EVAL_OPS_MAX_CONCURRENT_RUNS: "3" })).toBe(3);
  });

  it("falls back to 1 for a nonsense value", () => {
    expect(resolveConcurrency({ EVAL_OPS_MAX_CONCURRENT_RUNS: "banana" })).toBe(1);
    expect(resolveConcurrency({ EVAL_OPS_MAX_CONCURRENT_RUNS: "0" })).toBe(1);
  });
});

describe("RunQueue", () => {
  it("runs one at a time by default", async () => {
    let active = 0;
    let maxActive = 0;
    const executor = {
      async start(input: RunRecord) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Bun.sleep(20);
        active -= 1;
        return { ...input, status: "passed" as const };
      },
      async cancel(_id: string) {
        throw new Error("not used");
      },
    };
    const queue = new RunQueue({ executor, store: { update: async () => record("x") } as never });

    queue.enqueue(record("a"));
    queue.enqueue(record("b"));
    queue.enqueue(record("c"));
    await queue.drain();

    expect(maxActive).toBe(1);
  });

  it("keeps draining after a run throws", async () => {
    const started: string[] = [];
    const executor = {
      async start(input: RunRecord) {
        started.push(input.id);
        if (input.id === "a") throw new Error("boom");
        return { ...input, status: "passed" as const };
      },
      async cancel(_id: string) {
        throw new Error("not used");
      },
    };
    const updates: string[] = [];
    const queue = new RunQueue({
      executor,
      store: { update: async (id: string) => { updates.push(id); return record(id); } } as never,
    });

    queue.enqueue(record("a"));
    queue.enqueue(record("b"));
    await queue.drain();

    expect(started).toEqual(["a", "b"]);
    expect(updates).toContain("a");
  });
});

/** A promise a test resolves by hand, so a run is "in flight" for exactly as long as it wants. */
function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

interface SpyExecutor extends RunExecutor {
  /** Ids that are inside start() right now, in the order they entered. */
  readonly active: string[];
  /** Every id start() was called with, in order. */
  readonly started: string[];
  /** The step plan each start() was handed, aligned with `started`. */
  readonly plans: (readonly ExecutionStep[] | undefined)[];
}

/** Holds a run inside start() until its deferred is released; unheld runs settle at once. */
function spyExecutor(holds: Map<string, Promise<void>> = new Map()): SpyExecutor {
  const active: string[] = [];
  const started: string[] = [];
  const plans: (readonly ExecutionStep[] | undefined)[] = [];
  return {
    active,
    started,
    plans,
    async start(input: RunRecord, steps?: readonly ExecutionStep[]) {
      started.push(input.id);
      plans.push(steps);
      active.push(input.id);
      await (holds.get(input.id) ?? Promise.resolve());
      active.splice(active.indexOf(input.id), 1);
      return { ...input, status: "passed" as const };
    },
    async cancel(_id: string) {
      throw new Error("not used");
    },
  };
}

/** A store holding nothing: the posture of a server that has just started clean. */
const STORE = {
  update: async (id: string) => record(id),
  list: async () => ({ records: [], issues: [] }),
} as never;

/** A store holding exactly the records a test hands it, as a restarted server would find them. */
function storeHolding(...records: RunRecord[]): never {
  return { update: async (id: string) => record(id), list: async () => ({ records, issues: [] }) } as never;
}

/** A record as a *previous* process left it behind: a status and the pid it was running as. */
function orphan(id: string, status: RunStatus, pid: number | null, harness: OpsHarness = "discovery"): RunRecord {
  return { ...record(id, harness), status, pid, startedAt: new Date().toISOString() };
}

describe("the single discovery slot", () => {
  it("names the harnesses whose runs may never overlap", () => {
    // The scorecard harnesses read a fixture and write their own artifact, so a
    // second run of one of them corrupts nothing; discovery resets two shared
    // branches. A harness added later must answer here rather than inherit "safe".
    const exclusive = Object.entries(EXCLUSIVE_HARNESSES).filter(([, reason]) => reason !== null);
    expect(exclusive.map(([harness]) => harness)).toEqual(["discovery"]);
  });

  it("pins the branches the rule is about to the ones the engine actually designates", () => {
    // The rule exists because two runs would reset one physical pair of branches.
    // Which pair is AB_BRANCH_NAMES' answer, not this module's, and the comment
    // that explains the rule names them — so a rename in the engine must fail
    // here rather than leave this file explaining a rule about branches that no
    // longer exist. Read from source rather than imported: discovery.neon.ts
    // reaches node: APIs that this provider-free suite must not load, which is the
    // same reason argv.spec.ts reads AB_FLAGS and registry.spec.ts reads
    // AB_MAX_REPETITIONS as text.
    const source = readFileSync(AB_NEON_SOURCE, "utf8");
    const literal = source.match(/export const AB_BRANCH_NAMES = \{([^}]*)\}/);
    if (!literal) throw new Error(`AB_BRANCH_NAMES not found in ${AB_NEON_SOURCE}`);
    const branches = [...literal[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);

    // Guards the pin against passing vacuously on an unparsed match.
    expect(branches).toHaveLength(2);
    const queueSource = readFileSync(QUEUE_SOURCE, "utf8");
    // Compared as a list rather than one `toContain` per branch, so a rename
    // reports the names that went missing instead of printing the whole module.
    expect(branches.filter((branch) => queueSource.includes(branch))).toEqual(branches);

    // And the refusal an operator reads must say what is shared, since it is the
    // only explanation they get for a 409 on a harness they just launched once.
    expect(EXCLUSIVE_HARNESSES["discovery"]).toMatch(/Neon/);
    expect(EXCLUSIVE_HARNESSES["discovery"]).toMatch(/reset/);
  });

  it("runs one discovery at a time even when the queue is allowed three", async () => {
    const first = deferred();
    const second = deferred();
    const executor = spyExecutor(new Map([["ab-1", first.promise], ["ab-2", second.promise]]));
    const queue = new RunQueue({ executor, store: STORE, concurrency: 3 });

    queue.enqueue(record("ab-1", "discovery"));
    queue.enqueue(record("ab-2", "discovery"));
    await Bun.sleep(10);

    expect(executor.active).toEqual(["ab-1"]);
    first.release();
    await Bun.sleep(10);
    expect(executor.active).toEqual(["ab-2"]);

    second.release();
    await queue.drain();
    expect(executor.started).toEqual(["ab-1", "ab-2"]);
  });

  it("lets a scorecard run proceed while a discovery run holds the slot", async () => {
    const held = deferred();
    const executor = spyExecutor(new Map([["ab-1", held.promise]]));
    const queue = new RunQueue({ executor, store: STORE, concurrency: 2 });

    queue.enqueue(record("ab-1", "discovery"));
    queue.enqueue(record("ab-2", "discovery"));
    queue.enqueue(record("matching-1", "matching"));
    await Bun.sleep(10);

    // The blocked discovery run does not stall the queue behind it: the
    // scorecard run shares nothing with it and runs alongside.
    expect(executor.started).toEqual(["ab-1", "matching-1"]);
    expect(executor.active).toEqual(["ab-1"]);

    held.release();
    await queue.drain();
    expect(executor.started).toEqual(["ab-1", "matching-1", "ab-2"]);
  });

  it("names the run holding the slot, and nothing for a harness that has none", async () => {
    const held = deferred();
    const executor = spyExecutor(new Map([["ab-1", held.promise], ["matching-1", held.promise]]));
    const queue = new RunQueue({ executor, store: STORE, concurrency: 2 });

    expect(await queue.exclusiveConflict("discovery")).toBeNull();

    queue.enqueue(record("ab-1", "discovery"));
    queue.enqueue(record("matching-1", "matching"));
    await Bun.sleep(10);

    expect((await queue.exclusiveConflict("discovery"))?.id).toBe("ab-1");
    // A second scorecard run of a harness already running is ordinary, not a conflict.
    expect(await queue.exclusiveConflict("matching")).toBeNull();

    held.release();
    await queue.drain();
    expect(await queue.exclusiveConflict("discovery")).toBeNull();
  });

  it("still reports a queued discovery run as holding the slot before it starts", async () => {
    const held = deferred();
    const executor = spyExecutor(new Map([["matching-1", held.promise]]));
    const queue = new RunQueue({ executor, store: STORE, concurrency: 1 });

    queue.enqueue(record("matching-1", "matching"));
    queue.enqueue(record("ab-1", "discovery"));
    await Bun.sleep(10);

    // Not started yet, but it is spoken for: a launch route that ignored a
    // pending run would admit a second one that then ran back to back.
    expect(executor.started).toEqual(["matching-1"]);
    expect((await queue.exclusiveConflict("discovery"))?.id).toBe("ab-1");
    // The same run, seen without touching the store: this is the check the launch
    // route makes with no await in it, immediately before enqueuing.
    expect(queue.inProcessConflict("discovery")?.id).toBe("ab-1");

    held.release();
    await queue.drain();
  });

  it("survives the restart of the process that granted it", async () => {
    // The scenario, exactly: the ops server restarts (the deployed service is
    // ON_FAILURE) while a ~13-minute child keeps running — nothing killed it, its
    // parent simply went away. The new process's queue is empty and its maps know
    // nothing. Only the record on disk survived, and it still names a live pid.
    const running = orphan("ab-before-restart", "running", process.pid);
    const rebuilt = new RunQueue({ executor: spyExecutor(), store: storeHolding(running), concurrency: 3 });

    expect((await rebuilt.exclusiveConflict("discovery"))?.id).toBe("ab-before-restart");
    // Memory alone — what the rule used to consult — sees nothing at all, which is
    // precisely how a second launch used to be admitted.
    expect(rebuilt.inProcessConflict("discovery")).toBeNull();
  });

  it("does not let a record whose process is gone block the harness forever", async () => {
    // The other restart: the container was replaced, so the child died with it.
    // A `running` record with a dead pid is what that leaves, and refusing on it
    // would make discovery unlaunchable until someone deleted a file.
    const proc = Bun.spawn({ cmd: ["true"], stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    const dead = orphan("ab-killed-with-its-container", "running", proc.pid);
    const rebuilt = new RunQueue({ executor: spyExecutor(), store: storeHolding(dead) });

    expect(await rebuilt.exclusiveConflict("discovery")).toBeNull();
  });

  it("ignores stored records that are finished, pidless, or another harness's", async () => {
    const proc = Bun.spawn({ cmd: ["true"], stdout: "ignore", stderr: "ignore" });
    await proc.exited;
    const rebuilt = new RunQueue({
      executor: spyExecutor(),
      store: storeHolding(
        // Every terminal status is already final; a finished run holds nothing.
        orphan("ab-passed", "passed", process.pid),
        orphan("ab-interrupted", "interrupted", process.pid),
        orphan("ab-cancelled", "cancelled", process.pid),
        // Never started, so it never held two branches. Either this process is
        // about to enqueue it (inProcessConflict reports it a moment later, and
        // the route's own re-check separates two racing launches), or a dead
        // process left it and reconcile() marks it interrupted at the next start.
        orphan("ab-queued-no-pid", "queued", null),
        // A live scorecard run is not a conflict for anyone.
        orphan("matching-running", "running", process.pid, "matching"),
      ),
    });

    expect(await rebuilt.exclusiveConflict("discovery")).toBeNull();
    expect(await rebuilt.exclusiveConflict("matching")).toBeNull();
  });

  it("asks the store exactly the liveness question reconcile asks", async () => {
    // One probe, injected the way FsRunStore injects it. A record must not be
    // alive enough to survive reconcile and dead enough to be launched over.
    const LIVE_PID = 99999;
    const asked: number[] = [];
    const rebuilt = new RunQueue({
      executor: spyExecutor(),
      store: storeHolding(orphan("ab-live", "running", LIVE_PID)),
      isProcessAlive: (pid) => {
        asked.push(pid);
        return pid === LIVE_PID;
      },
    });

    expect((await rebuilt.exclusiveConflict("discovery"))?.id).toBe("ab-live");
    // The pid it consulted is the record's own, not a stand-in.
    expect(asked).toEqual([LIVE_PID]);
  });

  it("never reads the store for a harness that has no slot", async () => {
    // The four scorecard harnesses are launched constantly; asking the filesystem
    // on every launch to answer a question whose answer is always null is work
    // this rule has no business doing.
    let listed = 0;
    const rebuilt = new RunQueue({
      executor: spyExecutor(),
      store: { update: async (id: string) => record(id), list: async () => { listed += 1; return { records: [], issues: [] }; } } as never,
    });

    expect(await rebuilt.exclusiveConflict("matching")).toBeNull();
    expect(listed).toBe(0);
    expect(await rebuilt.exclusiveConflict("discovery")).toBeNull();
    expect(listed).toBe(1);
  });

  it("hands the executor the step plan the run was enqueued with, and none when there is none", async () => {
    const executor = spyExecutor();
    const queue = new RunQueue({ executor, store: STORE, concurrency: 1 });
    const steps: ExecutionStep[] = [
      { label: "discovery", argv: ["bun", "run", "eval:discovery"], cwd: "/repo/services/api", env: { NEON_API_KEY: "k" } },
    ];

    queue.enqueue(record("matching-1", "matching"));
    queue.enqueue(record("ab-1", "discovery"), steps);
    await queue.drain();

    expect(executor.plans[0]).toBeUndefined();
    expect(executor.plans[1]).toBe(steps);
  });
});
