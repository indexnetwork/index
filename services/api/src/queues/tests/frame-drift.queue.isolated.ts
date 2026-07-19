import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';
import type { Job, JobSchedulerJson } from 'bullmq';

const mockFactoryQueue = {
  getJobScheduler: mock(async () => undefined),
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

import type { FrameDriftExecutionAttemptStartResult } from '../../adapters/frame-drift-execution-attempt.database.adapter';
import type { FrameDriftMonitoringResult } from '../../services/frame-drift-monitoring.service';
import { deriveMostRecentlyClosedUtcDay, FRAME_DRIFT_JOB_NAME, FRAME_DRIFT_SCHEDULER_ID, FrameDriftQueue, type FrameDriftJobData, type FrameDriftQueueDeps } from '../frame-drift.queue';

const ENV_KEYS = [
  'FRAME_DRIFT_MONITORING_ENABLED',
  'FRAME_DRIFT_MONITORING_SCHEDULE',
] as const;
const savedEnv: Record<string, string | undefined> = {};
const DEFAULT_NEXT_SCHEDULED_AT = Date.parse('2026-07-20T00:15:00.000Z');

function makeScheduler(
  overrides: Partial<JobSchedulerJson<FrameDriftJobData>> = {},
): JobSchedulerJson<FrameDriftJobData> {
  return {
    key: FRAME_DRIFT_SCHEDULER_ID,
    name: FRAME_DRIFT_JOB_NAME,
    pattern: '15 0 * * *',
    tz: 'UTC',
    next: DEFAULT_NEXT_SCHEDULED_AT,
    template: {
      data: { source: 'daily-scheduler' },
      opts: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: { age: 24 * 3600, count: 1000 },
        removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
      },
    },
    ...overrides,
  };
}

function makeJob(overrides: Partial<Job<FrameDriftJobData>> = {}): Job<FrameDriftJobData> {
  return {
    id: 'job-123',
    name: FRAME_DRIFT_JOB_NAME,
    // BullMQ exposes the scheduler identity on the job (hoisted out of opts).
    repeatJobKey: FRAME_DRIFT_SCHEDULER_ID,
    data: { source: 'daily-scheduler' },
    opts: {
      prevMillis: Date.parse('2026-07-15T00:15:00Z'),
      attempts: 3,
    },
    timestamp: Date.parse('2026-01-01T00:15:00Z'),
    attemptsMade: 1,
    ...overrides,
  } as Job<FrameDriftJobData>;
}

function createHarness() {
  let scheduler: JobSchedulerJson<FrameDriftJobData> | undefined;
  const getJobScheduler = mock(async () => scheduler);
  const successfulUpsert = async (
    ...args: Parameters<NonNullable<FrameDriftQueueDeps['queue']>['upsertJobScheduler']>
  ): Promise<Job<FrameDriftJobData>> => {
    const [, repeat, template] = args;
    scheduler = makeScheduler({
      name: String(template?.name ?? FRAME_DRIFT_JOB_NAME),
      pattern: repeat.pattern,
      tz: repeat.tz,
      template: {
        data: template?.data,
        opts: template?.opts,
      },
    });
    return makeJob({
      opts: {
        prevMillis: scheduler.next,
        attempts: template?.opts?.attempts,
      },
    });
  };
  const upsertJobScheduler = mock(successfulUpsert);
  const removeJobScheduler = mock(async () => true);
  const closeQueue = mock(async () => undefined);
  const closeWorker = mock(async () => undefined);
  const info = mock(() => undefined);
  const error = mock(() => undefined);
  const sleep = mock(async (_delayMs: number) => undefined);
  const lifecycleCalls: string[] = [];
  const recordStarted = mock(async (): Promise<FrameDriftExecutionAttemptStartResult> => {
    lifecycleCalls.push('started');
    return { recordStatus: 'inserted' as const, terminalStatus: null };
  });
  const recordTerminal = mock(async () => {
    lifecycleCalls.push('terminal');
    return 'updated' as const;
  });
  const clock = mock(() => new Date('2026-07-15T00:15:01.000Z'));
  let processor: ((job: Job<FrameDriftJobData>) => Promise<void>) | undefined;
  const createWorker = mock((handler: (job: Job<FrameDriftJobData>) => Promise<void>) => {
    processor = handler;
    return { close: closeWorker };
  });
  const captureDailyBucket = mock(async (): Promise<FrameDriftMonitoringResult> => {
    lifecycleCalls.push('measurement');
    return {
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
    };
  });
  const deps: FrameDriftQueueDeps = {
    queue: {
      getJobScheduler,
      upsertJobScheduler,
      removeJobScheduler,
      close: closeQueue,
    } as unknown as NonNullable<FrameDriftQueueDeps['queue']>,
    createWorker,
    service: { captureDailyBucket },
    attemptStore: { recordStarted, recordTerminal },
    logger: { info, error },
    sleep,
    clock,
  };
  return {
    queue: new FrameDriftQueue(deps),
    getJobScheduler,
    upsertJobScheduler,
    removeJobScheduler,
    closeQueue,
    closeWorker,
    createWorker,
    captureDailyBucket,
    recordStarted,
    recordTerminal,
    clock,
    lifecycleCalls,
    info,
    error,
    sleep,
    getProcessor: () => processor,
    setScheduler: (value: JobSchedulerJson<FrameDriftJobData> | undefined) => {
      scheduler = value;
    },
    restoreSuccessfulUpsert: () => {
      upsertJobScheduler.mockImplementation(successfulUpsert);
    },
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
  it('creates a missing stable UTC scheduler and logs its authoritative next timestamp', async () => {
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
    expect(harness.info).toHaveBeenCalledWith(
      'Frame-drift monitoring scheduled',
      expect.objectContaining({
        schedulerAction: 'created',
        nextScheduledAt: '2026-07-20T00:15:00.000Z',
      }),
    );
  });

  it('reuses a materially matching scheduler without upsert', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    harness.setScheduler(makeScheduler());

    await harness.queue.start();

    expect(harness.getJobScheduler).toHaveBeenCalledTimes(1);
    expect(harness.upsertJobScheduler).not.toHaveBeenCalled();
    expect(harness.createWorker).toHaveBeenCalledTimes(1);
    expect(harness.info).toHaveBeenCalledWith(
      'Frame-drift monitoring scheduled',
      expect.objectContaining({
        schedulerAction: 'reused',
        nextScheduledAt: '2026-07-20T00:15:00.000Z',
      }),
    );
  });

  it('leaves a matching overdue scheduler untouched so its pending job survives', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    harness.setScheduler(makeScheduler({
      next: Date.parse('2026-07-19T00:15:00.000Z'),
      iterationCount: 37,
      offset: 125,
    }));

    await harness.queue.start();

    expect(harness.upsertJobScheduler).not.toHaveBeenCalled();
    expect(harness.createWorker).toHaveBeenCalledTimes(1);
    expect(harness.info).toHaveBeenCalledWith(
      'Frame-drift monitoring scheduled',
      expect.objectContaining({
        schedulerAction: 'reused',
        nextScheduledAt: '2026-07-19T00:15:00.000Z',
      }),
    );
  });

  it('updates a materially changed scheduler and logs the updated action', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    harness.setScheduler(makeScheduler({
      template: {
        data: { source: 'daily-scheduler' },
        opts: {
          attempts: 4,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
        },
      },
    }));

    await harness.queue.start();

    expect(harness.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(harness.info).toHaveBeenCalledWith(
      'Frame-drift monitoring scheduled',
      expect.objectContaining({ schedulerAction: 'updated' }),
    );
  });

  it('updates rather than reuses when unsupported scheduling controls are present', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const controls: Array<Partial<JobSchedulerJson<FrameDriftJobData>>> = [
      { limit: 5 },
      { startDate: Date.parse('2026-01-01T00:00:00.000Z') },
      { endDate: Date.parse('2027-01-01T00:00:00.000Z') },
      { every: 24 * 3600 * 1000 },
    ];
    for (const control of controls) {
      const harness = createHarness();
      harness.setScheduler(makeScheduler(control));

      await harness.queue.start();

      expect(harness.upsertJobScheduler).toHaveBeenCalledTimes(1);
      expect(harness.createWorker).toHaveBeenCalledTimes(1);
      expect(harness.info).toHaveBeenCalledWith(
        'Frame-drift monitoring scheduled',
        expect.objectContaining({ schedulerAction: 'updated' }),
      );
    }
  });

  it('repairs a matching scheduler with an invalid next and starts only after a valid one', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    harness.setScheduler(makeScheduler({ next: undefined }));

    await harness.queue.start();

    expect(harness.upsertJobScheduler).toHaveBeenCalledTimes(1);
    expect(harness.createWorker).toHaveBeenCalledTimes(1);
    expect(harness.info).toHaveBeenCalledWith(
      'Frame-drift monitoring scheduled',
      expect.objectContaining({
        schedulerAction: 'updated',
        nextScheduledAt: '2026-07-20T00:15:00.000Z',
      }),
    );
  });

  it('fails reconciliation and starts no worker when the post-upsert definition diverges', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    harness.upsertJobScheduler.mockImplementation(async () => {
      harness.setScheduler(makeScheduler({ pattern: '59 23 * * *' }));
      return makeJob();
    });

    await expect(harness.queue.start()).rejects.toThrow(
      'Frame-drift scheduler definition diverged after reconciliation',
    );
    expect(harness.createWorker).not.toHaveBeenCalled();
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

    expect(harness.lifecycleCalls).toEqual(['started', 'terminal']);
    expect(harness.captureDailyBucket).not.toHaveBeenCalled();
    expect(harness.recordStarted).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-123',
      scheduledAt: new Date('2026-07-15T00:15:00.000Z'),
      attempt: 2,
      maxAttempts: 3,
      bucketStart: new Date('2026-07-14T00:00:00.000Z'),
      bucketEnd: new Date('2026-07-15T00:00:00.000Z'),
    }));
    expect(harness.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-123',
      attempt: 2,
      terminalStatus: 'skipped',
      willRetry: false,
      failureCategory: null,
    }));
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

    expect(harness.lifecycleCalls).toEqual(['started', 'measurement', 'terminal']);
    expect(harness.captureDailyBucket).toHaveBeenCalledWith(
      new Date('2026-07-14T00:00:00.000Z'),
      new Date('2026-07-15T00:00:00.000Z'),
    );
    expect(harness.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: 'inserted',
      willRetry: false,
      failureCategory: null,
    }));
  });

  it('threads the real BullMQ scheduler identity into the attempt ledger', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    await harness.queue.start();

    await harness.getProcessor()?.(makeJob({ repeatJobKey: 'frame-drift-monitoring-daily-v2' }));

    expect(harness.recordStarted).toHaveBeenCalledWith(expect.objectContaining({
      schedulerId: 'frame-drift-monitoring-daily-v2',
      jobId: 'job-123',
    }));
  });

  it('falls back to the stable scheduler id when a job carries no repeatJobKey', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    await harness.queue.start();

    await harness.getProcessor()?.(makeJob({ repeatJobKey: undefined }));

    expect(harness.recordStarted).toHaveBeenCalledWith(expect.objectContaining({
      schedulerId: FRAME_DRIFT_SCHEDULER_ID,
    }));
  });

  it('records a duplicate measurement result as terminal duplicate', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    harness.captureDailyBucket.mockImplementationOnce(async () => ({
      observationStatus: 'duplicate',
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
    await harness.queue.start();

    await harness.getProcessor()?.(makeJob());

    expect(harness.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: 'duplicate',
      willRetry: false,
      failureCategory: null,
    }));
  });

  it('logs structured service failures and rethrows for BullMQ retry', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    const failure = new Error('database unavailable');
    harness.captureDailyBucket.mockImplementationOnce(async () => { throw failure; });
    await harness.queue.start();

    await expect(harness.getProcessor()?.(makeJob())).rejects.toThrow('database unavailable');
    expect(harness.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: 'failed',
      willRetry: true,
      failureCategory: 'measurement',
    }));
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
    expect(harness.recordTerminal).toHaveBeenCalledWith(expect.objectContaining({
      terminalStatus: 'failed',
      willRetry: false,
      failureCategory: 'measurement',
    }));
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

  it('short-circuits redelivered attempts whose successful or skipped terminal state exists', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    for (const terminalStatus of ['inserted', 'skipped'] as const) {
      const harness = createHarness();
      harness.recordStarted.mockImplementationOnce(async () => ({
        recordStatus: 'replayed',
        terminalStatus,
      }));
      await harness.queue.start();

      await harness.getProcessor()?.(makeJob());

      expect(harness.captureDailyBucket).not.toHaveBeenCalled();
      expect(harness.recordTerminal).not.toHaveBeenCalled();
      expect(harness.info).toHaveBeenCalledWith(
        'Frame-drift terminal attempt redelivered; retaining recorded outcome',
        expect.objectContaining({
          event: 'frame_drift_monitoring_terminal_attempt_replayed',
          terminalStatus,
        }),
      );
    }
  });

  it('preserves failure semantics when a terminal failed attempt is redelivered', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    harness.recordStarted.mockImplementationOnce(async () => ({
      recordStatus: 'replayed',
      terminalStatus: 'failed',
    }));
    await harness.queue.start();

    await expect(harness.getProcessor()?.(makeJob())).rejects.toThrow(
      'Frame-drift attempt was already recorded as failed',
    );

    expect(harness.captureDailyBucket).not.toHaveBeenCalled();
    expect(harness.recordTerminal).not.toHaveBeenCalled();
    expect(harness.error).toHaveBeenCalledWith(
      'Frame-drift failed attempt redelivered; preserving BullMQ failure',
      expect.objectContaining({
        event: 'frame_drift_monitoring_terminal_attempt_replayed',
        terminalStatus: 'failed',
      }),
    );
  });

  it('fails before the flag check or measurement when started tracking fails', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    const trackingFailure = new Error('attempt store unavailable');
    harness.recordStarted.mockImplementationOnce(async () => { throw trackingFailure; });
    await harness.queue.start();

    await expect(harness.getProcessor()?.(makeJob())).rejects.toBe(trackingFailure);

    expect(harness.captureDailyBucket).not.toHaveBeenCalled();
    expect(harness.recordTerminal).not.toHaveBeenCalled();
    expect(harness.error).toHaveBeenCalledWith(
      'Frame-drift attempt-start tracking failed; BullMQ will retry',
      expect.objectContaining({
        event: 'frame_drift_monitoring_attempt_tracking_failed',
        trackingPhase: 'started',
        willRetry: true,
      }),
    );
  });

  it('recovers when a terminal ledger write succeeds within the bounded retries', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    harness.recordTerminal.mockImplementationOnce(async () => {
      throw new Error('attempt store unavailable');
    });
    await harness.queue.start();

    await harness.getProcessor()?.(makeJob());

    // Measurement is never re-run while the ledger write retries.
    expect(harness.captureDailyBucket).toHaveBeenCalledTimes(1);
    expect(harness.recordTerminal).toHaveBeenCalledTimes(2);
    expect(harness.sleep).toHaveBeenCalledWith(50);
    expect(harness.error).not.toHaveBeenCalled();
  });

  it('fails the job after exhausting terminal ledger write retries with a later retry', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    const trackingFailure = new Error('attempt store unavailable');
    harness.recordTerminal.mockImplementation(async () => { throw trackingFailure; });
    await harness.queue.start();

    await expect(harness.getProcessor()?.(makeJob())).rejects.toBe(trackingFailure);

    expect(harness.captureDailyBucket).toHaveBeenCalledTimes(1);
    expect(harness.recordTerminal).toHaveBeenCalledTimes(3);
    expect(harness.error).toHaveBeenCalledWith(
      'Frame-drift terminal tracking failed; BullMQ will retry',
      expect.objectContaining({
        event: 'frame_drift_monitoring_attempt_tracking_failed',
        trackingPhase: 'terminal',
        observationStatus: 'inserted',
        willRetry: true,
      }),
    );
  });

  it('leaves an incomplete row after exhausting terminal retries on the final attempt', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    const trackingFailure = new Error('attempt store unavailable');
    harness.recordTerminal.mockImplementation(async () => { throw trackingFailure; });
    await harness.queue.start();

    await expect(harness.getProcessor()?.(makeJob({ attemptsMade: 2 }))).rejects.toBe(
      trackingFailure,
    );

    // Measurement committed once; the started row remains durable incomplete
    // evidence because no terminal row was ever written.
    expect(harness.captureDailyBucket).toHaveBeenCalledTimes(1);
    expect(harness.recordTerminal).toHaveBeenCalledTimes(3);
    expect(harness.error).toHaveBeenCalledWith(
      'Frame-drift terminal tracking failed on final attempt',
      expect.objectContaining({
        event: 'frame_drift_monitoring_attempt_tracking_failed',
        trackingPhase: 'terminal',
        observationStatus: 'inserted',
        willRetry: false,
      }),
    );
  });

  it('preserves the service error when failure bookkeeping also fails', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    const serviceFailure = new Error('measurement database unavailable');
    harness.captureDailyBucket.mockImplementationOnce(async () => { throw serviceFailure; });
    harness.recordTerminal.mockImplementation(async () => {
      throw new Error('attempt store unavailable');
    });
    await harness.queue.start();

    await expect(harness.getProcessor()?.(makeJob())).rejects.toBe(serviceFailure);

    // The failed-measurement ledger write also exhausts its bounded retries.
    expect(harness.recordTerminal).toHaveBeenCalledTimes(3);
    expect(harness.error).toHaveBeenCalledWith(
      'Frame-drift failure bookkeeping failed; preserving service error',
      expect.objectContaining({
        event: 'frame_drift_monitoring_attempt_tracking_failed',
        trackingPhase: 'terminal',
      }),
    );
    expect(harness.error).toHaveBeenCalledWith(
      'Frame-drift observation failed; BullMQ will retry',
      expect.objectContaining({
        error: serviceFailure,
        failureWasTracked: false,
      }),
    );
  });

  it('automatically retries scheduler lookup with bounded backoff', async () => {
    process.env.FRAME_DRIFT_MONITORING_ENABLED = 'true';
    const harness = createHarness();
    harness.setScheduler(makeScheduler());
    harness.getJobScheduler.mockImplementationOnce(async () => {
      throw new Error('redis unavailable');
    });

    await harness.queue.start();

    expect(harness.getJobScheduler).toHaveBeenCalledTimes(2);
    expect(harness.sleep).toHaveBeenCalledWith(50);
    expect(harness.upsertJobScheduler).not.toHaveBeenCalled();
    expect(harness.createWorker).toHaveBeenCalledTimes(1);
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

    harness.restoreSuccessfulUpsert();
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
