import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { timed, setTimingCallback, setTimingWrapper, Timed } from "../performance.js";

beforeEach(() => {
  setTimingCallback(undefined);
  setTimingWrapper(undefined);
});

afterEach(() => {
  setTimingCallback(undefined);
  setTimingWrapper(undefined);
});

describe("timed()", () => {
  it("returns the function's result", async () => {
    const result = await timed("test", async () => 42);
    expect(result).toBe(42);
  });

  it("re-throws errors from the wrapped function", async () => {
    const err = new Error("boom");
    await expect(timed("test", async () => { throw err; })).rejects.toThrow("boom");
  });

  it("calls the timing callback with the name and a positive durationMs on success", async () => {
    const calls: Array<{ name: string; durationMs: number }> = [];
    setTimingCallback((name, durationMs) => calls.push({ name, durationMs }));

    await timed("my-operation", async () => "value");

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("my-operation");
    expect(calls[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("calls the timing callback even when the function throws", async () => {
    const calls: Array<{ name: string; durationMs: number }> = [];
    setTimingCallback((name, durationMs) => calls.push({ name, durationMs }));

    await expect(timed("failing-op", async () => { throw new Error("fail"); })).rejects.toThrow();

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("failing-op");
    expect(calls[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("stops reporting after setTimingCallback(undefined)", async () => {
    const calls: Array<unknown> = [];
    setTimingCallback((name, durationMs) => calls.push({ name, durationMs }));
    setTimingCallback(undefined);

    await timed("silent-op", async () => "ok");

    expect(calls).toHaveLength(0);
  });

  it("runs through the timing wrapper when configured", async () => {
    const wrapped: string[] = [];
    setTimingWrapper(async (name, fn) => {
      wrapped.push(name);
      return fn();
    });

    const result = await timed("wrapped-op", async () => "ok");

    expect(result).toBe("ok");
    expect(wrapped).toEqual(["wrapped-op"]);
  });
});

describe("Timed() decorator", () => {
  it("measures timing and reports ClassName.methodName", async () => {
    const calls: Array<{ name: string; durationMs: number }> = [];
    setTimingCallback((name, durationMs) => calls.push({ name, durationMs }));

    class MyService {
      @Timed()
      async doWork(): Promise<string> {
        return "done";
      }
    }

    const svc = new MyService();
    const result = await svc.doWork();

    expect(result).toBe("done");
    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe("MyService.doWork");
    expect(calls[0].durationMs).toBeGreaterThanOrEqual(0);
  });
});
