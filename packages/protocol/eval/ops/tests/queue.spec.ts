import { describe, expect, it } from "bun:test";

import type { ExecutionStep, RunExecutor } from "../ops.executor.js";
import { EXCLUSIVE_HARNESSES, resolveConcurrency, RunQueue } from "../ops.queue.js";
import type { OpsHarness, RunRecord } from "../ops.types.js";

function record(id: string, harness: OpsHarness = "matching"): RunRecord {
  return {
    id,
    spec:
      harness === "discovery-ab"
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

const STORE = { update: async (id: string) => record(id) } as never;

describe("the single discovery-ab slot", () => {
  it("names the harnesses whose runs may never overlap, and why", () => {
    // eval-ab-a and eval-ab-b are one physical pair of Neon branches shared by
    // every discovery-ab run, and a run resets them; the scorecard harnesses
    // share nothing a second run of them could corrupt.
    const exclusive = Object.entries(EXCLUSIVE_HARNESSES).filter(([, reason]) => reason !== null);
    expect(exclusive.map(([harness]) => harness)).toEqual(["discovery-ab"]);
    // The reason is the refusal an operator reads, so it must say what is shared.
    expect(EXCLUSIVE_HARNESSES["discovery-ab"]).toMatch(/Neon/);
  });

  it("runs one discovery-ab at a time even when the queue is allowed three", async () => {
    const first = deferred();
    const second = deferred();
    const executor = spyExecutor(new Map([["ab-1", first.promise], ["ab-2", second.promise]]));
    const queue = new RunQueue({ executor, store: STORE, concurrency: 3 });

    queue.enqueue(record("ab-1", "discovery-ab"));
    queue.enqueue(record("ab-2", "discovery-ab"));
    await Bun.sleep(10);

    expect(executor.active).toEqual(["ab-1"]);
    first.release();
    await Bun.sleep(10);
    expect(executor.active).toEqual(["ab-2"]);

    second.release();
    await queue.drain();
    expect(executor.started).toEqual(["ab-1", "ab-2"]);
  });

  it("lets a scorecard run proceed while a discovery-ab run holds the slot", async () => {
    const held = deferred();
    const executor = spyExecutor(new Map([["ab-1", held.promise]]));
    const queue = new RunQueue({ executor, store: STORE, concurrency: 2 });

    queue.enqueue(record("ab-1", "discovery-ab"));
    queue.enqueue(record("ab-2", "discovery-ab"));
    queue.enqueue(record("matching-1", "matching"));
    await Bun.sleep(10);

    // The blocked discovery-ab run does not stall the queue behind it: the
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

    expect(queue.exclusiveConflict("discovery-ab")).toBeNull();

    queue.enqueue(record("ab-1", "discovery-ab"));
    queue.enqueue(record("matching-1", "matching"));
    await Bun.sleep(10);

    expect(queue.exclusiveConflict("discovery-ab")?.id).toBe("ab-1");
    // A second scorecard run of a harness already running is ordinary, not a conflict.
    expect(queue.exclusiveConflict("matching")).toBeNull();

    held.release();
    await queue.drain();
    expect(queue.exclusiveConflict("discovery-ab")).toBeNull();
  });

  it("still reports a queued discovery-ab run as holding the slot before it starts", async () => {
    const held = deferred();
    const executor = spyExecutor(new Map([["matching-1", held.promise]]));
    const queue = new RunQueue({ executor, store: STORE, concurrency: 1 });

    queue.enqueue(record("matching-1", "matching"));
    queue.enqueue(record("ab-1", "discovery-ab"));
    await Bun.sleep(10);

    // Not started yet, but it is spoken for: a launch route that ignored a
    // pending run would admit a second one that then ran back to back.
    expect(executor.started).toEqual(["matching-1"]);
    expect(queue.exclusiveConflict("discovery-ab")?.id).toBe("ab-1");

    held.release();
    await queue.drain();
  });

  it("hands the executor the step plan the run was enqueued with, and none when there is none", async () => {
    const executor = spyExecutor();
    const queue = new RunQueue({ executor, store: STORE, concurrency: 1 });
    const steps: ExecutionStep[] = [
      { label: "discovery-ab", argv: ["bun", "run", "eval:discovery-ab"], cwd: "/repo/services/api", env: { NEON_API_KEY: "k" } },
    ];

    queue.enqueue(record("matching-1", "matching"));
    queue.enqueue(record("ab-1", "discovery-ab"), steps);
    await queue.drain();

    expect(executor.plans[0]).toBeUndefined();
    expect(executor.plans[1]).toBe(steps);
  });
});
