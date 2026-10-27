import { describe, expect, test } from "bun:test";

import { Semaphore } from "./semaphore.ts";

describe("semaphore", () => {
  test("never admits more than the limit, even at handoff", async () => {
    const semaphore = new Semaphore(1);
    let active = 0;
    let peak = 0;
    const work = () => semaphore.run(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
    });
    await Promise.all([work(), work(), work()]);
    expect(peak).toBe(1);
  });
});
