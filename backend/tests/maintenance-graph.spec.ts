import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, mock } from 'bun:test';
import { MaintenanceGraphFactory } from '@indexnetwork/protocol';

describe('MaintenanceGraph', () => {
  const userId = 'test-user';

  function createMockDeps(overrides: {
    opportunities?: any[];
    activeIntents?: any[];
    expiredCount?: number;
    lastRediscoveryAt?: number | null;
  } = {}) {
    const {
      opportunities = [],
      activeIntents = [{ id: 'intent-1', payload: 'find investors' }],
      expiredCount = 0,
      lastRediscoveryAt = Date.now() - 1000,
    } = overrides;

    return {
      database: {
        getOpportunitiesForUser: mock(() => Promise.resolve(opportunities)),
        getActiveIntents: mock(() => Promise.resolve(activeIntents)),
      },
      cache: {
        get: mock((key: string) => {
          if (key.startsWith('rediscovery:throttle:')) return Promise.resolve(null);
          if (key.startsWith('rediscovery:lastRun:')) return Promise.resolve(lastRediscoveryAt ? { triggeredAt: new Date(lastRediscoveryAt).toISOString() } : null);
          return Promise.resolve(null);
        }),
        set: mock(() => Promise.resolve()),
      },
      queue: {
        addJob: mock(() => Promise.resolve({ id: 'job-1' })),
      },
    };
  }

  it('does not enqueue rediscovery when feed is healthy', async () => {
    const deps = createMockDeps({
      opportunities: Array.from({ length: 5 }, (_, i) => ({
        id: `opp-${i}`,
        actors: [{ userId, role: 'party' }, { userId: `other-${i}`, role: 'party' }],
        status: 'latent',
      })),
      lastRediscoveryAt: Date.now() - 1000,
    });

    const factory = new MaintenanceGraphFactory(deps.database as any, deps.cache as any, deps.queue as any);
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId });

    expect(deps.queue.addJob).not.toHaveBeenCalled();
  }, 30_000);

  it('enqueues rediscovery when feed is empty', async () => {
    const deps = createMockDeps({
      opportunities: [],
      lastRediscoveryAt: null,
    });

    const factory = new MaintenanceGraphFactory(deps.database as any, deps.cache as any, deps.queue as any);
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId });

    expect(deps.queue.addJob).toHaveBeenCalled();
  }, 30_000);

  it('enqueues rediscovery when composition is poor', async () => {
    const deps = createMockDeps({
      opportunities: Array.from({ length: 1 }, (_, i) => ({
        id: `opp-${i}`,
        actors: [{ userId, role: 'party' }, { userId: `other-${i}`, role: 'party' }],
        status: 'latent',
      })),
      lastRediscoveryAt: Date.now() - 20 * 60 * 60 * 1000, // 20h ago
    });

    const factory = new MaintenanceGraphFactory(deps.database as any, deps.cache as any, deps.queue as any);
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId });

    expect(deps.queue.addJob).toHaveBeenCalled();
  }, 30_000);
});
