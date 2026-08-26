import cron from 'node-cron';

import { FRAME_DRIFT_MONITORING } from '../frame-drift.config';
import { log } from '../log';
import { frameDriftMonitoringService, type FrameDriftMonitoringService } from '../../services/frame-drift-monitoring.service';

const UTC_DAY_MS = 24 * 60 * 60 * 1000;

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

export class FrameDriftCron {
  private readonly logger = log.job.from('FrameDrift');
  private readonly service: Pick<FrameDriftMonitoringService, 'captureDailyBucket'>;
  private readonly clock: () => Date;
  private task: ReturnType<typeof cron.schedule> | null = null;

  constructor(deps?: {
    service?: Pick<FrameDriftMonitoringService, 'captureDailyBucket'>;
    clock?: () => Date;
  }) {
    this.service = deps?.service ?? frameDriftMonitoringService;
    this.clock = deps?.clock ?? (() => new Date());
  }

  async capture(): Promise<void> {
    const { bucketStart, bucketEnd } = deriveMostRecentlyClosedUtcDay(this.clock().getTime());
    await this.service.captureDailyBucket(bucketStart, bucketEnd);
  }

  async start(): Promise<void> {
    if (this.task) return;
    this.task = cron.schedule(FRAME_DRIFT_MONITORING.schedule, () => {
      this.capture().catch((error) => {
        this.logger.error('Frame-drift capture failed', { error });
      });
    }, { timezone: 'UTC' });
    this.logger.info('Frame-drift monitoring scheduled', {
      schedule: FRAME_DRIFT_MONITORING.schedule,
      timezone: 'UTC',
    });
  }

  async close(): Promise<void> {
    this.task?.stop();
    this.task = null;
  }
}

export const frameDriftCron = new FrameDriftCron();
