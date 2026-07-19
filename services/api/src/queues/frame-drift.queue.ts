import type { Job, JobSchedulerJson, Queue, Worker } from 'bullmq';

import { frameDriftExecutionAttemptDatabaseAdapter, type FrameDriftExecutionAttemptStore, type FrameDriftExecutionAttemptTerminal } from '../adapters/frame-drift-execution-attempt.database.adapter';
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
const TERMINAL_WRITE_MAX_ATTEMPTS = 3;
const TERMINAL_WRITE_BASE_DELAY_MS = 50;
const FRAME_DRIFT_JOB_TEMPLATE = {
  name: FRAME_DRIFT_JOB_NAME,
  data: { source: 'daily-scheduler' as const },
  opts: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: { age: 24 * 3600, count: 1000 },
    removeOnFail: { age: 7 * 24 * 3600, count: 1000 },
  },
};

export interface FrameDriftJobData {
  source: 'daily-scheduler';
}

type FrameDriftQueueHandle = Pick<
  Queue<FrameDriftJobData>,
  'getJobScheduler' | 'upsertJobScheduler' | 'removeJobScheduler' | 'close'
>;
type DesiredFrameDriftScheduler = {
  repeat: { pattern: string; tz: 'UTC' };
  template: typeof FRAME_DRIFT_JOB_TEMPLATE;
};
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
  attemptStore?: FrameDriftExecutionAttemptStore;
  logger?: FrameDriftLogger;
  sleep?: (delayMs: number) => Promise<void>;
  clock?: () => Date;
}

function desiredFrameDriftScheduler(schedule: string): DesiredFrameDriftScheduler {
  return {
    repeat: { pattern: schedule, tz: 'UTC' },
    template: FRAME_DRIFT_JOB_TEMPLATE,
  };
}

function matchesExactRecord(value: unknown, expected: Record<string, unknown>): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const actual = value as Record<string, unknown>;
  const expectedKeys = Object.keys(expected);
  return Object.keys(actual).length === expectedKeys.length
    && expectedKeys.every((key) => actual[key] === expected[key]);
}

function schedulerMateriallyMatches(
  scheduler: JobSchedulerJson<FrameDriftJobData>,
  desired: DesiredFrameDriftScheduler,
): boolean {
  const opts = scheduler.template?.opts;
  return scheduler.pattern === desired.repeat.pattern
    && scheduler.tz === desired.repeat.tz
    && scheduler.name === desired.template.name
    // Unsupported scheduling controls must be absent: a finite (`limit`),
    // bounded (`startDate`/`endDate`), or interval (`every`) scheduler is not
    // the desired unlimited daily cron and must not be reused as one.
    && scheduler.limit === undefined
    && scheduler.startDate === undefined
    && scheduler.endDate === undefined
    && scheduler.every === undefined
    && matchesExactRecord(scheduler.template?.data, desired.template.data)
    && opts?.attempts === desired.template.opts.attempts
    && matchesExactRecord(opts.backoff, desired.template.opts.backoff)
    && matchesExactRecord(opts.removeOnComplete, desired.template.opts.removeOnComplete)
    && matchesExactRecord(opts.removeOnFail, desired.template.opts.removeOnFail);
}

function requireSchedulerNextTimestamp(scheduler: JobSchedulerJson<FrameDriftJobData>): number {
  if (!Number.isFinite(scheduler.next)) {
    throw new Error('Frame-drift scheduler has no authoritative next timestamp');
  }
  return scheduler.next as number;
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
  private readonly attemptStore: FrameDriftExecutionAttemptStore;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly clock: () => Date;
  private worker: FrameDriftWorkerHandle | null = null;
  private startPromise: Promise<void> | null = null;
  private closed = false;

  constructor(deps: FrameDriftQueueDeps = {}) {
    this.queue = deps.queue ?? QueueFactory.createQueue<FrameDriftJobData>(FRAME_DRIFT_QUEUE_NAME);
    this.createWorker = deps.createWorker ?? ((processor) => (
      QueueFactory.createWorker<FrameDriftJobData>(FRAME_DRIFT_QUEUE_NAME, processor)
    ));
    this.service = deps.service ?? frameDriftMonitoringService;
    this.attemptStore = deps.attemptStore ?? frameDriftExecutionAttemptDatabaseAdapter;
    this.logger = deps.logger ?? log.queue.from('FrameDriftQueue');
    this.sleep = deps.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.clock = deps.clock ?? (() => new Date());
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

  private async retrySchedulerOperation<Result>(operation: () => Promise<Result>): Promise<Result> {
    for (let attempt = 1; attempt <= SCHEDULER_OPERATION_MAX_ATTEMPTS; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (attempt === SCHEDULER_OPERATION_MAX_ATTEMPTS) throw error;
        await this.sleep(SCHEDULER_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)));
      }
    }
    throw new Error('Frame-drift scheduler retry loop exhausted');
  }

  /**
   * Persist a terminal ledger row with bounded in-process retries. Measurement
   * is never re-run here; only the ledger write is retried. On exhaustion the
   * last error is rethrown, leaving the started row as durable incomplete
   * evidence (the irreducible case on a final BullMQ attempt).
   */
  private async recordTerminalWithRetry(terminal: FrameDriftExecutionAttemptTerminal): Promise<void> {
    for (let attempt = 1; attempt <= TERMINAL_WRITE_MAX_ATTEMPTS; attempt += 1) {
      try {
        await this.attemptStore.recordTerminal(terminal);
        return;
      } catch (error) {
        if (attempt === TERMINAL_WRITE_MAX_ATTEMPTS) throw error;
        await this.sleep(TERMINAL_WRITE_BASE_DELAY_MS * (2 ** (attempt - 1)));
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

    const desiredScheduler = desiredFrameDriftScheduler(config.schedule);
    const existingScheduler = await this.retrySchedulerOperation(() => (
      this.queue.getJobScheduler(FRAME_DRIFT_SCHEDULER_ID)
    ));
    let schedulerAction: 'created' | 'reused' | 'updated';
    let reconciledScheduler: JobSchedulerJson<FrameDriftJobData>;
    // A materially matching scheduler is reused only when it also carries a
    // finite authoritative `next`; a missing/non-finite `next` is inconsistent
    // scheduler state that must be repaired through upsert, not reused.
    if (
      existingScheduler
      && schedulerMateriallyMatches(existingScheduler, desiredScheduler)
      && Number.isFinite(existingScheduler.next)
    ) {
      schedulerAction = 'reused';
      reconciledScheduler = existingScheduler;
    } else {
      schedulerAction = existingScheduler ? 'updated' : 'created';
      await this.retrySchedulerOperation(() => this.queue.upsertJobScheduler(
        FRAME_DRIFT_SCHEDULER_ID,
        desiredScheduler.repeat,
        desiredScheduler.template,
      ));
      const storedScheduler = await this.retrySchedulerOperation(() => (
        this.queue.getJobScheduler(FRAME_DRIFT_SCHEDULER_ID)
      ));
      if (!storedScheduler) {
        throw new Error('Frame-drift scheduler missing after reconciliation');
      }
      // Re-validate the stored definition: a rolling-deployment race could have
      // left a divergent scheduler. Fail reconciliation rather than start a
      // worker against an unexpected schedule.
      if (!schedulerMateriallyMatches(storedScheduler, desiredScheduler)) {
        throw new Error('Frame-drift scheduler definition diverged after reconciliation');
      }
      reconciledScheduler = storedScheduler;
    }
    const nextScheduledAtMs = requireSchedulerNextTimestamp(reconciledScheduler);

    if (!this.worker) {
      this.worker = this.createWorker(async (job) => {
        const jobId = job.id;
        if (!jobId) throw new Error('Frame-drift BullMQ job has no identity');
        const jobName = job.name;
        if (!jobName.trim()) throw new Error('Frame-drift BullMQ job has no name');
        // BullMQ strips repeatJobKey from opts and hoists it onto the job; the
        // stable constant is only a fallback for manually enqueued jobs.
        const schedulerId = job.repeatJobKey ?? FRAME_DRIFT_SCHEDULER_ID;
        const scheduledAtMs = job.opts.prevMillis ?? job.timestamp;
        const scheduledAt = new Date(scheduledAtMs);
        const { bucketStart, bucketEnd } = deriveMostRecentlyClosedUtcDay(scheduledAtMs);
        const attempt = job.attemptsMade + 1;
        const maxAttempts = job.opts.attempts ?? 1;
        const willRetry = attempt < maxAttempts;
        const jobMetadata = {
          queueName: FRAME_DRIFT_QUEUE_NAME,
          jobName,
          schedulerId,
          jobId,
          source: job.data.source,
          scheduledAt: scheduledAt.toISOString(),
          attempt,
          maxAttempts,
          bucketStart: bucketStart.toISOString(),
          bucketEnd: bucketEnd.toISOString(),
        };
        let existingTerminalStatus: 'inserted' | 'duplicate' | 'skipped' | 'failed' | null;
        try {
          const started = await this.attemptStore.recordStarted({
            queueName: FRAME_DRIFT_QUEUE_NAME,
            schedulerId,
            jobId,
            jobName,
            scheduledAt,
            bucketStart,
            bucketEnd,
            attempt,
            maxAttempts,
            startedAt: this.clock(),
          });
          existingTerminalStatus = started.terminalStatus;
        } catch (error) {
          this.logger.error(
            willRetry
              ? 'Frame-drift attempt-start tracking failed; BullMQ will retry'
              : 'Frame-drift attempt-start tracking failed on final attempt',
            {
              event: 'frame_drift_monitoring_attempt_tracking_failed',
              trackingPhase: 'started',
              ...jobMetadata,
              willRetry,
            },
          );
          throw error;
        }

        if (existingTerminalStatus !== null) {
          const replayMetadata = {
            event: 'frame_drift_monitoring_terminal_attempt_replayed',
            terminalStatus: existingTerminalStatus,
            ...jobMetadata,
            willRetry,
          };
          if (existingTerminalStatus === 'failed') {
            this.logger.error('Frame-drift failed attempt redelivered; preserving BullMQ failure', replayMetadata);
            throw new Error('Frame-drift attempt was already recorded as failed');
          }
          this.logger.info('Frame-drift terminal attempt redelivered; retaining recorded outcome', replayMetadata);
          return;
        }

        if (!resolveFrameDriftMonitoringConfig().enabled) {
          try {
            await this.recordTerminalWithRetry({
              jobId,
              attempt,
              completedAt: this.clock(),
              terminalStatus: 'skipped',
              willRetry: false,
              failureCategory: null,
            });
          } catch (error) {
            this.logger.error(
              willRetry
                ? 'Frame-drift terminal tracking failed; BullMQ will retry'
                : 'Frame-drift terminal tracking failed on final attempt',
              {
                event: 'frame_drift_monitoring_attempt_tracking_failed',
                trackingPhase: 'terminal',
                observationStatus: 'skipped',
                ...jobMetadata,
                willRetry,
              },
            );
            throw error;
          }
          this.logger.info('Frame-drift observation skipped because monitoring is disabled', {
            event: 'frame_drift_monitoring_job_skipped',
            reason: 'disabled',
            ...jobMetadata,
          });
          return;
        }
        let observationStatus: 'inserted' | 'duplicate';
        try {
          const result = await this.service.captureDailyBucket(bucketStart, bucketEnd);
          observationStatus = result.observationStatus;
        } catch (error) {
          let failureWasTracked = false;
          try {
            await this.recordTerminalWithRetry({
              jobId,
              attempt,
              completedAt: this.clock(),
              terminalStatus: 'failed',
              willRetry,
              failureCategory: 'measurement',
            });
            failureWasTracked = true;
          } catch {
            this.logger.error('Frame-drift failure bookkeeping failed; preserving service error', {
              event: 'frame_drift_monitoring_attempt_tracking_failed',
              trackingPhase: 'terminal',
              ...jobMetadata,
              willRetry,
            });
          }
          this.logger.error(
            willRetry
              ? 'Frame-drift observation failed; BullMQ will retry'
              : 'Frame-drift observation failed on final attempt',
            {
              event: 'frame_drift_monitoring_job_failed',
              ...jobMetadata,
              willRetry,
              failureWasTracked,
              error,
            },
          );
          throw error;
        }

        try {
          await this.recordTerminalWithRetry({
            jobId,
            attempt,
            completedAt: this.clock(),
            terminalStatus: observationStatus,
            willRetry: false,
            failureCategory: null,
          });
        } catch (error) {
          this.logger.error(
            willRetry
              ? 'Frame-drift terminal tracking failed; BullMQ will retry'
              : 'Frame-drift terminal tracking failed on final attempt',
            {
              event: 'frame_drift_monitoring_attempt_tracking_failed',
              trackingPhase: 'terminal',
              observationStatus,
              ...jobMetadata,
              willRetry,
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
      schedulerAction,
      nextScheduledAt: new Date(nextScheduledAtMs).toISOString(),
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
