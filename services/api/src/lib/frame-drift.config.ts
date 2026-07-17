import cron from 'node-cron';

const DEFAULT_SCHEDULE = '15 0 * * *';
const DEFAULT_MAX_NETWORKS = 200;
const DEFAULT_MAX_PAIRS = 10_000;
const DEFAULT_MIN_USERS = 5;
const MIN_USERS_LOWER_BOUND = 2;
const MIN_USERS_UPPER_BOUND = 100;

/** Runtime configuration for the frame-drift observation job. */
export interface FrameDriftMonitoringConfig {
  enabled: boolean;
  schedule: string;
  maxNetworks: number;
  maxPairs: number;
  minUsers: number;
}

function parseBoundedInteger(
  raw: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

function isDailyUtcSchedule(value: string): boolean {
  const match = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(value);
  if (!match) return false;
  const minute = Number(match[1]);
  const hour = Number(match[2]);
  return minute >= 0
    && minute <= 59
    && hour >= 0
    && hour <= 23
    && cron.validate(value);
}

/**
 * Resolve and validate frame-drift monitoring configuration.
 *
 * Only one fixed numeric minute/hour in a five-field UTC cron is accepted, so
 * an accidental frequent schedule cannot pass validation. Invalid values fall
 * back to safe defaults and numeric values are clamped to hard bounds.
 *
 * @param env - Environment source, injectable for tests.
 * @returns Validated monitoring configuration.
 */
export function resolveFrameDriftMonitoringConfig(
  env: NodeJS.ProcessEnv = process.env,
): FrameDriftMonitoringConfig {
  const configuredSchedule = env.FRAME_DRIFT_MONITORING_SCHEDULE?.trim();
  const schedule = configuredSchedule && isDailyUtcSchedule(configuredSchedule)
    ? configuredSchedule
    : DEFAULT_SCHEDULE;

  return {
    enabled: env.FRAME_DRIFT_MONITORING_ENABLED?.trim().toLowerCase() === 'true',
    schedule,
    maxNetworks: parseBoundedInteger(
      env.FRAME_DRIFT_MONITORING_MAX_NETWORKS,
      DEFAULT_MAX_NETWORKS,
      1,
      DEFAULT_MAX_NETWORKS,
    ),
    maxPairs: parseBoundedInteger(
      env.FRAME_DRIFT_MONITORING_MAX_PAIRS,
      DEFAULT_MAX_PAIRS,
      1,
      DEFAULT_MAX_PAIRS,
    ),
    minUsers: parseBoundedInteger(
      env.FRAME_DRIFT_MONITORING_MIN_USERS,
      DEFAULT_MIN_USERS,
      MIN_USERS_LOWER_BOUND,
      MIN_USERS_UPPER_BOUND,
    ),
  };
}
