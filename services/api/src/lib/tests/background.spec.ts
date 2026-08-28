/**
 * Unit tests for background(): fire-and-forget execution, retry/backoff, and
 * that a failure never escapes to the caller.
 */
import { describe, expect, it } from 'bun:test';

import { background } from '../background';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('background', () => {
  it('returns immediately without waiting for fn to settle', () => {
    let resolveFn: (() => void) | undefined;
    const fn = () => new Promise<void>((resolve) => { resolveFn = resolve; });
    const result = background('test', fn);
    expect(result).toBeUndefined();
    resolveFn?.();
  });

  it('runs fn once and does not retry on success', async () => {
    let calls = 0;
    background('test', async () => { calls += 1; });
    await sleep(10);
    expect(calls).toBe(1);
  });

  it('retries with exponential backoff and succeeds on a later attempt', async () => {
    let calls = 0;
    background('test', async () => {
      calls += 1;
      if (calls < 2) throw new Error('transient');
    }, { retries: 1 });
    // First attempt fails immediately; the 1s backoff must elapse before the retry runs.
    await sleep(50);
    expect(calls).toBe(1);
    await sleep(1100);
    expect(calls).toBe(2);
  });

  it('gives up after exhausting retries; the failure never escapes to the caller', async () => {
    let calls = 0;
    expect(() => {
      background('test', async () => {
        calls += 1;
        throw new Error('permanent');
      }, { retries: 1 });
    }).not.toThrow();
    await sleep(1200);
    // Initial attempt + one retry, then it stops.
    expect(calls).toBe(2);
  });

  it('never retries by default', async () => {
    let calls = 0;
    background('test', async () => {
      calls += 1;
      throw new Error('fails once');
    });
    await sleep(1100);
    expect(calls).toBe(1);
  });
});
