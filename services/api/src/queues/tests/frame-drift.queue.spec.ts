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

function makeJob(overrides: Partial<Job<FrameDriftJobData>> = {}): Job<FrameDriftJobData> {
  return {
    id: 'job-123',
    data: { source: 'daily-scheduler' },
    opts: { prevMillis: Date.parse('2026-07-15T00:15:00Z'), attempts: 3 },
    timestamp: Date.parse('2026-01-01T00:15:00Z'),
    attemptsMade: 1,
    ...overrides,
  } as Job<FrameDriftJobData>;
}

function createHarness() {
  const upsertJobScheduler = mock(async () => ({}));
  const removeJobScheduler = mock(async () => true);
  const closeQueue = mock(async () => undefined);
  const closeWorker = mock(async () => undefined);
  const info = mock(() => undefined);
  const error = mock(() => undefined);
  const sleep = mock(async (_delayMs: number) => undefined);
  let processor: ((job: Job<FrameDriftJobData>) => Promise<void>) | undefined;
  const createWorker = mock((handler: (job: Job<FrameDriftJobData>) => Promise<void>) => {
    processor = handler;
    return { close: closeWorker };
  });
  const captureDailyBucket = mock(async () => ({
    observationStatus: 'inserted' as const,
    centroidSnapshotCount: 0,
    yieldProxySnapshotCount: 0,
    capturedAt: new Date('2026-07-15T00:15:00Z'),
    selectedNetworkCount: 0,
    eligibleNetworkCount: 0,
    stableCohortHash: '',
    totalPossibleCohortPairCount: 0,
    selectedPairCount: 0,
    positiveMeasuredPairCount: 0,
    graphOpportunityCount: 0,
    attributedGraphOpportunityCount: 0,
    unattributedGraphOpportunityCount: 0,
    suppressedCentroidCount: 0,
    emptyCentroidCount: 0,
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
    logger: { info, error },
    sleep,
  };
  return {
    queue: new FrameDriftQueue(deps),
    upsertJobScheduler,
    removeJobScheduler,
    closeQueue,
    closeWorker,
    createWorker,
    captureDailyBucket,
    info,
    error,
    sleep,
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

  it('rechecks enabled and logs a structured skip before measuring', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    await harness.queue.start();
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'false';

    await harness.getProcessor()?.(makeJob());

    expect(harness.captureDailyBucket).not.toHaveBeenCalled();
    expect(harness.info).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        event: 'frame_drift_monitoring_job_skipped',
        schedulerId: FRAME_DRIFT_SCHEDULER_ID,
        jobId: 'job-123',
        attempt: 2,
        bucketStart: '2026-07-14T00:00:00.000Z',
        bucketEnd: '2026-07-15T00:00:00.000Z',
      }),
    );
  });

  it('prefers prevMillis, derives the closed bucket, and delegates', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    await harness.queue.start();

    await harness.getProcessor()?.(makeJob());

    expect(harness.captureDailyBucket).toHaveBeenCalledWith(
      new Date('2026-07-14T00:00:00.000Z'),
      new Date('2026-07-15T00:00:00.000Z'),
    );
  });

  it('logs structured service failures and rethrows for BullMQ retry', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    const failure = new Error('database unavailable');
    harness.captureDailyBucket.mockImplementationOnce(async () => { throw failure; });
    await harness.queue.start();

    await expect(harness.getProcessor()?.(makeJob())).rejects.toThrow('database unavailable');
    expect(harness.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        event: 'frame_drift_monitoring_job_failed',
        schedulerId: FRAME_DRIFT_SCHEDULER_ID,
        jobId: 'job-123',
        attempt: 2,
        maxAttempts: 3,
        willRetry: true,
        bucketStart: '2026-07-14T00:00:00.000Z',
        bucketEnd: '2026-07-15T00:00:00.000Z',
        error: failure,
      }),
    );
  });

  it('marks the final BullMQ attempt as non-retryable in logs', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    const failure = new Error('database unavailable');
    harness.captureDailyBucket.mockImplementationOnce(async () => { throw failure; });
    await harness.queue.start();

    await expect(harness.getProcessor()?.(makeJob({ attemptsMade: 2 }))).rejects.toThrow(
      'database unavailable',
    );
    expect(harness.error).toHaveBeenCalledWith(
      'Frame-drift observation failed on final attempt',
      expect.objectContaining({
        event: 'frame_drift_monitoring_job_failed',
        attempt: 3,
        maxAttempts: 3,
        willRetry: false,
        error: failure,
      }),
    );
  });

  it('automatically retries scheduler registration with bounded backoff', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    harness.upsertJobScheduler.mockImplementationOnce(async () => {
      throw new Error('redis unavailable');
    });

    await harness.queue.start();

    expect(harness.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(harness.sleep).toHaveBeenCalledWith(50);
    expect(harness.createWorker).toHaveBeenCalledTimes(1);
  });

  it('automatically retries scheduler removal when disabled', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'false';
    const harness = createHarness();
    harness.removeJobScheduler.mockImplementationOnce(async () => {
      throw new Error('redis unavailable');
    });

    await harness.queue.start();

    expect(harness.removeJobScheduler).toHaveBeenCalledTimes(2);
    expect(harness.sleep).toHaveBeenCalledWith(50);
  });

  it('resets startup state after all automatic retries fail', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    harness.upsertJobScheduler.mockImplementation(async () => {
      throw new Error('redis unavailable');
    });

    await expect(harness.queue.start()).rejects.toThrow('redis unavailable');
    expect(harness.upsertJobScheduler).toHaveBeenCalledTimes(3);
    expect(harness.sleep).toHaveBeenCalledTimes(2);

    harness.upsertJobScheduler.mockImplementation(async () => ({}));
    await harness.queue.start();
    expect(harness.upsertJobScheduler).toHaveBeenCalledTimes(4);
    expect(harness.createWorker).toHaveBeenCalledTimes(1);
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
