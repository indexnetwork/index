import { describe, expect, it } from 'bun:test';

import { runBoundedChild } from '../isolated-test-runner';

describe('isolated child termination', () => {
  it('escalates a SIGTERM-resistant child to SIGKILL within a bounded grace period', async () => {
    const startedAt = Date.now();
    const result = await runBoundedChild(
      [
        'bun',
        '-e',
        "process.on('SIGTERM', () => {}); setInterval(() => {}, 1_000);",
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env },
        timeoutMs: 50,
        terminationGraceMs: 100,
      },
    );

    expect(result.timedOut).toBe(true);
    expect(result.exitCode).not.toBe(0);
    expect(Date.now() - startedAt).toBeLessThan(1_000);
  });
});
