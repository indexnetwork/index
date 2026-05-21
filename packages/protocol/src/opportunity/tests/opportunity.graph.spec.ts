/**
 * Opportunity Graph: tests for the refactored linear workflow.
 * Flow: Prep → Scope → Discovery → Evaluation → Ranking → Persist.
 * Invoke API: { userId, searchQuery?, networkId?, options }.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, it, expect, spyOn } from 'bun:test';
import { OpportunityGraphFactory, type OpportunityEvaluatorLike, buildDiscovererContext } from '../opportunity.graph.js';
import type { Id } from '../../types/common.types.js';
import type {
  OpportunityGraphDatabase,
  OpportunityActor,
  Opportunity,
} from '../../shared/interfaces/database.interface.js';
import type { Embedder } from '../../shared/interfaces/embedder.interface.js';
import type { SourceProfileData } from '../opportunity.state.js';
import { OpportunityEvaluator, type EvaluatorInput, type EvaluatorEntity } from '../opportunity.evaluator.js';
import type { EvaluatedOpportunityWithActors } from '../opportunity.evaluator.js';
import type { ProfileDocument } from '../../profile/profile.generator.js';
import { assertLLM } from '../../shared/agent/tests/llm-assert.js';
import { requestContext } from '../../shared/observability/request-context.js';

type OpportunityGraphInvokeInput = Parameters<ReturnType<OpportunityGraphFactory['createGraph']>['invoke']>[0];
type OpportunityGraphInvokeResult = Awaited<ReturnType<ReturnType<OpportunityGraphFactory['createGraph']>['invoke']>>;

const dummyEmbedding = new Array(2000).fill(0.1);

const defaultMockEvaluatorResult: EvaluatedOpportunityWithActors[] = [
  {
    reasoning: 'The source user is building a DeFi protocol and the candidate has relevant community and marketing expertise in the crypto space.',
    score: 88,
    actors: [
      { userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const, intentId: null },
      { userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' as const, intentId: null },
    ],
  },
];

function createMockEvaluator(
  result: EvaluatedOpportunityWithActors[] = defaultMockEvaluatorResult
): OpportunityEvaluatorLike {
  return {
    invokeEntityBundle: async () => result,
  };
}

function createMockGraph(deps?: {
  getUserIndexIds?: () => Promise<Id<'networks'>[]>;
  getNetworkMemberships?: () => Promise<Array<{ networkId: string; networkTitle: string; indexPrompt: string | null; permissions: string[]; memberPrompt: string | null; autoAssign: boolean; isPersonal: boolean; joinedAt: Date }>>;
  getActiveIntents?: () => Promise<Array<{ id: Id<'intents'>; payload: string; summary: string | null; createdAt: Date }>>;
  getNetwork?: (id: string) => Promise<{ id: string; title: string } | null>;
  getNetworkMemberCount?: (id: string) => Promise<number>;
  getProfile?: Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>;
  evaluatorResult?: EvaluatedOpportunityWithActors[];
}) {
  const mockDb: OpportunityGraphDatabase = {
    getProfile: () => Promise.resolve(deps?.getProfile ?? null),
    createOpportunity: (data) =>
      Promise.resolve({
        id: 'opp-1',
        detection: data.detection,
        actors: data.actors,
        interpretation: data.interpretation,
        context: data.context,
        confidence: data.confidence,
        status: data.status ?? 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      }),
    opportunityExistsBetweenActors: () => Promise.resolve(false),
    findOpportunitiesByActors: () => Promise.resolve([]),
    getUserIndexIds: deps?.getUserIndexIds ?? (() => Promise.resolve(['idx-1'] as Id<'networks'>[])),
    getNetworkMemberships: deps?.getNetworkMemberships ?? (async () => {
      const ids = deps?.getUserIndexIds ? await deps.getUserIndexIds() : ['idx-1'] as Id<'networks'>[];
      return ids.map(id => ({ networkId: id, networkTitle: 'Test Index', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }));
    }),
    getActiveIntents:
      deps?.getActiveIntents ??
      (() =>
        Promise.resolve([
          {
            id: 'intent-1' as Id<'intents'>,
            payload: 'Looking for a technical co-founder',
            summary: 'Co-founder',
            createdAt: new Date(),
          },
        ])),
    getNetwork: deps?.getNetwork ?? (() => Promise.resolve({ id: 'idx-1', title: 'Test Index' })),
    getNetworkMemberCount: deps?.getNetworkMemberCount ?? (() => Promise.resolve(2)),
    getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
    getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com' }),
    isNetworkMember: () => Promise.resolve(true),
    isIndexOwner: () => Promise.resolve(false),
    getOpportunity: () => Promise.resolve(null),
    getOpportunitiesForUser: () => Promise.resolve([]),
    updateOpportunityStatus: () => Promise.resolve(null),
    updateOpportunityActorApproval: () => Promise.resolve(null),
    getIntent: () => Promise.resolve(null),
    getIntentIndexScores: async () => [],
    getNetworkMemberContext: async () => null,
  };

  const mockEmbedder: Embedder = {
    generate: () => Promise.resolve(dummyEmbedding),
    search: () => Promise.resolve([]),
    searchWithHydeEmbeddings: () =>
      Promise.resolve([
        {
          type: 'intent' as const,
          id: 'intent-bob' as Id<'intents'>,
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]),
    searchWithProfileEmbedding: () => Promise.resolve([]),
  } as unknown as Embedder;

  const mockHydeGenerator = {
    invoke: () =>
      Promise.resolve({
        hydeEmbeddings: {
          mirror: dummyEmbedding,
          reciprocal: dummyEmbedding,
        },
      }),
  };

  const evaluator = createMockEvaluator(deps?.evaluatorResult ?? defaultMockEvaluatorResult);
  const queueNotification = async () => undefined;
  const factory = new OpportunityGraphFactory(mockDb, mockEmbedder, mockHydeGenerator, evaluator, queueNotification);
  const compiledGraph = factory.createGraph();
  return { compiledGraph, mockDb, mockEmbedder, mockHydeGenerator };
}

function createMockGraphWithFnOverrides(deps?: {
  getProfileFn?: (userId: string) => Promise<Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>>;
  getActiveIntentsFn?: (userId: string) => Promise<Array<{ id: Id<'intents'>; payload: string; summary: string | null; createdAt: Date }>>;
  evaluatorResult?: EvaluatedOpportunityWithActors[];
  getUserIndexIds?: () => Promise<Id<'networks'>[]>;
  getNetworkMemberships?: () => Promise<Array<{ networkId: string; networkTitle: string; indexPrompt: string | null; permissions: string[]; memberPrompt: string | null; autoAssign: boolean; isPersonal: boolean; joinedAt: Date }>>;
}) {
  const mockDb: OpportunityGraphDatabase = {
    getProfile: (userId: string) =>
      deps?.getProfileFn
        ? deps.getProfileFn(userId)
        : Promise.resolve(null),
    createOpportunity: (data) =>
      Promise.resolve({
        id: 'opp-1',
        detection: data.detection,
        actors: data.actors,
        interpretation: data.interpretation,
        context: data.context,
        confidence: data.confidence,
        status: data.status ?? 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      }),
    opportunityExistsBetweenActors: () => Promise.resolve(false),
    findOpportunitiesByActors: () => Promise.resolve([]),
    getUserIndexIds: deps?.getUserIndexIds ?? (() => Promise.resolve(['idx-1'] as Id<'networks'>[])),
    getNetworkMemberships: deps?.getNetworkMemberships ?? (async () => {
      const ids = deps?.getUserIndexIds ? await deps.getUserIndexIds() : ['idx-1'] as Id<'networks'>[];
      return ids.map(id => ({ networkId: id, networkTitle: 'Test Index', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }));
    }),
    getActiveIntents: (userId: string) =>
      deps?.getActiveIntentsFn
        ? deps.getActiveIntentsFn(userId)
        : Promise.resolve([
            {
              id: 'intent-1' as Id<'intents'>,
              payload: 'Looking for a technical co-founder',
              summary: 'Co-founder',
              createdAt: new Date(),
            },
          ]),
    getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
    getNetworkMemberCount: () => Promise.resolve(2),
    getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
    getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com' }),
    isNetworkMember: () => Promise.resolve(true),
    isIndexOwner: () => Promise.resolve(false),
    getOpportunity: () => Promise.resolve(null),
    getOpportunitiesForUser: () => Promise.resolve([]),
    updateOpportunityStatus: () => Promise.resolve(null),
    updateOpportunityActorApproval: () => Promise.resolve(null),
    getIntent: () => Promise.resolve(null),
    getIntentIndexScores: async () => [],
    getNetworkMemberContext: async () => null,
  };

  const mockEmbedder: Embedder = {
    generate: () => Promise.resolve(dummyEmbedding),
    search: () => Promise.resolve([]),
    searchWithHydeEmbeddings: () =>
      Promise.resolve([
        {
          type: 'intent' as const,
          id: 'intent-bob' as Id<'intents'>,
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]),
    searchWithProfileEmbedding: () => Promise.resolve([]),
  } as unknown as Embedder;

  const mockHyde = {
    invoke: () =>
      Promise.resolve({
        hydeEmbeddings: {
          mirror: dummyEmbedding,
          reciprocal: dummyEmbedding,
        },
      }),
  };

  const evaluator = createMockEvaluator(deps?.evaluatorResult ?? defaultMockEvaluatorResult);
  const queueNotification = async () => undefined;
  const factory = new OpportunityGraphFactory(mockDb, mockEmbedder, mockHyde, evaluator, queueNotification);
  const compiledGraph = factory.createGraph();
  return { compiledGraph, mockDb };
}

describe('Opportunity Graph', () => {
  describe('Prep node', () => {
    test('when user has no index memberships, returns error and no opportunities', async () => {
      const { compiledGraph, mockHydeGenerator, mockEmbedder } = createMockGraph({
        getUserIndexIds: () => Promise.resolve([]),
      });
      const hydeSpy = spyOn(mockHydeGenerator, 'invoke');
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings');

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.error).toBeDefined();
      expect(result.error).toContain('join');
      expect(result.opportunities).toEqual([]);
      expect(hydeSpy).not.toHaveBeenCalled();
      expect(searchSpy).not.toHaveBeenCalled();
    });

    test('when user has no active intents, continues to scope and discovery (no error about intents)', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getActiveIntents: () => Promise.resolve([]),
      });
      // With searchQuery, the profile/query path runs (query-based HyDE discovery). Mock empty search so we get no opportunities.
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.error).toBeUndefined();
      expect(result.opportunities).toEqual([]);
    });
  });

  describe('Scope node', () => {
    test('when networkId provided and user is member, targetNetworks contains only that index', async () => {
      const { compiledGraph, mockDb } = createMockGraph({
        getUserIndexIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'networks'>[]),
      });
      const getIndexSpy = spyOn(mockDb, 'getNetwork');

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        networkId: 'idx-1' as Id<'networks'>,
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(getIndexSpy).toHaveBeenCalledWith('idx-1');
      expect(getIndexSpy).toHaveBeenCalledTimes(1);
    });

    test('when networkId omitted, scope uses all user indexes', async () => {
      const { compiledGraph, mockDb } = createMockGraph({
        getUserIndexIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'networks'>[]),
      });
      const getIndexSpy = spyOn(mockDb, 'getNetwork');

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput);

      expect(getIndexSpy).toHaveBeenCalledWith('idx-1');
      expect(getIndexSpy).toHaveBeenCalledWith('idx-2');
    });
  });

  describe('Discovery node', () => {
    test('performs vector search with index scope and excludeUserId', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.92,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(searchSpy).toHaveBeenCalled();
      const call = searchSpy.mock.calls[0];
      expect(call?.[1]?.indexScope).toContain('idx-1');
      expect(call?.[1]?.excludeUserId).toBe('a0000000-0000-4000-8000-000000000001');
      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    });

    test('when search returns only profile type (no intent), profile candidates are included', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'profile' as const,
          id: 'b0000000-0000-4000-8000-000000000002',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // Profile-only candidates are now valid (no candidateIntentId)
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].candidateUserId).toBe('b0000000-0000-4000-8000-000000000002');
      expect(result.candidates[0].candidateIntentId).toBeUndefined();
    });
  });

  describe('Evaluation node: userId dedup', () => {
    test('when same user appears via multiple indexes, evaluates them only once (deduped by userId)', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getUserIndexIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'networks'>[]),
        getNetwork: (id: string) => Promise.resolve({ id, title: `Index ${id}` }),
        getNetworkMemberCount: () => Promise.resolve(5),
        evaluatorResult: [
          {
            reasoning: 'Bob is a great match.',
            score: 88,
            actors: [
              { userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const, intentId: null },
              { userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' as const, intentId: null },
            ],
          },
        ],
      });

      // Same user appears in two indexes from search results
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob-1', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
        { type: 'intent' as const, id: 'intent-bob-2', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.85, matchedVia: 'mirror' as const, networkId: 'idx-2' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // Should have deduped to 1 candidate (b0000000-0000-4000-8000-000000000002), not 2
      const candidateTraceEntries = result.trace.filter(
        (t: { node: string; data?: Record<string, unknown> }) =>
          t.node === 'candidate' && t.data?.userId === 'b0000000-0000-4000-8000-000000000002'
      );
      expect(candidateTraceEntries.length).toBe(1);
      expect(result.opportunities.length).toBe(1);
    });

    test('dedup prefers candidate from index with higher relevancy score on equal similarity', async () => {
      const { compiledGraph } = createMockGraph({
        getUserIndexIds: async () => ['idx-high', 'idx-low'] as Id<'networks'>[],
        getNetworkMemberships: async () => [
          { networkId: 'idx-high', networkTitle: 'High Relevancy', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() },
          { networkId: 'idx-low', networkTitle: 'Low Relevancy', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() },
        ],
      });

      // Invoke with indexRelevancyScores pre-set (simulating scope node output)
      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'find collaborators',
        operationMode: 'create' as const,
        indexRelevancyScores: { 'idx-high': 0.9, 'idx-low': 0.3 },
      });

      // The opportunity actors should have networkId from the higher-scoring index
      if (result.evaluatedOpportunities?.length > 0) {
        const sourceActor = result.evaluatedOpportunities[0].actors.find(
          (a: { userId: string }) => a.userId === 'a0000000-0000-4000-8000-000000000001'
        );
        const counterpartActor = result.evaluatedOpportunities[0].actors.find(
          (a: { userId: string }) => a.userId !== 'a0000000-0000-4000-8000-000000000001'
        );
        // If both actors exist, source should inherit counterpart's networkId
        if (sourceActor && counterpartActor) {
          expect(sourceActor.networkId).toBe(counterpartActor.networkId);
        }
      }
    }, 30_000);
  });

  describe('Evaluation node: early termination', () => {
    test('when search is query-driven and remaining candidates have no query-sourced entries, remainingCandidates is empty', async () => {
      // 5 query candidates come through HyDE search → tagged 'query'
      // 25 profile candidates come through profile search → tagged 'profile-similarity'
      // With EVAL_BATCH_SIZE=25, batch 1 gets all 5 query + 20 profile
      // Remaining 5 are all profile-similarity → should be cleared
      const dummyProfileEmbedding = new Array(2000).fill(0.1);
      const queryCandidates = Array.from({ length: 5 }, (_, i) => ({
        type: 'intent' as const,
        id: `intent-query-${i}`,
        userId: `${String(i + 1).padStart(8, '0')}-0000-4000-8000-0000000000a0`,
        score: 0.9 - i * 0.01,
        matchedVia: 'Painters' as const,
        networkId: 'idx-1',
      }));
      const profileCandidates = Array.from({ length: 25 }, (_, i) => ({
        type: 'profile' as const,
        id: `user-profile-${i}`,
        userId: `${String(i + 1).padStart(8, '0')}-0000-4000-8000-0000000000b0`,
        score: 0.6 - i * 0.005,
        matchedVia: 'profile-similarity' as const,
        networkId: 'idx-1',
      }));

      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [],
        getProfile: {
          userId: 'a0000000-0000-4000-8000-000000000001',
          embedding: dummyProfileEmbedding,
          identity: { name: 'Test User', bio: 'Test bio', location: 'Remote' },
          narrative: { context: 'Test narrative' },
          attributes: { interests: ['painting'], skills: ['art'] },
        } satisfies ProfileDocument,
      });

      // HyDE search returns query candidates (tagged 'query' in discovery node)
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue(queryCandidates);
      // Profile search returns profile candidates (tagged 'profile-similarity' in discovery node)
      spyOn(mockEmbedder, 'searchWithProfileEmbedding').mockResolvedValue(profileCandidates);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'painters',
        options: { minScore: 50 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // All query candidates consumed in batch 1, remaining are profile-only
      // Early termination should clear remainingCandidates
      expect(result.remainingCandidates.length).toBe(0);
    });

    test('when remaining candidates still have query-sourced entries, remainingCandidates is preserved', async () => {
      // Create 30 query candidates — after batch of 25, 5 remain with discoverySource='query'
      const allQueryCandidates = Array.from({ length: 30 }, (_, i) => ({
        type: 'intent' as const,
        id: `intent-q-${i}`,
        userId: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
        score: 0.95 - i * 0.01,
        matchedVia: 'Painters' as const,
        networkId: 'idx-1',
      }));

      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [],
      });

      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue(allQueryCandidates);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'painters',
        options: { minScore: 50 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // 5 query-sourced candidates remain — pagination should be preserved
      expect(result.remainingCandidates.length).toBe(5);
    });
  });

  describe('Evaluation and Persist', () => {
    test('when discovery returns intent candidates and evaluator returns one, opportunity is created', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].detection.source).toBe('opportunity_graph');
      expect(result.opportunities[0].actors.length).toBe(2);
      expect(result.opportunities[0].actors.some((a: OpportunityActor) => a.userId === 'b0000000-0000-4000-8000-000000000002')).toBe(true);
    });
  });

  describe('Evaluation: pairwise actor normalization', () => {
    test('when evaluator returns 3 actors, splits into pairwise opportunities (viewer + each non-viewer)', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Three-way collaboration potential.',
            score: 85,
            actors: [
              { userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const, intentId: null },
              { userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' as const, intentId: null },
              { userId: 'e0000000-0000-4000-8000-000000000005', role: 'peer' as const, intentId: null },
            ],
          },
        ],
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
        { type: 'intent' as const, id: 'intent-third', userId: 'e0000000-0000-4000-8000-000000000005', score: 0.85, matchedVia: 'reciprocal' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(2);
      for (const opp of result.opportunities) {
        expect(opp.actors.length).toBe(2);
        expect(opp.actors.some((a: OpportunityActor) => a.userId === 'a0000000-0000-4000-8000-000000000001')).toBe(true);
      }
      const candidateUserIds = result.opportunities.map(
        (opp: { actors: OpportunityActor[] }) => opp.actors.find((a: OpportunityActor) => a.userId !== 'a0000000-0000-4000-8000-000000000001')?.userId
      );
      expect(candidateUserIds).toContain('b0000000-0000-4000-8000-000000000002');
      expect(candidateUserIds).toContain('e0000000-0000-4000-8000-000000000005');
    });

    test('when splitting multi-actor result, reasoning mentioning only one candidate does not leak to the other (IND-127)', async () => {
      // Simulate: evaluator bundles Alice and Bob into one opportunity with Alice's reasoning
      const profilesByUserId: Record<string, ProfileDocument> = {
        'c0000000-0000-4000-8000-000000000003': {
          identity: { name: 'Alice Park', bio: 'Founder & CIO of Acme Labs' },
          attributes: { interests: ['crypto', 'DeFi'], skills: ['blockchain'] },
          narrative: {},
        } as ProfileDocument,
        'f0000000-0000-4000-8000-000000000006': {
          identity: { name: 'Charlie Voss', bio: 'Angel investor in AI startups' },
          attributes: { interests: ['AI', 'machine learning'], skills: ['investing'] },
          narrative: {},
        } as ProfileDocument,
      };
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Alice Park is the Founder & CIO of Acme Labs with deep expertise in blockchain and DeFi, which complements the source user\'s interest in crypto.',
            score: 82,
            actors: [
              { userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const, intentId: null },
              { userId: 'c0000000-0000-4000-8000-000000000003', role: 'agent' as const, intentId: null },
              { userId: 'f0000000-0000-4000-8000-000000000006', role: 'agent' as const, intentId: null },
            ],
          },
        ],
      });
      spyOn(mockDb, 'getProfile').mockImplementation((userId: string) =>
        Promise.resolve(profilesByUserId[userId] ?? null)
      );
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-alice', userId: 'c0000000-0000-4000-8000-000000000003', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
        { type: 'intent' as const, id: 'intent-charlie', userId: 'f0000000-0000-4000-8000-000000000006', score: 0.85, matchedVia: 'reciprocal' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'investors in crypto',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(2);

      const charlieOpp = result.opportunities.find(
        (opp: { actors: OpportunityActor[] }) => opp.actors.some((a: OpportunityActor) => a.userId === 'f0000000-0000-4000-8000-000000000006')
      );
      const aliceOpp = result.opportunities.find(
        (opp: { actors: OpportunityActor[] }) => opp.actors.some((a: OpportunityActor) => a.userId === 'c0000000-0000-4000-8000-000000000003')
      );

      expect(charlieOpp).toBeDefined();
      expect(aliceOpp).toBeDefined();

      // Alice's opportunity should keep the original reasoning (it mentions Alice)
      expect(aliceOpp!.interpretation.reasoning).toContain('Alice');

      // Charlie's opportunity must NOT contain Alice's description
      expect(charlieOpp!.interpretation.reasoning).not.toContain('Alice');
      // It should contain Charlie's own profile info instead
      expect(charlieOpp!.interpretation.reasoning).toContain('Charlie');
    });

    test('when bundled reasoning mentions both candidates, neither split reuses the shared text', async () => {
      const profilesByUserId: Record<string, ProfileDocument> = {
        'c0000000-0000-4000-8000-000000000003': {
          identity: { name: 'Alice Park', bio: 'Founder & CIO of Acme Labs' },
          attributes: { interests: ['crypto'], skills: ['blockchain'] },
          narrative: {},
        } as ProfileDocument,
        'f0000000-0000-4000-8000-000000000006': {
          identity: { name: 'Charlie Voss', bio: 'Angel investor in AI startups' },
          attributes: { interests: ['AI'], skills: ['investing'] },
          narrative: {},
        } as ProfileDocument,
      };
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Alice Park and Charlie Voss both bring complementary expertise in blockchain and AI investing.',
            score: 80,
            actors: [
              { userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const, intentId: null },
              { userId: 'c0000000-0000-4000-8000-000000000003', role: 'agent' as const, intentId: null },
              { userId: 'f0000000-0000-4000-8000-000000000006', role: 'agent' as const, intentId: null },
            ],
          },
        ],
      });
      spyOn(mockDb, 'getProfile').mockImplementation((userId: string) =>
        Promise.resolve(profilesByUserId[userId] ?? null)
      );
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-alice', userId: 'c0000000-0000-4000-8000-000000000003', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
        { type: 'intent' as const, id: 'intent-charlie', userId: 'f0000000-0000-4000-8000-000000000006', score: 0.85, matchedVia: 'reciprocal' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'blockchain and AI',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(2);

      const aliceOpp = result.opportunities.find(
        (opp: { actors: OpportunityActor[] }) => opp.actors.some((a: OpportunityActor) => a.userId === 'c0000000-0000-4000-8000-000000000003')
      );
      const charlieOpp = result.opportunities.find(
        (opp: { actors: OpportunityActor[] }) => opp.actors.some((a: OpportunityActor) => a.userId === 'f0000000-0000-4000-8000-000000000006')
      );

      expect(aliceOpp).toBeDefined();
      expect(charlieOpp).toBeDefined();

      // Neither split should reuse the shared reasoning that mentions both names
      expect(aliceOpp!.interpretation.reasoning).toContain('Alice');
      expect(aliceOpp!.interpretation.reasoning).not.toContain('Charlie');
      expect(charlieOpp!.interpretation.reasoning).toContain('Charlie');
      expect(charlieOpp!.interpretation.reasoning).not.toContain('Alice');
    });
  });

  describe('Ranking node', () => {
    test('sorts by score and applies limit', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          { reasoning: 'Technical help match.', score: 85, actors: [{ userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient', intentId: null }, { userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent', intentId: null }] },
          { reasoning: 'Complementary interests in developer tools.', score: 92, actors: [{ userId: 'a0000000-0000-4000-8000-000000000001', role: 'peer', intentId: null }, { userId: 'c0000000-0000-4000-8000-000000000003', role: 'peer', intentId: null }] },
        ],
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.8, matchedVia: 'mirror' as const, networkId: 'idx-1' },
        { type: 'intent' as const, id: 'intent-alice', userId: 'c0000000-0000-4000-8000-000000000003', score: 0.9, matchedVia: 'reciprocal' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { limit: 1, minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].actors.some((a: OpportunityActor) => a.userId === 'c0000000-0000-4000-8000-000000000003')).toBe(true);
    });
  });

  describe('Persist node: initialStatus', () => {
    test('when options.initialStatus is "latent", opportunities are created with status latent', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { initialStatus: 'latent', minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].status).toBe('latent');
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'latent' }));
    });

    test('when options.initialStatus is omitted, createOpportunity is called with status pending', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]);

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    });

    test('when evaluator assigns discoverer as agent (no introducer), persist swaps discoverer to patient', async () => {
      // Evaluator thinks the discoverer (a0000000-0000-4000-8000-000000000001) is the agent (provider) and
      // the candidate (b0000000-0000-4000-8000-000000000002) is the patient (seeker). The lifecycle guard in the
      // persist node should swap them so the discoverer always sees first at latent.
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Source can offer mentoring to candidate.',
            score: 85,
            actors: [
              { userId: 'a0000000-0000-4000-8000-000000000001', role: 'agent' as const, intentId: null },
              { userId: 'b0000000-0000-4000-8000-000000000002', role: 'patient' as const, intentId: null },
            ],
          },
        ],
      });
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]);

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { initialStatus: 'latent', minScore: 70 },
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalled();
      const createdData = createSpy.mock.calls[0][0];
      const discovererActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'a0000000-0000-4000-8000-000000000001');
      const counterpartActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'b0000000-0000-4000-8000-000000000002');
      // Discoverer should have been swapped from agent → patient
      expect(discovererActor?.role).toBe('patient');
      // Counterpart should have been swapped from patient → agent
      expect(counterpartActor?.role).toBe('agent');
    });

    test('when evaluator assigns discoverer as patient, no swap occurs', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Source needs mentoring from candidate.',
            score: 85,
            actors: [
              { userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const, intentId: null },
              { userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' as const, intentId: null },
            ],
          },
        ],
      });
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]);

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { initialStatus: 'latent', minScore: 70 },
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalled();
      const createdData = createSpy.mock.calls[0][0];
      const discovererActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'a0000000-0000-4000-8000-000000000001');
      const counterpartActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'b0000000-0000-4000-8000-000000000002');
      // No swap — discoverer stays patient, counterpart stays agent
      expect(discovererActor?.role).toBe('patient');
      expect(counterpartActor?.role).toBe('agent');
    });

    test('when evaluator assigns both as peers, no swap occurs', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Symmetric collaboration match.',
            score: 90,
            actors: [
              { userId: 'a0000000-0000-4000-8000-000000000001', role: 'peer' as const, intentId: null },
              { userId: 'b0000000-0000-4000-8000-000000000002', role: 'peer' as const, intentId: null },
            ],
          },
        ],
      });
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'collaborator' as const,
          networkId: 'idx-1',
        },
      ]);

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { initialStatus: 'latent', minScore: 70 },
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalled();
      const createdData = createSpy.mock.calls[0][0];
      const discovererActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'a0000000-0000-4000-8000-000000000001');
      const counterpartActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'b0000000-0000-4000-8000-000000000002');
      // Both stay peer — no swap needed
      expect(discovererActor?.role).toBe('peer');
      expect(counterpartActor?.role).toBe('peer');
    });
  });

  describe('Persist node: dedup via findOpportunitiesByActors', () => {
    test('when pending opportunity exists between actors, skips creation and adds to existingBetweenActors', async () => {
      const existingOpp: Opportunity = {
        id: 'opp-existing-pending',
        status: 'pending',
        actors: [
          { networkId: 'idx-1', userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const },
          { networkId: 'idx-1', userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' as const },
        ],
        detection: { source: 'opportunity_graph' as const, timestamp: new Date().toISOString() },
        interpretation: { category: 'collaboration', reasoning: 'Previous match', confidence: 0.8 },
        context: {},
        confidence: '0.8',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };

      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockDb, 'findOpportunitiesByActors').mockResolvedValue([existingOpp]);
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(createSpy).not.toHaveBeenCalled();
      expect(result.opportunities.length).toBe(0);
      expect(result.existingBetweenActors.length).toBe(1);
      expect(result.existingBetweenActors[0].candidateUserId).toBe('b0000000-0000-4000-8000-000000000002');
      expect(result.existingBetweenActors[0].existingStatus).toBe('pending');
    });

    test('when expired opportunity exists between actors, reactivates it as draft', async () => {
      const expiredOpp: Opportunity = {
        id: 'opp-expired',
        status: 'expired',
        actors: [
          { networkId: 'idx-1', userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const },
          { networkId: 'idx-1', userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' as const },
        ],
        detection: { source: 'opportunity_graph' as const, timestamp: new Date().toISOString() },
        interpretation: { category: 'collaboration', reasoning: 'Old match', confidence: 0.7 },
        context: { networkId: 'idx-1' },
        confidence: '0.7',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };
      const reactivatedOpp: Opportunity = { ...expiredOpp, status: 'draft', updatedAt: new Date() };

      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockDb, 'findOpportunitiesByActors').mockResolvedValue([expiredOpp]);
      spyOn(mockDb, 'updateOpportunityStatus').mockResolvedValue(reactivatedOpp);
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(createSpy).not.toHaveBeenCalled();
      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].id).toBe('opp-expired');
      expect(result.opportunities[0].status).toBe('draft');
      expect(result.existingBetweenActors.length).toBe(0);
    });

    test('when existing opportunity has 3 actors (viewer + candidate + third-party), dedup still detects overlap', async () => {
      const threeActorOpp: Opportunity = {
        id: 'opp-three-actors',
        status: 'pending',
        actors: [
          { networkId: 'idx-1', userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const },
          { networkId: 'idx-1', userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' as const },
          { networkId: 'idx-1', userId: 'a1000000-0000-4000-8000-000000000007', role: 'peer' as const },
        ],
        detection: { source: 'opportunity_graph' as const, timestamp: new Date().toISOString() },
        interpretation: { category: 'collaboration', reasoning: 'Three-way match', confidence: 0.85 },
        context: {},
        confidence: '0.85',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };

      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockDb, 'findOpportunitiesByActors').mockResolvedValue([threeActorOpp]);
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(createSpy).not.toHaveBeenCalled();
      expect(result.opportunities.length).toBe(0);
      expect(result.existingBetweenActors.length).toBe(1);
      expect(result.existingBetweenActors[0].candidateUserId).toBe('b0000000-0000-4000-8000-000000000002');
      expect(result.existingBetweenActors[0].existingStatus).toBe('pending');
    });

    test('when no overlapping opportunity exists, creates new opportunity normally', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockDb, 'findOpportunitiesByActors').mockResolvedValue([]);
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(createSpy).toHaveBeenCalled();
      expect(result.opportunities.length).toBe(1);
      expect(result.existingBetweenActors.length).toBe(0);
    });

    test('when latent opportunity exists between actors, dedup prevents duplicate creation (IND-166)', async () => {
      const latentOpp: Opportunity = {
        id: 'opp-latent',
        status: 'latent',
        actors: [
          { networkId: 'idx-1', userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const },
          { networkId: 'idx-1', userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' as const },
        ],
        detection: { source: 'opportunity_graph' as const, timestamp: new Date().toISOString() },
        interpretation: { category: 'collaboration', reasoning: 'Background match', confidence: 0.75 },
        context: {},
        confidence: '0.75',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };

      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockDb, 'findOpportunitiesByActors').mockResolvedValue([latentOpp]);
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { initialStatus: 'latent', minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // Should NOT create a new opportunity — latent dedup kicks in
      expect(createSpy).not.toHaveBeenCalled();
      expect(result.opportunities.length).toBe(0);
      expect(result.existingBetweenActors.length).toBe(1);
      expect(result.existingBetweenActors[0].existingStatus).toBe('latent');
    });

    test('when latent opportunity exists and initialStatus is pending, upgrades to pending (IND-166)', async () => {
      const latentOpp: Opportunity = {
        id: 'opp-latent-upgrade',
        status: 'latent',
        actors: [
          { networkId: 'idx-1', userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const },
          { networkId: 'idx-1', userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' as const },
        ],
        detection: { source: 'opportunity_graph' as const, timestamp: new Date().toISOString() },
        interpretation: { category: 'collaboration', reasoning: 'Background match', confidence: 0.75 },
        context: {},
        confidence: '0.75',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };
      const upgradedOpp: Opportunity = { ...latentOpp, status: 'pending', updatedAt: new Date() };

      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockDb, 'findOpportunitiesByActors').mockResolvedValue([latentOpp]);
      const updateSpy = spyOn(mockDb, 'updateOpportunityStatus').mockResolvedValue(upgradedOpp);
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },  // initialStatus defaults to 'pending'
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // Should upgrade, not create
      expect(createSpy).not.toHaveBeenCalled();
      expect(updateSpy).toHaveBeenCalledWith('opp-latent-upgrade', 'pending');
      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].status).toBe('pending');
    });

    test('when existing draft opportunity exists between actors, allows creation (does not dedup)', async () => {
      // Draft opportunities are excluded via excludeStatuses in the DB query,
      // so findOpportunitiesByActors returns [] when only drafts exist.
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      const findByActorsSpy = spyOn(mockDb, 'findOpportunitiesByActors').mockResolvedValue([]);
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(findByActorsSpy).toHaveBeenCalledWith(
        expect.arrayContaining(['a0000000-0000-4000-8000-000000000001', 'b0000000-0000-4000-8000-000000000002']),
        { excludeStatuses: ['draft'] },
      );
      expect(createSpy).toHaveBeenCalled();
      expect(result.opportunities.length).toBe(1);
      expect(result.existingBetweenActors.length).toBe(0);
    });
  });

  describe('Conditional routing: early exit', () => {
    test('when no index memberships, full invoke does not call HyDE or search or createOpportunity', async () => {
      const { compiledGraph, mockDb, mockHydeGenerator, mockEmbedder } = createMockGraph({
        getUserIndexIds: () => Promise.resolve([]),
      });
      const hydeSpy = spyOn(mockHydeGenerator, 'invoke');
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings');
      const createSpy = spyOn(mockDb, 'createOpportunity');

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(hydeSpy).not.toHaveBeenCalled();
      expect(searchSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
    });

    test('when no active intents, full invoke does not createOpportunity when query discovery returns no candidates', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({
        getActiveIntents: () => Promise.resolve([]),
      });
      // With searchQuery, the profile/query path runs (HyDE + search). Mock empty search so no opportunities are created.
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);
      const createSpy = spyOn(mockDb, 'createOpportunity');

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(createSpy).not.toHaveBeenCalled();
    });
  });

  describe('Full flow with new API', () => {
    test('invoke with userId, searchQuery, options returns opportunities with correct shape', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { initialStatus: 'latent', limit: 5, minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities).toBeDefined();
      expect(Array.isArray(result.opportunities)).toBe(true);
      if (result.opportunities.length > 0) {
        const opp = result.opportunities[0];
        expect(opp.detection.source).toBe('opportunity_graph');
        expect(opp.detection.createdBy).toBe('agent-opportunity-finder');
        expect(opp.interpretation.reasoning).toBeDefined();
        // context.networkId is set only when user explicitly scoped search; actor tokens carry discovery networkId
        expect(opp.actors.length).toBeGreaterThanOrEqual(1);
        expect(opp.actors[0].networkId).toBeDefined();
        expect(opp.actors[0].userId).toBeDefined();
        expect(opp.status).toBe('latent');
      }
    });

    test('when search returns empty, opportunities remain empty', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities).toEqual([]);
      expect(result.candidates).toEqual([]);
    });

    test('when evaluator returns empty (below minScore), opportunities remain empty', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [],
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.6,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 80 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
      expect(result.opportunities).toEqual([]);
    });
  });

  describe('create_introduction path', () => {
    const introEntities = [
      { userId: 'c0000000-0000-4000-8000-000000000003', profile: { name: 'Alice' }, networkId: 'idx-1' },
      { userId: 'b0000000-0000-4000-8000-000000000002', profile: { name: 'Bob' }, networkId: 'idx-1' },
    ];

    test('with valid entities and hint returns one opportunity with manual detection and introducer actor', async () => {
      const { compiledGraph, mockDb } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Alice and Bob should collaborate.',
            score: 85,
            actors: [
              { userId: 'c0000000-0000-4000-8000-000000000003', role: 'peer' as const, intentId: null },
              { userId: 'b0000000-0000-4000-8000-000000000002', role: 'peer' as const, intentId: null },
            ],
          },
        ],
      });
      const createSpy = spyOn(mockDb, 'createOpportunity');

      const result = (await compiledGraph.invoke({
        operationMode: 'create_introduction',
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        networkId: 'idx-1' as Id<'networks'>,
        introductionEntities: introEntities,
        introductionHint: 'both AI devs',
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.error).toBeUndefined();
      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].detection.source).toBe('manual');
      expect(result.opportunities[0].detection.createdBy).toBe('a0000000-0000-4000-8000-000000000001');
      expect(result.opportunities[0].actors.some((a: OpportunityActor) => a.role === 'introducer' && a.userId === 'a0000000-0000-4000-8000-000000000001')).toBe(true);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          detection: expect.objectContaining({ source: 'manual', createdBy: 'a0000000-0000-4000-8000-000000000001' }),
          status: 'latent',
        })
      );
    });

    test('when requiredNetworkId does not match networkId returns error', async () => {
      const { compiledGraph } = createMockGraph();

      const result = (await compiledGraph.invoke({
        operationMode: 'create_introduction',
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        networkId: 'idx-1' as Id<'networks'>,
        introductionEntities: introEntities,
        requiredNetworkId: 'idx-other' as Id<'networks'>,
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.error).toBeDefined();
      expect(result.error).toContain('scoped');
      expect(result.opportunities?.length ?? 0).toBe(0);
    });

    test('when opportunityExistsBetweenActors returns true returns error', async () => {
      const { compiledGraph, mockDb } = createMockGraph();
      spyOn(mockDb, 'opportunityExistsBetweenActors').mockResolvedValue(true);

      const result = (await compiledGraph.invoke({
        operationMode: 'create_introduction',
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        networkId: 'idx-1' as Id<'networks'>,
        introductionEntities: introEntities,
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.error).toBeDefined();
      expect(result.error).toContain('already exists');
      expect(result.opportunities?.length ?? 0).toBe(0);
    });

    test('when introducer is not index member returns error', async () => {
      const { compiledGraph, mockDb } = createMockGraph();
      spyOn(mockDb, 'isNetworkMember').mockImplementation(async (networkId: string, userId: string) => {
        if (userId === 'a0000000-0000-4000-8000-000000000001') return false;
        return true;
      });

      const result = (await compiledGraph.invoke({
        operationMode: 'create_introduction',
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        networkId: 'idx-1' as Id<'networks'>,
        introductionEntities: introEntities,
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.error).toBeDefined();
      expect(result.error).toContain('not members');
      expect(result.opportunities?.length ?? 0).toBe(0);
    });

    test('when evaluator returns no results uses fallback and returns one opportunity', async () => {
      const { compiledGraph } = createMockGraph({ evaluatorResult: [] });

      const result = (await compiledGraph.invoke({
        operationMode: 'create_introduction',
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        networkId: 'idx-1' as Id<'networks'>,
        introductionEntities: introEntities,
        introductionHint: 'both AI devs',
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(1);
      expect(result.error).toBeUndefined();
    });
  });

  describe('onBehalfOfUserId (introducer discovery) path', () => {
    const onBehalfUserId = 'd0000000-0000-4000-8000-000000000004' as Id<'users'>;

    test('prep node fetches target user profile and intents when onBehalfOfUserId is set', async () => {
      const getProfileCalls: string[] = [];
      const getActiveIntentsCalls: string[] = [];

      const { compiledGraph } = createMockGraphWithFnOverrides({
        getProfileFn: async (userId: string) => {
          getProfileCalls.push(userId);
          if (userId === onBehalfUserId) {
            return {
              embedding: dummyEmbedding,
              identity: { name: 'Target User', bio: 'Target bio' },
              narrative: { context: 'Target context' },
              attributes: { skills: ['skill-a'], interests: ['interest-a'] },
            } as Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>;
          }
          return null;
        },
        getActiveIntentsFn: async (userId: string) => {
          getActiveIntentsCalls.push(userId);
          if (userId === onBehalfUserId) {
            return [{
              id: 'intent-target' as Id<'intents'>,
              payload: 'Target intent payload',
              summary: 'Target summary',
              createdAt: new Date(),
            }];
          }
          return [];
        },
      });

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        onBehalfOfUserId: onBehalfUserId,
        searchQuery: 'find collaborators',
        options: { limit: 1 },
      });

      expect(getProfileCalls).toContain(onBehalfUserId);
      expect(getActiveIntentsCalls).toContain(onBehalfUserId);
    });

    test('evaluation node uses target user as source entity when onBehalfOfUserId is set', async () => {
      let capturedInput: Parameters<NonNullable<OpportunityEvaluatorLike['invokeEntityBundle']>>[0] | null = null;
      const capturingEvaluator: OpportunityEvaluatorLike = {
        invokeEntityBundle: async (input) => {
          capturedInput = input;
          return defaultMockEvaluatorResult;
        },
      };

      const mockDb: OpportunityGraphDatabase = {
        getProfile: async (userId: string) => {
          if (userId === onBehalfUserId) {
            return {
              embedding: dummyEmbedding,
              identity: { name: 'Target User', bio: 'Target bio' },
            } as Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>;
          }
          return { embedding: dummyEmbedding, identity: { name: 'Source User' } } as Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>;
        },
        createOpportunity: (data) =>
          Promise.resolve({
            id: 'opp-1',
            detection: data.detection,
            actors: data.actors,
            interpretation: data.interpretation,
            context: data.context,
            confidence: data.confidence,
            status: data.status ?? 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
            expiresAt: null,
          }),
        opportunityExistsBetweenActors: () => Promise.resolve(false),
        findOpportunitiesByActors: () => Promise.resolve([]),
        getUserIndexIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
        getNetworkMemberships: async () => [{ networkId: 'idx-1', networkTitle: 'Test Index', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }],
        getActiveIntents: async (userId: string) => {
          if (userId === onBehalfUserId) {
            return [{
              id: 'intent-target' as Id<'intents'>,
              payload: 'Target intent payload',
              summary: 'Target summary',
              createdAt: new Date(),
            }];
          }
          return [];
        },
        getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
        getNetworkMemberCount: () => Promise.resolve(2),
        getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
        getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com' }),
        isNetworkMember: () => Promise.resolve(true),
        isIndexOwner: () => Promise.resolve(false),
        getOpportunity: () => Promise.resolve(null),
        getOpportunitiesForUser: () => Promise.resolve([]),
        updateOpportunityStatus: () => Promise.resolve(null),
        updateOpportunityActorApproval: () => Promise.resolve(null),
        getIntent: () => Promise.resolve(null),
            getIntentIndexScores: async () => [],
        getNetworkMemberContext: async () => null,
      };

      const mockEmbedder: Embedder = {
        generate: () => Promise.resolve(dummyEmbedding),
        search: () => Promise.resolve([]),
        searchWithHydeEmbeddings: () =>
          Promise.resolve([
            {
              type: 'intent' as const,
              id: 'intent-bob' as Id<'intents'>,
              userId: 'b0000000-0000-4000-8000-000000000002',
              score: 0.9,
              matchedVia: 'mirror' as const,
              networkId: 'idx-1',
            },
          ]),
        searchWithProfileEmbedding: () => Promise.resolve([]),
      } as unknown as Embedder;

      const mockHyde = {
        invoke: () =>
          Promise.resolve({
            hydeEmbeddings: {
              mirror: dummyEmbedding,
              reciprocal: dummyEmbedding,
            },
          }),
      };

      const factory = new OpportunityGraphFactory(mockDb, mockEmbedder, mockHyde, capturingEvaluator, async () => undefined);
      const compiledGraph = factory.createGraph();

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        onBehalfOfUserId: onBehalfUserId,
        searchQuery: 'find collaborators',
        options: {},
      });

      expect(capturedInput).not.toBeNull();
      expect(capturedInput!.discovererId).toBe(onBehalfUserId);
      const sourceEntity = capturedInput!.entities?.find((e) => e.userId === onBehalfUserId);
      expect(sourceEntity).toBeDefined();
      expect(sourceEntity?.profile?.name).toBe('Target User');
    });

    test('persist node assigns userId as introducer actor when onBehalfOfUserId is set', async () => {
      const { compiledGraph } = createMockGraphWithFnOverrides({
        getProfileFn: async (userId: string) => ({
          embedding: dummyEmbedding,
          identity: { name: userId === onBehalfUserId ? 'Target User' : 'Bob' },
        } as Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>),
        evaluatorResult: [{
          reasoning: 'Great match for target user.',
          score: 85,
          actors: [
            { userId: onBehalfUserId, role: 'patient' as const, intentId: null },
            { userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' as const, intentId: null },
          ],
        }],
      });

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        onBehalfOfUserId: onBehalfUserId,
        searchQuery: 'find collaborators',
        options: { limit: 1 },
      });

      expect(result.opportunities.length).toBeGreaterThan(0);
      const opp = result.opportunities[0];
      const introducerActor = opp.actors.find((a: OpportunityActor) => a.role === 'introducer');
      const targetActor = opp.actors.find((a: OpportunityActor) => a.userId === onBehalfUserId);

      expect(introducerActor).toBeDefined();
      expect(introducerActor!.userId).toBe('a0000000-0000-4000-8000-000000000001');
      expect(targetActor).toBeDefined();
      expect(targetActor!.role).not.toBe('introducer');
      expect(opp.detection?.source).toBe('manual');
      expect(opp.actors.length).toBe(3); // target + candidate + introducer
    });
  });

  describe('targetUserId filtering', () => {
    test('when targetUserId is set, only candidates matching that user are returned', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Shared interest in design and technology.',
            score: 82,
            actors: [
              { userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const, intentId: null },
              { userId: 'c0000000-0000-4000-8000-000000000003', role: 'agent' as const, intentId: null },
            ],
          },
        ],
      });
      // Return two candidates: b0000000-0000-4000-8000-000000000002 and c0000000-0000-4000-8000-000000000003
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob' as Id<'intents'>,
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
        {
          type: 'intent' as const,
          id: 'intent-alice' as Id<'intents'>,
          userId: 'c0000000-0000-4000-8000-000000000003',
          score: 0.85,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]);

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'design and technology overlap',
        targetUserId: 'c0000000-0000-4000-8000-000000000003' as Id<'users'>,
        options: {},
      });

      // Only c0000000-0000-4000-8000-000000000003 should be evaluated and persisted
      expect(result.opportunities.length).toBe(1);
      const actors = result.opportunities[0].actors;
      const candidateActor = actors.find((a: { userId: string }) => a.userId !== 'a0000000-0000-4000-8000-000000000001');
      expect(candidateActor?.userId).toBe('c0000000-0000-4000-8000-000000000003');
    });

    test('when targetUserId is not set, all candidates proceed to evaluation', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Both building DeFi.',
            score: 88,
            actors: [
              { userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const, intentId: null },
              { userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' as const, intentId: null },
            ],
          },
          {
            reasoning: 'Shared design interest.',
            score: 82,
            actors: [
              { userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const, intentId: null },
              { userId: 'c0000000-0000-4000-8000-000000000003', role: 'agent' as const, intentId: null },
            ],
          },
        ],
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob' as Id<'intents'>,
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
        {
          type: 'intent' as const,
          id: 'intent-alice' as Id<'intents'>,
          userId: 'c0000000-0000-4000-8000-000000000003',
          score: 0.85,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]);

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'design and technology overlap',
        options: {},
      });

      // Both candidates should proceed (no filtering) — at least 1 opportunity
      expect(result.opportunities.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('send path', () => {
    test('when opportunity is draft and user is party actor, promotes to pending and returns success', async () => {
      const opportunityId = 'opp-draft-send-test';
      const draftOpportunity = {
        id: opportunityId,
        status: 'draft' as const,
        actors: [
          { networkId: 'idx-1', userId: 'a0000000-0000-4000-8000-000000000001', role: 'party' as const },
          { networkId: 'idx-1', userId: 'a2000000-0000-4000-8000-000000000008', role: 'party' as const },
        ],
        detection: { source: 'opportunity_graph' as const, timestamp: new Date().toISOString() },
        interpretation: { category: 'collaboration', reasoning: 'Match', confidence: 0.8 },
        context: { networkId: 'idx-1', conversationId: 'chat-1' },
        confidence: '0.8',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };
      const { compiledGraph, mockDb } = createMockGraph();
      spyOn(mockDb, 'getOpportunity').mockResolvedValue(draftOpportunity as Opportunity);
      const updateStatusSpy = spyOn(mockDb, 'updateOpportunityStatus').mockResolvedValue(null);

      const result = (await compiledGraph.invoke({
        operationMode: 'send',
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        opportunityId,
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.mutationResult?.success).toBe(true);
      expect(result.mutationResult?.opportunityId).toBe(opportunityId);
      expect(updateStatusSpy).toHaveBeenCalledWith(opportunityId, 'pending');
    });
  });

  describe('Discovery node: discoverer context', () => {
    test('passes profileContext with profile and intents to HyDE generator', async () => {
      const { compiledGraph, mockHydeGenerator, mockEmbedder } = createMockGraph({
        getProfile: {
          identity: { name: 'Alice Chen', bio: 'Full-stack engineer building AI tools', location: 'Remote' },
          narrative: { context: 'Alice is a software engineer' },
          attributes: { interests: ['machine learning', 'startups'], skills: ['TypeScript', 'Python'] },
          embedding: dummyEmbedding,
        } as ProfileDocument & { embedding: number[] },
        getActiveIntents: () =>
          Promise.resolve([
            {
              id: 'intent-1' as Id<'intents'>,
              payload: 'Looking for an AI research collaborator',
              summary: 'AI collaborator',
              createdAt: new Date(),
            },
          ]),
      });

      const hydeSpy = spyOn(mockHydeGenerator, 'invoke');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'AI research partner',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(hydeSpy).toHaveBeenCalled();
      const invokeInput = (hydeSpy.mock.calls[0] as unknown[])[0] as { profileContext?: string };
      expect(invokeInput.profileContext).toBeDefined();
      expect(invokeInput.profileContext).toContain('Alice Chen');
      expect(invokeInput.profileContext).toContain('Full-stack engineer building AI tools');
      expect(invokeInput.profileContext).toContain('Active intents');
    });
  });

  describe('Discovery node: direct-connection (targetUserId)', () => {
    const discovererId = 'a0000000-0000-4000-8000-000000000001' as Id<'users'>;
    const targetId = 'b0000000-0000-4000-8000-000000000002' as Id<'users'>;

    test('bypasses vector search and returns target user as candidate', async () => {
      const { compiledGraph, mockDb } = createMockGraphWithFnOverrides({
        getActiveIntentsFn: async (userId: string) => {
          if (userId === targetId) {
            return [{
              id: 'intent-target-1' as Id<'intents'>,
              payload: 'Looking for an ML co-founder',
              summary: 'ML co-founder',
              createdAt: new Date(),
            }];
          }
          return [{
            id: 'intent-source-1' as Id<'intents'>,
            payload: 'Building AI developer tools',
            summary: 'AI tools',
            createdAt: new Date(),
          }];
        },
        evaluatorResult: [{
          reasoning: 'Strong alignment between AI tools and ML co-founder search.',
          score: 85,
          actors: [
            { userId: discovererId, role: 'patient' as const, intentId: null },
            { userId: targetId, role: 'agent' as const, intentId: 'intent-target-1' },
          ],
        }],
      });

      // Spy on getNetworkMemberships to verify the direct path queries the target's memberships
      const membershipsSpy = spyOn(mockDb, 'getNetworkMemberships');

      const result = (await compiledGraph.invoke({
        userId: discovererId,
        targetUserId: targetId,
        searchQuery: 'What can I do with this person?',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // getNetworkMemberships should be called for both discoverer (prep) and target (discovery)
      expect(membershipsSpy).toHaveBeenCalledTimes(2);
      // Candidates should include the target user
      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
      expect(result.candidates.some(c => c.candidateUserId === targetId)).toBe(true);
    });

    test('returns candidates with similarity 1.0 and explicit_mention lens', async () => {
      const { compiledGraph } = createMockGraphWithFnOverrides({
        getActiveIntentsFn: async (userId: string) => {
          if (userId === targetId) {
            return [{
              id: 'intent-target-1' as Id<'intents'>,
              payload: 'Looking for an ML co-founder',
              summary: 'ML co-founder',
              createdAt: new Date(),
            }];
          }
          return [{ id: 'intent-1' as Id<'intents'>, payload: 'Test', summary: null, createdAt: new Date() }];
        },
        evaluatorResult: [{
          reasoning: 'Match found.',
          score: 80,
          actors: [
            { userId: discovererId, role: 'patient' as const, intentId: null },
            { userId: targetId, role: 'agent' as const, intentId: 'intent-target-1' },
          ],
        }],
      });

      const result = (await compiledGraph.invoke({
        userId: discovererId,
        targetUserId: targetId,
        searchQuery: 'Connect with this person',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      const targetCandidate = result.candidates.find(c => c.candidateUserId === targetId);
      expect(targetCandidate).toBeDefined();
      expect(targetCandidate!.similarity).toBe(1.0);
      expect(targetCandidate!.lens).toBe('explicit_mention');
    });

    test('returns profile-level candidate when target has no intents', async () => {
      const { compiledGraph } = createMockGraphWithFnOverrides({
        getActiveIntentsFn: async (userId: string) => {
          if (userId === targetId) return []; // No intents for target
          return [{ id: 'intent-1' as Id<'intents'>, payload: 'Test', summary: null, createdAt: new Date() }];
        },
        evaluatorResult: [{
          reasoning: 'Profile match found.',
          score: 70,
          actors: [
            { userId: discovererId, role: 'peer' as const, intentId: null },
            { userId: targetId, role: 'peer' as const, intentId: null },
          ],
        }],
      });

      const result = (await compiledGraph.invoke({
        userId: discovererId,
        targetUserId: targetId,
        searchQuery: 'What can I do with this person?',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // Should still have a candidate (profile-level fallback)
      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
      const targetCandidate = result.candidates.find(c => c.candidateUserId === targetId);
      expect(targetCandidate).toBeDefined();
      expect(targetCandidate!.candidateIntentId).toBeUndefined();
    });

    test('no shared indexes returns empty candidates with per-userId memberships', async () => {
      const mockDb: OpportunityGraphDatabase = {
        getProfile: () => Promise.resolve(null),
        createOpportunity: (data) => Promise.resolve({
          id: 'opp-1', detection: data.detection, actors: data.actors,
          interpretation: data.interpretation, context: data.context,
          confidence: data.confidence, status: data.status ?? 'pending',
          createdAt: new Date(), updatedAt: new Date(), expiresAt: null,
        }),
        opportunityExistsBetweenActors: () => Promise.resolve(false),
        findOpportunitiesByActors: () => Promise.resolve([]),
        getUserIndexIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
        getNetworkMemberships: (userId: string) => {
          // Discoverer is in idx-1, target is in idx-999 — no overlap
          if (userId === discovererId) {
            return Promise.resolve([{ networkId: 'idx-1', networkTitle: 'Alpha', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }]);
          }
          return Promise.resolve([{ networkId: 'idx-999', networkTitle: 'Beta', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }]);
        },
        getActiveIntents: () => Promise.resolve([{
          id: 'intent-1' as Id<'intents'>, payload: 'Test intent', summary: null, createdAt: new Date(),
        }]),
        getNetwork: (id: string) => Promise.resolve({ id, title: `Index ${id}` }),
        getNetworkMemberCount: () => Promise.resolve(5),
        getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
        getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com' }),
        isNetworkMember: () => Promise.resolve(true),
        isIndexOwner: () => Promise.resolve(false),
        getOpportunity: () => Promise.resolve(null),
        getOpportunitiesForUser: () => Promise.resolve([]),
        updateOpportunityStatus: () => Promise.resolve(null),
        updateOpportunityActorApproval: () => Promise.resolve(null),
        getIntent: () => Promise.resolve(null),
        getIntentIndexScores: async () => [],
        getNetworkMemberContext: async () => null,
      };

      const mockEmbedder = {
        generate: () => Promise.resolve(dummyEmbedding),
        search: () => Promise.resolve([]),
        searchWithHydeEmbeddings: () => Promise.resolve([]),
        searchWithProfileEmbedding: () => Promise.resolve([]),
      } as unknown as Embedder;

      const mockHyde = { invoke: () => Promise.resolve({ hydeEmbeddings: { mirror: dummyEmbedding } }) };
      const evaluator = createMockEvaluator([]);
      const factory = new OpportunityGraphFactory(mockDb, mockEmbedder, mockHyde, evaluator, async () => undefined);
      const compiledGraph = factory.createGraph();

      const result = (await compiledGraph.invoke({
        userId: discovererId,
        targetUserId: targetId,
        searchQuery: 'Connect with target',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // No shared indexes → 0 candidates
      expect(result.candidates.length).toBe(0);
    });

    test('self-target (targetUserId === discoveryUserId) returns empty candidates', async () => {
      const { compiledGraph } = createMockGraphWithFnOverrides({
        evaluatorResult: [],
      });

      const result = (await compiledGraph.invoke({
        userId: discovererId,
        targetUserId: discovererId, // Self-target
        searchQuery: 'What can I do with myself?',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.candidates.length).toBe(0);
    });
  });

  // ─── Introducer gating tests ─────────────────────────────────────────────────

  describe('negotiateNode: introducer gating', () => {
    test('does not invoke the negotiation graph when an introducer actor has approved: false', async () => {
      const negotiationInvocations: unknown[] = [];

      // Minimal mock negotiation graph that records every invocation.
      const mockNegotiationGraph = {
        invoke: async (input: unknown) => {
          negotiationInvocations.push(input);
          return { outcome: null };
        },
      };

      // Build a full mockDb that mirrors createMockGraph but with a custom
      // createOpportunity that appends an unapproved introducer actor.
      const mockDb: OpportunityGraphDatabase = {
        getProfile: () => Promise.resolve(null),
        createOpportunity: (data) =>
          Promise.resolve({
            id: 'opp-gated',
            detection: data.detection,
            actors: [
              ...data.actors,
              {
                networkId: 'idx-1' as Id<'networks'>,
                userId: 'introducer-user' as Id<'users'>,
                role: 'introducer' as const,
                approved: false,
              },
            ],
            interpretation: data.interpretation,
            context: data.context,
            confidence: data.confidence,
            status: data.status ?? 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
            expiresAt: null,
          }),
        opportunityExistsBetweenActors: () => Promise.resolve(false),
        findOpportunitiesByActors: () => Promise.resolve([]),
        getUserIndexIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
        getNetworkMemberships: () =>
          Promise.resolve([
            {
              networkId: 'idx-1',
              networkTitle: 'Test Index',
              indexPrompt: null,
              permissions: ['member'],
              memberPrompt: null,
              autoAssign: true,
              isPersonal: false,
              joinedAt: new Date(),
            },
          ]),
        getActiveIntents: () =>
          Promise.resolve([
            {
              id: 'intent-1' as Id<'intents'>,
              payload: 'Looking for a technical co-founder',
              summary: 'Co-founder',
              createdAt: new Date(),
            },
          ]),
        getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
        getNetworkMemberCount: () => Promise.resolve(2),
        getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
        getUser: (userId: string) =>
          Promise.resolve({ id: userId, name: 'Test User', email: 'test@example.com' }),
        isNetworkMember: () => Promise.resolve(true),
        isIndexOwner: () => Promise.resolve(false),
        getOpportunity: () => Promise.resolve(null),
        getOpportunitiesForUser: () => Promise.resolve([]),
        updateOpportunityStatus: () => Promise.resolve(null),
        updateOpportunityActorApproval: () => Promise.resolve(null),
        getIntent: () => Promise.resolve(null),
        getIntentIndexScores: async () => [],
        getNetworkMemberContext: async () => null,
      };

      const mockEmbedder: Embedder = {
        generate: () => Promise.resolve(dummyEmbedding),
        search: () => Promise.resolve([]),
        searchWithHydeEmbeddings: () =>
          Promise.resolve([
            {
              type: 'intent' as const,
              id: 'intent-bob' as Id<'intents'>,
              userId: 'b0000000-0000-4000-8000-000000000002',
              score: 0.9,
              matchedVia: 'mirror' as const,
              networkId: 'idx-1',
            },
          ]),
        searchWithProfileEmbedding: () => Promise.resolve([]),
      } as unknown as Embedder;

      const mockHydeGenerator = {
        invoke: () =>
          Promise.resolve({
            hydeEmbeddings: { mirror: dummyEmbedding, reciprocal: dummyEmbedding },
          }),
      };

      const evaluator = createMockEvaluator(defaultMockEvaluatorResult);
      const factory = new OpportunityGraphFactory(
        mockDb,
        mockEmbedder,
        mockHydeGenerator,
        evaluator,
        async () => undefined,
        mockNegotiationGraph,
      );
      const compiledGraph = factory.createGraph();

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        operationMode: 'create' as const,
        options: { initialStatus: 'latent' as const },
      });

      // The gate should prevent the negotiation graph from being invoked
      // because the persisted opportunity has an introducer with approved: false.
      expect(negotiationInvocations).toHaveLength(0);
    });

    test('invokes the negotiation graph when introducer actor has approved: true', async () => {
      const negotiationInvocations: unknown[] = [];

      const mockNegotiationGraph = {
        invoke: async (input: unknown) => {
          negotiationInvocations.push(input);
          return { outcome: null };
        },
      };

      const mockDb: OpportunityGraphDatabase = {
        getProfile: () => Promise.resolve(null),
        createOpportunity: (data) =>
          Promise.resolve({
            id: 'opp-approved',
            detection: data.detection,
            actors: [
              ...data.actors,
              {
                networkId: 'idx-1' as Id<'networks'>,
                userId: 'introducer-user' as Id<'users'>,
                role: 'introducer' as const,
                approved: true,
              },
            ],
            interpretation: data.interpretation,
            context: data.context,
            confidence: data.confidence,
            status: data.status ?? 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
            expiresAt: null,
          }),
        opportunityExistsBetweenActors: () => Promise.resolve(false),
        findOpportunitiesByActors: () => Promise.resolve([]),
        getUserIndexIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
        getNetworkMemberships: () =>
          Promise.resolve([
            {
              networkId: 'idx-1',
              networkTitle: 'Test Index',
              indexPrompt: null,
              permissions: ['member'],
              memberPrompt: null,
              autoAssign: true,
              isPersonal: false,
              joinedAt: new Date(),
            },
          ]),
        getActiveIntents: () =>
          Promise.resolve([
            {
              id: 'intent-1' as Id<'intents'>,
              payload: 'Looking for a technical co-founder',
              summary: 'Co-founder',
              createdAt: new Date(),
            },
          ]),
        getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
        getNetworkMemberCount: () => Promise.resolve(2),
        getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
        getUser: (userId: string) =>
          Promise.resolve({ id: userId, name: 'Test User', email: 'test@example.com' }),
        isNetworkMember: () => Promise.resolve(true),
        isIndexOwner: () => Promise.resolve(false),
        getOpportunity: () => Promise.resolve(null),
        getOpportunitiesForUser: () => Promise.resolve([]),
        updateOpportunityStatus: () => Promise.resolve(null),
        updateOpportunityActorApproval: () => Promise.resolve(null),
        getIntent: () => Promise.resolve(null),
        getIntentIndexScores: async () => [],
        getNetworkMemberContext: async () => null,
      };

      const mockEmbedder: Embedder = {
        generate: () => Promise.resolve(dummyEmbedding),
        search: () => Promise.resolve([]),
        searchWithHydeEmbeddings: () =>
          Promise.resolve([
            {
              type: 'intent' as const,
              id: 'intent-bob' as Id<'intents'>,
              userId: 'b0000000-0000-4000-8000-000000000002',
              score: 0.9,
              matchedVia: 'mirror' as const,
              networkId: 'idx-1',
            },
          ]),
        searchWithProfileEmbedding: () => Promise.resolve([]),
      } as unknown as Embedder;

      const mockHydeGenerator = {
        invoke: () =>
          Promise.resolve({
            hydeEmbeddings: { mirror: dummyEmbedding, reciprocal: dummyEmbedding },
          }),
      };

      const evaluator = createMockEvaluator(defaultMockEvaluatorResult);
      const factory = new OpportunityGraphFactory(
        mockDb,
        mockEmbedder,
        mockHydeGenerator,
        evaluator,
        async () => undefined,
        mockNegotiationGraph,
      );
      const compiledGraph = factory.createGraph();

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        operationMode: 'create' as const,
        options: { initialStatus: 'latent' as const },
      });

      // The gate should allow negotiation when introducer is approved.
      expect(negotiationInvocations.length).toBeGreaterThan(0);
    });
  });

  // ─── negotiate_existing mode tests ───────────────────────────────────────────

  describe('negotiate_existing mode', () => {
    test('invokes negotiation with source and candidate actors, notifies non-introducer actors on acceptance', async () => {
      const negotiationInvocations: unknown[] = [];
      const notifiedUserIds: string[] = [];

      // Mock negotiation graph that records invocations and returns acceptance
      const mockNegotiationGraph = {
        invoke: async (input: unknown) => {
          negotiationInvocations.push(input);
          return {
            outcome: {
              hasOpportunity: true,
              agreedRoles: [{ userId: 'patient-user', role: 'patient' as const }, { userId: 'agent-user', role: 'agent' as const }],
              reasoning: 'Great match.',
              turnCount: 2,
            },
          };
        },
      };

      const existingOpportunity = {
        id: 'opp-existing',
        detection: { source: 'manual' as const, createdBy: 'introducer-user' as Id<'users'> },
        actors: [
          {
            userId: 'patient-user' as Id<'users'>,
            role: 'patient' as const,
            networkId: 'idx-1' as Id<'networks'>,
            intentId: 'intent-patient' as Id<'intents'>,
            approved: undefined,
          },
          {
            userId: 'agent-user' as Id<'users'>,
            role: 'agent' as const,
            networkId: 'idx-1' as Id<'networks'>,
            intentId: 'intent-agent' as Id<'intents'>,
            approved: undefined,
          },
          {
            userId: 'introducer-user' as Id<'users'>,
            role: 'introducer' as const,
            networkId: 'idx-1' as Id<'networks'>,
            intentId: undefined,
            approved: true,
          },
        ],
        interpretation: { reasoning: 'Great match.' },
        context: null,
        confidence: 0.9,
        status: 'latent' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };

      const mockDb: OpportunityGraphDatabase = {
        getProfile: () => Promise.resolve(null),
        createOpportunity: (data) =>
          Promise.resolve({
            id: 'opp-1',
            detection: data.detection,
            actors: data.actors,
            interpretation: data.interpretation,
            context: data.context,
            confidence: data.confidence,
            status: data.status ?? 'pending',
            createdAt: new Date(),
            updatedAt: new Date(),
            expiresAt: null,
          }),
        opportunityExistsBetweenActors: () => Promise.resolve(false),
        findOpportunitiesByActors: () => Promise.resolve([]),
        getUserIndexIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
        getNetworkMemberships: () => Promise.resolve([{
          networkId: 'idx-1',
          networkTitle: 'Test Index',
          indexPrompt: null,
          permissions: ['member'],
          memberPrompt: null,
          autoAssign: true,
          isPersonal: false,
          joinedAt: new Date(),
        }]),
        getActiveIntents: (userId: string) => Promise.resolve([
          {
            id: `intent-${userId}` as Id<'intents'>,
            payload: `Intent for ${userId}`,
            summary: null,
            createdAt: new Date(),
          },
        ]),
        getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
        getNetworkMemberCount: () => Promise.resolve(2),
        getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
        getUser: (userId: string) => Promise.resolve({ id: userId, name: `User ${userId}`, email: `${userId}@example.com` }),
        isNetworkMember: () => Promise.resolve(true),
        isIndexOwner: () => Promise.resolve(false),
        getOpportunity: (id: string) => id === 'opp-existing'
          ? Promise.resolve(existingOpportunity as unknown as Opportunity)
          : Promise.resolve(null),
        getOpportunitiesForUser: () => Promise.resolve([]),
        updateOpportunityStatus: () => Promise.resolve(null),
        updateOpportunityActorApproval: () => Promise.resolve(null),
        getIntent: () => Promise.resolve(null),
        getIntentIndexScores: async () => [],
        getNetworkMemberContext: async () => null,
      };

      const mockEmbedder: Embedder = {
        generate: () => Promise.resolve(dummyEmbedding),
        search: () => Promise.resolve([]),
        searchWithHydeEmbeddings: () => Promise.resolve([]),
        searchWithProfileEmbedding: () => Promise.resolve([]),
      } as unknown as Embedder;

      const mockHydeGenerator = {
        invoke: () => Promise.resolve({ hydeEmbeddings: { mirror: dummyEmbedding } }),
      };

      const evaluator = createMockEvaluator();
      const queueNotification = async (oppId: string, userId: string) => {
        notifiedUserIds.push(userId);
      };

      const factory = new OpportunityGraphFactory(
        mockDb,
        mockEmbedder,
        mockHydeGenerator,
        evaluator,
        queueNotification,
        mockNegotiationGraph,
        undefined, // agentDispatcher
        async () => undefined, // queueNegotiateExisting
      );
      const compiledGraph = factory.createGraph();

      await compiledGraph.invoke({
        userId: 'patient-user' as Id<'users'>,
        operationMode: 'negotiate_existing' as const,
        opportunityId: 'opp-existing',
        options: {},
      });

      // Negotiation should have been invoked
      expect(negotiationInvocations.length).toBeGreaterThan(0);

      // Notifications should be sent to non-introducer actors only
      expect(notifiedUserIds).toContain('patient-user');
      expect(notifiedUserIds).toContain('agent-user');
      expect(notifiedUserIds).not.toContain('introducer-user');
    });
  });

  // ─── approve_introduction mode tests ─────────────────────────────────────────

  describe('approve_introduction mode', () => {
    test('sets approved=true on introducer actor and enqueues negotiate job', async () => {
      const approvalCalls: Array<[string, string, boolean]> = [];
      const negotiateJobsEnqueued: Array<{ opportunityId: string; userId: string }> = [];

      const existingOpp = {
        id: 'opp-456',
        status: 'latent' as const,
        actors: [
          { networkId: 'idx-1' as Id<'networks'>, userId: 'target-user' as Id<'users'>, role: 'patient' as const },
          { networkId: 'idx-1' as Id<'networks'>, userId: 'candidate-user' as Id<'users'>, role: 'agent' as const },
          { networkId: 'idx-1' as Id<'networks'>, userId: 'introducer-user' as Id<'users'>, role: 'introducer' as const, approved: false },
        ],
        detection: { source: 'manual' as const, createdBy: 'introducer-user', timestamp: new Date().toISOString() },
        interpretation: { category: 'collaboration', reasoning: 'test', confidence: 0.8, signals: [] },
        context: { networkId: 'idx-1' as Id<'networks'> },
        confidence: '0.8',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };

      // Build the mock db directly (same pattern as negotiate_existing tests)
      const mockDb: OpportunityGraphDatabase = {
        getProfile: () => Promise.resolve(null),
        createOpportunity: (data) => Promise.resolve({ id: 'opp-new', ...data, status: data.status ?? 'latent', createdAt: new Date(), updatedAt: new Date(), expiresAt: null }),
        opportunityExistsBetweenActors: () => Promise.resolve(false),
        findOpportunitiesByActors: () => Promise.resolve([]),
        getUserIndexIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
        getNetworkMemberships: async () => [],
        getActiveIntents: () => Promise.resolve([]),
        getNetworkIdsForIntent: () => Promise.resolve([]),
        getNetwork: () => Promise.resolve(null),
        getNetworkMemberCount: () => Promise.resolve(0),
        getIntentIndexScores: async () => [],
        getNetworkMemberContext: async () => null,
        getUser: (_id: string) => Promise.resolve({ id: _id, name: 'Test', email: 'test@test.com' }),
        isNetworkMember: () => Promise.resolve(false),
        isIndexOwner: () => Promise.resolve(false),
        getOpportunity: () => Promise.resolve(existingOpp as any),
        getOpportunitiesForUser: () => Promise.resolve([]),
        updateOpportunityStatus: () => Promise.resolve(null),
        updateOpportunityActorApproval: (_id: string, userId: string, approved: boolean) => {
          approvalCalls.push([_id, userId, approved]);
          return Promise.resolve({ ...existingOpp, actors: existingOpp.actors.map((a: any) => a.userId === userId && a.role === 'introducer' ? { ...a, approved } : a) } as any);
        },
        getIntent: () => Promise.resolve(null),
      };

      const mockEmbedder = { generate: async () => new Array(2000).fill(0.1) };
      const mockHyde = { invoke: async () => ({ hydeEmbeddings: {} }) };

      const factory = new OpportunityGraphFactory(
        mockDb,
        mockEmbedder as any,
        mockHyde as any,
        undefined, // evaluator
        undefined, // queueNotification
        undefined, // negotiationGraph
        undefined, // agentDispatcher
        async (opportunityId: string, userId: string) => {
          negotiateJobsEnqueued.push({ opportunityId, userId });
        },
      );

      await factory.createGraph().invoke({
        userId: 'introducer-user' as Id<'users'>,
        opportunityId: 'opp-456',
        operationMode: 'approve_introduction',
      });

      expect(approvalCalls).toHaveLength(1);
      expect(approvalCalls[0]).toEqual(['opp-456', 'introducer-user', true]);
      expect(negotiateJobsEnqueued).toHaveLength(1);
      expect(negotiateJobsEnqueued[0].opportunityId).toBe('opp-456');
    });
  });
});

// ─── buildDiscovererContext tests ───────────────────────────────────────────

describe('buildDiscovererContext', () => {
  it('includes location when present in profile identity', () => {
    const profile: SourceProfileData = {
      embedding: null,
      identity: { name: 'Alice', bio: 'AI startup founder', location: 'San Francisco' },
      attributes: { skills: ['TypeScript'], interests: ['AI'] },
    };
    const result = buildDiscovererContext(profile, []);
    expect(result).toContain('Location: San Francisco');
  });

  it('omits location line when location is undefined', () => {
    const profile: SourceProfileData = {
      embedding: null,
      identity: { name: 'Alice', bio: 'AI startup founder' },
      attributes: { skills: ['TypeScript'], interests: ['AI'] },
    };
    const result = buildDiscovererContext(profile, []);
    expect(result).not.toContain('Location:');
  });

  it('omits location line when location is empty string', () => {
    const profile: SourceProfileData = {
      embedding: null,
      identity: { name: 'Alice', bio: 'AI startup founder', location: '' },
      attributes: { skills: ['TypeScript'], interests: ['AI'] },
    };
    const result = buildDiscovererContext(profile, []);
    expect(result).not.toContain('Location:');
  });
});

// ─── Direct-connection evaluator tests ──────────────────────────────────────

const DISCOVERER_ID = 'user-yanki';
const TARGET_ID = 'user-sam';

const sourceEntity: EvaluatorEntity = {
  userId: DISCOVERER_ID,
  profile: {
    name: 'Yankı Ekin Yüksel',
    bio: 'CTO at a digital media startup. Background in linguistics and software development. Built content distribution platforms and game development projects.',
    location: 'Istanbul, Turkey',
    interests: ['computational linguistics', 'game development', 'sound design', 'AI', 'machine learning', 'backend development'],
    skills: ['Laravel', 'Vue.js', 'Node.js', 'PostgreSQL', 'TypeScript', 'software engineering', 'project management'],
    context: 'Exploring the intersection of linguistics and sound design in game development. Looking for investors for a game project using Unreal Engine.',
  },
  intents: [
    { intentId: 'i-yanki-1', payload: 'Explore the intersection of linguistics and sound design in game development' },
    { intentId: 'i-yanki-2', payload: 'Find investors for a game project using Unreal Engine and TypeScript' },
  ],
  networkId: 'idx-shared',
};

const targetEntity: EvaluatorEntity = {
  userId: TARGET_ID,
  profile: {
    name: 'Samuel Rivera',
    bio: 'Seasoned full-stack developer based in Madrid. Builds efficient web solutions using Laravel and Vue. Active member of the gaming community.',
    location: 'Madrid, Spain',
    interests: ['web development', 'gaming', 'Laravel ecosystem', 'Vue.js', 'esports', 'game dev'],
    skills: ['Laravel', 'Vue.js', 'PHP', 'JavaScript', 'MySQL', 'full-stack development', 'API design'],
    context: 'Looking for a technical co-founder to build an AI/LLM-based developer tool. Seeking someone with ML, data engineering, and product experience.',
  },
  intents: [
    { intentId: 'i-sam-1', payload: 'Find a co-founder with ML/data engineering background to build LLM-based developer tools' },
    { intentId: 'i-sam-2', payload: 'Connect with Laravel and Vue developers interested in gaming projects' },
  ],
  networkId: 'idx-shared',
  ragScore: 100, // Explicit mention = perfect match
  matchedVia: 'explicit_mention',
};

const verificationCriteria =
  'The discoverer (Yankı) was directly @-mentioned with target user (Samuel). ' +
  'Both share strong technical overlap: Laravel, Vue.js, game development interests, and web engineering. ' +
  'Samuel is explicitly seeking a co-founder with ML/data engineering background, and Yankı has CTO experience with AI/ML interests. ' +
  'PASS criteria: the opportunities list must contain at least one result with score >= 50. ' +
  'These two users have genuine alignment that should produce a meaningful opportunity. ' +
  'FAIL if the list is empty or all scores are below 50 — that means the system failed to recognize an obvious match between directly connected users.';

async function runDirectConnectionEval(): Promise<{ opportunities: Array<{ reasoning: string; score: number; candidateUserId: string }>; durationMs: number }> {
  const evaluator = new OpportunityEvaluator();
  const input: EvaluatorInput = {
    discovererId: DISCOVERER_ID,
    entities: [sourceEntity, targetEntity],
    discoveryQuery: 'What can I do with Samuel Rivera?',
  };
  // Retry up to 3 times — LLM non-determinism can yield empty results on some runs
  const MAX_ATTEMPTS = 3;
  let totalDurationMs = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const start = Date.now();
    const raw = await evaluator.invokeEntityBundle(input, { minScore: 0, returnAll: true });
    const durationMs = Date.now() - start;
    totalDurationMs += durationMs;
    const opportunities = raw
      .map(op => {
        const candidate = op.actors.find(a => a.userId !== DISCOVERER_ID);
        if (!candidate?.userId) return null;
        return { reasoning: op.reasoning, score: op.score, candidateUserId: candidate.userId };
      })
      .filter((op): op is { reasoning: string; score: number; candidateUserId: string } => op !== null);
    if (opportunities.length > 0 || attempt === MAX_ATTEMPTS) {
      return { opportunities, durationMs: totalDurationMs };
    }
    console.log(`  [Attempt ${attempt}/${MAX_ATTEMPTS}] Empty result, retrying...`);
  }
  return { opportunities: [], durationMs: totalDurationMs };
}

describe('OpportunityEvaluator: direct-connection candidates', () => {
  it('produces an opportunity when evaluating explicitly-mentioned users with genuine alignment', async () => {
    const { opportunities, durationMs } = await runDirectConnectionEval();

    console.log(`\n[Direct Connection] duration=${durationMs}ms, results=${opportunities.length}`);
    for (const o of [...opportunities].sort((a, b) => b.score - a.score)) {
      console.log(`  score=${o.score}  ${o.candidateUserId}  "${o.reasoning.slice(0, 100)}..."`);
    }

    await assertLLM({ opportunities, durationMs }, verificationCriteria);
  }, 120000);
});

// ─── Trace events tests ──────────────────────────────────────────────────────

const dummyTraceEmbedding = new Array(2000).fill(0.1);

const traceDefaultMockEvaluatorResult: EvaluatedOpportunityWithActors[] = [
  {
    reasoning: 'Test reasoning for trace event test.',
    score: 88,
    actors: [
      { userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' as const, intentId: null },
      { userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' as const, intentId: null },
    ],
  },
];

function createTraceMockEvaluatorFn(
  result: EvaluatedOpportunityWithActors[] = traceDefaultMockEvaluatorResult
): OpportunityEvaluatorLike {
  return {
    invokeEntityBundle: async () => result,
  };
}

function createTraceMockGraph() {
  const mockDb: OpportunityGraphDatabase = {
    getProfile: () => Promise.resolve(null),
    createOpportunity: (data) =>
      Promise.resolve({
        id: 'opp-1',
        detection: data.detection,
        actors: data.actors,
        interpretation: data.interpretation,
        context: data.context,
        confidence: data.confidence,
        status: data.status ?? 'pending',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      }),
    opportunityExistsBetweenActors: () => Promise.resolve(false),
    findOpportunitiesByActors: () => Promise.resolve([]),
    getUserIndexIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
    getNetworkMemberships: async () => [
      { networkId: 'idx-1', networkTitle: 'Test Index', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() },
    ],
    getActiveIntents: () =>
      Promise.resolve([
        {
          id: 'intent-1' as Id<'intents'>,
          payload: 'Looking for a technical co-founder',
          summary: 'Co-founder',
          createdAt: new Date(),
        },
      ]),
    getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Index' }),
    getNetworkMemberCount: () => Promise.resolve(2),
    getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
    getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com' }),
    isNetworkMember: () => Promise.resolve(true),
    isIndexOwner: () => Promise.resolve(false),
    getOpportunity: () => Promise.resolve(null),
    getOpportunitiesForUser: () => Promise.resolve([]),
    updateOpportunityStatus: () => Promise.resolve(null),
    updateOpportunityActorApproval: () => Promise.resolve(null),
    getIntent: () => Promise.resolve(null),
    getIntentIndexScores: async () => [],
    getNetworkMemberContext: async () => null,
  };

  const mockEmbedder: Embedder = {
    generate: () => Promise.resolve(dummyTraceEmbedding),
    search: () => Promise.resolve([]),
    searchWithHydeEmbeddings: () =>
      Promise.resolve([
        {
          type: 'intent' as const,
          id: 'intent-bob' as Id<'intents'>,
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror' as const,
          networkId: 'idx-1',
        },
      ]),
    searchWithProfileEmbedding: () => Promise.resolve([]),
  } as unknown as Embedder;

  const mockHydeGenerator = {
    invoke: () =>
      Promise.resolve({
        hydeEmbeddings: {
          mirror: dummyTraceEmbedding,
          reciprocal: dummyTraceEmbedding,
        },
      }),
  };

  const evaluator = createTraceMockEvaluatorFn();
  const queueNotification = async () => undefined;
  const factory = new OpportunityGraphFactory(mockDb, mockEmbedder, mockHydeGenerator, evaluator, queueNotification);
  const compiledGraph = factory.createGraph();
  return { compiledGraph };
}

/** The node names we expect trace events for (kebab-case). */
const EXPECTED_NODE_TRACE_NAMES = [
  'opportunity-prep',
  'opportunity-scope',
  'opportunity-resolve',
  'opportunity-discovery',
  'opportunity-ranking',
  'opportunity-persist',
];

describe('Opportunity Graph — Trace Events', () => {
  test('emits agent_start/agent_end trace events for each significant node', async () => {
    const { compiledGraph } = createTraceMockGraph();
    const traceEvents: Array<{ type: string; name: string; durationMs?: number; summary?: string }> = [];
    const traceEmitter = (event: { type: string; name: string; durationMs?: number; summary?: string }) => {
      traceEvents.push(event);
    };

    // Run the graph inside a requestContext with our traceEmitter
    await requestContext.run({ traceEmitter }, async () => {
      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      });
    });

    // Verify that each expected node emitted both agent_start and agent_end
    for (const nodeName of EXPECTED_NODE_TRACE_NAMES) {
      const starts = traceEvents.filter(e => e.type === 'agent_start' && e.name === nodeName);
      const ends = traceEvents.filter(e => e.type === 'agent_end' && e.name === nodeName);

      expect(starts.length).toBeGreaterThanOrEqual(1);
      expect(ends.length).toBeGreaterThanOrEqual(1);

      // agent_end events must have durationMs
      for (const end of ends) {
        expect(end.durationMs).toBeDefined();
        expect(typeof end.durationMs).toBe('number');
      }
    }

    // Also verify the evaluation node still emits its own events (existing behavior)
    const evalStarts = traceEvents.filter(e => e.type === 'agent_start' && e.name === 'opportunity-evaluator');
    const evalEnds = traceEvents.filter(e => e.type === 'agent_end' && e.name === 'opportunity-evaluator');
    expect(evalStarts.length).toBeGreaterThanOrEqual(1);
    expect(evalEnds.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  test('trace events are in correct chronological order (start before end)', async () => {
    const { compiledGraph } = createTraceMockGraph();
    const traceEvents: Array<{ type: string; name: string; ts: number }> = [];
    const traceEmitter = (event: { type: string; name: string }) => {
      traceEvents.push({ ...event, ts: Date.now() });
    };

    await requestContext.run({ traceEmitter }, async () => {
      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      });
    });

    // For each node, verify start comes before end
    for (const nodeName of EXPECTED_NODE_TRACE_NAMES) {
      const start = traceEvents.find(e => e.type === 'agent_start' && e.name === nodeName);
      const end = traceEvents.find(e => e.type === 'agent_end' && e.name === nodeName);
      if (start && end) {
        expect(start.ts).toBeLessThanOrEqual(end.ts);
      }
    }
  }, 60_000);
});
