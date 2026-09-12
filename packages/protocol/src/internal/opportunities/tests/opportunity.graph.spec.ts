import { describe, test, expect, mock, spyOn } from 'bun:test';
import { Discovery, DISCOVERY_MIN_SIMILARITY } from '@indexnetwork/discovery';
import type { DiscoveryData, DiscoveryDeps, DiscoveryInput, DiscoveryState, CandidateSearch } from '@indexnetwork/discovery';

import { resolveDiscoveryNetworkScope, renderDiscoveryNetworkContext } from '../../../index.js';

const owner = 'a0000000-0000-4000-8000-000000000001';
const bob = 'b0000000-0000-4000-8000-000000000002';
const dummyEmbedding = new Array(2000).fill(0.1);
type DiscoveryResult = DiscoveryState;

/** Existing fake-host coverage now stops at retrieval; only the personal agent selects negotiations. */
function createMockGraph(deps: {
  getUserNetworkIds?: () => Promise<string[]>;
  getActiveIntents?: DiscoveryData['getActiveIntents'];
  getNetworkIdsForIntent?: DiscoveryData['getNetworkIdsForIntent'];
  getActiveNetworkMembershipPairs?: DiscoveryData['getActiveNetworkMembershipPairs'];
  thresholdOverrides?: Pick<DiscoveryDeps, 'retrievalMinSimilarity'> | null;
} = {}) {
  const mockDb = {
    openCounterparties: mock(async () => []),
    getNetwork: mock(async (id: string) => ({ title: id })),
    getNetworkMemberships: async () => (await (deps.getUserNetworkIds?.() ?? Promise.resolve(['idx-1']))).map(networkId => ({ networkId })),
    getActiveIntents: deps.getActiveIntents ?? (async (id: string) => id === owner
      ? [{ id: 'intent-1', payload: 'Looking for a technical co-founder' }]
      : [{ id: 'intent-bob', payload: 'I want to build a startup as a technical co-founder' }, { id: 'intent-alice', payload: 'Looking for a co-founder' }]),
    getProfile: async () => null,
    getNetworkIdsForIntent: deps.getNetworkIdsForIntent ?? (async () => deps.getUserNetworkIds?.() ?? ['idx-1']),
    getActiveNetworkMembershipPairs: deps.getActiveNetworkMembershipPairs ?? (async pairs => pairs),
    getRecentlyRejectedOpportunityCounterparties: async () => [],
  };
  const data: DiscoveryData = { ...mockDb,
    getDiscoveryScope: async input => resolveDiscoveryNetworkScope({ userNetworkIds: input.userNetworks,
      networkId: input.networkId, networkScope: input.networkScope, ownsRequestedNetwork: false,
      triggerIntentNetworkIds: await mockDb.getNetworkIdsForIntent(input.triggerIntentId),
    }),
    getNetworkContexts: async ids => Object.fromEntries(await Promise.all(ids.map(async id => [id, renderDiscoveryNetworkContext(await mockDb.getNetwork(id))!]))),
  };
  const mockSearch: CandidateSearch = { searchIntentCandidates: async () => [{ type: 'intent', id: 'intent-bob', userId: bob, networkId: 'idx-1', score: 0.9 }] };
  const mockEmbedder = { generate: async (_text: string | string[]) => dummyEmbedding };
  const discovery = new Discovery({ database: data, search: mockSearch, embedder: mockEmbedder, ...deps.thresholdOverrides });
  return { discovery, mockDb, mockSearch, mockEmbedder };
}

describe('Explicit candidate discovery', () => {
    test('when user has no network memberships, returns no candidates', async () => {
      const { discovery, mockEmbedder, mockSearch } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve([]),
      });
      const embeddingSpy = spyOn(mockEmbedder, 'generate');
      const searchSpy = spyOn(mockSearch, 'searchIntentCandidates');

      const result = (await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      } as DiscoveryInput)) as DiscoveryResult;

      expect(result.networkIds).toEqual([]);
      expect(result.candidates).toEqual([]);
      expect(embeddingSpy).not.toHaveBeenCalled();
      expect(searchSpy).not.toHaveBeenCalled();
    });

    test('when user has no active intents, discovery fails closed', async () => {
      const { discovery, mockSearch } = createMockGraph({
        getActiveIntents: () => Promise.resolve([]),
      });
      spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([]);

      const result = (await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      } as DiscoveryInput)) as DiscoveryResult;

      expect(result.error).toContain('not available');
      expect(mockSearch.searchIntentCandidates).not.toHaveBeenCalled();
      expect(result.candidates).toEqual([]);
    });

    test('when networkId provided and user is member, search covers only that network', async () => {
      const { discovery, mockDb } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve(['idx-1', 'idx-2']),
      });
      const getNetworkSpy = spyOn(mockDb, 'getNetwork');

      await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        networkId: 'idx-1',
        options: {},
      } as DiscoveryInput);

      expect(getNetworkSpy).toHaveBeenCalledWith('idx-1');
      expect(getNetworkSpy.mock.calls.map((call) => call[0])).not.toContain('idx-2');
    });

    test('when networkId omitted, one query covers all assigned networks', async () => {
      const { discovery, mockDb } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve(['idx-1', 'idx-2']),
      });
      const getNetworkSpy = spyOn(mockDb, 'getNetwork');

      await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: { limit: 5 },
      } as DiscoveryInput);

      expect(getNetworkSpy).toHaveBeenCalledWith('idx-1');
      expect(getNetworkSpy).toHaveBeenCalledWith('idx-2');
    });

    test('when triggerIntentId is present, unscoped graph discovery searches only active assigned networks', async () => {
      const { discovery, mockSearch } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve(['idx-1', 'idx-2']),
        getNetworkIdsForIntent: async () => ['idx-2'],
      });
      const searchSpy = spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([]);

      await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: { limit: 5 },
      } as DiscoveryInput);

      const searchedNetworks = searchSpy.mock.calls.flatMap((call) => call?.[1]?.networkScope ?? []);
      expect([...new Set(searchedNetworks)]).toEqual(['idx-2']);
      expect(searchedNetworks).not.toContain('idx-1');
    });

    test('when trigger intent is not an active intent owned by the user, discovery fails closed', async () => {
      const { discovery, mockSearch } = createMockGraph({
        getNetworkIdsForIntent: async () => ['idx-1'],
      });
      const searchSpy = spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([]);

      const result = await discovery.discover({
        userId: owner, triggerIntentId: 'foreign-intent',
        searchQuery: 'co-founder',
        options: { limit: 5 },
      } as DiscoveryInput);

      expect(searchSpy).not.toHaveBeenCalled();
      expect(result.error).toContain('not available');
      expect(result.candidates).toEqual([]);
    });

    test('when trigger intent has no active assigned network, graph discovery fails closed', async () => {
      const { discovery, mockSearch } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve(['idx-1', 'idx-2']),
        getNetworkIdsForIntent: async () => ['idx-foreign'],
      });
      const searchSpy = spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([]);

      const result = await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: { limit: 5 },
      } as DiscoveryInput);

      expect(searchSpy).not.toHaveBeenCalled();
      expect(result.candidates).toEqual([]);
    });

    test('when networkScope is explicitly empty, discovery fails closed', async () => {
      const { discovery, mockSearch } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve(['idx-1', 'idx-2']),
      });
      const searchSpy = spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([]);

      const result = await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        networkScope: [],
        options: { limit: 5 },
      } as DiscoveryInput);

      expect(searchSpy).not.toHaveBeenCalled();
      expect(result.candidates).toEqual([]);
    });

    test('when networkScope provided, the vector search is intersected and networks outside it are excluded', async () => {
      const { discovery, mockSearch } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve(['idx-1', 'idx-2', 'idx-3']),
      });
      const searchSpy = spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([]);

      await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        // A network-scoped agent reaches only its bound network + personal network;
        // idx-3 is another network the user belongs to and must not be searched.
        networkScope: ['idx-1', 'idx-2'],
        options: { limit: 5 },
      } as DiscoveryInput);

      expect(searchSpy).toHaveBeenCalled();
      expect(searchSpy).toHaveBeenCalledTimes(1);
      const searchedNetworks = searchSpy.mock.calls
        .flatMap((c) => c?.[1]?.networkScope ?? []);
      expect([...new Set(searchedNetworks)].sort()).toEqual(['idx-1', 'idx-2']);
      expect(searchedNetworks).not.toContain('idx-3');
    });

    test('constructor overrides govern the single retrieval call', async () => {
      const thresholds = {
        retrievalMinSimilarity: 0.42,
      };
      const { discovery, mockSearch } = createMockGraph({
        thresholdOverrides: thresholds,
      });
      const searchSpy = spyOn(mockSearch, 'searchIntentCandidates');

      const result = await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      });

      expect(searchSpy.mock.calls[0]?.[1]?.minScore).toBe(0.42);
      expect(result.candidates).toHaveLength(1);
      expect(searchSpy).toHaveBeenCalledTimes(1);
    });

    test('the built-in retrieval threshold applies unless constructor overrides are provided', async () => {
      const fromDefaults = createMockGraph({ thresholdOverrides: null });
      const defaultsSearch = spyOn(fromDefaults.mockSearch, 'searchIntentCandidates');
      await fromDefaults.discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      });
      expect(defaultsSearch.mock.calls[0]?.[1]?.minScore).toBe(DISCOVERY_MIN_SIMILARITY);

      const fromConstructor = createMockGraph({
        thresholdOverrides: { retrievalMinSimilarity: 0.52 },
      });
      const constructorSearch = spyOn(fromConstructor.mockSearch, 'searchIntentCandidates');
      await fromConstructor.discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      });
      expect(constructorSearch.mock.calls[0]?.[1]?.minScore).toBe(0.52);
    });

    test('performs vector search with network scope and excludeUserId', async () => {
      const { discovery, mockSearch } = createMockGraph();
      const searchSpy = spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.92,
          networkId: 'idx-1',
        },
      ]);

      const result = (await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: { limit: 5 },
      } as DiscoveryInput)) as DiscoveryResult;

      expect(searchSpy).toHaveBeenCalled();
      const call = searchSpy.mock.calls[0];
      expect(call?.[1]?.networkScope).toContain('idx-1');
      expect(call?.[1]?.excludeUserId).toBe('a0000000-0000-4000-8000-000000000001');
      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    });

    test('does not broaden retrieval when the first query finds few candidates', async () => {
      const { discovery, mockSearch } = createMockGraph();
      const firstPass = Array.from({ length: 3 }, (_, i) => ({
        type: 'intent' as const,
        id: `intent-first-${i}`,
        userId: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
        score: 0.9 - i * 0.01,
        networkId: 'idx-1',
      }));
      const toppedUp = Array.from({ length: 12 }, (_, i) => ({
        type: 'intent' as const,
        id: `intent-top-${i}`,
        userId: `${String(i + 100).padStart(8, '0')}-0000-4000-8000-000000000000`,
        score: 0.1,
        networkId: 'idx-1',
      }));
      const searchSpy = spyOn(mockSearch, 'searchIntentCandidates').mockImplementation(
        async (_lensEmbeddings, opts) => (opts?.minScore === 0 ? toppedUp : firstPass),
      );

      const result = (await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      } as DiscoveryInput)) as DiscoveryResult;

      expect(searchSpy).toHaveBeenCalledTimes(1);
      expect(searchSpy.mock.calls[0]?.[1]?.minScore).toBe(DISCOVERY_MIN_SIMILARITY);
      expect(result.candidates.every(candidate => candidate.similarity >= DISCOVERY_MIN_SIMILARITY)).toBe(true);
    });

    test('does not top up retrieval when the first pass already has enough distinct users', async () => {
      const { discovery, mockSearch } = createMockGraph();
      const candidates = Array.from({ length: 12 }, (_, i) => ({
        type: 'intent' as const,
        id: `intent-${i}`,
        userId: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
        score: 0.9 - i * 0.01,
        networkId: 'idx-1',
      }));
      const searchSpy = spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue(candidates);

      await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      } as DiscoveryInput);

      expect(searchSpy).toHaveBeenCalledTimes(1);
    });

    test('removes inactive candidate pairs before returning candidates', async () => {
      const getActiveNetworkMembershipPairs = mock(async (
        pairs: Array<{ userId: string; networkId: string }>,
      ) => pairs.filter((pair) => pair.userId === 'a0000000-0000-4000-8000-000000000001'));
      const { discovery } = createMockGraph({ getActiveNetworkMembershipPairs });

      const result = await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      } as DiscoveryInput);

      expect(getActiveNetworkMembershipPairs).toHaveBeenCalled();
      expect(result.candidates).toEqual([]);
    });

    test('fails closed when the trigger intent is unassigned after initial scope resolution', async () => {
      let assignmentRead = 0;
      const { discovery, mockDb } = createMockGraph({
        getNetworkIdsForIntent: async () => {
          assignmentRead += 1;
          return assignmentRead === 1 ? ['idx-1'] : [];
        },
      });
      const createIfEligible = spyOn(mockDb, 'openCounterparties');

      const result = await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      } as DiscoveryInput);

      expect(assignmentRead).toBeGreaterThanOrEqual(2);
      expect(createIfEligible).not.toHaveBeenCalled();
      expect(result.candidates).toEqual([]);
    });

    test('when discovery returns a candidate, no negotiation is opened', async () => {
      const { discovery, mockDb, mockSearch } = createMockGraph();
      const openSpy = spyOn(mockDb, 'openCounterparties');
      spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          networkId: 'idx-1',
        },
      ]);

      const result = (await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      } as DiscoveryInput)) as DiscoveryResult;

      expect(result.candidates.length).toBe(1);
      expect(openSpy).not.toHaveBeenCalled();
      expect(result.candidates[0]).toMatchObject({ candidateUserId: bob, candidateIntentId: 'intent-bob', networkId: 'idx-1' });
    });

    test('returns candidate evidence for agent evaluation', async () => {
      const { discovery, mockDb, mockSearch } = createMockGraph();
      const upsertSpy = spyOn(mockDb, 'openCounterparties');
      spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          networkId: 'idx-1',
        },
      ]);

      const result = await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      } as DiscoveryInput);

      expect(upsertSpy).not.toHaveBeenCalled();
      expect(result.candidates[0]).toMatchObject({ candidateIntentId: 'intent-bob', networkId: 'idx-1', similarity: 0.9,
        candidatePayload: 'I want to build a startup as a technical co-founder', networkContext: '## idx-1' });
    });

    test('sorts by score and applies limit', async () => {
      // Score is derived from discovery similarity now — the higher-similarity
      // candidate (c, 0.9) should outrank the lower one (bob, 0.8).
      const { discovery, mockDb, mockSearch } = createMockGraph();
      const openSpy = spyOn(mockDb, 'openCounterparties');
      spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.8, networkId: 'idx-1' },
        { type: 'intent' as const, id: 'intent-alice', userId: 'c0000000-0000-4000-8000-000000000003', score: 0.9, networkId: 'idx-1' },
      ]);

      const result = (await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: { limit: 1 },
      } as DiscoveryInput)) as DiscoveryResult;

      expect(result.candidates.length).toBe(1);
      expect(openSpy).not.toHaveBeenCalled();
      expect(result.candidates[0]!.candidateUserId).toBe('c0000000-0000-4000-8000-000000000003');
    });

    test('when no network memberships, full invoke does not call embedder or search or openCounterparties', async () => {
      const { discovery, mockDb, mockEmbedder, mockSearch } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve([]),
      });
      const embeddingSpy = spyOn(mockEmbedder, 'generate');
      const searchSpy = spyOn(mockSearch, 'searchIntentCandidates');
      const createSpy = spyOn(mockDb, 'openCounterparties');

      await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      } as DiscoveryInput);

      expect(embeddingSpy).not.toHaveBeenCalled();
      expect(searchSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    test('when no active intents, full invoke does not openCounterparties when query discovery returns no candidates', async () => {
      const { discovery, mockDb, mockSearch } = createMockGraph({
        getActiveIntents: () => Promise.resolve([]),
      });
      spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([]);
      const createSpy = spyOn(mockDb, 'openCounterparties');

      await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      } as DiscoveryInput);

      expect(createSpy).not.toHaveBeenCalled();
    });

    test('invoke with an explicit query returns candidates with grounded evidence', async () => {
      const { discovery, mockDb, mockSearch } = createMockGraph();
      const openSpy = spyOn(mockDb, 'openCounterparties');
      spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          networkId: 'idx-1',
        },
      ]);

      const result = (await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: { limit: 5 },
      } as DiscoveryInput)) as DiscoveryResult;

      expect(result.candidates).toBeDefined();
      expect(Array.isArray(result.candidates)).toBe(true);
      expect(result.candidates).toHaveLength(1);
      expect(openSpy).not.toHaveBeenCalled();
      expect(result.candidates[0]).toMatchObject({ candidateUserId: bob, candidateIntentId: 'intent-bob', networkId: 'idx-1', similarity: 0.9 });
    });

    test('when search returns empty, candidates remain empty', async () => {
      const { discovery, mockSearch } = createMockGraph();
      spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([]);

      const result = (await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'co-founder',
        options: {},
      } as DiscoveryInput)) as DiscoveryResult;

      expect(result.candidates).toEqual([]);
      expect(result.candidates).toEqual([]);
    });

    test('embeds the search query', async () => {
      const { discovery, mockEmbedder, mockSearch } = createMockGraph({
        getProfile: {
          userId: 'user-alice',
          identity: { name: 'Alice Chen', bio: 'Full-stack engineer building AI tools', location: 'Remote' },
          context: 'Alice is a software engineer',
        } satisfies UserIdentity,
        getActiveIntents: () =>
          Promise.resolve([
            {
              id: 'intent-1',
              payload: 'Looking for an AI research collaborator',
              summary: 'AI collaborator',
              createdAt: new Date(),
            },
          ]),
      });

      const embeddingSpy = spyOn(mockEmbedder, 'generate');
      spyOn(mockSearch, 'searchIntentCandidates').mockResolvedValue([]);

      await discovery.discover({
        userId: owner, triggerIntentId: 'intent-1',
        searchQuery: 'AI research partner',
        options: {},
      } as DiscoveryInput);

      expect(embeddingSpy).toHaveBeenCalledTimes(1);
      expect(embeddingSpy.mock.calls[0]?.[0]).toBe('AI research partner');
    });
});
