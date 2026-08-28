import { ChatDatabaseAdapter } from '../../adapters/chat.database.adapter';
import { EmbedderAdapter } from '../../adapters/embedder.adapter';
import { RedisCacheAdapter } from '../../adapters/cache.adapter';
import { HydeGraphFactory, HydeGenerator, LensInferrer, type HydeGraphDatabase } from '@indexnetwork/protocol';

export interface SeedIntentIndexInput {
  intentId: string;
  userId: string;
  description: string;
}

export interface SeedIntentIndexDependencies {
  generateEmbedding(description: string): Promise<number[] | number[][]>;
  updateIntent(intentId: string, data: { embedding: number[]; expectedIntentUserId: string }): Promise<unknown | null>;
  runHyde(input: { intentId: string; userId: string; sourceText: string }): Promise<void>;
}

/**
 * The provider-backed seed indexing path for deterministic, already-persisted
 * intents. It rejects malformed embeddings and failed ownership-scoped writes
 * rather than silently persisting a placeholder vector.
 */
export async function indexExistingIntentForSeed(
  deps: SeedIntentIndexDependencies,
  input: SeedIntentIndexInput,
): Promise<void> {
  const generated = await deps.generateEmbedding(input.description);
  if (!Array.isArray(generated) || generated.length !== 2000 || generated.some((value) => typeof value !== 'number')) {
    throw new Error(`Seed intent ${input.intentId} did not receive a valid 2000-dimensional embedding`);
  }

  const updated = await deps.updateIntent(input.intentId, {
    embedding: generated as number[],
    expectedIntentUserId: input.userId,
  });
  if (!updated) throw new Error(`Seed intent ${input.intentId} was not found or is not owned by ${input.userId}`);

  await deps.runHyde({
    intentId: input.intentId,
    userId: input.userId,
    sourceText: input.description,
  });
}

/**
 * Creates the production embed/persist/HyDE composition without importing
 * IntentQueue or application services. Fixture network assignments already
 * exist, so this deliberately performs no admission or discovery work.
 */
export function createSeedIntentIndexer(): (input: SeedIntentIndexInput) => Promise<void> {
  const database = new ChatDatabaseAdapter();
  const embedder = new EmbedderAdapter();
  const cache = new RedisCacheAdapter();
  const hydeGraph = new HydeGraphFactory(
    database as unknown as HydeGraphDatabase,
    embedder,
    cache,
    new LensInferrer(),
    new HydeGenerator(),
  ).createGraph();

  return async (input) => indexExistingIntentForSeed({
    generateEmbedding: (description) => embedder.generate(description),
    updateIntent: (intentId, data) => database.updateIntent(intentId, data),
    runHyde: async ({ intentId, sourceText }) => {
      await hydeGraph.invoke({
        sourceText,
        sourceType: 'intent',
        sourceId: intentId,
        forceRegenerate: true,
      });
    },
  }, input);
}
