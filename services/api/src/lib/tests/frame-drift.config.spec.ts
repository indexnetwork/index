import { describe, expect, it } from 'bun:test';

import { resolveFrameDriftMonitoringConfig } from '../frame-drift.config';

describe('resolveFrameDriftMonitoringConfig', () => {
  it('is disabled by default with bounded daily defaults', () => {
    expect(resolveFrameDriftMonitoringConfig({})).toEqual({
      enabled: false,
      schedule: '15 0 * * *',
      maxNetworks: 200,
      maxPairs: 10_000,
      minUsers: 5,
    });
  });

  it('accepts an enabled fixed once-daily UTC schedule', () => {
    expect(resolveFrameDriftMonitoringConfig({
      FRAME_DRIFT_MONITORING_ENABLED: ' TRUE ',
      FRAME_DRIFT_MONITORING_SCHEDULE: '30 23 * * *',
    }).enabled).toBe(true);
    expect(resolveFrameDriftMonitoringConfig({
      FRAME_DRIFT_MONITORING_SCHEDULE: '30 23 * * *',
    }).schedule).toBe('30 23 * * *');
  });

  it('falls back for invalid or potentially more-frequent schedules', () => {
    for (const schedule of [
      'not a cron',
      '*/5 * * * *',
      '0 */2 * * *',
      '0 0,12 * * *',
      '0 0 * * 1',
      '0 0 * 1 *',
      '0 0 * * * *',
      '60 1 * * *',
      '0 24 * * *',
    ]) {
      expect(resolveFrameDriftMonitoringConfig({
        FRAME_DRIFT_MONITORING_SCHEDULE: schedule,
      }).schedule).toBe('15 0 * * *');
    }
  });

  it('clamps cohort limits and minUsers', () => {
    expect(resolveFrameDriftMonitoringConfig({
      FRAME_DRIFT_MONITORING_MAX_NETWORKS: '999',
      FRAME_DRIFT_MONITORING_MAX_PAIRS: '999999',
      FRAME_DRIFT_MONITORING_MIN_USERS: '1',
    })).toMatchObject({ maxNetworks: 200, maxPairs: 10_000, minUsers: 2 });
    expect(resolveFrameDriftMonitoringConfig({
      FRAME_DRIFT_MONITORING_MAX_NETWORKS: '0',
      FRAME_DRIFT_MONITORING_MAX_PAIRS: '-2',
      FRAME_DRIFT_MONITORING_MIN_USERS: '101',
    })).toMatchObject({ maxNetworks: 1, maxPairs: 1, minUsers: 100 });
    expect(resolveFrameDriftMonitoringConfig({
      FRAME_DRIFT_MONITORING_MIN_USERS: 'invalid',
    }).minUsers).toBe(5);
  });
});
