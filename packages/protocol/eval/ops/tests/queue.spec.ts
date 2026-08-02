import { describe, expect, it } from "bun:test";

import { resolveConcurrency, RunQueue } from "../ops.queue.js";
import type { RunRecord } from "../ops.types.js";

function record(id: string): RunRecord {
  return {
    id,
    spec: { kind: "eval", harness: "matching", profile: "default", flags: {} },
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
