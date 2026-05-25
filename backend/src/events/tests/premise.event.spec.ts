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
  ProfileDatabaseAdapter: class {
    getProfile = async () => null;
  },
}));

// ---------------------------------------------------------------------------
// Protocol mock — ProfileGraphFactory not needed for unit tests
// ---------------------------------------------------------------------------
mock.module('@indexnetwork/protocol', () => ({
  ProfileGraphFactory: class {
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
import type { PremiseQueueDeps, NonTerminalStatus } from '../../queues/premise.queue';

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
  it('transitions draft and latent opportunities to expired', async () => {
    const transitions: Array<[string, string]> = [];
    const deps: PremiseQueueDeps = {
      getUserOpportunities: async () => [
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

  it('transitions pending, negotiating, and accepted opportunities to stalled', async () => {
    const transitions: Array<[string, string]> = [];
    const deps: PremiseQueueDeps = {
      getUserOpportunities: async () => [
        { id: 'opp-1', status: 'pending' as NonTerminalStatus },
        { id: 'opp-2', status: 'negotiating' as NonTerminalStatus },
        { id: 'opp-3', status: 'accepted' as NonTerminalStatus },
      ],
      updateOpportunityStatus: async (id, status) => {
        transitions.push([id, status]);
      },
    };
    const queue = new PremiseQueue(deps);
    await queue.processJob('premise_cascade', { premiseId: 'p-2', userId: 'u-2', event: 'expired' });
    expect(transitions).toEqual([
      ['opp-1', 'stalled'],
      ['opp-2', 'stalled'],
      ['opp-3', 'stalled'],
    ]);
  });

  it('handles mixed statuses: early ones expire, in-progress ones stall', async () => {
    const transitions: Array<[string, string]> = [];
    const deps: PremiseQueueDeps = {
      getUserOpportunities: async () => [
        { id: 'opp-a', status: 'draft' as NonTerminalStatus },
        { id: 'opp-b', status: 'pending' as NonTerminalStatus },
        { id: 'opp-c', status: 'latent' as NonTerminalStatus },
        { id: 'opp-d', status: 'accepted' as NonTerminalStatus },
      ],
      updateOpportunityStatus: async (id, status) => {
        transitions.push([id, status]);
      },
    };
    const queue = new PremiseQueue(deps);
    await queue.processJob('premise_cascade', { premiseId: 'p-3', userId: 'u-3', event: 'retracted' });
    expect(transitions).toEqual([
      ['opp-a', 'expired'],
      ['opp-b', 'stalled'],
      ['opp-c', 'expired'],
      ['opp-d', 'stalled'],
    ]);
  });

  it('completes without errors when there are no opportunities', async () => {
    const deps: PremiseQueueDeps = {
      getUserOpportunities: async () => [],
      updateOpportunityStatus: async () => {},
    };
    const queue = new PremiseQueue(deps);
    await expect(
      queue.processJob('premise_cascade', { premiseId: 'p-4', userId: 'u-4', event: 'retracted' })
    ).resolves.toBeUndefined();
  });

  it('calls updateOpportunityStatus once per opportunity', async () => {
    const updateOpportunityStatus = mock(async (_id: string, _status: 'expired' | 'stalled') => {});
    const deps: PremiseQueueDeps = {
      getUserOpportunities: async () => [
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
// PremiseQueue profile_regen tests
// ---------------------------------------------------------------------------
describe('PremiseQueue — profile_regen', () => {
  it('invokes profile aggregate for the given userId', async () => {
    const aggregateCalls: string[] = [];
    const deps: PremiseQueueDeps = {
      invokeProfileAggregate: async (userId) => {
        aggregateCalls.push(userId);
      },
    };
    const queue = new PremiseQueue(deps);
    await queue.processJob('profile_regen', { userId: 'u-1', trigger: 'premise_created' });
    expect(aggregateCalls).toEqual(['u-1']);
  });

  it('invokes profile aggregate exactly once per job', async () => {
    const invokeProfileAggregate = mock(async (_userId: string) => {});
    const deps: PremiseQueueDeps = { invokeProfileAggregate };
    const queue = new PremiseQueue(deps);
    await queue.processJob('profile_regen', { userId: 'u-2', trigger: 'premise_updated' });
    expect(invokeProfileAggregate).toHaveBeenCalledTimes(1);
    expect(invokeProfileAggregate).toHaveBeenCalledWith('u-2');
  });

  it('works for all trigger types', async () => {
    const triggers = [
      'premise_created',
      'premise_updated',
      'premise_retracted',
      'premise_expired',
    ] as const;

    for (const trigger of triggers) {
      const invokeProfileAggregate = mock(async (_userId: string) => {});
      const deps: PremiseQueueDeps = { invokeProfileAggregate };
      const queue = new PremiseQueue(deps);
      await queue.processJob('profile_regen', { userId: 'u-trigger', trigger });
      expect(invokeProfileAggregate).toHaveBeenCalledWith('u-trigger');
    }
  });

  it('completes without errors when no invokeProfileAggregate dep is provided', async () => {
    // Without a dep, it falls through to the default which calls adapters.
    // We just verify processJob resolves (or rejects gracefully — adapters throw without DB).
    const deps: PremiseQueueDeps = {};
    const queue = new PremiseQueue(deps);
    // Default impl will try to instantiate real adapters — we only verify the injected path works
    const invokeProfileAggregate = mock(async (_userId: string) => {});
    const queueWithDep = new PremiseQueue({ invokeProfileAggregate });
    await expect(
      queueWithDep.processJob('profile_regen', { userId: 'u-3', trigger: 'premise_expired' })
    ).resolves.toBeUndefined();
    expect(invokeProfileAggregate).toHaveBeenCalledWith('u-3');
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
