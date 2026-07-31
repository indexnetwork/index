import { afterAll, describe, expect, it, mock } from 'bun:test';

mock.module('../../lib/drizzle/drizzle', () => ({
  default: {},
  closeDb: async () => {},
}));
mock.module('../../adapters/database.adapter', () => ({
  IntentDatabaseAdapter: class {},
  intentDatabaseAdapter: {},
}));
mock.module('../../adapters/intent.database.adapter', () => ({
  IntentDatabaseAdapter: class {},
  intentDatabaseAdapter: {},
}));
mock.module('../../adapters/chat.database.adapter', () => ({
  ChatDatabaseAdapter: class {},
}));
mock.module('../../adapters/cache.adapter', () => ({
  RedisCacheAdapter: class {},
}));
mock.module('../../adapters/embedder.adapter', () => ({
  EmbedderAdapter: class {},
}));
mock.module('../../adapters/intent-proposal.database.adapter', () => ({
  IntentProposalDatabaseAdapter: class {},
  intentProposalDatabaseAdapter: {},
}));
mock.module('../../queues/intent.queue', () => ({
  intentQueue: {
    addGenerateHydeJob: mock(async () => {}),
    runGenerateHydeSync: mock(async () => {}),
  },
}));
mock.module('../../queues/questioner.queue', () => ({
  questionerEnqueueIfEnabled: () => undefined,
}));
mock.module('../../events/intent.event', () => ({
  IntentEvents: { onCreated: () => {} },
}));

afterAll(() => {
  mock.restore();
});

import type { IntentDatabaseAdapter } from '../../adapters/database.adapter';
import type { EmbedderAdapter } from '../../adapters/embedder.adapter';

const { IntentService } = await import('../intent.service');

const INTENT_ID = 'fixture-intent';
const OWNER_ID = 'fixture-owner';
const PAYLOAD = 'Find a complementary collaborator for the fixture scenario.';

function createService(options: {
  embedding: number[];
  updateResult?: { id: string } | null;
}) {
  const generate = mock(async () => options.embedding);
  const updateIntent = mock(async () => options.updateResult === undefined ? { id: INTENT_ID } : options.updateResult);
  const runGenerateHydeSync = mock(async () => {});
  const service = new IntentService({
    adapter: { updateIntent } as unknown as IntentDatabaseAdapter,
    embedder: { generate } as unknown as EmbedderAdapter,
    seedIndexQueue: { runGenerateHydeSync },
  });
  return { service, generate, updateIntent, runGenerateHydeSync };
}

describe('IntentService.indexExistingIntentForSeed', () => {
  it('generates, validates, persists, and HyDE-indexes a real 2000-dimensional embedding', async () => {
    const embedding = Array.from({ length: 2000 }, (_value, index) => index / 2000);
    const { service, generate, updateIntent, runGenerateHydeSync } = createService({ embedding });

    await service.indexExistingIntentForSeed(INTENT_ID, OWNER_ID, PAYLOAD);

    expect(generate).toHaveBeenCalledWith(PAYLOAD);
    expect(updateIntent).toHaveBeenCalledWith(INTENT_ID, {
      embedding,
      expectedIntentUserId: OWNER_ID,
    });
    expect(runGenerateHydeSync).toHaveBeenCalledWith(
      { intentId: INTENT_ID, userId: OWNER_ID },
      { skipOpportunity: true },
    );
  });

  it('rejects invalid embedding dimensions before persistence or HyDE indexing', async () => {
    const { service, updateIntent, runGenerateHydeSync } = createService({
      embedding: Array.from({ length: 1999 }, () => 0.1),
    });

    await expect(service.indexExistingIntentForSeed(INTENT_ID, OWNER_ID, PAYLOAD)).rejects.toThrow(
      'valid 2000-dimensional embedding',
    );

    expect(updateIntent).not.toHaveBeenCalled();
    expect(runGenerateHydeSync).not.toHaveBeenCalled();
  });

  it('rejects an ownership-scoped persistence failure before HyDE indexing', async () => {
    const { service, updateIntent, runGenerateHydeSync } = createService({
      embedding: Array.from({ length: 2000 }, () => 0.1),
      updateResult: null,
    });

    await expect(service.indexExistingIntentForSeed(INTENT_ID, OWNER_ID, PAYLOAD)).rejects.toThrow(
      `not found or is not owned by ${OWNER_ID}`,
    );

    expect(updateIntent).toHaveBeenCalledWith(INTENT_ID, expect.objectContaining({
      expectedIntentUserId: OWNER_ID,
    }));
    expect(runGenerateHydeSync).not.toHaveBeenCalled();
  });
});
