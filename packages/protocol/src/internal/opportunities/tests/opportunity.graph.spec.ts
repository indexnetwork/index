import { describe, test, expect, mock, spyOn } from 'bun:test';
import { CandidateDiscovery, DISCOVERY_MIN_SIMILARITY } from '@indexnetwork/discovery';
import type { CandidateDiscoveryData, CandidateSearch } from '@indexnetwork/discovery';

import { resolveDiscoveryNetworkScope } from '../../../index.js';

const owner = 'a0000000-0000-4000-8000-000000000001';
const bob = 'b0000000-0000-4000-8000-000000000002';
const dummyEmbedding = new Array(2000).fill(0.1);

function createMockDiscovery(deps: {
  getUserNetworkIds?: () => Promise<string[]>;
  getActiveIntents?: CandidateDiscoveryData['getActiveIntents'];
  getNetworkIdsForIntent?: CandidateDiscoveryData['getNetworkIdsForIntent'];
  getActiveNetworkMembershipPairs?: CandidateDiscoveryData['getActiveNetworkMembershipPairs'];
} = {}) {
  const mockDb: CandidateDiscoveryData = {
    getNetworkMemberships: async () => (await (deps.getUserNetworkIds?.() ?? Promise.resolve(['idx-1']))).map((networkId) => ({ networkId })),
    getActiveIntents: deps.getActiveIntents ?? (async (id: string) => id === owner
      ? [{ id: 'intent-1', payload: 'Looking for a technical co-founder' }]
      : [{ id: 'intent-bob', payload: 'I want to build a startup as a technical co-founder' }, { id: 'intent-alice', payload: 'Looking for a co-founder' }]),
    getProfile: async () => null,
    getNetworkIdsForIntent: deps.getNetworkIdsForIntent ?? (async () => deps.getUserNetworkIds?.() ?? ['idx-1']),
    getActiveNetworkMembershipPairs: deps.getActiveNetworkMembershipPairs ?? (async (pairs) => pairs),
    getRecentlyRejectedOpportunityCounterparties: async () => [],
    getDiscoveryScope: async (input) => resolveDiscoveryNetworkScope({
      userNetworkIds: input.userNetworks,
      networkScope: input.networkScope,
      ownsRequestedNetwork: false,
      triggerIntentNetworkIds: await (deps.getNetworkIdsForIntent?.(input.triggerIntentId!) ?? deps.getUserNetworkIds?.() ?? Promise.resolve(['idx-1'])),
    }),
    getNetworkContexts: async (ids) => Object.fromEntries(ids.map((id) => [id, `## ${id}`])),
  };

  const mockSearch: CandidateSearch = {
    searchIntentCandidates: async () => [{ type: 'intent', id: 'intent-bob', userId: bob, networkId: 'idx-1', score: 0.9 }],
  };
  const mockEmbedder = {
    generate: async (_text: string | string[]) => dummyEmbedding,
  };

  const discovery = new CandidateDiscovery({
    database: mockDb,
    search: mockSearch,
    embedder: mockEmbedder,
  });

  return { discovery, mockDb, mockSearch, mockEmbedder };
}

describe('CandidateDiscovery', () => {
  test('when user has no network memberships, returns no candidates', async () => {
    const { discovery, mockEmbedder, mockSearch } = createMockDiscovery({
      getUserNetworkIds: () => Promise.resolve([]),
    });
    const embeddingSpy = spyOn(mockEmbedder, 'generate');
    const searchSpy = spyOn(mockSearch, 'searchIntentCandidates');

    await expect(
      discovery.discover({
        userId: owner,
        triggerIntentId: 'intent-1',
        query: 'co-founder',
        minSimilarity: DISCOVERY_MIN_SIMILARITY,
        networkIds: ['idx-1'],
      }),
    ).rejects.toThrow('outside authorized scope');

    expect(embeddingSpy).not.toHaveBeenCalled();
    expect(searchSpy).not.toHaveBeenCalled();
  });

  test('when user has no active intents, discovery fails closed', async () => {
    const { discovery, mockSearch } = createMockDiscovery({
      getActiveIntents: () => Promise.resolve([]),
    });
    const searchSpy = spyOn(mockSearch, 'searchIntentCandidates');

    await expect(
      discovery.discover({
        userId: owner,
        triggerIntentId: 'intent-1',
        query: 'co-founder',
        minSimilarity: DISCOVERY_MIN_SIMILARITY,
        networkIds: ['idx-1'],
      }),
    ).rejects.toThrow('Trigger intent is not available for discovery.');

    expect(searchSpy).not.toHaveBeenCalled();
  });

  test('when trigger intent is not an active intent owned by user, fails closed', async () => {
    const { discovery, mockSearch } = createMockDiscovery();
    const searchSpy = spyOn(mockSearch, 'searchIntentCandidates');

    await expect(
      discovery.discover({
        userId: owner,
        triggerIntentId: 'foreign-intent',
        query: 'co-founder',
        minSimilarity: DISCOVERY_MIN_SIMILARITY,
        networkIds: ['idx-1'],
      }),
    ).rejects.toThrow('Trigger intent is not available for discovery.');

    expect(searchSpy).not.toHaveBeenCalled();
  });

  test('when requested network is outside authorized scope, fails closed', async () => {
    const { discovery, mockSearch } = createMockDiscovery({
      getUserNetworkIds: () => Promise.resolve(['idx-1']),
    });
    const searchSpy = spyOn(mockSearch, 'searchIntentCandidates');

    await expect(
      discovery.discover({
        userId: owner,
        triggerIntentId: 'intent-1',
        query: 'co-founder',
        minSimilarity: DISCOVERY_MIN_SIMILARITY,
        networkIds: ['idx-unauthorized'],
      }),
    ).rejects.toThrow('outside authorized scope');

    expect(searchSpy).not.toHaveBeenCalled();
  });

  test('performs vector search with network scope, minScore and excludeUserId', async () => {
    const { discovery, mockSearch } = createMockDiscovery();
    const searchSpy = spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([
      {
        type: 'intent',
        id: 'intent-bob',
        userId: bob,
        score: 0.92,
        networkId: 'idx-1',
      },
    ]);

    const result = await discovery.discover({
      userId: owner,
      triggerIntentId: 'intent-1',
      query: 'co-founder',
      minSimilarity: 0.5,
      networkIds: ['idx-1'],
    });

    expect(searchSpy).toHaveBeenCalled();
    const call = searchSpy.mock.calls[0];
    expect(call?.[1]?.networkScope).toEqual(['idx-1']);
    expect(call?.[1]?.excludeUserId).toBe(owner);
    expect(call?.[1]?.minScore).toBe(0.5);
    expect(result.candidates.length).toBe(1);
    expect(result.candidates[0]).toMatchObject({
      candidateUserId: bob,
      candidateIntentId: 'intent-bob',
      networkId: 'idx-1',
      similarity: 0.92,
    });
  });

  test('removes inactive candidate pairs before returning candidates', async () => {
    const getActiveNetworkMembershipPairs = mock(async (
      pairs: Array<{ userId: string; networkId: string }>,
    ) => pairs.filter((pair) => pair.userId === owner));
    const { discovery } = createMockDiscovery({ getActiveNetworkMembershipPairs });

    const result = await discovery.discover({
      userId: owner,
      triggerIntentId: 'intent-1',
      query: 'co-founder',
      minSimilarity: DISCOVERY_MIN_SIMILARITY,
      networkIds: ['idx-1'],
    });

    expect(getActiveNetworkMembershipPairs).toHaveBeenCalled();
    expect(result.candidates).toEqual([]);
  });

  test('returns candidate evidence with hydrated context and payload', async () => {
    const { discovery, mockSearch } = createMockDiscovery();
    spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([
      {
        type: 'intent',
        id: 'intent-bob',
        userId: bob,
        score: 0.88,
        networkId: 'idx-1',
      },
    ]);

    const result = await discovery.discover({
      userId: owner,
      triggerIntentId: 'intent-1',
      query: 'co-founder',
      minSimilarity: DISCOVERY_MIN_SIMILARITY,
      networkIds: ['idx-1'],
    });

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      candidateIntentId: 'intent-bob',
      candidateUserId: bob,
      networkId: 'idx-1',
      similarity: 0.88,
      candidatePayload: 'I want to build a startup as a technical co-founder',
      networkContext: '## idx-1',
    });
  });

  test('sorts candidates by similarity descending and deduplicates per intent and network', async () => {
    const charlie = 'c0000000-0000-4000-8000-000000000003';
    const { discovery, mockSearch } = createMockDiscovery({
      getActiveIntents: async (id: string) => {
        if (id === owner) return [{ id: 'intent-1', payload: 'Looking for a co-founder' }];
        if (id === bob) return [{ id: 'intent-bob', payload: 'Building AI startup' }];
        if (id === charlie) return [{ id: 'intent-charlie', payload: 'Senior AI researcher' }];
        return [];
      },
    });

    spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([
      { type: 'intent', id: 'intent-bob', userId: bob, score: 0.75, networkId: 'idx-1' },
      { type: 'intent', id: 'intent-charlie', userId: charlie, score: 0.95, networkId: 'idx-1' },
      { type: 'intent', id: 'intent-bob', userId: bob, score: 0.80, networkId: 'idx-1' },
    ]);

    const result = await discovery.discover({
      userId: owner,
      triggerIntentId: 'intent-1',
      query: 'AI startup partner',
      minSimilarity: 0.5,
      networkIds: ['idx-1'],
    });

    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0]!.candidateUserId).toBe(charlie);
    expect(result.candidates[0]!.similarity).toBe(0.95);
    expect(result.candidates[1]!.candidateUserId).toBe(bob);
    expect(result.candidates[1]!.similarity).toBe(0.80);
  });

  test('embeds the search query', async () => {
    const { discovery, mockEmbedder, mockSearch } = createMockDiscovery();
    const embeddingSpy = spyOn(mockEmbedder, 'generate');
    spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([]);

    await discovery.discover({
      userId: owner,
      triggerIntentId: 'intent-1',
      query: 'AI research partner',
      minSimilarity: DISCOVERY_MIN_SIMILARITY,
      networkIds: ['idx-1'],
    });

    expect(embeddingSpy).toHaveBeenCalledTimes(1);
    expect(embeddingSpy.mock.calls[0]?.[0]).toBe('AI research partner');
  });
});
