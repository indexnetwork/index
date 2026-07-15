import { describe, expect, it } from 'bun:test';

import { assertNoPausedIntentsForRediscovery } from '../rediscover-user-opportunities.guard';

describe('assertNoPausedIntentsForRediscovery', () => {
  it('allows rediscovery when no paused intents exist', () => {
    expect(() => assertNoPausedIntentsForRediscovery('user-1', [])).not.toThrow();
  });

  it('fails closed with operator guidance when paused intents exist', () => {
    expect(() => assertNoPausedIntentsForRediscovery('user-1', ['intent-1', 'intent-2']))
      .toThrow(
        'Refusing destructive rediscovery for user user-1: found 2 non-archived paused intent(s). '
        + 'Resume them before running this maintenance command; paused Radar and negotiation data were not deleted.',
      );
  });
});
