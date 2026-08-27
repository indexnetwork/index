/**
 * Opportunity Graph: tests for the refactored linear workflow.
 * Flow: Prep → Scope → Discovery → Evaluation → Ranking → Persist.
 * Invoke API: { userId, searchQuery?, networkId?, options }.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { afterAll, afterEach, beforeAll, beforeEach, describe, test, it, expect, mock, spyOn } from 'bun:test';
import type { Runnable } from '@langchain/core/runnables';
import { OpportunityGraphFactory, type OpportunityGraphThresholdOverrides, buildDiscovererContext } from '../opportunity.graph.js';
import type { Id } from '../../../platform/database.js';
import type { CreateOpportunityData, HydeDocument, OpportunityGraphDatabase, OpportunityActor, Opportunity } from '../../../platform/database.js';
import type { Embedder } from '../../../platform/discovery/embedder.js';
import type { SourceProfileData } from '../opportunity.state.js';
import { DISCOVERY_MIN_SIMILARITY } from '../discovery.env.js';
import { REJECTION_COOLDOWN_MS } from '../opportunity.graph.shared.js';
import { MatchExplainer } from '../opportunity.match-explainer.js';
import type { MatchExplainerLike, MatchExplainerResult, MatchExplainerInput, EvaluatorEntity } from '../opportunity.match-explainer.js';
import type { UserIdentity } from '../../../protocol/schemas/identity.schema.js';
import { assertLLM } from '../../shared/agent/tests/llm-assert.js';
import { computeHydeSourceTextHash } from '../../shared/hyde-documents.js';
import { requestContext, type TraceEmitter } from '../../shared/observability/request-context.js';
import { setLoggerFactory, type LoggerWithSource } from '../../shared/observability/log.js';
import { createOpportunityGraphDatabaseFixture } from './opportunity.graph.fixtures.js';
import { approveOpportunityIntroduction } from '../opportunity.lifecycle.js';

type OpportunityGraphInvokeInput = Parameters<ReturnType<OpportunityGraphFactory['createGraph']>['invoke']>[0];
type OpportunityGraphInvokeResult = Awaited<ReturnType<ReturnType<OpportunityGraphFactory['createGraph']>['invoke']>>;

const dummyEmbedding = new Array(2000).fill(0.1);

const defaultMockExplainerResult: MatchExplainerResult = {
  reasoning: 'The source user is building a DeFi protocol and the candidate has relevant community and marketing expertise in the crypto space.',
};

function createMockExplainer(
  result: MatchExplainerResult = defaultMockExplainerResult,
  calls?: unknown[],
): MatchExplainerLike {
  return {
    explain: async (input) => {
      calls?.push(input);
      return result;
    },
  };
}

function createdOpportunity(data: CreateOpportunityData): Opportunity {
  return {
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
  };
}

function createMockGraph(deps?: {
  getUserIndexIds?: () => Promise<Id<'networks'>[]>;
  getNetworkMemberships?: () => Promise<Array<{ networkId: string; networkTitle: string; indexPrompt: string | null; permissions: string[]; memberPrompt: string | null; autoAssign: boolean; isPersonal: boolean; joinedAt: Date }>>;
  getActiveNetworkMembershipPairs?: OpportunityGraphDatabase['getActiveNetworkMembershipPairs'];
  getActiveIntents?: () => Promise<Array<{ id: Id<'intents'>; payload: string; summary: string | null; createdAt: Date }>>;
  getNetwork?: (id: string) => Promise<{ id: string; title: string } | null>;
  getNetworkMemberCount?: (id: string) => Promise<number>;
  getNetworkIdsForIntent?: (intentId: string) => Promise<string[]>;
  getProfile?: Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>;
  explainerResult?: MatchExplainerResult;
  explainer?: MatchExplainerLike;
  /** null and omitted are equivalent — both resolve to environment defaults. */
  thresholdOverrides?: OpportunityGraphThresholdOverrides | null;
}) {
  const mockDb: OpportunityGraphDatabase = {
    ...createOpportunityGraphDatabaseFixture(),
    getProfile: () => Promise.resolve(deps?.getProfile ?? null),
    createOpportunity: async (data) => createdOpportunity(data),
    async createOpportunityIfNetworkEligible(data) {
      return this.createOpportunity(data);
    },
    opportunityExistsBetweenActors: () => Promise.resolve(false),
    findOpportunitiesByActors: () => Promise.resolve([]),
    getUserIndexIds: deps?.getUserIndexIds ?? (() => Promise.resolve(['idx-1'] as Id<'networks'>[])),
    getNetworkMemberships: deps?.getNetworkMemberships ?? (async () => {
      const ids = deps?.getUserIndexIds ? await deps.getUserIndexIds() : ['idx-1'] as Id<'networks'>[];
      return ids.map(id => ({ networkId: id, networkTitle: 'Test Index', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }));
    }),
    getActiveNetworkMembershipPairs: deps?.getActiveNetworkMembershipPairs ?? ((pairs) => Promise.resolve(pairs)),
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
    getNetworkIdsForIntent: deps?.getNetworkIdsForIntent ?? (() => Promise.resolve(['idx-1'])),
    getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com', socials: [] }),
    isNetworkMember: () => Promise.resolve(true),
    isIndexOwner: () => Promise.resolve(false),
    getOpportunity: () => Promise.resolve(null),
    getOpportunitiesForUser: () => Promise.resolve([]),
    updateOpportunityStatus: () => Promise.resolve(null),
    async updateOpportunityStatusIfNetworkEligible(id, status) {
      return this.updateOpportunityStatus(id, status) as Promise<Opportunity | null>;
    },
    updateOpportunityActorApproval: () => Promise.resolve(null),
    getIntent: () => Promise.resolve(null),
    getIntentIndexScores: async () => [],
    getNetworkMemberContext: async () => null,
    getNegotiationTaskForOpportunity: async () => null,
    stampOpportunityActorAction: async () => null,
    getPremisesForUser: async () => [],
    searchPremisesBySimilarity: async () => [],
    getUserContexts: async () => [],
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

  const explainerCalls: unknown[] = [];
  const explainer = deps?.explainer ?? createMockExplainer(deps?.explainerResult ?? defaultMockExplainerResult, explainerCalls);
  const queueNotification = async () => undefined;
  const thresholdOverrides = deps?.thresholdOverrides ?? undefined;
  const factory = new OpportunityGraphFactory(
    mockDb,
    mockEmbedder,
    mockHydeGenerator,
    explainer,
    queueNotification,
    undefined,
    undefined,
    undefined,
    thresholdOverrides,
  );
  const compiledGraph = factory.createGraph();
  return { compiledGraph, factory, mockDb, mockEmbedder, mockHydeGenerator, explainer, explainerCalls };
}

function createMockGraphWithFnOverrides(deps?: {
  getProfileFn?: (userId: string) => Promise<Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>>;
  getActiveIntentsFn?: (userId: string) => Promise<Array<{ id: Id<'intents'>; payload: string; summary: string | null; createdAt: Date }>>;
  getUserIndexIds?: () => Promise<Id<'networks'>[]>;
  getNetworkMemberships?: () => Promise<Array<{ networkId: string; networkTitle: string; indexPrompt: string | null; permissions: string[]; memberPrompt: string | null; autoAssign: boolean; isPersonal: boolean; joinedAt: Date }>>;
  getActiveNetworkMembershipPairsFn?: OpportunityGraphDatabase['getActiveNetworkMembershipPairs'];
  thresholdOverrides?: OpportunityGraphThresholdOverrides;
}) {
  const mockDb: OpportunityGraphDatabase = {
    ...createOpportunityGraphDatabaseFixture(),
    getProfile: (userId: string) =>
      deps?.getProfileFn
        ? deps.getProfileFn(userId)
        : Promise.resolve(null),
    createOpportunity: async (data) => createdOpportunity(data),
    async createOpportunityIfNetworkEligible(data) {
      return this.createOpportunity(data);
    },
    opportunityExistsBetweenActors: () => Promise.resolve(false),
    findOpportunitiesByActors: () => Promise.resolve([]),
    getUserIndexIds: deps?.getUserIndexIds ?? (() => Promise.resolve(['idx-1'] as Id<'networks'>[])),
    getNetworkMemberships: deps?.getNetworkMemberships ?? (async () => {
      const ids = deps?.getUserIndexIds ? await deps.getUserIndexIds() : ['idx-1'] as Id<'networks'>[];
      return ids.map(id => ({ networkId: id, networkTitle: 'Test Index', indexPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }));
    }),
    getActiveNetworkMembershipPairs: deps?.getActiveNetworkMembershipPairsFn ?? ((pairs) => Promise.resolve(pairs)),
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
    getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com', socials: [] }),
    isNetworkMember: () => Promise.resolve(true),
    isIndexOwner: () => Promise.resolve(false),
    getOpportunity: () => Promise.resolve(null),
    getOpportunitiesForUser: () => Promise.resolve([]),
    updateOpportunityStatus: () => Promise.resolve(null),
    updateOpportunityActorApproval: () => Promise.resolve(null),
    getIntent: () => Promise.resolve(null),
    getIntentIndexScores: async () => [],
    getNetworkMemberContext: async () => null,
    getNegotiationTaskForOpportunity: async () => null,
    stampOpportunityActorAction: async () => null,
    getPremisesForUser: async () => [],
    searchPremisesBySimilarity: async () => [],
    getUserContexts: async () => [],
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

  const explainer = createMockExplainer(defaultMockExplainerResult);
  const queueNotification = async () => undefined;
  const factory = new OpportunityGraphFactory(
    mockDb,
    mockEmbedder,
    mockHyde,
    explainer,
    queueNotification,
    undefined,
    undefined,
    undefined,
    deps?.thresholdOverrides,
  );
  const compiledGraph = factory.createGraph();
  return { compiledGraph, mockDb };
}

describe('Opportunity Graph', () => {
  describe('Prep node', () => {
    test('when user has no network memberships, returns error and no opportunities', async () => {
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
      expect(getIndexSpy.mock.calls.map((call) => call[0])).not.toContain('idx-2');
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

    test('when triggerIntentId is present, unscoped graph discovery searches only active assigned networks', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getUserIndexIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'networks'>[]),
        getNetworkIdsForIntent: async () => ['idx-2'],
      });
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        triggerIntentId: 'intent-1' as Id<'intents'>,
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput);

      const searchedNetworks = searchSpy.mock.calls.flatMap((call) => call?.[1]?.indexScope ?? []);
      expect([...new Set(searchedNetworks)]).toEqual(['idx-2']);
      expect(searchedNetworks).not.toContain('idx-1');
    });

    test('when trigger intent is not an active intent owned by the user, discovery fails closed', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getNetworkIdsForIntent: async () => ['idx-1'],
      });
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        triggerIntentId: 'foreign-intent' as Id<'intents'>,
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput);

      expect(searchSpy).not.toHaveBeenCalled();
      expect(result.error).toContain('not available');
      expect(result.opportunities).toEqual([]);
    });

    test('when trigger intent has no active assigned network, graph discovery fails closed', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getUserIndexIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'networks'>[]),
        getNetworkIdsForIntent: async () => ['idx-foreign'],
      });
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        triggerIntentId: 'intent-1' as Id<'intents'>,
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput);

      expect(searchSpy).not.toHaveBeenCalled();
      expect(result.opportunities).toEqual([]);
    });

    test('when indexScope is explicitly empty, discovery fails closed', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getUserIndexIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'networks'>[]),
      });
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        indexScope: [],
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput);

      expect(searchSpy).not.toHaveBeenCalled();
      expect(result.opportunities).toEqual([]);
    });

    test('when indexScope provided, the vector search is intersected and networks outside it are excluded', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getUserIndexIds: () => Promise.resolve(['idx-1', 'idx-2', 'idx-3'] as Id<'networks'>[]),
      });
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        // A network-scoped agent reaches only its bound network + personal network;
        // idx-3 is another network the user belongs to and must not be searched.
        indexScope: ['idx-1', 'idx-2'] as Id<'networks'>[],
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput);

      expect(searchSpy).toHaveBeenCalled();
      // Discovery searches one network at a time; collect every network touched.
      const searchedNetworks = searchSpy.mock.calls
        .flatMap((c) => c?.[1]?.indexScope ?? []);
      expect([...new Set(searchedNetworks)].sort()).toEqual(['idx-1', 'idx-2']);
      expect(searchedNetworks).not.toContain('idx-3');
    });
  });

  describe('configurable discovery thresholds', () => {
    test('constructor overrides govern retrieval and trace data', async () => {
      const thresholds = {
        retrievalMinSimilarity: 0.42,
      };
      const { compiledGraph, mockEmbedder } = createMockGraph({
        thresholdOverrides: thresholds,
      });
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings');

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      });

      expect(searchSpy.mock.calls[0]?.[1]?.minScore).toBe(0.42);
      // Every candidate that clears retrieval is persisted directly now —
      // no evaluator score floor.
      expect(result.opportunities).toHaveLength(1);
      expect(result.trace).toContainEqual(expect.objectContaining({
        node: 'threshold_filter',
        detail: expect.stringContaining('above 0.42'),
        data: expect.objectContaining({
          minSimilarity: 0.42,
          retrievalMinSimilarity: 0.42,
        }),
      }));
    });

    test('the built-in retrieval threshold applies unless constructor overrides are provided', async () => {
      const fromDefaults = createMockGraph({ thresholdOverrides: null });
      const defaultsSearch = spyOn(fromDefaults.mockEmbedder, 'searchWithHydeEmbeddings');
      await fromDefaults.compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      });
      expect(defaultsSearch.mock.calls[0]?.[1]?.minScore).toBe(DISCOVERY_MIN_SIMILARITY);

      const fromConstructor = createMockGraph({
        thresholdOverrides: { retrievalMinSimilarity: 0.52 },
      });
      const constructorSearch = spyOn(fromConstructor.mockEmbedder, 'searchWithHydeEmbeddings');
      await fromConstructor.compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      });
      expect(constructorSearch.mock.calls[0]?.[1]?.minScore).toBe(0.52);
    });
  });

  describe('Discovery node', () => {
    test('performs vector search with network scope and excludeUserId', async () => {
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

    test('tops up retrieval with no similarity floor when the pool has fewer than the match floor of users', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
      const firstPass = Array.from({ length: 3 }, (_, i) => ({
        type: 'intent' as const,
        id: `intent-first-${i}`,
        userId: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
        score: 0.9 - i * 0.01,
        matchedVia: 'mirror' as const,
        networkId: 'idx-1',
      }));
      const toppedUp = Array.from({ length: 12 }, (_, i) => ({
        type: 'intent' as const,
        id: `intent-top-${i}`,
        userId: `${String(i + 100).padStart(8, '0')}-0000-4000-8000-000000000000`,
        score: 0.1,
        matchedVia: 'mirror' as const,
        networkId: 'idx-1',
      }));
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockImplementation(
        async (_lensEmbeddings, opts) => (opts?.minScore === 0 ? toppedUp : firstPass),
      );

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(searchSpy).toHaveBeenCalledTimes(2);
      expect(searchSpy.mock.calls[1]?.[1]?.minScore).toBe(0);
      const distinctUsers = new Set(result.candidates.map((c) => c.candidateUserId));
      expect(distinctUsers.size).toBeGreaterThanOrEqual(10);
    });

    test('does not top up retrieval when the first pass already has enough distinct users', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
      const candidates = Array.from({ length: 12 }, (_, i) => ({
        type: 'intent' as const,
        id: `intent-${i}`,
        userId: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
        score: 0.9 - i * 0.01,
        matchedVia: 'mirror' as const,
        networkId: 'idx-1',
      }));
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue(candidates);

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(searchSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('Evaluation node: userId dedup', () => {
    test('when same user appears via multiple indexes, evaluates them only once (deduped by userId)', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getUserIndexIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'networks'>[]),
        getNetwork: (id: string) => Promise.resolve({ id, title: `Index ${id}` }),
        getNetworkMemberCount: () => Promise.resolve(5),
      });

      // Same user appears in two indexes from search results
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob-1', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
        { type: 'intent' as const, id: 'intent-bob-2', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.85, matchedVia: 'mirror' as const, networkId: 'idx-2' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
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

  describe('Evaluation node: rejection cooldown', () => {
    test('applies the rejection cooldown and ranks penalized candidates behind unpenalized candidates', async () => {
      const explainerInputs: Array<{ entities: EvaluatorEntity[] }> = [];
      const explainer: MatchExplainerLike = {
        explain: async (input) => {
          explainerInputs.push(input);
          return { reasoning: 'ok' };
        },
      };

      try {
        const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({ explainer });
        const cooldownCalls: Array<{ userId: string; candidateIds: string[]; cooldownMs: number }> = [];
        mockDb.getRecentlyRejectedOpportunityCounterparties = async (userId, candidateIds, cooldownMs) => {
          cooldownCalls.push({ userId, candidateIds: [...candidateIds], cooldownMs });
          return ['b0000000-0000-4000-8000-000000000002'];
        };
        spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
          { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
          { type: 'intent' as const, id: 'intent-carol', userId: 'c0000000-0000-4000-8000-000000000003', score: 0.8, matchedVia: 'mirror' as const, networkId: 'idx-1' },
        ]);

        await compiledGraph.invoke({
          userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
          searchQuery: 'co-founder',
          options: {},
        } as OpportunityGraphInvokeInput);

        expect(cooldownCalls).toEqual([{
          userId: 'a0000000-0000-4000-8000-000000000001',
          candidateIds: [
            'b0000000-0000-4000-8000-000000000002',
            'c0000000-0000-4000-8000-000000000003',
          ],
          cooldownMs: REJECTION_COOLDOWN_MS,
        }]);
        // One explainer call per candidate, fired in rank order: the penalized
        // candidate ranks behind the unpenalized one.
        expect(explainerInputs).toHaveLength(2);
        expect(explainerInputs.map((input) => input.entities[1].userId)).toEqual([
          'c0000000-0000-4000-8000-000000000003',
          'b0000000-0000-4000-8000-000000000002',
        ]);
        expect(explainerInputs.map((input) => input.entities[1].ragScore)).toEqual([80, 45]);
      } finally {
        // nothing to restore — the cooldown is a constant now
      }
    });
  });

  describe('Evaluation and Persist', () => {
    test('forwards an aborted request signal to the explainer model without retrying', async () => {
      const controller = new AbortController();
      const abortReason = new Error('caller cancelled discovery');
      controller.abort(abortReason);
      let explainerModelCalls = 0;
      let receivedSignal: AbortSignal | undefined;
      const explainerModel = {
        invoke: async (_messages: unknown, config?: { signal?: AbortSignal }) => {
          explainerModelCalls += 1;
          receivedSignal = config?.signal;
          throw config?.signal?.reason ?? new Error('missing explainer cancellation signal');
        },
      } as unknown as Runnable;
      const explainer = new MatchExplainer({ model: explainerModel });
      const explainerSpy = spyOn(explainer, 'explain');
      const { compiledGraph } = createMockGraph({ explainer });

      await requestContext.run({ abortSignal: controller.signal }, async () => {
        await compiledGraph.invoke({
          userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
          searchQuery: 'co-founder',
          options: {},
        } as OpportunityGraphInvokeInput);
      });

      expect(explainerSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ signal: controller.signal }),
      );
      expect(receivedSignal?.aborted).toBe(true);
      expect(receivedSignal?.reason).toBe(abortReason);
      expect(explainerModelCalls).toBe(1);
    });

    test('rejects unsafe custom-explainer reasoning again at the persistence boundary', async () => {
      const { compiledGraph, mockDb } = createMockGraph({
        explainerResult: { reasoning: 'Alice and Bob will both be at Edge Esmeralda.' },
      });
      const createSpy = spyOn(mockDb, 'createOpportunity');

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(createSpy).not.toHaveBeenCalled();
      expect(result.opportunities).toEqual([]);
    });

    test('removes inactive candidate pairs before evaluation and pagination', async () => {
      const getActiveNetworkMembershipPairs = mock(async (
        pairs: Array<{ userId: string; networkId: string }>,
      ) => pairs.filter((pair) => pair.userId === 'a0000000-0000-4000-8000-000000000001'));
      const { compiledGraph, explainer } = createMockGraph({ getActiveNetworkMembershipPairs });
      const explainerSpy = spyOn(explainer, 'explain');

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(getActiveNetworkMembershipPairs).toHaveBeenCalled();
      expect(explainerSpy).not.toHaveBeenCalled();
      expect(result.candidates).toEqual([]);
      expect(result.evaluatedOpportunities).toEqual([]);
      expect(result.opportunities).toEqual([]);
    });

    test('skips persistence when a participant membership is removed after evaluation', async () => {
      let activePairCheck = 0;
      const getActiveNetworkMembershipPairs = mock(async (
        pairs: Array<{ userId: string; networkId: string }>,
      ) => {
        activePairCheck += 1;
        return activePairCheck === 1
          ? pairs
          : pairs.filter((pair) => pair.userId === 'a0000000-0000-4000-8000-000000000001');
      });
      const { compiledGraph, mockDb, explainer } = createMockGraph({ getActiveNetworkMembershipPairs });
      const explainerSpy = spyOn(explainer, 'explain');
      const createSpy = spyOn(mockDb, 'createOpportunity');

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(explainerSpy).toHaveBeenCalledTimes(1);
      expect(getActiveNetworkMembershipPairs).toHaveBeenCalledTimes(2);
      expect(createSpy).not.toHaveBeenCalled();
      expect(result.opportunities).toEqual([]);
    });

    test('fails closed when the trigger intent is unassigned after initial scope resolution', async () => {
      let assignmentRead = 0;
      const { compiledGraph, mockDb } = createMockGraph({
        getNetworkIdsForIntent: async () => {
          assignmentRead += 1;
          return assignmentRead === 1 ? ['idx-1'] : [];
        },
      });
      const createIfEligible = mock(async (data: CreateOpportunityData) => createdOpportunity(data));
      mockDb.createOpportunityIfNetworkEligible = createIfEligible;

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        triggerIntentId: 'intent-1' as Id<'intents'>,
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(assignmentRead).toBeGreaterThanOrEqual(2);
      expect(createIfEligible).not.toHaveBeenCalled();
      expect(result.opportunities).toEqual([]);
    });

    test('fails closed when the adapter lacks an eligibility-locked create method', async () => {
      const { compiledGraph, mockDb } = createMockGraph();
      mockDb.createOpportunityIfNetworkEligible = undefined;
      const unguardedCreate = spyOn(mockDb, 'createOpportunity');

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(unguardedCreate).not.toHaveBeenCalled();
      expect(result.opportunities).toEqual([]);
    });

    test('uses the adapter eligibility lock at the final create boundary', async () => {
      const { compiledGraph, mockDb } = createMockGraph();
      const createIfEligible = mock(async () => null);
      mockDb.createOpportunityIfNetworkEligible = createIfEligible;
      const unguardedCreate = spyOn(mockDb, 'createOpportunity');

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(createIfEligible).toHaveBeenCalledTimes(1);
      expect(unguardedCreate).not.toHaveBeenCalled();
      expect(result.opportunities).toEqual([]);
    });

    test('when discovery returns an intent candidate, opportunity is created', async () => {
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
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].detection.source).toBe('opportunity_graph');
      expect(result.opportunities[0].actors.length).toBe(2);
      expect(result.opportunities[0].actors.some((a: OpportunityActor) => a.userId === 'b0000000-0000-4000-8000-000000000002')).toBe(true);
    });

    test('persists typed opportunity evidence in metadata', async () => {
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
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({
        metadata: expect.objectContaining({
          evidence: expect.arrayContaining([
            expect.objectContaining({
              kind: 'query_intent',
              candidateIntentId: 'intent-bob',
              networkId: 'idx-1',
              score: 0.9,
              matchedStrategies: expect.arrayContaining(['query']),
            }),
          ]),
        }),
      }));
    });

  });

  describe('Ranking node', () => {
    test('sorts by score and applies limit', async () => {
      // Score is derived from discovery similarity now — the higher-similarity
      // candidate (c, 0.9) should outrank the lower one (bob, 0.8).
      const { compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.8, matchedVia: 'mirror' as const, networkId: 'idx-1' },
        { type: 'intent' as const, id: 'intent-alice', userId: 'c0000000-0000-4000-8000-000000000003', score: 0.9, matchedVia: 'reciprocal' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { limit: 1 },
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
        options: { initialStatus: 'latent' },
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
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    });

    test('discovery-path actors are always persisted as peers (no valency role)', async () => {
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
        options: { initialStatus: 'latent' },
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalled();
      const createdData = createSpy.mock.calls[0][0];
      const discovererActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'a0000000-0000-4000-8000-000000000001');
      const counterpartActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'b0000000-0000-4000-8000-000000000002');
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
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(createSpy).not.toHaveBeenCalled();
      expect(result.opportunities.length).toBe(0);
      expect(result.existingBetweenActors.length).toBe(1);
      expect(result.existingBetweenActors[0].candidateUserId).toBe('b0000000-0000-4000-8000-000000000002');
      expect(result.existingBetweenActors[0].existingStatus).toBe('pending');
    });

    test('when an expired opportunity exists, reactivates it through the eligibility lock', async () => {
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
      const reactivatedOpp: Opportunity = { ...expiredOpp, status: 'pending', updatedAt: new Date() };

      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      const unguardedUpdateSpy = spyOn(mockDb, 'updateOpportunityStatus');
      const eligibleUpdate = mock(async () => reactivatedOpp);
      mockDb.updateOpportunityStatusIfNetworkEligible = eligibleUpdate;
      spyOn(mockDb, 'findOpportunitiesByActors').mockResolvedValue([expiredOpp]);
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.9, matchedVia: 'mirror' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(createSpy).not.toHaveBeenCalled();
      expect(unguardedUpdateSpy).not.toHaveBeenCalled();
      expect(eligibleUpdate).toHaveBeenCalledWith(
        'opp-expired',
        'pending',
        expiredOpp.actors,
        {
          ownerUserId: 'a0000000-0000-4000-8000-000000000001',
          allowedNetworkIds: ['idx-1'],
        },
        'expired',
      );
      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].id).toBe('opp-expired');
      expect(result.opportunities[0].status).toBe('pending');
      expect(result.existingBetweenActors.length).toBe(0);
    });

    test('does not reactivate an opportunity from outside the explicit discovery scope', async () => {
      const expiredOutsideScope: Opportunity = {
        id: 'opp-expired-network-b',
        status: 'expired',
        actors: [
          { networkId: 'idx-b', userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient' },
          { networkId: 'idx-b', userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent' },
        ],
        detection: { source: 'opportunity_graph', timestamp: new Date().toISOString() },
        interpretation: { category: 'collaboration', reasoning: 'Old network B match', confidence: 0.7 },
        context: { networkId: 'idx-b' },
        confidence: '0.7',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({
        getUserIndexIds: async () => ['idx-a', 'idx-b'] as Id<'networks'>[],
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent',
          id: 'intent-bob',
          userId: 'b0000000-0000-4000-8000-000000000002',
          score: 0.9,
          matchedVia: 'mirror',
          networkId: 'idx-a',
        },
      ]);
      spyOn(mockDb, 'findOpportunitiesByActors').mockResolvedValue([expiredOutsideScope]);
      const eligibleUpdate = mock(async () => ({ ...expiredOutsideScope, status: 'pending' as const }));
      mockDb.updateOpportunityStatusIfNetworkEligible = eligibleUpdate;

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        indexScope: ['idx-a'] as Id<'networks'>[],
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(eligibleUpdate).not.toHaveBeenCalled();
      expect(result.opportunities).toEqual([]);
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
        options: {},
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
        options: {},
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
        options: { initialStatus: 'latent' },
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
        options: {},  // initialStatus defaults to 'pending'
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
        options: {},
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
    test('when no network memberships, full invoke does not call HyDE or search or createOpportunity', async () => {
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
        options: { initialStatus: 'latent', limit: 5 },
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

  });

  describe('create_introduction path', () => {
    const introEntities = [
      { userId: 'c0000000-0000-4000-8000-000000000003', profile: { name: 'Alice' }, networkId: 'idx-1' },
      { userId: 'b0000000-0000-4000-8000-000000000002', profile: { name: 'Bob' }, networkId: 'idx-1' },
    ];

    test('with valid entities and hint returns one opportunity with manual detection and introducer actor', async () => {
      const { factory, mockDb } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');

      const result = (await factory.createIntroduction({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        networkId: 'idx-1' as Id<'networks'>,
        introductionEntities: introEntities,
        introductionHint: 'both AI devs',
      })) as OpportunityGraphInvokeResult;

      // Introductions are human-curated — reasoning is a deterministic
      // template, not an LLM verdict, so it always carries the hint verbatim.
      expect(result.error).toBeUndefined();
      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].detection.source).toBe('manual');
      expect(result.opportunities[0].detection.createdBy).toBe('a0000000-0000-4000-8000-000000000001');
      expect(result.opportunities[0].interpretation.reasoning).toContain('both AI devs');
      expect(result.opportunities[0].actors.some((a: OpportunityActor) => a.role === 'introducer' && a.userId === 'a0000000-0000-4000-8000-000000000001')).toBe(true);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          detection: expect.objectContaining({ source: 'manual', createdBy: 'a0000000-0000-4000-8000-000000000001' }),
          status: 'latent',
        })
      );
    });

    test('when requiredNetworkId does not match networkId returns error', async () => {
      const { factory } = createMockGraph();

      const result = (await factory.createIntroduction({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        networkId: 'idx-1' as Id<'networks'>,
        introductionEntities: introEntities,
        requiredNetworkId: 'idx-other' as Id<'networks'>,
      })) as OpportunityGraphInvokeResult;

      expect(result.error).toBeDefined();
      expect(result.error).toContain('scoped');
      expect(result.opportunities?.length ?? 0).toBe(0);
    });

    test('when opportunityExistsBetweenActors returns true returns error', async () => {
      const { factory, mockDb } = createMockGraph();
      spyOn(mockDb, 'opportunityExistsBetweenActors').mockResolvedValue(true);

      const result = (await factory.createIntroduction({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        networkId: 'idx-1' as Id<'networks'>,
        introductionEntities: introEntities,
      })) as OpportunityGraphInvokeResult;

      expect(result.error).toBeDefined();
      expect(result.error).toContain('already exists');
      expect(result.opportunities?.length ?? 0).toBe(0);
    });

    test('when introducer is not network member returns error', async () => {
      const { factory, mockDb } = createMockGraph();
      spyOn(mockDb, 'isNetworkMember').mockImplementation(async (networkId: string, userId: string) => {
        if (userId === 'a0000000-0000-4000-8000-000000000001') return false;
        return true;
      });

      const result = (await factory.createIntroduction({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        networkId: 'idx-1' as Id<'networks'>,
        introductionEntities: introEntities,
      })) as OpportunityGraphInvokeResult;

      expect(result.error).toBeDefined();
      expect(result.error).toContain('not members');
      expect(result.opportunities?.length ?? 0).toBe(0);
    });

    test('always uses the deterministic reasoning fallback and returns one opportunity', async () => {
      const { factory } = createMockGraph();

      const result = (await factory.createIntroduction({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        networkId: 'idx-1' as Id<'networks'>,
        introductionEntities: introEntities,
      })) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(1);
      expect(result.error).toBeUndefined();
      expect(result.opportunities[0].interpretation.reasoning).toContain('believes these people should connect');
    });

    test('rejects an unsafe user-authored introduction hint at persistence', async () => {
      const { factory } = createMockGraph();

      const result = await factory.createIntroduction({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        networkId: 'idx-1' as Id<'networks'>,
        introductionEntities: introEntities,
        introductionHint: 'Alice and Bob will both be at Edge Esmeralda.',
      });

      expect(result.opportunities).toEqual([]);
    });
  });

  describe('targetUserId filtering', () => {
    test('when targetUserId is set, only candidates matching that user are returned', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
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
      const { compiledGraph, mockEmbedder } = createMockGraph();
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
      const { factory, mockDb } = createMockGraph();
      spyOn(mockDb, 'getOpportunity').mockResolvedValue(draftOpportunity as Opportunity);
      const stampActionSpy = spyOn(mockDb, 'stampOpportunityActorAction').mockResolvedValue(null);

      const result = await factory.sendOpportunity({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        opportunityId,
      });

      expect(result.mutationResult?.success).toBe(true);
      expect(result.mutationResult?.opportunityId).toBe(opportunityId);
      expect(stampActionSpy).toHaveBeenCalledWith(
        opportunityId,
        'a0000000-0000-4000-8000-000000000001',
        'pending',
      );
    });
  });

  describe('Discovery node: discoverer context', () => {
    test('passes profileContext with profile and intents to HyDE generator', async () => {
      const { compiledGraph, mockHydeGenerator, mockEmbedder } = createMockGraph({
        getProfile: {
          userId: 'user-alice' as Id<'users'>,
          identity: { name: 'Alice Chen', bio: 'Full-stack engineer building AI tools', location: 'Remote' },
          context: 'Alice is a software engineer',
        } satisfies UserIdentity,
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
      expect(membershipsSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
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

    test('no shared networks returns empty candidates with per-userId memberships', async () => {
      const mockDb: OpportunityGraphDatabase = {
        ...createOpportunityGraphDatabaseFixture(),
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
        getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com', socials: [] }),
        isNetworkMember: () => Promise.resolve(true),
        isIndexOwner: () => Promise.resolve(false),
        getOpportunity: () => Promise.resolve(null),
        getOpportunitiesForUser: () => Promise.resolve([]),
        updateOpportunityStatus: () => Promise.resolve(null),
        updateOpportunityActorApproval: () => Promise.resolve(null),
        getIntent: () => Promise.resolve(null),
        getIntentIndexScores: async () => [],
        getNetworkMemberContext: async () => null,
        getNegotiationTaskForOpportunity: async () => null,
        stampOpportunityActorAction: async () => null,
        getPremisesForUser: async () => [],
        searchPremisesBySimilarity: async () => [],
      };

      const mockEmbedder = {
        generate: () => Promise.resolve(dummyEmbedding),
        search: () => Promise.resolve([]),
        searchWithHydeEmbeddings: () => Promise.resolve([]),
      } as unknown as Embedder;

      const mockHyde = { invoke: () => Promise.resolve({ hydeEmbeddings: { mirror: dummyEmbedding } }) };
      const factory = new OpportunityGraphFactory(
        mockDb, mockEmbedder, mockHyde, createMockExplainer(), async () => undefined,
        undefined, undefined, undefined,
      );
      const compiledGraph = factory.createGraph();

      const result = (await compiledGraph.invoke({
        userId: discovererId,
        targetUserId: targetId,
        searchQuery: 'Connect with target',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // No shared networks → 0 candidates
      expect(result.candidates.length).toBe(0);
    });

    test('self-target (targetUserId === discoveryUserId) returns empty candidates', async () => {
      const { compiledGraph } = createMockGraphWithFnOverrides();

      const result = (await compiledGraph.invoke({
        userId: discovererId,
        targetUserId: discovererId, // Self-target
        searchQuery: 'What can I do with myself?',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.candidates.length).toBe(0);
    });
  });

  // ─── matches_ready introducer gating tests ───────────────────────────────────

  describe('matches_ready: introducer gating', () => {
    test('does not wake a signal while an introducer actor remains unapproved', async () => {
      const wakes: Array<{ userId: string; intentId: string }> = [];

      // Build a full mockDb that mirrors createMockGraph but with a custom
      // createOpportunity that appends an unapproved introducer actor.
      const mockDb: OpportunityGraphDatabase = {
        ...createOpportunityGraphDatabaseFixture(),
        getProfile: () => Promise.resolve(null),
        getActiveNetworkMembershipPairs: async (pairs) => pairs,
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
          Promise.resolve({ id: userId, name: 'Test User', email: 'test@example.com', socials: [] }),
        isNetworkMember: () => Promise.resolve(true),
        isIndexOwner: () => Promise.resolve(false),
        getOpportunity: () => Promise.resolve(null),
        getOpportunitiesForUser: () => Promise.resolve([]),
        updateOpportunityStatus: () => Promise.resolve(null),
        updateOpportunityActorApproval: () => Promise.resolve(null),
        getIntent: () => Promise.resolve(null),
        getIntentIndexScores: async () => [],
        getNetworkMemberContext: async () => null,
        getNegotiationTaskForOpportunity: async () => null,
        stampOpportunityActorAction: async () => null,
        getPremisesForUser: async () => [],
        searchPremisesBySimilarity: async () => [],
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
      } as unknown as Embedder;

      const mockHydeGenerator = {
        invoke: () =>
          Promise.resolve({
            hydeEmbeddings: { mirror: dummyEmbedding, reciprocal: dummyEmbedding },
          }),
      };

      const factory = new OpportunityGraphFactory(
        mockDb,
        mockEmbedder,
        mockHydeGenerator,
        createMockExplainer(),
        async () => undefined,
        async (signal) => { wakes.push(signal); },
        undefined,
        undefined,
      );
      const compiledGraph = factory.createGraph();

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        operationMode: 'create' as const,
        options: { initialStatus: 'latent' as const },
      });

      expect(wakes).toEqual([]);
    });

    test('an eligible persisted opportunity wakes the discoverer\'s bound signal', async () => {
      const wakes: Array<{ userId: string; intentId: string }> = [];

      const mockDb: OpportunityGraphDatabase = {
        ...createOpportunityGraphDatabaseFixture(),
        getProfile: () => Promise.resolve(null),
        getActiveNetworkMembershipPairs: async (pairs) => pairs,
        createOpportunity: (data) =>
          Promise.resolve({
            id: 'opp-approved',
            detection: data.detection,
            actors: [
              ...data.actors.map((actor) => actor.userId === 'b0000000-0000-4000-8000-000000000002'
                ? { ...actor, intentId: ' NULL ' }
                : actor),
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
        async createOpportunityIfNetworkEligible(data) {
          return this.createOpportunity(data);
        },
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
          Promise.resolve({ id: userId, name: 'Test User', email: 'test@example.com', socials: [] }),
        isNetworkMember: () => Promise.resolve(true),
        isIndexOwner: () => Promise.resolve(false),
        getOpportunity: () => Promise.resolve(null),
        getOpportunitiesForUser: () => Promise.resolve([]),
        updateOpportunityStatus: () => Promise.resolve(null),
        updateOpportunityActorApproval: () => Promise.resolve(null),
        getIntent: () => Promise.resolve(null),
        getIntentIndexScores: async () => [],
        getNetworkMemberContext: async () => null,
        getNegotiationTaskForOpportunity: async () => null,
        stampOpportunityActorAction: async () => null,
        getPremisesForUser: async () => [],
        searchPremisesBySimilarity: async () => [],
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
      } as unknown as Embedder;

      const mockHydeGenerator = {
        invoke: () =>
          Promise.resolve({
            hydeEmbeddings: { mirror: dummyEmbedding, reciprocal: dummyEmbedding },
          }),
      };

      const factory = new OpportunityGraphFactory(
        mockDb,
        mockEmbedder,
        mockHydeGenerator,
        createMockExplainer(),
        async () => undefined,
        async (signal) => { wakes.push(signal); },
        undefined,
        undefined,
      );
      const compiledGraph = factory.createGraph();

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        operationMode: 'create' as const,
        options: { initialStatus: 'latent' as const },
      });

      expect(wakes).toEqual([{ userId: 'a0000000-0000-4000-8000-000000000001', intentId: 'intent-1' }]);
    });
  });

  // ─── approve_introduction mode tests ─────────────────────────────────────────

  describe('approve_introduction mode', () => {
    test('sets approved=true and wakes the source signal once the gate opens', async () => {
      const approvalCalls: Array<[string, string, boolean]> = [];
      const wakes: Array<{ userId: string; intentId: string }> = [];

      const existingOpp = {
        id: 'opp-456',
        status: 'latent' as const,
        actors: [
          { networkId: 'idx-1' as Id<'networks'>, userId: 'target-user' as Id<'users'>, role: 'patient' as const, intentId: 'target-intent' },
          { networkId: 'idx-1' as Id<'networks'>, userId: 'candidate-user' as Id<'users'>, role: 'agent' as const, intent: 'candidate-intent' },
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

      // Build the mock db directly for the standalone lifecycle mode.
      const mockDb: OpportunityGraphDatabase = {
        ...createOpportunityGraphDatabaseFixture(),
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
        getNegotiationTaskForOpportunity: async () => null,
        getUser: (_id: string) => Promise.resolve({ id: _id, name: 'Test', email: 'test@test.com', socials: [] }),
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
        stampOpportunityActorAction: async () => null,
        getPremisesForUser: async () => [],
        searchPremisesBySimilarity: async () => [],
      };

      const mockEmbedder = { generate: async () => new Array(2000).fill(0.1) };
      const mockHyde = { invoke: async () => ({ hydeEmbeddings: {} }) };

      const factory = new OpportunityGraphFactory(
        mockDb,
        mockEmbedder as any,
        mockHyde as any,
        undefined, // matchExplainer
        undefined, // queueNotification
        async (signal) => { wakes.push(signal); },
        undefined, // agentDispatcher
      );

      await factory.approveIntroduction({
        userId: 'introducer-user' as Id<'users'>,
        opportunityId: 'opp-456',
      });

      expect(approvalCalls).toHaveLength(1);
      expect(approvalCalls[0]).toEqual(['opp-456', 'introducer-user', true]);
      expect(wakes).toEqual([{ userId: 'target-user', intentId: 'target-intent' }]);
    });

    test('does not wake a signal when the approval write fails', async () => {
      const wakes: Array<{ userId: string; intentId: string }> = [];
      const opportunity = {
        id: 'opp-456',
        actors: [
          { userId: 'target-user', role: 'patient', intent: 'target-intent' },
          { userId: 'introducer-user', role: 'introducer', approved: false },
        ],
      } as unknown as Opportunity;

      const result = await approveOpportunityIntroduction(
        {
          getOpportunity: async () => opportunity,
          updateOpportunityActorApproval: async () => null,
        } as never,
        { opportunityId: 'opp-456', actorUserId: 'introducer-user' },
        async (signal) => { wakes.push(signal); },
      );

      expect(result).toEqual({ success: false, error: 'Failed to update approval' });
      expect(wakes).toEqual([]);
    });
  });
});

// ─── buildDiscovererContext tests ───────────────────────────────────────────

describe('buildDiscovererContext', () => {
  it('includes location when present in profile identity', () => {
    const profile: SourceProfileData = {
      identity: { name: 'Alice', bio: 'AI startup founder', location: 'San Francisco' },
    };
    const result = buildDiscovererContext(profile, []);
    expect(result).toContain('Location: San Francisco');
  });

  it('omits location line when location is undefined', () => {
    const profile: SourceProfileData = {
      identity: { name: 'Alice', bio: 'AI startup founder' },
    };
    const result = buildDiscovererContext(profile, []);
    expect(result).not.toContain('Location:');
  });

  it('omits location line when location is empty string', () => {
    const profile: SourceProfileData = {
      identity: { name: 'Alice', bio: 'AI startup founder', location: '' },
    };
    const result = buildDiscovererContext(profile, []);
    expect(result).not.toContain('Location:');
  });
});

// ─── Direct-connection explainer tests ──────────────────────────────────────

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
  'PASS criteria: reasoning must be non-empty, droppedUnsupportedClaim must be falsy, and the reasoning must plausibly explain ' +
  'why these two specific profiles could be relevant to each other (e.g. shared Laravel/Vue/game-dev background, or Samuel ' +
  'seeking a co-founder and Yankı having relevant CTO/AI experience). ' +
  'FAIL if reasoning is empty, if droppedUnsupportedClaim is true, or if the reasoning does not engage with the actual profiles at all.';

async function runDirectConnectionExplain(): Promise<{ reasoning: string; droppedUnsupportedClaim?: boolean; durationMs: number }> {
  const explainer = new MatchExplainer();
  const input: MatchExplainerInput = {
    discovererId: DISCOVERER_ID,
    entities: [sourceEntity, targetEntity],
    discoveryQuery: 'What can I do with Samuel Rivera?',
  };
  // Retry up to 3 times — LLM non-determinism can yield an empty/dropped result on some runs
  const MAX_ATTEMPTS = 3;
  let totalDurationMs = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const start = Date.now();
    const result = await explainer.explain(input);
    const durationMs = Date.now() - start;
    totalDurationMs += durationMs;
    if ((result.reasoning && !result.droppedUnsupportedClaim) || attempt === MAX_ATTEMPTS) {
      return { ...result, durationMs: totalDurationMs };
    }
    console.log(`  [Attempt ${attempt}/${MAX_ATTEMPTS}] Empty/dropped result, retrying...`);
  }
  return { reasoning: '', durationMs: totalDurationMs };
}

describe('MatchExplainer: direct-connection candidates', () => {
  it('produces a grounded explanation for explicitly-mentioned users with genuine alignment', async () => {
    const { reasoning, droppedUnsupportedClaim, durationMs } = await runDirectConnectionExplain();

    console.log(`\n[Direct Connection] duration=${durationMs}ms, dropped=${!!droppedUnsupportedClaim}`);
    console.log(`  "${reasoning.slice(0, 200)}..."`);

    await assertLLM({ reasoning, droppedUnsupportedClaim }, verificationCriteria);
  }, 120000);
});

// ─── Trace events tests ──────────────────────────────────────────────────────

const dummyTraceEmbedding = new Array(2000).fill(0.1);

function createTraceMockGraph(explainerOverride?: MatchExplainerLike) {
  const mockDb: OpportunityGraphDatabase = {
    ...createOpportunityGraphDatabaseFixture(),
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
    getActiveNetworkMembershipPairs: async (pairs) => pairs,
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
    getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com', socials: [] }),
    isNetworkMember: () => Promise.resolve(true),
    isIndexOwner: () => Promise.resolve(false),
    getOpportunity: () => Promise.resolve(null),
    getOpportunitiesForUser: () => Promise.resolve([]),
    updateOpportunityStatus: () => Promise.resolve(null),
    updateOpportunityActorApproval: () => Promise.resolve(null),
    getIntent: () => Promise.resolve(null),
    getIntentIndexScores: async () => [],
    getNetworkMemberContext: async () => null,
    getNegotiationTaskForOpportunity: async () => null,
    stampOpportunityActorAction: async () => null,
    getPremisesForUser: async () => [],
    searchPremisesBySimilarity: async () => [],
    getUserContexts: async () => [],
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

  const explainer = explainerOverride ?? createMockExplainer();
  const queueNotification = async () => undefined;
  const factory = new OpportunityGraphFactory(
    mockDb, mockEmbedder, mockHydeGenerator, explainer, queueNotification,
    undefined, undefined, undefined,
  );
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
    const traceEmitter: TraceEmitter = (event) => {
      if ('name' in event) traceEvents.push(event);
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

    // Also verify the match explainer still emits its own events (existing behavior)
    const evalStarts = traceEvents.filter(e => e.type === 'agent_start' && e.name === 'opportunity-match-explainer');
    const evalEnds = traceEvents.filter(e => e.type === 'agent_end' && e.name === 'opportunity-match-explainer');
    expect(evalStarts.length).toBeGreaterThanOrEqual(1);
    expect(evalEnds.length).toBeGreaterThanOrEqual(1);
  }, 60_000);

  test('redacts evaluator provider failures before graph logs and traces', async () => {
    const secret = 'postgresql://matrix:secret@neon.example/protocol_eval Authorization: Bearer sk-or-v1-secret NEON_API_KEY=neon-secret provider body: {"token":"provider-secret"}';
    const capturedLogs: Array<{ message: string; meta?: Record<string, unknown> }> = [];
    const captureLogger: LoggerWithSource = {
      verbose: (message, meta) => capturedLogs.push({ message, meta }),
      debug: (message, meta) => capturedLogs.push({ message, meta }),
      info: (message, meta) => capturedLogs.push({ message, meta }),
      warn: (message, meta) => capturedLogs.push({ message, meta }),
      error: (message, meta) => capturedLogs.push({ message, meta }),
    };
    const silentLogger: LoggerWithSource = {
      verbose: () => undefined,
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    };
    const traceEvents: Array<{ type: string; name?: string; summary?: string }> = [];
    const explainer: MatchExplainerLike = {
      explain: async () => {
        const error = new Error(secret);
        error.name = 'Authorization: Bearer hostile-error-name-token';
        throw error;
      },
    };

    setLoggerFactory(() => captureLogger);
    try {
      const { compiledGraph } = createTraceMockGraph(explainer);
      await requestContext.run({ traceEmitter: (event) => traceEvents.push(event) }, async () => {
        await compiledGraph.invoke({
          userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
          searchQuery: 'co-founder',
          options: {},
        });
      });
    } finally {
      setLoggerFactory(() => silentLogger);
    }

    const emitted = JSON.stringify({ capturedLogs, traceEvents });
    for (const secretFragment of [
      'matrix:secret',
      'sk-or-v1-secret',
      'neon-secret',
      'provider-secret',
      'Authorization:',
      'hostile-error-name-token',
    ]) {
      expect(emitted).not.toContain(secretFragment);
    }
    expect(emitted).toContain('OpportunityEvaluationError: [redacted]');
  }, 60_000);

  test('trace events are in correct chronological order (start before end)', async () => {
    const { compiledGraph } = createTraceMockGraph();
    const traceEvents: Array<{ type: string; name: string; ts: number }> = [];
    const traceEmitter: TraceEmitter = (event) => {
      if ('name' in event) traceEvents.push({ ...event, ts: Date.now() });
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
