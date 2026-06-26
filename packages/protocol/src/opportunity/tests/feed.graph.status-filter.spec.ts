/**
 * Home Graph status filter: default narrows to latent/stalled/pending, overridable.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, test, expect } from 'bun:test';
import { HomeGraphFactory, DEFAULT_HOME_STATUSES, ALL_OPPORTUNITY_STATUSES } from '../feed/feed.graph.js';
import type { HomeGraphDatabase, Opportunity, OpportunityStatus } from '../../shared/interfaces/database.interface.js';
import type { OpportunityCache } from '../../shared/interfaces/cache.interface.js';

function createMockCache(): OpportunityCache {
  const store = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (store.get(key) as T) ?? null,
    set: async <T>(key: string, value: T) => { store.set(key, value); },
    mget: async <T>(keys: string[]) => keys.map((k) => (store.get(k) as T) ?? null),
  };
}

function createMockDb(captured: { statuses?: OpportunityStatus[]; scopeType?: 'intent'; scopeId?: string }): HomeGraphDatabase {
  return {
    getOpportunitiesForUser: (_userId: string, opts?: { statuses?: OpportunityStatus[]; scopeType?: 'intent'; scopeId?: string }) => {
      captured.statuses = opts?.statuses;
      captured.scopeType = opts?.scopeType;
      captured.scopeId = opts?.scopeId;
      return Promise.resolve([] as Opportunity[]);
    },
    getOpportunity: () => Promise.resolve(null),
    getProfile: () => Promise.resolve(null),
    getActiveIntents: () => Promise.resolve([]),
    getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
    getUser: (id: string) => Promise.resolve({ id, name: 'User ' + id, email: '', avatar: null }),
  };
}

describe('home graph status filter', () => {
  test('DEFAULT_HOME_STATUSES is exactly latent, pending', () => {
    expect(DEFAULT_HOME_STATUSES).toEqual(['latent', 'pending']);
  });

  test('ALL_OPPORTUNITY_STATUSES includes accepted/rejected/expired', () => {
    expect(ALL_OPPORTUNITY_STATUSES).toContain('accepted');
    expect(ALL_OPPORTUNITY_STATUSES).toContain('rejected');
    expect(ALL_OPPORTUNITY_STATUSES).toContain('expired');
    expect(ALL_OPPORTUNITY_STATUSES).toContain('negotiating');
    expect(ALL_OPPORTUNITY_STATUSES).toContain('draft');
  });

  test('default invocation passes DEFAULT_HOME_STATUSES to the database', async () => {
    const captured: { statuses?: OpportunityStatus[] } = {};
    const graph = new HomeGraphFactory(createMockDb(captured), createMockCache()).createGraph();
    await graph.invoke({ userId: 'u1' });
    expect(captured.statuses).toEqual(DEFAULT_HOME_STATUSES);
  });

  test('explicit statuses override the default', async () => {
    const captured: { statuses?: OpportunityStatus[] } = {};
    const graph = new HomeGraphFactory(createMockDb(captured), createMockCache()).createGraph();
    await graph.invoke({ userId: 'u1', statuses: ALL_OPPORTUNITY_STATUSES });
    expect(captured.statuses).toEqual(ALL_OPPORTUNITY_STATUSES);
  });

  test('explicit intent scope is forwarded with the load query before home dedupe', async () => {
    const captured: { statuses?: OpportunityStatus[]; scopeType?: 'intent'; scopeId?: string } = {};
    const graph = new HomeGraphFactory(createMockDb(captured), createMockCache()).createGraph();
    await graph.invoke({ userId: 'u1', scopeType: 'intent', scopeId: '00000000-0000-4000-8000-00000000a111' });
    expect(captured.statuses).toEqual(DEFAULT_HOME_STATUSES);
    expect(captured.scopeType).toBe('intent');
    expect(captured.scopeId).toBe('00000000-0000-4000-8000-00000000a111');
  });
});
