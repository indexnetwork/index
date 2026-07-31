import { describe, expect, it, mock } from 'bun:test';

import { assertSmokeEnvironment, buildSmokeSeedPlan, DeterministicSmokeEmbedder, runSmoke, SMOKE_CLEANUP_ORDER, withDiscoveryProfileSource } from '../discovery-retrieval-smoke.main';

const SAFE_ENV: NodeJS.ProcessEnv = {
  DISCOVERY_RETRIEVAL_EVAL_CONFIRM: '1',
  TEST_DATABASE_SAFE: '1',
  DATABASE_URL: 'postgres://x@ep-disposable.neon.tech/protocol_prod',
  DISCOVERY_RETRIEVAL_EVAL_BRANCH: 'eval-discovery-retrieval-provider-free-test',
};

describe('assertSmokeEnvironment', () => {
  it.each([
    [{}, 'DISCOVERY_RETRIEVAL_EVAL_CONFIRM'],
    [{ DISCOVERY_RETRIEVAL_EVAL_CONFIRM: '1' }, 'TEST_DATABASE_SAFE'],
    [{
      DISCOVERY_RETRIEVAL_EVAL_CONFIRM: '1',
      TEST_DATABASE_SAFE: '1',
      DATABASE_URL: 'postgres://x@localhost/db',
      DISCOVERY_RETRIEVAL_EVAL_BRANCH: 'eval-discovery-retrieval-x',
    }, 'non-Neon'],
    [{
      DISCOVERY_RETRIEVAL_EVAL_CONFIRM: '1',
      TEST_DATABASE_SAFE: '1',
      DATABASE_URL: 'postgres://x@ep-x.neon.tech/db',
      DISCOVERY_RETRIEVAL_EVAL_BRANCH: 'dev',
    }, 'DISCOVERY_RETRIEVAL_EVAL_BRANCH'],
  ])('rejects unsafe environment %#', (env, message) => {
    expect(() => assertSmokeEnvironment(env as NodeJS.ProcessEnv)).toThrow(message);
  });

  it('accepts explicit disposable-Neon attestation', () => {
    expect(assertSmokeEnvironment(SAFE_ENV)).toMatchObject({
      declaredBranch: 'eval-discovery-retrieval-provider-free-test',
    });
  });
});

describe('deterministic smoke plans', () => {
  it('uses a provider-free graph embedder with deterministic 2000-dimensional vectors', async () => {
    const previousOpenAiKey = process.env.OPENAI_API_KEY;
    const previousOpenRouterKey = process.env.OPENROUTER_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.OPENROUTER_API_KEY;

    try {
      const embedder = new DeterministicSmokeEmbedder();
      const [single, batch, hydeResults, repeatedHydeResults] = await Promise.all([
        embedder.generate('any source text'),
        embedder.generate(['first source text', 'second source text']),
        embedder.searchWithHydeEmbeddings([], { indexScope: ['network'] }),
        embedder.searchWithHydeEmbeddings([], { indexScope: ['network'] }),
      ]);

      expect(single).toHaveLength(2000);
      expect(batch).toEqual([single, single]);
      expect(hydeResults).toEqual([]);
      expect(repeatedHydeResults).toEqual(hydeResults);
      await expect(embedder.search([], 'intents')).resolves.toEqual([]);
    } finally {
      if (previousOpenAiKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = previousOpenAiKey;
      if (previousOpenRouterKey === undefined) delete process.env.OPENROUTER_API_KEY;
      else process.env.OPENROUTER_API_KEY = previousOpenRouterKey;
    }
  });

  it('uses marker-scoped IDs and paired 2000-dimensional source/candidate vectors', () => {
    const plan = buildSmokeSeedPlan('eval-discovery-retrieval-test-marker');

    expect(plan.ids.sourceUserId).toContain('eval-discovery-retrieval-test-marker');
    expect(plan.ids.candidateContextId).toContain('eval-discovery-retrieval-test-marker');
    expect(plan.sourceVector).toHaveLength(2000);
    expect(plan.sourceVector).toEqual(buildSmokeSeedPlan('another-marker').sourceVector);
    expect(plan.sourceVector).not.toEqual(plan.distractorVector);
  });

  it('declares FK-safe marker-scoped cleanup order', () => {
    expect(SMOKE_CLEANUP_ORDER).toEqual([
      'opportunities',
      'intent_networks',
      'premise_networks',
      'user_contexts',
      'premises',
      'intents',
      'network_members',
      'networks',
      'users',
    ]);
  });
});

describe('withDiscoveryProfileSource', () => {
  it('restores DISCOVERY_PROFILE_SOURCE when graph invocation throws', async () => {
    const previous = process.env.DISCOVERY_PROFILE_SOURCE;
    process.env.DISCOVERY_PROFILE_SOURCE = 'original-source';

    try {
      await expect(withDiscoveryProfileSource('user_context', async () => {
        expect(process.env.DISCOVERY_PROFILE_SOURCE).toBe('user_context');
        throw new Error('graph invocation failed');
      })).rejects.toThrow('graph invocation failed');

      expect(process.env.DISCOVERY_PROFILE_SOURCE).toBe('original-source');
    } finally {
      if (previous === undefined) delete process.env.DISCOVERY_PROFILE_SOURCE;
      else process.env.DISCOVERY_PROFILE_SOURCE = previous;
    }
  });
});

describe('runSmoke', () => {
  it('runs lightweight then premise assertions and always cleans up', async () => {
    const calls: string[] = [];

    await runSmoke(SAFE_ENV, {
      seed: async () => ({ sourceUserId: 'source', candidateUserId: 'candidate', networkId: 'network' }),
      runDiscovery: async ({ mode }) => {
        calls.push(mode);
        return mode === 'user_context'
          ? { candidateUserIds: ['candidate'], contextSearchCalls: 1 }
          : { candidateUserIds: [], contextSearchCalls: 0 };
      },
      cleanup: async () => { calls.push('cleanup'); },
      log: () => {},
    });

    expect(calls).toEqual(['user_context', 'premise', 'cleanup']);
  });

  it('cleans up when seed rejects after partial work', async () => {
    const cleanup = mock(async () => {});
    const partialWork: string[] = [];

    await expect(runSmoke(SAFE_ENV, {
      seed: async () => {
        partialWork.push('seeded-network');
        throw new Error('seed failed after partial work');
      },
      runDiscovery: async () => ({ candidateUserIds: [], contextSearchCalls: 0 }),
      cleanup,
      log: () => {},
    })).rejects.toThrow('seed failed after partial work');

    expect(partialWork).toEqual(['seeded-network']);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('cleans up after a failed lightweight assertion', async () => {
    const cleanup = mock(async () => {});

    await expect(runSmoke(SAFE_ENV, {
      seed: async () => ({ sourceUserId: 'source', candidateUserId: 'candidate', networkId: 'network' }),
      runDiscovery: async () => ({ candidateUserIds: [], contextSearchCalls: 0 }),
      cleanup,
      log: () => {},
    })).rejects.toThrow('did not return expected');

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('fails when premise mode calls the context candidate search and still cleans up', async () => {
    const cleanup = mock(async () => {});

    await expect(runSmoke(SAFE_ENV, {
      seed: async () => ({ sourceUserId: 'source', candidateUserId: 'candidate', networkId: 'network' }),
      runDiscovery: async ({ mode }) => mode === 'user_context'
        ? { candidateUserIds: ['candidate'], contextSearchCalls: 1 }
        : { candidateUserIds: ['candidate'], contextSearchCalls: 1 },
      cleanup,
      log: () => {},
    })).rejects.toThrow('Premise mode unexpectedly invoked context-to-context search');

    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
