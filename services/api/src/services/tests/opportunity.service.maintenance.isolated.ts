import { beforeEach, describe, expect, mock, test } from 'bun:test';

const fromIntentAddJob = mock(async () => ({ id: 'from-intent-job' }));
const fromIntroducerAddJob = mock(async () => ({ id: 'from-introducer-job' }));

mock.module('../../queues/opportunity/from-intent.queue', () => ({
  fromIntentQueue: { addJob: fromIntentAddJob },
}));
mock.module('../../queues/opportunity/from-introducer.queue', () => ({
  fromIntroducerQueue: { addJob: fromIntroducerAddJob },
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
mock.module('../../lib/opportunity/uptake-acceptance.guard', () => ({ uptakeAcceptanceGuard: {} }));
mock.module('../../lib/opportunity/outcome-feedback.recorder', () => ({ outcomeFeedbackRecorder: {} }));

const { OpportunityService } = await import('../opportunity.service');

describe('OpportunityService maintenance queue composition', () => {
  beforeEach(() => {
    fromIntentAddJob.mockClear();
    fromIntroducerAddJob.mockClear();
  });

  test('routes maintenance rediscovery and introducer work through retained background queues', async () => {
    const service = new OpportunityService({
      getOpportunitiesForUser: async () => [],
      getActiveIntents: async () => [{ id: 'intent-1', payload: 'Find a technical cofounder' }],
      getPersonalIndexId: async () => 'personal-index-1',
      getContactsWithIntentFreshness: async () => [{
        userId: 'contact-1',
        latestIntentAt: new Date().toISOString(),
        intentCount: 1,
      }],
    } as never, {
      get: async () => null,
      set: async () => {},
    } as never);

    service.triggerMaintenance('user-1', 'test');

    await waitFor(() => fromIntentAddJob.mock.calls.length === 1 && fromIntroducerAddJob.mock.calls.length === 1);

    expect(fromIntentAddJob).toHaveBeenCalledWith(
      { intentId: 'intent-1', userId: 'user-1' },
      expect.objectContaining({ priority: 10 }),
    );
    expect(fromIntroducerAddJob).toHaveBeenCalledWith(
      { userId: 'user-1', contactUserId: 'contact-1', networkIds: ['personal-index-1'] },
      expect.objectContaining({ priority: 15 }),
    );
  });
});

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error('maintenance graph did not enqueue both retained queues');
}
