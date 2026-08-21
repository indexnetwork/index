import { describe, expect, it } from 'bun:test';

import { FRAME_DRIFT_MONITORING } from '../frame-drift.config';

describe('FRAME_DRIFT_MONITORING', () => {
  it('runs once daily on a fixed UTC schedule with bounded cohort limits', () => {
    expect(FRAME_DRIFT_MONITORING).toEqual({
      schedule: '15 0 * * *',
      maxNetworks: 200,
      maxPairs: 10_000,
      minUsers: 5,
    });
  });
});
