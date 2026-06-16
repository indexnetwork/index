import { describe, it, expect } from "bun:test";

import { repeatRuns } from "../runner.js";

describe("repeatRuns", () => {
  it("invokes exactly `runs` times and collects outputs in order", async () => {
    let n = 0;
    const out = await repeatRuns(async () => ++n, 3);
    expect(out).toEqual([1, 2, 3]);
  });

  it("retries transient failures up to maxAttempts then succeeds", async () => {
    let attempts = 0;
    const out = await repeatRuns(
      async () => {
        attempts++;
        if (attempts < 3) throw new Error("transient");
        return "ok";
      },
      1,
      { maxAttempts: 3, retryDelayMs: 1 },
    );
    expect(out).toEqual(["ok"]);
    expect(attempts).toBe(3);
  });

  it("throws the last error after exhausting attempts", async () => {
    let attempts = 0;
    await expect(
      repeatRuns(
        async () => {
          attempts++;
          throw new Error(`fail-${attempts}`);
        },
        1,
        { maxAttempts: 2, retryDelayMs: 1 },
      ),
    ).rejects.toThrow("fail-2");
    expect(attempts).toBe(2);
  });
});
