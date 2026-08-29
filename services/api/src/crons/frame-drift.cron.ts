import cron from 'node-cron';

import { frameDriftExecutionAttemptDatabaseAdapter, type FrameDriftExecutionAttemptStore, type FrameDriftExecutionAttemptTerminal } from '../adapters/frame-drift-execution-attempt.database.adapter';
import { FRAME_DRIFT_MONITORING } from '../lib/frame-drift.config';
import { log } from '../lib/log';
import { frameDriftMonitoringService, type FrameDriftMonitoringService } from '../services/frame-drift-monitoring.service';

/** Stable ledger label; unchanged so existing `frame_drift_execution_attempts` rows still match. */
export const FRAME_DRIFT_SCHEDULE_NAME = 'frame-drift-monitoring';
export const FRAME_DRIFT_JOB_NAME = 'capture-daily-frame-drift';
/** Stable label persisted onto each ledger row; not a scheduler identity anymore. */
export const FRAME_DRIFT_SCHEDULER_ID = 'frame-drift-monitoring-daily-v1';

const UTC_DAY_MS = 24 * 60 * 60 * 1000;
const TERMINAL_WRITE_MAX_ATTEMPTS = 3;
const TERMINAL_WRITE_BASE_DELAY_MS = 50;

export interface FrameDriftJobData {
  source: 'daily-scheduler';
}

type FrameDriftLogger = {
  info(message: string, metadata?: Record<string, unknown>): void;
  error(message: string, metadata?: Record<string, unknown>): void;
};

export interface FrameDriftCronDeps {
  service?: Pick<FrameDriftMonitoringService, 'captureDailyBucket'>;
  attemptStore?: FrameDriftExecutionAttemptStore;
  logger?: FrameDriftLogger;
  sleep?: (delayMs: number) => Promise<void>;
  clock?: () => Date;
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

/**
 * Measurement-only daily monitoring job, triggered by a node-cron schedule.
 *
 * The BullMQ scheduler reconciliation this used to do (upsert/reuse/repair a
 * repeatable job definition across rolling deploys) is gone entirely — a
 * node-cron schedule needs none of that. The per-run attempt ledger
 * (dedup + bounded-retry terminal write) stays: it is what keeps one UTC
 * day's observation from running twice, independent of BullMQ.
 */
export class FrameDriftCron {
  private readonly logger: FrameDriftLogger;
  private readonly service: Pick<FrameDriftMonitoringService, 'captureDailyBucket'>;
  private readonly attemptStore: FrameDriftExecutionAttemptStore;
  private readonly sleep: (delayMs: number) => Promise<void>;
  private readonly clock: () => Date;
  private cronTask: ReturnType<typeof cron.schedule> | null = null;

  constructor(deps: FrameDriftCronDeps = {}) {
    this.service = deps.service ?? frameDriftMonitoringService;
    this.attemptStore = deps.attemptStore ?? frameDriftExecutionAttemptDatabaseAdapter;
    this.logger = deps.logger ?? log.job.from('FrameDriftCron');
    this.sleep = deps.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
    this.clock = deps.clock ?? (() => new Date());
  }

  /** Schedule the daily capture. Idempotent. */
  async start(): Promise<void> {
    if (this.cronTask) return;
    this.cronTask = cron.schedule(FRAME_DRIFT_MONITORING.schedule, () => {
      this.runDailyCapture().catch((error) => {
        this.logger.error('Frame-drift monitoring cron failed', {
          event: 'frame_drift_monitoring_cron_failed',
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, { timezone: 'UTC' });
    this.logger.info('Frame-drift monitoring scheduled', {
      event: 'frame_drift_monitoring_scheduled',
      jobName: FRAME_DRIFT_JOB_NAME,
      schedule: FRAME_DRIFT_MONITORING.schedule,
      timezone: 'UTC',
    });
  }

  /**
   * Persist a terminal ledger row with bounded in-process retries. Measurement
   * is never re-run here; only the ledger write is retried. On exhaustion the
   * last error is rethrown, leaving the started row as durable incomplete
   * evidence.
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

  /**
   * Run one daily capture: dedup via the attempt ledger (keyed by UTC day),
   * measure, and record the outcome. No retry above this — background()
   * runs it once; a failure is logged and the cron simply fires again
   * tomorrow. Exported for direct use by tests and the cron callback.
   */
  async runDailyCapture(): Promise<void> {
    const scheduledAt = this.clock();
    const { bucketStart, bucketEnd } = deriveMostRecentlyClosedUtcDay(scheduledAt.getTime());
    const jobId = `frame-drift-${bucketStart.toISOString()}`;
    const jobMetadata = {
      scheduleName: FRAME_DRIFT_SCHEDULE_NAME,
      jobName: FRAME_DRIFT_JOB_NAME,
      schedulerId: FRAME_DRIFT_SCHEDULER_ID,
      jobId,
      scheduledAt: scheduledAt.toISOString(),
      bucketStart: bucketStart.toISOString(),
      bucketEnd: bucketEnd.toISOString(),
    };

    let existingTerminalStatus: 'inserted' | 'duplicate' | 'skipped' | 'failed' | null;
    try {
      const started = await this.attemptStore.recordStarted({
        queueName: FRAME_DRIFT_SCHEDULE_NAME,
        schedulerId: FRAME_DRIFT_SCHEDULER_ID,
        jobId,
        jobName: FRAME_DRIFT_JOB_NAME,
        scheduledAt,
        bucketStart,
        bucketEnd,
        attempt: 1,
        maxAttempts: 1,
        startedAt: this.clock(),
      });
      existingTerminalStatus = started.terminalStatus;
    } catch (error) {
      this.logger.error('Frame-drift attempt-start tracking failed', {
        event: 'frame_drift_monitoring_attempt_tracking_failed',
        trackingPhase: 'started',
        ...jobMetadata,
      });
      throw error;
    }

    if (existingTerminalStatus !== null) {
      const replayMetadata = {
        event: 'frame_drift_monitoring_terminal_attempt_replayed',
        terminalStatus: existingTerminalStatus,
        ...jobMetadata,
      };
      if (existingTerminalStatus === 'failed') {
        this.logger.error('Frame-drift failed attempt redelivered; preserving recorded failure', replayMetadata);
        throw new Error('Frame-drift attempt was already recorded as failed');
      }
      this.logger.info('Frame-drift terminal attempt redelivered; retaining recorded outcome', replayMetadata);
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
          attempt: 1,
          completedAt: this.clock(),
          terminalStatus: 'failed',
          willRetry: false,
          failureCategory: 'measurement',
        });
        failureWasTracked = true;
      } catch {
        this.logger.error('Frame-drift failure bookkeeping failed; preserving service error', {
          event: 'frame_drift_monitoring_attempt_tracking_failed',
          trackingPhase: 'terminal',
          ...jobMetadata,
        });
      }
      this.logger.error('Frame-drift observation failed', {
        event: 'frame_drift_monitoring_job_failed',
        ...jobMetadata,
        failureWasTracked,
        error,
      });
      throw error;
    }

    try {
      await this.recordTerminalWithRetry({
        jobId,
        attempt: 1,
        completedAt: this.clock(),
        terminalStatus: observationStatus,
        willRetry: false,
        failureCategory: null,
      });
    } catch (error) {
      this.logger.error('Frame-drift terminal tracking failed', {
        event: 'frame_drift_monitoring_attempt_tracking_failed',
        trackingPhase: 'terminal',
        observationStatus,
        ...jobMetadata,
      });
      throw error;
    }
  }
}

export const frameDriftCron = new FrameDriftCron();
