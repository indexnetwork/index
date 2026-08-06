import { describe, expect, it } from 'bun:test';

import { buildBackfillEnrichmentItems } from '../backfill-premises.payload';

describe('buildBackfillEnrichmentItems', () => {
  it('preserves network scope and producer reason for every queued member', () => {
    expect(buildBackfillEnrichmentItems(
      [{ userId: 'user-1' }, { userId: 'user-2' }],
      'network-1',
    )).toEqual([
      { userId: 'user-1', networkId: 'network-1', reason: 'backfill_premises' },
      { userId: 'user-2', networkId: 'network-1', reason: 'backfill_premises' },
    ]);
  });
});
