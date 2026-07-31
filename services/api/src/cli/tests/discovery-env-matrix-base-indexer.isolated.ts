import { afterAll, describe, expect, it, mock } from 'bun:test';

const generate = mock(async () => Array.from({ length: 2000 }, (_value, index) => index / 2000));
const updateIntent = mock(async () => ({ id: 'fixture-intent' }));
const invokeHyde = mock(async () => {});

mock.module('../../adapters/chat.database.adapter', () => ({
  ChatDatabaseAdapter: class {
    updateIntent = updateIntent;
  },
}));
mock.module('../../adapters/embedder.adapter', () => ({
  EmbedderAdapter: class {
    generate = generate;
  },
}));
mock.module('../../adapters/cache.adapter', () => ({
  RedisCacheAdapter: class {},
}));
mock.module('../../queues/intent.queue', () => {
  throw new Error('base fixture indexer must not import IntentQueue');
});
mock.module('../../services/intent.service', () => {
  throw new Error('base fixture indexer must not import IntentService');
});
mock.module('@indexnetwork/protocol', () => ({
  HydeGraphFactory: class {
    createGraph() {
      return { invoke: invokeHyde };
    }
  },
  HydeGenerator: class {},
  LensInferrer: class {},
}));

afterAll(() => {
  mock.restore();
});

const { createBaseFixtureIntentIndexer } = await import('../discovery-env-matrix-base');

describe('protected base fixture intent indexer composition', () => {
  it('constructs the supported embed/persist/HyDE path without queue or app startup imports', async () => {
    const indexFixtureIntent = await createBaseFixtureIntentIndexer();

    await indexFixtureIntent({
      id: 'fixture-intent',
      userId: 'fixture-owner',
      networkId: 'fixture-network',
      payload: 'Find a complementary collaborator.',
      summary: 'Fixture intent',
    });

    expect(generate).toHaveBeenCalledWith('Find a complementary collaborator.');
    expect(updateIntent).toHaveBeenCalledWith('fixture-intent', {
      embedding: expect.any(Array),
      expectedIntentUserId: 'fixture-owner',
    });
    expect(invokeHyde).toHaveBeenCalledWith({
      sourceText: 'Find a complementary collaborator.',
      sourceType: 'intent',
      sourceId: 'fixture-intent',
      forceRegenerate: true,
    });
  });
});
