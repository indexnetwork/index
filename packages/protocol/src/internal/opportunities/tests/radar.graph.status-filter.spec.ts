/**
 * Home Graph status filter: default narrows to latent/stalled/pending, overridable.
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, test, expect } from 'bun:test';
import { RadarGraphFactory, DEFAULT_RADAR_STATUSES, ALL_OPPORTUNITY_STATUSES } from '../radar/radar.graph.js';
import type { RadarGraphDatabase, OpportunityStatus } from '../../../platform/database.js';
import type { OpportunityCache } from '../../../platform/discovery/cache.js';

function createMockCache(): OpportunityCache {
  const store = new Map<string, unknown>();
  return {
    get: async <T>(key: string) => (store.get(key) as T) ?? null,
    set: async <T>(key: string, value: T) => { store.set(key, value); },
    mget: async <T>(keys: string[]) => keys.map((k) => (store.get(k) as T) ?? null),
  };
}

function createMockDb(
  captured: { statuses?: OpportunityStatus[]; scopeType?: 'intent'; scopeId?: string },
): RadarGraphDatabase {
  return {
    getOpportunitiesForUser: (_userId: string, opts?: { statuses?: OpportunityStatus[]; scopeType?: 'intent'; scopeId?: string }) => {
      captured.statuses = opts?.statuses;
      captured.scopeType = opts?.scopeType;
      captured.scopeId = opts?.scopeId;
      return Promise.resolve([]);
    },
    getOpportunity: () => Promise.resolve(null),
    getProfile: () => Promise.resolve(null),
    getActiveIntents: () => Promise.resolve([]),
    getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
    getUser: (id: string) => Promise.resolve({ id, name: 'User ' + id, email: '', avatar: null, socials: [] }),
    getNegotiationTaskForOpportunity: () => Promise.resolve(null),
    getMessagesForConversation: () => Promise.resolve([]),
    getNegotiationMessages: () => Promise.resolve([]),
    getArtifactsForTask: () => Promise.resolve([]),
  };
}

describe('home graph status filter', () => {
  test('DEFAULT_RADAR_STATUSES is exactly pending', () => {
    // `pending` is the only status a principal can act on: a pairing is born
    // `negotiating` and there is no pre-kickoff state before it.
    expect(DEFAULT_RADAR_STATUSES).toEqual(['pending']);
  });

  test('ALL_OPPORTUNITY_STATUSES includes accepted/rejected/expired', () => {
    expect(ALL_OPPORTUNITY_STATUSES).toContain('accepted');
    expect(ALL_OPPORTUNITY_STATUSES).toContain('rejected');
    expect(ALL_OPPORTUNITY_STATUSES).toContain('expired');
    expect(ALL_OPPORTUNITY_STATUSES).toContain('negotiating');
    expect(ALL_OPPORTUNITY_STATUSES).not.toContain('draft');
    expect(ALL_OPPORTUNITY_STATUSES).not.toContain('latent');
  });

  test('default invocation passes DEFAULT_RADAR_STATUSES to the database', async () => {
    const captured: { statuses?: OpportunityStatus[] } = {};
    const graph = new RadarGraphFactory(createMockDb(captured), createMockCache()).createGraph();
    await graph.invoke({ userId: 'u1' });
    expect(captured.statuses).toEqual(DEFAULT_RADAR_STATUSES);
  });

  test('explicit statuses override the default', async () => {
    const captured: { statuses?: OpportunityStatus[] } = {};
    const graph = new RadarGraphFactory(createMockDb(captured), createMockCache()).createGraph();
    await graph.invoke({ userId: 'u1', statuses: ALL_OPPORTUNITY_STATUSES });
    expect(captured.statuses).toEqual(ALL_OPPORTUNITY_STATUSES);
  });

  test('explicit intent scope is forwarded with the load query before home dedupe', async () => {
    const captured: { statuses?: OpportunityStatus[]; scopeType?: 'intent'; scopeId?: string } = {};
    const graph = new RadarGraphFactory(createMockDb(captured), createMockCache()).createGraph();
    await graph.invoke({ userId: 'u1', scopeType: 'intent', scopeId: '00000000-0000-4000-8000-00000000a111' });
    expect(captured.statuses).toEqual(DEFAULT_RADAR_STATUSES);
    expect(captured.scopeType).toBe('intent');
    expect(captured.scopeId).toBe('00000000-0000-4000-8000-00000000a111');
  });
});
