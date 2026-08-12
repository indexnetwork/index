import { describe, expect, it } from 'bun:test';

import { requireHermesPreflightThresholds } from '../hermes-assurance-thresholds';

describe('Hermes assurance thresholds', () => {
  it('strictly parses both required positive safe decimal integers', () => {
    expect(requireHermesPreflightThresholds({
      HERMES_PREFLIGHT_MAX_LOCK_MS: '7123',
      HERMES_PREFLIGHT_MAX_TOTAL_MS: '45678',
    })).toEqual({ maxLockMs: 7123, maxTotalMs: 45678 });
  });

  it('refuses missing, blank, non-canonical, zero, and unsafe values without defaults', () => {
    for (const value of [undefined, '', ' ', '0', '01', '+1', '1.0', '1e3', '-1', '9007199254740992']) {
      expect(() => requireHermesPreflightThresholds({
        HERMES_PREFLIGHT_MAX_LOCK_MS: value,
        HERMES_PREFLIGHT_MAX_TOTAL_MS: '30000',
      })).toThrow('HERMES_PREFLIGHT_MAX_LOCK_MS');
      expect(() => requireHermesPreflightThresholds({
        HERMES_PREFLIGHT_MAX_LOCK_MS: '5000',
        HERMES_PREFLIGHT_MAX_TOTAL_MS: value,
      })).toThrow('HERMES_PREFLIGHT_MAX_TOTAL_MS');
    }
  });
});
