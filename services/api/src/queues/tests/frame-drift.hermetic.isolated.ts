import { describe, expect, it, mock } from 'bun:test';

import { FrameDriftQueue } from '../frame-drift.queue';

describe('FrameDriftQueue hermetic scheduler contract', () => {
  it('reconciles through QueueFactory and exposes an authoritative next timestamp', async () => {
    const info = mock(() => undefined);
    const queue = new FrameDriftQueue({
      createWorker: () => ({ close: async () => undefined }),
      service: { captureDailyBucket: mock(async () => ({})) } as never,
      attemptStore: {
        recordStarted: mock(async () => ({ recordStatus: 'inserted', terminalStatus: null })),
        recordTerminal: mock(async () => 'updated'),
      },
      logger: { info, error: mock(() => undefined) },
      sleep: async () => undefined,
    });

    await queue.start();

    const scheduled = info.mock.calls.find(
      (call) => (call[1] as { event?: string } | undefined)?.event === 'frame_drift_monitoring_scheduled',
    );
    const nextScheduledAt = (scheduled?.[1] as { nextScheduledAt?: string } | undefined)
      ?.nextScheduledAt;
    expect(nextScheduledAt).toBeDefined();
    expect(Number.isFinite(Date.parse(nextScheduledAt!))).toBe(true);
    await queue.close();
  });
});
