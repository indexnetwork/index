/** Runtime configuration for the frame-drift observation job. */
export interface FrameDriftMonitoringConfig {
  schedule: string;
  maxNetworks: number;
  maxPairs: number;
  minUsers: number;
}

/**
 * Frame-drift monitoring runs daily, measurement-only. The schedule and the
 * three bounds were configurable but set in no environment; these are the
 * values that have always run.
 */
export const FRAME_DRIFT_MONITORING: FrameDriftMonitoringConfig = {
  schedule: '15 0 * * *',
  maxNetworks: 200,
  maxPairs: 10_000,
  minUsers: 5,
};
