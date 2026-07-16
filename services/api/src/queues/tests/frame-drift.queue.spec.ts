import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Job } from 'bullmq';

const mockFactoryQueue = {
  upsertJobScheduler: mock(async () => ({})),
  removeJobScheduler: mock(async () => true),
  close: mock(async () => undefined),
};
const mockFactoryWorker = { close: mock(async () => undefined) };
const mockCreateFactoryWorker = mock(() => mockFactoryWorker);

mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => mockFactoryQueue,
    createWorker: mockCreateFactoryWorker,
  },
}));

afterAll(() => mock.restore());

import { deriveMostRecentlyClosedUtcDay, FRAME_DRIFT_JOB_NAME, FRAME_DRIFT_SCHEDULER_ID, FrameDriftQueue, type FrameDriftJobData, type FrameDriftQueueDeps } from '../frame-drift.queue';

const ENV_KEYS = [
  'FRAME_DRIFT_MONITORING_ENABLED',
  'FRAME_DRIFT_MONITORING_SCHEDULE',
] as const;
const savedEnv: Record<string, string | undefined> = {};

function createHarness() {
  const upsertJobScheduler = mock(async () => ({}));
  const removeJobScheduler = mock(async () => true);
  const closeQueue = mock(async () => undefined);
  const closeWorker = mock(async () => undefined);
  let processor: ((job: Job<FrameDriftJobData>) => Promise<void>) | undefined;
  const createWorker = mock((handler: (job: Job<FrameDriftJobData>) => Promise<void>) => {
    processor = handler;
    return { close: closeWorker };
  });
  const captureDailyBucket = mock(async () => ({
    centroidSnapshotCount: 0,
    yieldSnapshotCount: 0,
    invalidVectorCount: 0,
    networksTruncated: false,
    pairsTruncated: false,
    durationMs: 0,
  }));
  const deps: FrameDriftQueueDeps = {
    queue: {
      upsertJobScheduler,
      removeJobScheduler,
      close: closeQueue,
    } as unknown as NonNullable<FrameDriftQueueDeps['queue']>,
    createWorker,
    service: { captureDailyBucket },
  };
  return {
    queue: new FrameDriftQueue(deps),
    upsertJobScheduler,
    removeJobScheduler,
    closeQueue,
    closeWorker,
    createWorker,
    captureDailyBucket,
    getProcessor: () => processor,
  };
}

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('deriveMostRecentlyClosedUtcDay', () => {
  it('derives UTC boundaries across a month boundary', () => {
    const bucket = deriveMostRecentlyClosedUtcDay(Date.parse('2026-03-01T00:15:00.000Z'));
    expect(bucket.bucketStart.toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(bucket.bucketEnd.toISOString()).toBe('2026-03-01T00:00:00.000Z');
  });
});

describe('FrameDriftQueue', () => {
  it('upserts one stable UTC scheduler and starts one worker when enabled', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    process.env.FRAME_DRIFT_MONITORING_SCHEDULE = '30 1 * * *';
    const harness = createHarness();

    await harness.queue.start();
    await harness.queue.start();

    expect(harness.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(harness.upsertJobScheduler).toHaveBeenCalledWith(
      FRAME_DRIFT_SCHEDULER_ID,
      { pattern: '30 1 * * *', tz: 'UTC' },
      expect.objectContaining({
        name: FRAME_DRIFT_JOB_NAME,
        data: { source: 'daily-scheduler' },
        opts: expect.objectContaining({ attempts: 3 }),
      }),
    );
    expect(harness.createWorker).toHaveBeenCalledTimes(1);
  });

  it('removes a prior scheduler and does not create a worker when disabled', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'false';
    const harness = createHarness();

    await harness.queue.start();

    expect(harness.removeJobScheduler).toHaveBeenCalledWith(FRAME_DRIFT_SCHEDULER_ID);
    expect(harness.upsertJobScheduler).not.toHaveBeenCalled();
    expect(harness.createWorker).not.toHaveBeenCalled();
  });

  it('prefers prevMillis, derives the closed bucket, and delegates', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    await harness.queue.start();
    const processor = harness.getProcessor();
    expect(processor).toBeDefined();

    await processor?.({
      opts: { prevMillis: Date.parse('2026-07-15T00:15:00Z') },
      timestamp: Date.parse('2026-01-01T00:15:00Z'),
    } as Job<FrameDriftJobData>);

    expect(harness.captureDailyBucket).toHaveBeenCalledWith(
      new Date('2026-07-14T00:00:00.000Z'),
      new Date('2026-07-15T00:00:00.000Z'),
    );
  });

  it('propagates service failures so BullMQ can retry', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    harness.captureDailyBucket.mockImplementationOnce(async () => {
      throw new Error('database unavailable');
    });
    await harness.queue.start();
    const processor = harness.getProcessor();

    await expect(processor?.({
      opts: { prevMillis: Date.parse('2026-07-15T00:15:00Z') },
      timestamp: Date.parse('2026-07-15T00:15:00Z'),
    } as Job<FrameDriftJobData>)).rejects.toThrow('database unavailable');
  });

  it('gracefully closes worker and queue and is idempotent', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    await harness.queue.start();

    await harness.queue.close();
    await harness.queue.close();

    expect(harness.closeWorker).toHaveBeenCalledTimes(1);
    expect(harness.closeQueue).toHaveBeenCalledTimes(1);
  });
});
