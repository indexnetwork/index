import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, mock } from 'bun:test';
import {
  MaintenanceGraphFactory,
  type MaintenanceGraphDatabase,
  type MaintenanceGraphCache,
  type MaintenanceGraphQueue,
} from '@indexnetwork/protocol';

describe('MaintenanceGraph — Introducer Discovery', () => {
  const userId = 'test-user';

  function createMockDeps(overrides: {
    opportunities?: unknown[];
    activeIntents?: unknown[];
    lastRediscoveryAt?: number | null;
    personalIndexId?: string | null;
    contacts?: Array<{ userId: string; latestIntentAt: string | null; intentCount: number }>;
  } = {}) {
    const {
      opportunities = [],
      activeIntents = [{ id: 'intent-1', payload: 'find investors' }],
      lastRediscoveryAt = Date.now() - 1000,
      personalIndexId = 'personal-index-1',
      contacts = [],
    } = overrides;

    return {
      database: {
        getOpportunitiesForUser: mock(() => Promise.resolve(opportunities)),
        getActiveIntents: mock(() => Promise.resolve(activeIntents)),
        getPersonalIndexId: mock(() => Promise.resolve(personalIndexId)),
        getContactsWithIntentFreshness: mock(() => Promise.resolve(contacts)),
      } as MaintenanceGraphDatabase,
      cache: {
        get: mock((key: string) => {
          if (key.startsWith('rediscovery:lastRun:'))
            return Promise.resolve(
              lastRediscoveryAt
                ? { triggeredAt: new Date(lastRediscoveryAt).toISOString() }
                : null,
            );
          return Promise.resolve(null);
        }),
        set: mock(() => Promise.resolve()),
      } as MaintenanceGraphCache,
      queue: {
        addJob: mock(() => Promise.resolve({ id: 'job-1' })),
      } as MaintenanceGraphQueue,
    };
  }

  it('runs introducer discovery when connector-flow count is below target and feed is healthy', async () => {
    // Healthy feed (enough connections) but no connector-flow opportunities
    const deps = createMockDeps({
      opportunities: Array.from({ length: 5 }, (_, i) => ({
        id: `opp-${i}`,
        actors: [
          { userId, role: 'party' },
          { userId: `other-${i}`, role: 'party' },
        ],
        status: 'latent',
      })),
      lastRediscoveryAt: Date.now() - 1000,
      contacts: [
        { userId: 'contact-1', latestIntentAt: '2026-03-27T00:00:00Z', intentCount: 2 },
        { userId: 'contact-2', latestIntentAt: '2026-03-26T00:00:00Z', intentCount: 1 },
      ],
    });

    const factory = new MaintenanceGraphFactory(
      deps.database,
      deps.cache,
      deps.queue,
    );
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId });

    // Should have enqueued introducer discovery jobs (the feed is healthy so regular
    // rediscovery does NOT run, but introducer discovery runs because connectorFlowCount = 0)
    // The introducer discovery enqueues jobs for contacts
    const addJobCalls = (deps.queue.addJob as ReturnType<typeof mock>).mock.calls;
    const introducerJobs = addJobCalls.filter(
      (call: unknown[]) => typeof call[0] === 'object' && call[0]?.contactUserId != null,
    );
    expect(introducerJobs.length).toBeGreaterThan(0);
  }, 30_000);

  it('skips introducer discovery when connector-flow target is already met', async () => {
    // Feed with enough connector-flow opportunities (2 = target)
    const deps = createMockDeps({
      opportunities: [
        // 2 connector-flow opportunities (have introducer)
        ...Array.from({ length: 2 }, (_, i) => ({
          id: `cf-${i}`,
          actors: [
            { userId, role: 'introducer' },
            { userId: `party-a-${i}`, role: 'patient' },
            { userId: `party-b-${i}`, role: 'agent' },
          ],
          status: 'latent',
        })),
        // 3 connections
        ...Array.from({ length: 3 }, (_, i) => ({
          id: `conn-${i}`,
          actors: [
            { userId, role: 'party' },
            { userId: `other-${i}`, role: 'party' },
          ],
          status: 'latent',
        })),
      ],
      lastRediscoveryAt: Date.now() - 1000,
      contacts: [
        { userId: 'contact-1', latestIntentAt: '2026-03-27T00:00:00Z', intentCount: 2 },
      ],
    });

    const factory = new MaintenanceGraphFactory(
      deps.database,
      deps.cache,
      deps.queue,
    );
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId });

    // No introducer discovery jobs should be enqueued
    const addJobCalls = (deps.queue.addJob as ReturnType<typeof mock>).mock.calls;
    const introducerJobs = addJobCalls.filter(
      (call: unknown[]) => typeof call[0] === 'object' && call[0]?.contactUserId != null,
    );
    expect(introducerJobs.length).toBe(0);
  }, 30_000);

  it('skips introducer discovery when user has no personal index', async () => {
    const deps = createMockDeps({
      opportunities: Array.from({ length: 3 }, (_, i) => ({
        id: `opp-${i}`,
        actors: [
          { userId, role: 'party' },
          { userId: `other-${i}`, role: 'party' },
        ],
        status: 'latent',
      })),
      lastRediscoveryAt: Date.now() - 1000,
      personalIndexId: null,
    });

    const factory = new MaintenanceGraphFactory(
      deps.database,
      deps.cache,
      deps.queue,
    );
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId });

    // No introducer discovery jobs (no personal index)
    const addJobCalls = (deps.queue.addJob as ReturnType<typeof mock>).mock.calls;
    const introducerJobs = addJobCalls.filter(
      (call: unknown[]) => typeof call[0] === 'object' && call[0]?.contactUserId != null,
    );
    expect(introducerJobs.length).toBe(0);
  }, 30_000);

  it('does not break existing rediscovery behavior', async () => {
    // Empty feed should still trigger regular rediscovery
    const deps = createMockDeps({
      opportunities: [],
      lastRediscoveryAt: null,
      contacts: [
        { userId: 'contact-1', latestIntentAt: '2026-03-27T00:00:00Z', intentCount: 1 },
      ],
    });

    const factory = new MaintenanceGraphFactory(
      deps.database,
      deps.cache,
      deps.queue,
    );
    const graph = factory.createGraph();
    const result = await graph.invoke({ userId });

    // Regular rediscovery should have run (intent-based jobs)
    const addJobCalls = (deps.queue.addJob as ReturnType<typeof mock>).mock.calls;
    const regularJobs = addJobCalls.filter(
      (call: unknown[]) =>
        typeof call[0] === 'object' && call[0]?.contactUserId == null,
    );
    expect(regularJobs.length).toBeGreaterThan(0);
  }, 30_000);
});
