import cron from 'node-cron';

const DEFAULT_SCHEDULE = '15 0 * * *';
const DEFAULT_MAX_NETWORKS = 200;
const DEFAULT_MAX_PAIRS = 10_000;
const MAX_NETWORKS_LIMIT = 10_000;
const MAX_PAIRS_LIMIT = 1_000_000;

/** Runtime configuration for the frame-drift measurement job. */
export interface FrameDriftMonitoringConfig {
  enabled: boolean;
  schedule: string;
  maxNetworks: number;
  maxPairs: number;
}

function parseBoundedInteger(
  raw: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = Number(raw?.trim());
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(maximum, Math.floor(parsed));
}

/**
 * Resolve and validate frame-drift monitoring configuration.
 *
 * Invalid schedules and bounds fall back to safe defaults. Bounds are clamped
 * to prevent an accidental environment change from creating unbounded queries.
 *
 * @param env - Environment source, injectable for tests.
 * @returns Validated monitoring configuration.
 */
export function resolveFrameDriftMonitoringConfig(
  env: NodeJS.ProcessEnv = process.env,
): FrameDriftMonitoringConfig {
  const configuredSchedule = env.FRAME_DRIFT_MONITORING_SCHEDULE?.trim();
  const schedule = configuredSchedule && cron.validate(configuredSchedule)
    ? configuredSchedule
    : DEFAULT_SCHEDULE;

  return {
    enabled: env.FRAME_DRIFT_MONITORING_ENABLED?.trim().toLowerCase() === 'true',
    schedule,
    maxNetworks: parseBoundedInteger(
      env.FRAME_DRIFT_MONITORING_MAX_NETWORKS,
      DEFAULT_MAX_NETWORKS,
      MAX_NETWORKS_LIMIT,
    ),
    maxPairs: parseBoundedInteger(
      env.FRAME_DRIFT_MONITORING_MAX_PAIRS,
      DEFAULT_MAX_PAIRS,
      MAX_PAIRS_LIMIT,
    ),
  };
}
