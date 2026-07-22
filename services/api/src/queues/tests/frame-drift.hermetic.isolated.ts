import { afterAll, describe, expect, it, mock } from 'bun:test';

import { FrameDriftQueue } from '../frame-drift.queue';

const originalEnabled = process.env.FRAME_DRIFT_MONITORING_ENABLED;
const originalSchedule = process.env.FRAME_DRIFT_MONITORING_SCHEDULE;

afterAll(() => {
  if (originalEnabled === undefined) delete process.env.FRAME_DRIFT_MONITORING_ENABLED;
  else process.env.FRAME_DRIFT_MONITORING_ENABLED = originalEnabled;
  if (originalSchedule === undefined) delete process.env.FRAME_DRIFT_MONITORING_SCHEDULE;
  else process.env.FRAME_DRIFT_MONITORING_SCHEDULE = originalSchedule;
});

describe('FrameDriftQueue hermetic scheduler contract', () => {
  it('reconciles through QueueFactory and exposes an authoritative next timestamp', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    process.env.FRAME_DRIFT_MONITORING_SCHEDULE = '15 0 * * *';
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
