import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY ??= 'test';

import { afterEach, describe, expect, mock, test } from 'bun:test';

import { continueDiscovery } from '../opportunity.discover.js';
import { finalizeDiscoveryContinuation } from '../opportunity.discovery-continuation-finalization.js';
import type { Opportunity } from '../../shared/interfaces/database.interface.js';

const viewerId = 'continuation-viewer';
const candidateId = 'continuation-candidate';
const persistedAt = new Date('2026-06-01T12:00:00.000Z');
const originalIntroducerDiscoveryEnabled = process.env.INTRODUCER_DISCOVERY_ENABLED;

afterEach(() => {
  if (originalIntroducerDiscoveryEnabled === undefined) {
    delete process.env.INTRODUCER_DISCOVERY_ENABLED;
  } else {
    process.env.INTRODUCER_DISCOVERY_ENABLED = originalIntroducerDiscoveryEnabled;
  }
});

function opportunity(status: Opportunity['status']): Opportunity {
  return {
    id: 'continuation-opportunity',
    detection: { source: 'opportunity_graph', timestamp: persistedAt.toISOString() },
    actors: [
      { userId: viewerId, networkId: 'network-1', role: 'patient' },
      { userId: candidateId, networkId: 'network-1', role: 'agent' },
    ],
    interpretation: {
      category: 'collaboration',
      reasoning: 'A relevant collaboration.',
      confidence: 0.9,
      signals: [],
    },
    context: { networkId: 'network-1' },
    confidence: '0.9',
    status,
    createdAt: persistedAt,
    updatedAt: persistedAt,
    expiresAt: null,
  };
}

describe('continueDiscovery lifecycle refresh', () => {
  test('returns the disabled result without invoking the graph for cached on-behalf discovery', async () => {
    process.env.INTRODUCER_DISCOVERY_ENABLED = 'false';
    const invoke = mock(async () => ({ opportunities: [] }));

    const result = await continueDiscovery({
      opportunityGraph: { invoke } as never,
      database: {} as never,
      cache: {
        get: async () => ({
          candidates: [],
          userId: viewerId,
          onBehalfOfUserId: 'target-1',
          query: 'find an investor',
          indexScope: ['network-1'],
          options: {},
        }),
      } as never,
      userId: viewerId,
      discoveryId: 'continuation-id',
    });

    expect(result).toMatchObject({
      found: false,
      count: 0,
      message: 'Introducer discovery is currently disabled.',
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  test('continues regular cached discovery while introducer discovery is disabled', async () => {
    process.env.INTRODUCER_DISCOVERY_ENABLED = 'false';
    const invoke = mock(async () => ({ opportunities: [], remainingCandidates: [] }));

    await continueDiscovery({
      opportunityGraph: { invoke } as never,
      database: {} as never,
      cache: {
        get: async () => ({
          candidates: [],
          userId: viewerId,
          query: 'find a collaborator',
          indexScope: ['network-1'],
          options: {},
        }),
        delete: async () => undefined,
      } as never,
      userId: viewerId,
      discoveryId: 'continuation-id',
    });

    expect(invoke).toHaveBeenCalled();
  });

  test('preserves the current database status instead of the persist-time or chat-session projection', async () => {
    const graphOpportunity = opportunity('negotiating');
    const currentOpportunity = { ...graphOpportunity, status: 'rejected' as const, updatedAt: new Date(persistedAt.getTime() + 1_000) };
    let refreshedIds: string[] = [];

    const result = await continueDiscovery({
      opportunityGraph: {
        invoke: async () => ({
          opportunities: [graphOpportunity],
          remainingCandidates: [],
          trace: [],
        }),
      } as never,
      database: {
        getOpportunitiesByIds: async (ids: string[]) => {
          refreshedIds = ids;
          return [currentOpportunity];
        },
        getProfile: async () => ({
          identity: { name: 'Candidate' },
          context: '',
        }),
        getUser: async (id: string) => ({
          id,
          name: id === viewerId ? 'Viewer' : 'Candidate',
          email: `${id}@test.local`,
          socials: [],
        }),
      } as never,
      cache: {
        get: async () => ({
          candidates: [],
          userId: viewerId,
          query: 'find a collaborator',
          indexScope: ['network-1'],
          options: {},
          trigger: 'orchestrator',
        }),
        set: async () => undefined,
        delete: async () => undefined,
      } as never,
      userId: viewerId,
      discoveryId: 'continuation-id',
      chatSessionId: 'chat-session-1',
      minimalForChat: true,
    });

    expect(refreshedIds).toEqual([graphOpportunity.id]);
    expect(result.opportunities).toHaveLength(1);
    expect(result.opportunities?.[0].status).toBe('rejected');
    expect(result.opportunities?.[0].homeCardPresentation?.personalizedSummary).toBeTruthy();
  });

  test('returns a graph error without mutating pagination cache', async () => {
    let cacheMutated = false;
    const result = await finalizeDiscoveryContinuation({
      result: { error: 'graph unavailable', trace: [{ node: 'evaluate', detail: 'failed' }] },
      cache: { set: async () => { cacheMutated = true; }, delete: async () => { cacheMutated = true; } },
      cacheKey: 'discovery:key',
      cached: { candidates: [] },
      userId: viewerId,
      discoveryId: 'continuation-id',
      database: { getOpportunitiesByIds: async () => [] } as never,
      enrich: async () => [],
    });

    expect(result).toMatchObject({ found: false, count: 0, message: 'Discovery continuation failed. Please start a new search.' });
    expect(result.debugSteps).toEqual([{ step: 'evaluate', detail: 'failed' }]);
    expect(cacheMutated).toBe(false);
  });

  test('updates pagination cache with remaining candidates', async () => {
    const remaining = [{ candidateUserId: 'candidate' }];
    let cacheValue: unknown;
    const result = await finalizeDiscoveryContinuation({
      result: { remainingCandidates: remaining as never, opportunities: [] },
      cache: { set: async (_key, value) => { cacheValue = value; }, delete: async () => true },
      cacheKey: 'discovery:key',
      cached: { candidates: [{ candidateUserId: 'first' }, { candidateUserId: 'second' }] as never, query: 'q' } as never,
      userId: viewerId,
      discoveryId: 'continuation-id',
      database: { getOpportunitiesByIds: async () => [] } as never,
      enrich: async () => [],
    });

    expect(cacheValue).toMatchObject({ candidates: remaining, query: 'q' });
    expect(result.pagination).toEqual({ discoveryId: 'continuation-id', evaluated: 1, remaining: 1 });
    expect(result.message).toBe('No more matching opportunities found in the remaining candidates.');
  });

  test('deletes exhausted pagination cache before returning an empty result', async () => {
    let deletedKey: string | undefined;
    const result = await finalizeDiscoveryContinuation({
      result: { remainingCandidates: [], opportunities: [] },
      cache: { set: async () => undefined, delete: async (key) => { deletedKey = key; return true; } },
      cacheKey: 'discovery:key',
      cached: { candidates: [] },
      userId: viewerId,
      discoveryId: 'continuation-id',
      database: { getOpportunitiesByIds: async () => [] } as never,
      enrich: async () => [],
    });

    expect(deletedKey).toBe('discovery:key');
    expect(result.pagination).toBeUndefined();
    expect(result).toMatchObject({ found: false, count: 0 });
  });

  test('cache write failure does not mask refreshed and enriched graph opportunities', async () => {
    const graphOpportunity = opportunity('negotiating');
    const refreshedOpportunity = { ...graphOpportunity, status: 'pending' as const };
    const result = await finalizeDiscoveryContinuation({
      result: { remainingCandidates: [{ candidateUserId: 'later' }] as never, opportunities: [graphOpportunity] },
      cache: { set: async () => { throw new Error('cache unavailable'); }, delete: async () => true },
      cacheKey: 'discovery:key',
      cached: { candidates: [{ candidateUserId: 'first' }, { candidateUserId: 'later' }] as never },
      userId: viewerId,
      discoveryId: 'continuation-id',
      database: { getOpportunitiesByIds: async () => [refreshedOpportunity] } as never,
      enrich: async (opportunities) => opportunities.map((item) => ({ id: item.id, status: item.status })) as never,
    });

    expect(result.pagination).toBeUndefined();
    expect(result).toMatchObject({ found: true, count: 1, opportunities: [{ id: graphOpportunity.id, status: 'pending' }] });
  });
});
