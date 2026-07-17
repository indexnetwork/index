/**
 * Unit tests for PremiseEvents hooks and PremiseQueue cascade/regen logic.
 * No DB or Redis needed — all external deps are mocked at module level.
 *
 * Note: env stubs are set here so the module-level adapter singletons can
 * instantiate without real credentials. These keys are never used in tests
 * because the injected deps bypass the production code paths.
 */

// Must be before any imports: Bun hoists mock.module and static imports together,
// so we also need env stubs for adapters that instantiate at module evaluation time.
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'test-placeholder';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-placeholder';
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://localhost:5432/test';

import { describe, expect, it, mock, beforeEach, afterEach, afterAll } from 'bun:test';

// ---------------------------------------------------------------------------
// node-cron mock — prevent real cron scheduling
// ---------------------------------------------------------------------------
mock.module('node-cron', () => ({
  default: {
    schedule: mock(() => ({ start: () => {}, stop: () => {} })),
  },
}));

// ---------------------------------------------------------------------------
// QueueFactory mock — prevent Redis connections on construction
// ---------------------------------------------------------------------------
mock.module('../../lib/bullmq/bullmq', () => ({
  QueueFactory: {
    createQueue: () => ({
      add: mock(async () => ({ id: 'job-1' })),
      close: mock(async () => {}),
    }),
    createWorker: mock(() => ({ close: mock(async () => {}) })),
    createQueueEvents: mock(() => ({})),
  },
}));

// ---------------------------------------------------------------------------
// Adapter mocks — prevent singleton instantiation (OpenAI/DB clients) at import time.
// Paths are relative to THIS test file (src/events/tests/), resolving to src/adapters/*.
// ---------------------------------------------------------------------------
mock.module('../../adapters/embedder.adapter', () => ({
  EmbedderAdapter: class {
    embed = async () => [];
  },
  embedderAdapter: { embed: async () => [] },
}));

mock.module('../../adapters/scraper.adapter', () => ({
  ScraperAdapter: class {
    scrape = async () => '';
  },
  scraperAdapter: { scrape: async () => '' },
}));

mock.module('../../adapters/database.adapter', () => ({
  ChatDatabaseAdapter: class {
    getExpiredPremises = async () => [];
    updatePremise = async () => {};
  },
  OpportunityDatabaseAdapter: class {
    getOpportunitiesForUser = async () => [];
    updateOpportunityStatus = async () => {};
  },
  EnrichmentDatabaseAdapter: class {
    getProfile = async () => null;
  },
}));

// ---------------------------------------------------------------------------
// Protocol mock — EnrichmentGraphFactory not needed for unit tests
// ---------------------------------------------------------------------------
mock.module('@indexnetwork/protocol', () => ({
  EnrichmentGraphFactory: class {
    createGraph() {
      return { invoke: mock(async () => {}) };
    }
  },
}));

afterAll(() => {
  mock.restore();
});

// ---------------------------------------------------------------------------
// Imports (must come after mock.module calls)
// ---------------------------------------------------------------------------
import { PremiseEvents } from '../premise.event';
import { PremiseQueue } from '../../queues/premise.queue';
import type { PremiseQueueDeps, NonTerminalStatus, IntentReverificationVerdict } from '../../queues/premise.queue';

/** Deps that silence the re-verification path for opportunity-focused tests. */
const noReverifyDeps: Pick<PremiseQueueDeps, 'getPremiseEmbedding'> = {
  getPremiseEmbedding: async () => null,
};

// ---------------------------------------------------------------------------
// PremiseEvents tests
// ---------------------------------------------------------------------------
describe('PremiseEvents', () => {
  let savedOnCreated: typeof PremiseEvents.onCreated;
  let savedOnRetracted: typeof PremiseEvents.onRetracted;
  let savedOnUpdated: typeof PremiseEvents.onUpdated;
  let savedOnExpired: typeof PremiseEvents.onExpired;

  beforeEach(() => {
    savedOnCreated = PremiseEvents.onCreated;
    savedOnRetracted = PremiseEvents.onRetracted;
    savedOnUpdated = PremiseEvents.onUpdated;
    savedOnExpired = PremiseEvents.onExpired;
  });

  afterEach(() => {
    PremiseEvents.onCreated = savedOnCreated;
    PremiseEvents.onRetracted = savedOnRetracted;
    PremiseEvents.onUpdated = savedOnUpdated;
    PremiseEvents.onExpired = savedOnExpired;
  });

  it('fires onCreated with premiseId and userId', () => {
    const handler = mock((_premiseId: string, _userId: string) => {});
    PremiseEvents.onCreated = handler;
    PremiseEvents.onCreated('premise-1', 'user-1');
    expect(handler).toHaveBeenCalledWith('premise-1', 'user-1');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fires onRetracted with premiseId and userId', () => {
    const handler = mock((_premiseId: string, _userId: string) => {});
    PremiseEvents.onRetracted = handler;
    PremiseEvents.onRetracted('premise-2', 'user-2');
    expect(handler).toHaveBeenCalledWith('premise-2', 'user-2');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fires onUpdated with premiseId and userId', () => {
    const handler = mock((_premiseId: string, _userId: string) => {});
    PremiseEvents.onUpdated = handler;
    PremiseEvents.onUpdated('premise-3', 'user-3');
    expect(handler).toHaveBeenCalledWith('premise-3', 'user-3');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('fires onExpired with premiseId and userId', () => {
    const handler = mock((_premiseId: string, _userId: string) => {});
    PremiseEvents.onExpired = handler;
    PremiseEvents.onExpired('premise-4', 'user-4');
    expect(handler).toHaveBeenCalledWith('premise-4', 'user-4');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('all four event hooks exist on PremiseEvents', () => {
    expect(PremiseEvents).toHaveProperty('onCreated');
    expect(PremiseEvents).toHaveProperty('onUpdated');
    expect(PremiseEvents).toHaveProperty('onRetracted');
    expect(PremiseEvents).toHaveProperty('onExpired');
    expect(typeof PremiseEvents.onCreated).toBe('function');
    expect(typeof PremiseEvents.onUpdated).toBe('function');
    expect(typeof PremiseEvents.onRetracted).toBe('function');
    expect(typeof PremiseEvents.onExpired).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// PremiseQueue cascade tests
// ---------------------------------------------------------------------------
describe('PremiseQueue — premise_cascade', () => {
  it('passes both userId and premiseId to the targeted opportunity fetch', async () => {
    const fetchArgs: Array<[string, string]> = [];
    const deps: PremiseQueueDeps = {
      ...noReverifyDeps,
      getOpportunitiesCitingPremise: async (userId, premiseId) => {
        fetchArgs.push([userId, premiseId]);
        return [];
      },
      updateOpportunityStatus: async () => {},
    };
    const queue = new PremiseQueue(deps);
    await queue.processJob('premise_cascade', { premiseId: 'p-0', userId: 'u-0', event: 'retracted' });
    expect(fetchArgs).toEqual([['u-0', 'p-0']]);
  });

  it('transitions draft and latent opportunities citing the premise to expired', async () => {
    const transitions: Array<[string, string]> = [];
    const deps: PremiseQueueDeps = {
      ...noReverifyDeps,
      getOpportunitiesCitingPremise: async () => [
        { id: 'opp-1', status: 'draft' as NonTerminalStatus },
        { id: 'opp-2', status: 'latent' as NonTerminalStatus },
      ],
      updateOpportunityStatus: async (id, status) => {
        transitions.push([id, status]);
      },
    };
    const queue = new PremiseQueue(deps);
    await queue.processJob('premise_cascade', { premiseId: 'p-1', userId: 'u-1', event: 'retracted' });
    expect(transitions).toEqual([
      ['opp-1', 'expired'],
      ['opp-2', 'expired'],
    ]);
  });

  it('transitions pending and negotiating opportunities to expired, never stalled', async () => {
    const transitions: Array<[string, string]> = [];
    const deps: PremiseQueueDeps = {
      ...noReverifyDeps,
      getOpportunitiesCitingPremise: async () => [
        { id: 'opp-1', status: 'pending' as NonTerminalStatus },
        { id: 'opp-2', status: 'negotiating' as NonTerminalStatus },
      ],
      updateOpportunityStatus: async (id, status) => {
        transitions.push([id, status]);
      },
    };
    const queue = new PremiseQueue(deps);
    await queue.processJob('premise_cascade', { premiseId: 'p-2', userId: 'u-2', event: 'expired' });
    expect(transitions).toEqual([
      ['opp-1', 'expired'],
      ['opp-2', 'expired'],
    ]);
  });

  it('handles mixed statuses: every citing cascade-eligible opportunity expires', async () => {
    const transitions: Array<[string, string]> = [];
    const deps: PremiseQueueDeps = {
      ...noReverifyDeps,
      getOpportunitiesCitingPremise: async () => [
        { id: 'opp-a', status: 'draft' as NonTerminalStatus },
        { id: 'opp-b', status: 'pending' as NonTerminalStatus },
        { id: 'opp-c', status: 'latent' as NonTerminalStatus },
        { id: 'opp-d', status: 'negotiating' as NonTerminalStatus },
      ],
      updateOpportunityStatus: async (id, status) => {
        transitions.push([id, status]);
      },
    };
    const queue = new PremiseQueue(deps);
    await queue.processJob('premise_cascade', { premiseId: 'p-3', userId: 'u-3', event: 'retracted' });
    expect(transitions).toEqual([
      ['opp-a', 'expired'],
      ['opp-b', 'expired'],
      ['opp-c', 'expired'],
      ['opp-d', 'expired'],
    ]);
  });

  it('expires nothing when no opportunity cites the premise (no collateral)', async () => {
    const updateOpportunityStatus = mock(async (_id: string, _status: 'expired') => {});
    const deps: PremiseQueueDeps = {
      ...noReverifyDeps,
      getOpportunitiesCitingPremise: async () => [],
      updateOpportunityStatus,
    };
    const queue = new PremiseQueue(deps);
    await expect(
      queue.processJob('premise_cascade', { premiseId: 'p-4', userId: 'u-4', event: 'retracted' })
    ).resolves.toBeUndefined();
    expect(updateOpportunityStatus).not.toHaveBeenCalled();
  });

  it('calls updateOpportunityStatus once per citing opportunity', async () => {
    const updateOpportunityStatus = mock(async (_id: string, _status: 'expired') => {});
    const deps: PremiseQueueDeps = {
      ...noReverifyDeps,
      getOpportunitiesCitingPremise: async () => [
        { id: 'opp-1', status: 'draft' as NonTerminalStatus },
        { id: 'opp-2', status: 'pending' as NonTerminalStatus },
      ],
      updateOpportunityStatus,
    };
    const queue = new PremiseQueue(deps);
    await queue.processJob('premise_cascade', { premiseId: 'p-5', userId: 'u-5', event: 'retracted' });
    expect(updateOpportunityStatus).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// PremiseQueue grounded-intent re-verification tests (IND-423)
// ---------------------------------------------------------------------------
describe('PremiseQueue — grounded intent re-verification', () => {
  const verdict: IntentReverificationVerdict = {
    classification: 'COMMISSIVE',
    felicity_scores: { clarity: 80, authority: 45, sincerity: 90 },
    semantic_entropy: 0.4,
    flags: ['SKILL_MISMATCH'],
  };

  const baseDeps = (): PremiseQueueDeps => ({
    getOpportunitiesCitingPremise: async () => [],
    updateOpportunityStatus: async () => {},
  });

  it('re-verifies intents grounded on the lapsed premise and persists the verdict', async () => {
    const applied: Array<[string, IntentReverificationVerdict]> = [];
    const verified: string[] = [];
    const deps: PremiseQueueDeps = {
      ...baseDeps(),
      getPremiseEmbedding: async () => [0.1, 0.2, 0.3],
      getGroundedIntents: async () => [
        { id: 'intent-1', payload: 'Looking for a co-founder in Berlin', similarity: 0.72 },
        { id: 'intent-2', payload: 'Seeking Berlin-based investors', similarity: 0.61 },
      ],
      getUserProfileContext: async () => '{"name":"U"}',
      verifyIntent: async (content) => {
        verified.push(content);
        return verdict;
      },
      applyIntentVerification: async (intentId, v) => {
        applied.push([intentId, v]);
      },
    };
    const queue = new PremiseQueue(deps);
    await queue.processJob('premise_cascade', { premiseId: 'p-1', userId: 'u-1', event: 'retracted' });
    expect(verified).toEqual([
      'Looking for a co-founder in Berlin',
      'Seeking Berlin-based investors',
    ]);
    expect(applied).toEqual([
      ['intent-1', verdict],
      ['intent-2', verdict],
    ]);
  });

  it('skips re-verification when the premise has no embedding', async () => {
    const getGroundedIntents = mock(async () => []);
    const deps: PremiseQueueDeps = {
      ...baseDeps(),
      getPremiseEmbedding: async () => null,
      getGroundedIntents,
    };
    const queue = new PremiseQueue(deps);
    await queue.processJob('premise_cascade', { premiseId: 'p-2', userId: 'u-2', event: 'expired' });
    expect(getGroundedIntents).not.toHaveBeenCalled();
  });

  it('skips the profile fetch and verifier when no intents are grounded on the premise', async () => {
    const verifyIntent = mock(async () => verdict);
    const getUserProfileContext = mock(async () => '{}');
    const deps: PremiseQueueDeps = {
      ...baseDeps(),
      getPremiseEmbedding: async () => [0.5, 0.5],
      getGroundedIntents: async () => [],
      getUserProfileContext,
      verifyIntent,
    };
    const queue = new PremiseQueue(deps);
    await queue.processJob('premise_cascade', { premiseId: 'p-3', userId: 'u-3', event: 'retracted' });
    expect(getUserProfileContext).not.toHaveBeenCalled();
    expect(verifyIntent).not.toHaveBeenCalled();
  });

  it('continues past per-intent verifier failures and persists the rest', async () => {
    const applied: string[] = [];
    const deps: PremiseQueueDeps = {
      ...baseDeps(),
      getPremiseEmbedding: async () => [0.1],
      getGroundedIntents: async () => [
        { id: 'intent-bad', payload: 'boom payload', similarity: 0.9 },
        { id: 'intent-good', payload: 'fine payload', similarity: 0.8 },
      ],
      getUserProfileContext: async () => '{}',
      verifyIntent: async (content) => {
        if (content === 'boom payload') throw new Error('LLM flake');
        return verdict;
      },
      applyIntentVerification: async (intentId) => {
        applied.push(intentId);
      },
    };
    const queue = new PremiseQueue(deps);
    await expect(
      queue.processJob('premise_cascade', { premiseId: 'p-4', userId: 'u-4', event: 'retracted' })
    ).resolves.toBeUndefined();
    expect(applied).toEqual(['intent-good']);
  });

  it('never fails the cascade job when re-verification setup throws (expiry already done)', async () => {
    const transitions: string[] = [];
    const deps: PremiseQueueDeps = {
      getOpportunitiesCitingPremise: async () => [
        { id: 'opp-1', status: 'pending' as NonTerminalStatus },
      ],
      updateOpportunityStatus: async (id) => { transitions.push(id); },
      getPremiseEmbedding: async () => { throw new Error('db down'); },
    };
    const queue = new PremiseQueue(deps);
    await expect(
      queue.processJob('premise_cascade', { premiseId: 'p-5', userId: 'u-5', event: 'retracted' })
    ).resolves.toBeUndefined();
    expect(transitions).toEqual(['opp-1']);
  });
});

// ---------------------------------------------------------------------------
// PremiseQueue profile_regen tests
// ---------------------------------------------------------------------------
describe('PremiseQueue — profile_regen', () => {
  it('enqueues context regen for the given userId', async () => {
    const regenCalls: string[] = [];
    const deps: PremiseQueueDeps = {
      enqueueContextRegen: async (userId) => {
        regenCalls.push(userId);
      },
    };
    const queue = new PremiseQueue(deps);
    await queue.processJob('profile_regen', { userId: 'u-1', trigger: 'premise_created' });
    expect(regenCalls).toEqual(['u-1']);
  });

  it('enqueues context regen exactly once per job', async () => {
    const enqueueContextRegen = mock(async (_userId: string) => {});
    const deps: PremiseQueueDeps = { enqueueContextRegen };
    const queue = new PremiseQueue(deps);
    await queue.processJob('profile_regen', { userId: 'u-2', trigger: 'premise_updated' });
    expect(enqueueContextRegen).toHaveBeenCalledTimes(1);
    expect(enqueueContextRegen).toHaveBeenCalledWith('u-2');
  });

  it('works for all trigger types', async () => {
    const triggers = [
      'premise_created',
      'premise_updated',
      'premise_retracted',
      'premise_expired',
    ] as const;

    for (const trigger of triggers) {
      const enqueueContextRegen = mock(async (_userId: string) => {});
      const deps: PremiseQueueDeps = { enqueueContextRegen };
      const queue = new PremiseQueue(deps);
      await queue.processJob('profile_regen', { userId: 'u-trigger', trigger });
      expect(enqueueContextRegen).toHaveBeenCalledWith('u-trigger');
    }
  });

  it('completes via the injected context-regen dep', async () => {
    const enqueueContextRegen = mock(async (_userId: string) => {});
    const queueWithDep = new PremiseQueue({ enqueueContextRegen });
    await expect(
      queueWithDep.processJob('profile_regen', { userId: 'u-3', trigger: 'premise_expired' })
    ).resolves.toBeUndefined();
    expect(enqueueContextRegen).toHaveBeenCalledWith('u-3');
  });
});

// ---------------------------------------------------------------------------
// PremiseQueue routing tests
// ---------------------------------------------------------------------------
describe('PremiseQueue — job routing', () => {
  it('does not throw for unknown job names', async () => {
    const deps: PremiseQueueDeps = {};
    const queue = new PremiseQueue(deps);
    await expect(
      queue.processJob('unknown_job_type', { premiseId: 'p-x', userId: 'u-x', event: 'retracted' })
    ).resolves.toBeUndefined();
  });
});
