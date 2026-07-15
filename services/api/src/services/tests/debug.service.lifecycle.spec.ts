import { describe, expect, it } from 'bun:test';

import { isDebugDiscoveryIntentActive } from '../debug.service';

describe('debug intent discovery lifecycle admission', () => {
  it('admits only owned, non-archived active or legacy-null intents', () => {
    expect(isDebugDiscoveryIntentActive({
      userId: 'user-1', status: 'ACTIVE', archivedAt: null,
    }, 'user-1')).toBe(true);
    expect(isDebugDiscoveryIntentActive({
      userId: 'user-1', status: null, archivedAt: null,
    }, 'user-1')).toBe(true);

    for (const status of ['PAUSED', 'FULFILLED', 'EXPIRED'] as const) {
      expect(isDebugDiscoveryIntentActive({
        userId: 'user-1', status, archivedAt: null,
      }, 'user-1')).toBe(false);
    }
    expect(isDebugDiscoveryIntentActive({
      userId: 'user-1', status: 'ACTIVE', archivedAt: new Date(),
    }, 'user-1')).toBe(false);
    expect(isDebugDiscoveryIntentActive({
      userId: 'user-2', status: 'ACTIVE', archivedAt: null,
    }, 'user-1')).toBe(false);
    expect(isDebugDiscoveryIntentActive(null, 'user-1')).toBe(false);
  });
});
