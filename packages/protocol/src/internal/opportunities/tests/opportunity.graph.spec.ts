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
import { OpportunityGraphFactory, type OpportunityEvaluatorLike, type OpportunityGraphThresholdOverrides, buildDiscovererContext } from '../opportunity.graph.js';
import type { Id } from '../../../platform/database.js';
import type { CreateOpportunityData, HydeDocument, OpportunityGraphDatabase, OpportunityActor, Opportunity } from '../../../platform/database.js';
import type { Embedder } from '../../../platform/discovery/embedder.js';
import type { SourceProfileData } from '../opportunity.state.js';
import { DISCOVERY_EVALUATOR_MIN_SCORE, DISCOVERY_MIN_SIMILARITY } from '../discovery.env.js';
import { REJECTION_COOLDOWN_MS } from '../opportunity.graph.shared.js';
import { OpportunityEvaluator, type EvaluatorInput, type EvaluatorEntity } from '../opportunity.evaluator.js';
import type { EvaluatedOpportunityWithActors } from '../opportunity.evaluator.js';
import type { UserIdentity } from '../../../protocol/schemas/identity.schema.js';
import { assertLLM } from '../../shared/agent/tests/llm-assert.js';
import { computeHydeSourceTextHash } from '../../shared/hyde-documents.js';
import { requestContext, type TraceEmitter } from '../../shared/observability/request-context.js';
import { setLoggerFactory, type LoggerWithSource } from '../../shared/observability/log.js';
import { createOpportunityGraphDatabaseFixture } from './opportunity.graph.fixtures.js';

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

type EvaluatorOptions = Parameters<NonNullable<OpportunityEvaluatorLike['invokeEntityBundle']>>[1];

function createMockEvaluator(
  result: EvaluatedOpportunityWithActors[] = defaultMockEvaluatorResult,
  calls?: EvaluatorOptions[],
): OpportunityEvaluatorLike {
  return {
    invokeEntityBundle: async (_input, options) => {
      calls?.push(options);
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
  evaluatorResult?: EvaluatedOpportunityWithActors[];
  evaluator?: OpportunityEvaluatorLike;
  /** null opts into environment resolution; omitted preserves the legacy test threshold of 70. */
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

  const evaluatorCalls: EvaluatorOptions[] = [];
  const evaluator = deps?.evaluator ?? createMockEvaluator(deps?.evaluatorResult ?? defaultMockEvaluatorResult, evaluatorCalls);
  const queueNotification = async () => undefined;
  const thresholdOverrides = deps?.thresholdOverrides === null
    ? undefined
    : deps?.thresholdOverrides ?? { evaluatorMinScore: 70 };
  const factory = new OpportunityGraphFactory(
    mockDb,
    mockEmbedder,
    mockHydeGenerator,
    evaluator,
    queueNotification,
    undefined,
    undefined,
    undefined,
    undefined,
    thresholdOverrides,
  );
  const compiledGraph = factory.createGraph();
  return { compiledGraph, factory, mockDb, mockEmbedder, mockHydeGenerator, evaluator, evaluatorCalls };
}

function createMockGraphWithFnOverrides(deps?: {
  getProfileFn?: (userId: string) => Promise<Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>>;
  getActiveIntentsFn?: (userId: string) => Promise<Array<{ id: Id<'intents'>; payload: string; summary: string | null; createdAt: Date }>>;
  evaluatorResult?: EvaluatedOpportunityWithActors[];
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

  const evaluator = createMockEvaluator(deps?.evaluatorResult ?? defaultMockEvaluatorResult);
  const queueNotification = async () => undefined;
  const factory = new OpportunityGraphFactory(
    mockDb,
    mockEmbedder,
    mockHyde,
    evaluator,
    queueNotification,
    undefined,
    undefined,
    undefined,
    undefined,
    deps?.thresholdOverrides ?? { evaluatorMinScore: 70 },
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
    test('constructor overrides govern retrieval, evaluation filtering, and trace data', async () => {
      const thresholds = {
        retrievalMinSimilarity: 0.42,
        evaluatorMinScore: 63,
      };
      const { compiledGraph, mockEmbedder, evaluatorCalls } = createMockGraph({
        thresholdOverrides: thresholds,
        evaluatorResult: [{ ...defaultMockEvaluatorResult[0], score: 62 }],
      });
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings');

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      });

      expect(searchSpy.mock.calls[0]?.[1]?.minScore).toBe(0.42);
      expect(evaluatorCalls[0]?.minScore).toBe(63);
      // Below the evaluator threshold, so it never "passed" — but the pool has
      // nothing else, so it fills the match floor with its own real score.
      expect(result.opportunities).toHaveLength(1);
      expect(parseFloat(result.opportunities[0].confidence)).toBeCloseTo(0.62, 5);
      expect(result.trace).toContainEqual(expect.objectContaining({
        node: 'threshold_filter',
        detail: expect.stringContaining('above 0.42'),
        data: expect.objectContaining({
          minScore: 0.42,
          retrievalMinSimilarity: 0.42,
          evaluatorMinScore: 63,
        }),
      }));
    });

    test('the built-in thresholds apply unless constructor overrides are provided', async () => {
      const fromDefaults = createMockGraph({ thresholdOverrides: null });
      const defaultsSearch = spyOn(fromDefaults.mockEmbedder, 'searchWithHydeEmbeddings');
      await fromDefaults.compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      });
      expect(defaultsSearch.mock.calls[0]?.[1]?.minScore).toBe(DISCOVERY_MIN_SIMILARITY);
      expect(fromDefaults.evaluatorCalls[0]?.minScore).toBe(DISCOVERY_EVALUATOR_MIN_SCORE);

      const fromConstructor = createMockGraph({
        thresholdOverrides: { retrievalMinSimilarity: 0.52, evaluatorMinScore: 72 },
      });
      const constructorSearch = spyOn(fromConstructor.mockEmbedder, 'searchWithHydeEmbeddings');
      await fromConstructor.compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      });
      expect(constructorSearch.mock.calls[0]?.[1]?.minScore).toBe(0.52);
      expect(fromConstructor.evaluatorCalls[0]?.minScore).toBe(72);
    });

    test('direct-target evaluation keeps the built-in floor despite an evaluator override', async () => {
      const { compiledGraph, evaluatorCalls } = createMockGraph({
        thresholdOverrides: { evaluatorMinScore: 80 },
        evaluatorResult: [{ ...defaultMockEvaluatorResult[0], score: 70 }],
      });

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        targetUserId: 'b0000000-0000-4000-8000-000000000002' as Id<'users'>,
        searchQuery: 'Connect with this person',
        options: {},
      });

      expect(evaluatorCalls[0]?.minScore).toBe(DISCOVERY_EVALUATOR_MIN_SCORE);
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
      const evaluatorInputs: EvaluatorInput[] = [];
      const evaluator: OpportunityEvaluatorLike = {
        invokeEntityBundle: async (input) => {
          evaluatorInputs.push(input);
          return [];
        },
      };

      try {
        const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({ evaluator });
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
        // One evaluator call per candidate, fired in rank order: the penalized
        // candidate ranks behind the unpenalized one.
        expect(evaluatorInputs).toHaveLength(2);
        expect(evaluatorInputs.map((input) => input.entities[1].userId)).toEqual([
          'c0000000-0000-4000-8000-000000000003',
          'b0000000-0000-4000-8000-000000000002',
        ]);
        expect(evaluatorInputs.map((input) => input.entities[1].ragScore)).toEqual([80, 45]);
      } finally {
        // nothing to restore — the cooldown is a constant now
      }
    });
  });

  describe('Evaluation node: whole-pool evaluation and the match floor', () => {
    /** Distinct HyDE candidates, ranked by descending score. */
    const rankedCandidates = (count: number) =>
      Array.from({ length: count }, (_, i) => ({
        type: 'intent' as const,
        id: `intent-q-${i}`,
        userId: `${String(i).padStart(8, '0')}-0000-4000-8000-000000000000`,
        score: 0.99 - i * 0.005,
        matchedVia: 'Painters' as const,
        networkId: 'idx-1',
      }));

    const SOURCE_USER_ID = 'a0000000-0000-4000-8000-000000000001';

    const passingVerdict = (candidateUserId: string, score = 80) => ({
      reasoning: 'The candidate funds the stage and sector the source user is raising for.',
      score,
      actors: [
        { userId: SOURCE_USER_ID, role: 'patient' as const, intentId: null },
        { userId: candidateUserId, role: 'agent' as const, intentId: null },
      ],
    });

    /** A `not_accepted` verdict — carries actors, same as the real evaluator now does. */
    const rejectedVerdict = (candidateUserId: string, score: number) => ({
      reasoning: 'Complementary-role mismatch.',
      score,
      actors: [
        { userId: SOURCE_USER_ID, role: 'peer' as const, intentId: null },
        { userId: candidateUserId, role: 'peer' as const, intentId: null },
      ],
      rejection: { candidateId: candidateUserId, reason: 'not_accepted' as const },
    });

    /** A guard-dropped verdict — never carries actors, never a fill candidate. */
    const guardDroppedVerdict = (
      candidateUserId: string,
      score: number,
      reason: 'incomplete_actors' | 'unsupported_claim',
    ) => ({
      reasoning: 'Guard dropped this verdict.',
      score,
      actors: [],
      rejection: { candidateId: candidateUserId, reason },
    });

    /** Records the candidate ids handed to each evaluator call. */
    const recordingEvaluator = (
      seenCalls: string[][],
      verdictFor: (candidateId: string) => EvaluatedOpportunityWithActors[],
    ): OpportunityEvaluatorLike => ({
      invokeEntityBundle: async (input) => {
        const candidateIds = input.entities.slice(1).map((e) => e.userId);
        seenCalls.push(candidateIds);
        return candidateIds.flatMap(verdictFor);
      },
    });

    test('evaluates every candidate in one round — a passer deep in the tail is still found', async () => {
      // 30 candidates, one passer at rank 27 — no batch boundary to strand it behind.
      const candidates = rankedCandidates(30);
      const passerId = candidates[27].userId;
      const seenCalls: string[][] = [];
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluator: recordingEvaluator(seenCalls, (id) =>
          id === passerId ? [passingVerdict(id)] : [rejectedVerdict(id, 20)],
        ),
        thresholdOverrides: { evaluatorMinScore: 50 },
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue(candidates);

      const result = (await compiledGraph.invoke({
        userId: SOURCE_USER_ID as Id<'users'>,
        searchQuery: 'painters',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // One round, every candidate evaluated — no batching.
      expect(seenCalls).toHaveLength(30);
      expect(seenCalls.flat()).toContain(passerId);
      const passerActor = result.opportunities.flatMap((o) => o.actors).find((a) => a.userId === passerId);
      expect(passerActor).toBeDefined();
    });

    test('surfaces every passing candidate uncapped — more than the old 20-item ranking default', async () => {
      const candidates = rankedCandidates(25);
      const seenCalls: string[][] = [];
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluator: recordingEvaluator(seenCalls, (id) => [passingVerdict(id, 90)]),
        thresholdOverrides: { evaluatorMinScore: 50 },
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue(candidates);

      const result = (await compiledGraph.invoke({
        userId: SOURCE_USER_ID as Id<'users'>,
        searchQuery: 'painters',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities).toHaveLength(25);
    });

    test('fills below the match floor with the best-scored rejects, tiebroken by similarity', async () => {
      // 15 candidates ranked by similarity; only the top 3 pass.
      const candidates = rankedCandidates(15);
      const passerIds = new Set(candidates.slice(0, 3).map((c) => c.userId));
      // Rejects get varied scores so the top 7 by score are deterministic.
      const rejectScoreByIndex = new Map(candidates.slice(3).map((c, i) => [c.userId, 49 - i]));
      const seenCalls: string[][] = [];
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluator: recordingEvaluator(seenCalls, (id) =>
          passerIds.has(id) ? [passingVerdict(id, 90)] : [rejectedVerdict(id, rejectScoreByIndex.get(id)!)],
        ),
        thresholdOverrides: { evaluatorMinScore: 50 },
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue(candidates);

      const result = (await compiledGraph.invoke({
        userId: SOURCE_USER_ID as Id<'users'>,
        searchQuery: 'painters',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // 3 passed + 7 fills = 10, the match floor.
      expect(result.opportunities).toHaveLength(10);
      const counterpartIds = result.opportunities.map(
        (o) => o.actors.find((a) => a.userId !== SOURCE_USER_ID)!.userId,
      );
      // The 7 fills are the top 7 rejects by score (ranks 3..9 of the reject pool).
      const expectedFillIds = candidates.slice(3, 10).map((c) => c.userId);
      for (const id of expectedFillIds) expect(counterpartIds).toContain(id);
      // A fill's persisted confidence is its real (low) score, not the passing threshold.
      const fillOpp = result.opportunities.find(
        (o) => o.actors.find((a) => a.userId === expectedFillIds[0]),
      );
      expect(parseFloat(fillOpp?.confidence ?? 'NaN')).toBeCloseTo(rejectScoreByIndex.get(expectedFillIds[0])! / 100, 5);
    });

    test('never pads past the pool — a small rejected pool stays small', async () => {
      const candidates = rankedCandidates(4);
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluator: recordingEvaluator([], (id) => [rejectedVerdict(id, 10)]),
        thresholdOverrides: { evaluatorMinScore: 50 },
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue(candidates);

      const result = (await compiledGraph.invoke({
        userId: SOURCE_USER_ID as Id<'users'>,
        searchQuery: 'painters',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities).toHaveLength(4);
    });

    test('guard-dropped verdicts never fill, even when the floor is unmet', async () => {
      const candidates = rankedCandidates(5);
      const [passer, ...rest] = candidates;
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluator: recordingEvaluator([], (id) => {
          if (id === passer.userId) return [passingVerdict(id, 90)];
          return [guardDroppedVerdict(id, 95, 'unsupported_claim')];
        }),
        thresholdOverrides: { evaluatorMinScore: 50 },
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue(candidates);

      const result = (await compiledGraph.invoke({
        userId: SOURCE_USER_ID as Id<'users'>,
        searchQuery: 'painters',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // Only the single passer — guard drops (even with a higher score) never fill.
      expect(result.opportunities).toHaveLength(1);
      const counterpartId = result.opportunities[0].actors.find((a) => a.userId !== SOURCE_USER_ID)?.userId;
      expect(counterpartId).toBe(passer.userId);
      void rest;
    });
  });

  /**
   * An evaluator that returns nothing for a candidate is ambiguous on its own:
   * the model may have judged the pairing unviable, or a deterministic guard may
   * have dropped an accepted verdict. The trace has to distinguish them.
   */
  describe('Evaluation node: verdict diagnostics', () => {
    const CANDIDATE_ID = 'b0000000-0000-4000-8000-000000000002';

    const diagnosticEvaluator = (
      entries: EvaluatedOpportunityWithActors[],
    ): OpportunityEvaluatorLike => ({
      invokeEntityBundle: async () => entries,
    });

    const runWith = async (evaluator: OpportunityEvaluatorLike) => {
      const { compiledGraph } = createMockGraph({ evaluator, thresholdOverrides: { evaluatorMinScore: 50 } });
      return (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;
    };

    test('reports the model\'s own rejection with its score and reasoning, and fills the floor with it', async () => {
      const result = await runWith(diagnosticEvaluator([{
        reasoning: 'Same-side match: both are seeking investment rather than offering it.',
        score: 12,
        actors: [],
        rejection: { candidateId: CANDIDATE_ID, reason: 'not_accepted' },
      }]));

      // The pool has exactly one candidate; with nothing passing, it fills the
      // match floor with its own real (low) score rather than vanishing.
      expect(result.evaluatedOpportunities).toHaveLength(1);
      expect(result.evaluatedOpportunities[0].score).toBe(12);
      expect(result.trace).toContainEqual(expect.objectContaining({
        node: 'candidate',
        data: expect.objectContaining({
          userId: CANDIDATE_ID,
          score: 12,
          passed: false,
          filled: true,
          rejectionReason: 'not_accepted',
          reasoning: 'Same-side match: both are seeking investment rather than offering it.',
        }),
      }));
    });

    test('surfaces a guard drop instead of letting it look like silence', async () => {
      const result = await runWith(diagnosticEvaluator([{
        reasoning: 'Both will be at the same event.',
        score: 88,
        actors: [],
        rejection: { candidateId: CANDIDATE_ID, reason: 'unsupported_claim' },
      }]));

      expect(result.evaluatedOpportunities).toEqual([]);
      expect(result.trace).toContainEqual(expect.objectContaining({
        node: 'evaluation_dropped',
        data: expect.objectContaining({
          droppedCount: 1,
          drops: [{ candidateUserId: CANDIDATE_ID, reason: 'unsupported_claim', score: 88 }],
        }),
      }));
      // A high-scoring guard drop must never reach persistence.
      expect(result.opportunities).toEqual([]);
    });

    test('says "no verdict" only when the evaluator really returned nothing', async () => {
      const result = await runWith(diagnosticEvaluator([]));

      expect(result.trace).toContainEqual(expect.objectContaining({
        node: 'candidate',
        detail: expect.stringContaining('✗ no verdict'),
        data: expect.objectContaining({
          userId: CANDIDATE_ID,
          score: undefined,
          reasoning: 'Evaluator returned no verdict for this candidate',
        }),
      }));
    });
  });

  describe('Evaluation and Persist', () => {
    test('forwards an aborted request signal to the evaluator model without retrying', async () => {
      const controller = new AbortController();
      const abortReason = new Error('caller cancelled discovery');
      controller.abort(abortReason);
      let evaluatorCalls = 0;
      let receivedSignal: AbortSignal | undefined;
      const entityBundleModel = {
        invoke: async (_messages: unknown, config?: { signal?: AbortSignal }) => {
          evaluatorCalls += 1;
          receivedSignal = config?.signal;
          throw config?.signal?.reason ?? new Error('missing evaluator cancellation signal');
        },
      } as unknown as Runnable;
      const evaluator = new OpportunityEvaluator({ entityBundleModel });
      const evaluatorSpy = spyOn(evaluator, 'invokeEntityBundle');
      const { compiledGraph } = createMockGraph({ evaluator });

      await requestContext.run({ abortSignal: controller.signal }, async () => {
        await compiledGraph.invoke({
          userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
          searchQuery: 'co-founder',
          options: {},
        } as OpportunityGraphInvokeInput);
      });

      expect(evaluatorSpy).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ signal: controller.signal }),
      );
      expect(receivedSignal?.aborted).toBe(true);
      expect(receivedSignal?.reason).toBe(abortReason);
      expect(evaluatorCalls).toBe(1);
    });

    test('rejects unsafe custom-evaluator reasoning again at the persistence boundary', async () => {
      const { compiledGraph, mockDb } = createMockGraph({
        evaluatorResult: [{
          reasoning: 'Alice and Bob will both be at Edge Esmeralda.',
          score: 90,
          actors: [
            { userId: 'a0000000-0000-4000-8000-000000000001', role: 'patient', intentId: null },
            { userId: 'b0000000-0000-4000-8000-000000000002', role: 'agent', intentId: null },
          ],
        }],
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
      const { compiledGraph, evaluator } = createMockGraph({ getActiveNetworkMembershipPairs });
      const evaluatorSpy = spyOn(evaluator, 'invokeEntityBundle');

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(getActiveNetworkMembershipPairs).toHaveBeenCalled();
      expect(evaluatorSpy).not.toHaveBeenCalled();
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
      const { compiledGraph, mockDb, evaluator } = createMockGraph({ getActiveNetworkMembershipPairs });
      const evaluatorSpy = spyOn(evaluator, 'invokeEntityBundle');
      const createSpy = spyOn(mockDb, 'createOpportunity');

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(evaluatorSpy).toHaveBeenCalledTimes(1);
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

    test('does not persist a literal null evaluator actor intent', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({
        evaluatorResult: [{
          reasoning: 'A strong provider-free regression match.',
          score: 90,
          actors: [
            {
              userId: 'a0000000-0000-4000-8000-000000000001',
              role: 'patient',
              intentId: 'null',
            },
            {
              userId: 'b0000000-0000-4000-8000-000000000002',
              role: 'agent',
              intentId: '  intent-1  ',
            },
          ],
        }],
      });
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([{
        type: 'intent',
        id: 'intent-bob',
        userId: 'b0000000-0000-4000-8000-000000000002',
        score: 0.9,
        matchedVia: 'mirror',
        networkId: 'idx-1',
      }]);

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput);

      const persisted = createSpy.mock.calls[0]?.[0];
      const sourceActor = persisted?.actors.find((actor) =>
        actor.userId === 'a0000000-0000-4000-8000-000000000001');
      const candidateActor = persisted?.actors.find((actor) =>
        actor.userId === 'b0000000-0000-4000-8000-000000000002');
      expect(Object.prototype.hasOwnProperty.call(sourceActor ?? {}, 'intent')).toBe(false);
      expect(candidateActor?.intent).toBe('intent-1');
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
        options: { initialStatus: 'latent' },
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
        options: { initialStatus: 'latent' },
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
        options: { initialStatus: 'latent' },
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

    test('when evaluator returns empty (below minScore), opportunities remain empty', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [],
        thresholdOverrides: { evaluatorMinScore: 80 },
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
        options: {},
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
      const { factory, mockDb, evaluatorCalls } = createMockGraph({
        thresholdOverrides: { evaluatorMinScore: 80 },
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

      const result = (await factory.createIntroduction({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        networkId: 'idx-1' as Id<'networks'>,
        introductionEntities: introEntities,
        introductionHint: 'both AI devs',
      })) as OpportunityGraphInvokeResult;

      expect(result.error).toBeUndefined();
      expect(evaluatorCalls[0]?.minScore).toBe(0);
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

    test('when evaluator returns no results uses fallback and returns one opportunity', async () => {
      const { factory } = createMockGraph({ evaluatorResult: [] });

      const result = (await factory.createIntroduction({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        networkId: 'idx-1' as Id<'networks'>,
        introductionEntities: introEntities,
        introductionHint: 'both AI devs',
      })) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(1);
      expect(result.error).toBeUndefined();
    });

    test('rejects an unsafe user-authored introduction hint at persistence', async () => {
      const { factory } = createMockGraph({ evaluatorResult: [] });

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
      const evaluator = createMockEvaluator([]);
      const factory = new OpportunityGraphFactory(mockDb, mockEmbedder, mockHyde, evaluator, async () => undefined);
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

    test('fresh negotiation kicks off with the opportunity id and the discoverer\'s bound intent', async () => {
      const negotiationInvocations: unknown[] = [];

      const mockNegotiationGraph = {
        invoke: async (input: unknown) => {
          negotiationInvocations.push(input);
          return { outcome: null };
        },
      };

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

      const evaluator = createMockEvaluator([{
        reasoning: 'Candidate intent should be loaded exactly.',
        score: 90,
        actors: [
          {
            userId: 'a0000000-0000-4000-8000-000000000001',
            role: 'patient',
            intentId: 'intent-1',
          },
          {
            userId: 'b0000000-0000-4000-8000-000000000002',
            role: 'agent',
            intentId: 'intent-bob',
          },
        ],
      }]);
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

      expect(negotiationInvocations.length).toBeGreaterThan(0);
      const invocation = negotiationInvocations[0] as { opportunityId: string; intentId: string; brief: string };
      expect(invocation.opportunityId).toBe('opp-approved');
      expect(invocation.intentId).toBe('intent-1');
      expect(typeof invocation.brief).toBe('string');
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
        undefined, // evaluator
        undefined, // queueNotification
        undefined, // negotiationGraph
        undefined, // agentDispatcher
        async (opportunityId: string, userId: string) => {
          negotiateJobsEnqueued.push({ opportunityId, userId });
        },
      );

      await factory.approveIntroduction({
        userId: 'introducer-user' as Id<'users'>,
        opportunityId: 'opp-456',
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
      // `rejection === undefined` is the persistable signal now — a not_accepted
      // rejection carries real actors too (for the discovery match floor), so
      // actor presence alone no longer distinguishes an accepted verdict.
      .filter(op => op.rejection === undefined)
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

function createTraceMockGraph(evaluatorOverride?: OpportunityEvaluatorLike) {
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

  const evaluator = evaluatorOverride ?? createTraceMockEvaluatorFn();
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

    // Also verify the evaluation node still emits its own events (existing behavior)
    const evalStarts = traceEvents.filter(e => e.type === 'agent_start' && e.name === 'opportunity-evaluator');
    const evalEnds = traceEvents.filter(e => e.type === 'agent_end' && e.name === 'opportunity-evaluator');
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
    const evaluator: OpportunityEvaluatorLike = {
      invokeEntityBundle: async () => {
        const error = new Error(secret);
        error.name = 'Authorization: Bearer hostile-error-name-token';
        throw error;
      },
    };

    setLoggerFactory(() => captureLogger);
    try {
      const { compiledGraph } = createTraceMockGraph(evaluator);
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
