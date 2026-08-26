import { beforeEach, describe, expect, mock, test } from 'bun:test';

const fromIntentAddJob = mock(async () => undefined);

mock.module('../../lib/opportunity/discovery', () => ({
  intentDiscovery: { addJob: fromIntentAddJob },
}));
mock.module('../../lib/drizzle/drizzle', () => ({ default: {} }));
mock.module('../../adapters/database.adapter', () => ({
  ChatDatabaseAdapter: class {},
  chatDatabaseAdapter: {},
}));
mock.module('../../adapters/cache.adapter', () => ({
  RedisCacheAdapter: class {},
}));
mock.module('../../adapters/embedder.adapter', () => ({
  EmbedderAdapter: class {},
}));
mock.module('../../lib/opportunity/outcome-feedback.recorder', () => ({ outcomeFeedbackRecorder: {} }));

const { OpportunityService } = await import('../opportunity.service');

describe('OpportunityService maintenance rediscovery', () => {
  beforeEach(() => {
    fromIntentAddJob.mockClear();
  });

  test('starts intent discovery when the maintenance graph rediscovers', async () => {
    const service = new OpportunityService({
      getOpportunitiesForUser: async () => [],
      getActiveIntents: async () => [{ id: 'intent-1', payload: 'Find a technical cofounder' }],
    } as never, {
      get: async () => null,
      set: async () => {},
    } as never);

    service.triggerMaintenance('user-1', 'test');

    await waitFor(() => fromIntentAddJob.mock.calls.length === 1);

    expect(fromIntentAddJob).toHaveBeenCalledWith(
      { intentId: 'intent-1', userId: 'user-1' },
    );
  });
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('maintenance graph did not start discovery');
}
