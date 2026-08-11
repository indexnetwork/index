import { afterAll, beforeEach, describe, expect, it, mock } from 'bun:test';

const observedThresholdOverrides: unknown[] = [];

mock.module('@indexnetwork/protocol', () => ({
  HydeGenerator: class HydeGenerator {},
  HydeGraphFactory: class HydeGraphFactory {
    createGraph() {
      return { invoke: async () => ({}) };
    }
  },
  LensInferrer: class LensInferrer {},
  OpportunityEvaluator: class OpportunityEvaluator {},
  OpportunityGraphFactory: class OpportunityGraphFactory {
    constructor(
      _graphDb: unknown,
      _embedder: unknown,
      _hydeGraph: unknown,
      _evaluator: unknown,
      _arg5?: unknown,
      _arg6?: unknown,
      _arg7?: unknown,
      _arg8?: unknown,
      _arg9?: unknown,
      thresholdOverrides?: unknown,
    ) {
      observedThresholdOverrides.push(thresholdOverrides);
    }

    createGraph() {
      return { invoke: async () => ({}) };
    }
  },
  PremiseGraphFactory: class PremiseGraphFactory {
    createGraph() {
      return { invoke: async () => ({}) };
    }
  },
  UserContextGenerator: class UserContextGenerator {},
  discoveryEvaluatorMinScore: () => Number(process.env.DISCOVERY_EVALUATOR_MIN_SCORE ?? '50'),
}));

mock.module('../../adapters/database.adapter', () => ({
  ChatDatabaseAdapter: class ChatDatabaseAdapter {},
}));
mock.module('../../adapters/embedder.adapter', () => ({
  EmbedderAdapter: class EmbedderAdapter {},
}));
mock.module('../../adapters/cache.adapter', () => ({
  RedisCacheAdapter: class RedisCacheAdapter {},
  closeRedisConnection: async () => undefined,
}));

const { createChildDependencies, discoveryChildThresholdOverrides } = await import('../discovery-env-matrix.main');

afterAll(() => mock.restore());

beforeEach(() => {
  observedThresholdOverrides.length = 0;
  delete process.env.DISCOVERY_EVALUATOR_MIN_SCORE;
});

describe('createChildDependencies threshold defaults', () => {
  it('keeps the historical matrix child constructor fixed at evaluatorMinScore 50 even when process env asks for 37.5', async () => {
    process.env.DISCOVERY_EVALUATOR_MIN_SCORE = '37.5';

    await createChildDependencies();

    expect(observedThresholdOverrides).toEqual([{ evaluatorMinScore: 50 }]);
  });

  it('still exposes the env-derived A/B child override separately', () => {
    process.env.DISCOVERY_EVALUATOR_MIN_SCORE = '37.5';

    expect(discoveryChildThresholdOverrides()).toEqual({ evaluatorMinScore: 37.5 });
  });
});
