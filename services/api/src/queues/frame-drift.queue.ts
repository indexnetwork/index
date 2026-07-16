import type { Job, Queue, Worker } from 'bullmq';

import { QueueFactory } from '../lib/bullmq/bullmq';
import { resolveFrameDriftMonitoringConfig } from '../lib/frame-drift.config';
import { log } from '../lib/log';
import { frameDriftMonitoringService, type FrameDriftMonitoringService } from '../services/frame-drift-monitoring.service';

export const FRAME_DRIFT_QUEUE_NAME = 'frame-drift-monitoring';
export const FRAME_DRIFT_JOB_NAME = 'capture-daily-frame-drift';
export const FRAME_DRIFT_SCHEDULER_ID = 'frame-drift-monitoring-daily-v1';

const UTC_DAY_MS = 24 * 60 * 60 * 1000;
const SCHEDULER_OPERATION_MAX_ATTEMPTS = 3;
const SCHEDULER_RETRY_BASE_DELAY_MS = 50;

export interface FrameDriftJobData {
  source: 'daily-scheduler';
}

type FrameDriftQueueHandle = Pick<
  Queue<FrameDriftJobData>,
  'upsertJobScheduler' | 'removeJobScheduler' | 'close'
>;
type FrameDriftWorkerHandle = Pick<Worker<FrameDriftJobData>, 'close'>;
type FrameDriftLogger = {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
};

export interface FrameDriftQueueDeps {
  queue?: FrameDriftQueueHandle;
  createWorker?: (
    processor: (job: Job<FrameDriftJobData>) => Promise<void>,
  ) => FrameDriftWorkerHandle;
  service?: Pick<FrameDriftMonitoringService, 'captureDailyBucket'>;
  logger?: FrameDriftLogger;
  sleep?: (delayMs: number) => Promise<void>;
}

/** Derive the most recently closed UTC calendar day from a scheduler timestamp. */
export function deriveMostRecentlyClosedUtcDay(scheduledAtMs: number): {
  bucketStart: Date;
  bucketEnd: Date;
} {
  if (!Number.isFinite(scheduledAtMs)) {
    throw new Error('Frame-drift scheduled timestamp must be finite');
  }
  const scheduledAt = new Date(scheduledAtMs);
  const bucketEnd = new Date(Date.UTC(
    scheduledAt.getUTCFullYear(),
    scheduledAt.getUTCMonth(),
    scheduledAt.getUTCDate(),
  ));
  return {
    bucketStart: new Date(bucketEnd.getTime() - UTC_DAY_MS),
    bucketEnd,
  };
}

/** BullMQ lifecycle wrapper for the measurement-only daily monitoring job. */
export class FrameDriftQueue {
  private readonly logger: FrameDriftLogger;
  private readonly queue: FrameDriftQueueHandle;
  private readonly createWorker: (
    processor: (job: Job<FrameDriftJobData>) => Promise<void>,
  ) => FrameDriftWorkerHandle;
  private readonly service: Pick<FrameDriftMonitoringService, 'captureDailyBucket'>;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private worker: FrameDriftWorkerHandle | null = null;
  private startPromise: Promise<void> | null = null;
  private closed = false;

  constructor(deps: FrameDriftQueueDeps = {}) {
    this.queue = deps.queue ?? QueueFactory.createQueue<FrameDriftJobData>(FRAME_DRIFT_QUEUE_NAME);
    this.createWorker = deps.createWorker ?? ((processor) => (
      QueueFactory.createWorker<FrameDriftJobData>(FRAME_DRIFT_QUEUE_NAME, processor)
    ));
    this.service = deps.service ?? frameDriftMonitoringService;
    this.logger = deps.logger ?? log.queue.from('FrameDriftQueue');
    this.sleep = deps.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  }

  /** Register/remove the stable scheduler and start at most one local worker. */
  start(): Promise<void> {
    if (this.startPromise) return this.startPromise;
    const attempt = this.startInternal();
    this.startPromise = attempt;
    void attempt.catch(() => {
      if (this.startPromise === attempt) this.startPromise = null;
    });
    return attempt;
  }

  private async retrySchedulerOperation(operation: () => Promise<unknown>): Promise<void> {
    for (let attempt = 1; attempt <= SCHEDULER_OPERATION_MAX_ATTEMPTS; attempt += 1) {
      try {
        await operation();
        return;
      } catch (error) {
        if (attempt === SCHEDULER_OPERATION_MAX_ATTEMPTS) throw error;
        await this.sleep(SCHEDULER_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)));
      }
    }
  }

  private async startInternal(): Promise<void> {
    if (this.closed) throw new Error('Frame-drift queue is closed');
    const config = resolveFrameDriftMonitoringConfig();
    if (!config.enabled) {
      await this.retrySchedulerOperation(() => (
        this.queue.removeJobScheduler(FRAME_DRIFT_SCHEDULER_ID)
      ));
      this.logger.info('Frame-drift monitoring disabled', {
        event: 'frame_drift_monitoring_disabled',
        schedulerId: FRAME_DRIFT_SCHEDULER_ID,
      });
      return;
    }

    await this.retrySchedulerOperation(() => this.queue.upsertJobScheduler(
      FRAME_DRIFT_SCHEDULER_ID,
      { pattern: config.schedule, tz: 'UTC' },
      {
        name: FRAME_DRIFT_JOB_NAME,
        data: { source: 'daily-scheduler' },
        opts: {
          attempts: 3,
          backoff: { type: 'exponential', delay: 1000 },
          removeOnComplete: { age: 24 * 3600, count: 1000 },
          removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
        },
      },
    ));

    if (!this.worker) {
      this.worker = this.createWorker(async (job) => {
        const scheduledAtMs = job.opts.prevMillis ?? job.timestamp;
        const { bucketStart, bucketEnd } = deriveMostRecentlyClosedUtcDay(scheduledAtMs);
        const attempt = job.attemptsMade + 1;
        const maxAttempts = job.opts.attempts ?? 1;
        const jobMetadata = {
          queueName: FRAME_DRIFT_QUEUE_NAME,
          jobName: FRAME_DRIFT_JOB_NAME,
          schedulerId: FRAME_DRIFT_SCHEDULER_ID,
          jobId: job.id,
          source: job.data.source,
          attempt,
          maxAttempts,
          bucketStart: bucketStart.toISOString(),
          bucketEnd: bucketEnd.toISOString(),
        };
        if (!resolveFrameDriftMonitoringConfig().enabled) {
          this.logger.info('Frame-drift observation skipped because monitoring is disabled', {
            event: 'frame_drift_monitoring_job_skipped',
            reason: 'disabled',
            ...jobMetadata,
          });
          return;
        }
        try {
          await this.service.captureDailyBucket(bucketStart, bucketEnd);
        } catch (error) {
          const willRetry = attempt < maxAttempts;
          this.logger.error(
            willRetry
              ? 'Frame-drift observation failed; BullMQ will retry'
              : 'Frame-drift observation failed on final attempt',
            {
              event: 'frame_drift_monitoring_job_failed',
              ...jobMetadata,
              willRetry,
              error,
            },
          );
          throw error;
        }
      });
    }
    this.logger.info('Frame-drift monitoring scheduled', {
      event: 'frame_drift_monitoring_scheduled',
      queueName: FRAME_DRIFT_QUEUE_NAME,
      jobName: FRAME_DRIFT_JOB_NAME,
      schedulerId: FRAME_DRIFT_SCHEDULER_ID,
      schedule: config.schedule,
      timezone: 'UTC',
    });
  }

  /** Gracefully close the local worker and queue connection. */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.startPromise) await this.startPromise.catch(() => undefined);
    await Promise.all([
      this.worker?.close(),
      this.queue.close(),
    ]);
    this.worker = null;
  }
}

export const frameDriftQueue = new FrameDriftQueue();
