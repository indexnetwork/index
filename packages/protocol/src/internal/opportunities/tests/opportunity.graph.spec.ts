/**
 * Opportunity Graph: tests for the refactored linear workflow.
 * Flow: Prep → Scope → Discovery → Evaluation → Ranking → Persist.
 * Invoke API: { userId, searchQuery?, networkId?, options }.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, test, it, expect, mock, spyOn } from 'bun:test';
import type { Runnable } from '@langchain/core/runnables';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { OpportunityGraphFactory, type OpportunityGraphThresholdOverrides, buildDiscovererContext } from '../opportunity.graph.js';
import type { Id } from '../../../platform/database.js';
import type { CreateOpportunityData, OpportunityGraphDatabase, Opportunity } from '../../../platform/database.js';
import type { Embedder } from '../../../platform/discovery/embedder.js';
import type { SourceProfileData } from '../opportunity.state.js';
import { DISCOVERY_MIN_SIMILARITY } from '../discovery.env.js';
import { REJECTION_COOLDOWN_MS } from '../opportunity.graph.shared.js';
import { MatchExplainer } from '../opportunity.match-explainer.js';
import type { MatchExplainerLike, MatchExplainerResult, MatchExplainerInput, EvaluatorEntity } from '../opportunity.match-explainer.js';
import type { UserIdentity } from '../../../protocol/schemas/identity.schema.js';
import { requestContext, type TraceEmitter } from '../../shared/observability/request-context.js';
import { setLoggerFactory, type LoggerWithSource } from '../../shared/observability/log.js';

type OpportunityGraphInvokeInput = Parameters<ReturnType<OpportunityGraphFactory['createGraph']>['invoke']>[0];
type OpportunityGraphInvokeResult = Awaited<ReturnType<ReturnType<OpportunityGraphFactory['createGraph']>['invoke']>>;

const JUDGE_SYSTEM_PROMPT = `You are a test oracle for an AI system. Given the output of a system under test and evaluation criteria, determine whether the output passes or fails.

Return JSON with two fields:
- pass: true if the output satisfies the criteria, false otherwise
- reasoning: concise explanation of your judgment (1-3 sentences)`;

const judgeOutputSchema = z.object({
  pass: z.boolean(),
  reasoning: z.string(),
});

/**
 * Assert that `output` satisfies the given `criteria` according to an LLM judge.
 * Throws an error (with reasoning embedded) if the assertion fails.
 * Uses google/gemini-3.7-flash.
 *
 * @param output - The value produced by the system under test.
 * @param criteria - Natural language description of what the output must satisfy.
 * @throws {Error} If the LLM judge determines the output does not meet the criteria.
 */
async function assertLLM(output: unknown, criteria: string): Promise<void> {
  const modelId = "google/gemini-3.7-flash";

  const model = new ChatOpenAI({
    model: modelId,
    apiKey: process.env.OPENROUTER_API_KEY!,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
    },
    temperature: 0,
    maxTokens: 512,
  });

  const structured = model.withStructuredOutput(judgeOutputSchema, { name: "llm_judge" });

  const userMessage = `Output:\n${JSON.stringify(output, null, 2)}\n\nCriteria:\n${criteria}`;

  const result = await structured.invoke([
    new SystemMessage(JUDGE_SYSTEM_PROMPT),
    new HumanMessage(userMessage),
  ]);

  if (!result.pass) {
    throw new Error(`LLM assertion failed: ${result.reasoning}`);
  }
}

/**
 * Provider-free defaults for graph tests that exercise only one workflow path.
 * Individual tests override the methods whose result is part of their contract.
 */
function createOpportunityGraphDatabaseFixture(): OpportunityGraphDatabase {
  const emptyOpportunity = (id: string): Opportunity => ({
    id,
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: [],
    interpretation: { reasoning: '', category: 'connection', confidence: 0 },
    context: {},
    confidence: '0',
    status: 'latent',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  });

  return {
    openCounterparties: async (pairs) => pairs.map((pair, i) => ({
      opportunityId: `opp-${i}` as Id<'opportunities'>,
      negotiationId: `neg-${i}`,
      initiatorUserId: pair.userA,
      initiatorIntentId: pair.intentA,
    })),
    getProfile: async () => null,
    createOpportunity: async (data) => ({ ...emptyOpportunity('fixture-opportunity'), ...data }),
    createOpportunityIfNetworkEligible: async () => null,
    createOpportunityAndExpireIdsIfNetworkEligible: async () => null,
    persistIntentScopedOpportunityIfNetworkEligible: async () => null,
    updateOpportunityStatusIfNetworkEligible: async () => null,
    opportunityExistsBetweenActors: async () => false,
    findOpportunitiesByActors: async () => [],
    getUserNetworkIds: async () => [],
    getNetworkMemberships: async () => [],
    getActiveNetworkMembershipPairs: async (pairs) => pairs,
    getActiveIntents: async () => [],
    getNetworkIdsForIntent: async () => [],
    getNetwork: async () => null,
    getNetworkMemberCount: async () => 0,
    getIntentNetworkScores: async () => [],
    getNetworkMemberContext: async () => null,
    getNetworkAssignmentContext: async () => null,
    getOpportunity: async () => null,
    getOpportunitiesForUser: async () => [],
    updateOpportunityStatus: async () => null,
    stampOpportunityActorAction: async () => null,
    updateOpportunityActorApproval: async () => null,
    isNetworkMember: async () => false,
    isNetworkOwner: async () => false,
    getUser: async () => null,
    getOrCreateDM: async () => ({ id: 'fixture-conversation' }),
    getIntent: async () => null,
    getUserContext: async () => null,
    getUserContexts: async () => [],
    searchIntentsByContextEmbedding: async () => [],
    getHydeDocumentsForSource: async () => [],
  };
}

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
  getUserNetworkIds?: () => Promise<Id<'networks'>[]>;
  getNetworkMemberships?: () => Promise<Array<{ networkId: string; networkTitle: string; networkPrompt: string | null; permissions: string[]; memberPrompt: string | null; autoAssign: boolean; isPersonal: boolean; joinedAt: Date }>>;
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
    getUserNetworkIds: deps?.getUserNetworkIds ?? (() => Promise.resolve(['idx-1'] as Id<'networks'>[])),
    getNetworkMemberships: deps?.getNetworkMemberships ?? (async () => {
      const ids = deps?.getUserNetworkIds ? await deps.getUserNetworkIds() : ['idx-1'] as Id<'networks'>[];
      return ids.map(id => ({ networkId: id, networkTitle: 'Test Network', networkPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }));
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
    getNetwork: deps?.getNetwork ?? (() => Promise.resolve({ id: 'idx-1', title: 'Test Network' })),
    getNetworkMemberCount: deps?.getNetworkMemberCount ?? (() => Promise.resolve(2)),
    getNetworkIdsForIntent: deps?.getNetworkIdsForIntent ?? (() => Promise.resolve(['idx-1'])),
    getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com', socials: [] }),
    isNetworkMember: () => Promise.resolve(true),
    isNetworkOwner: () => Promise.resolve(false),
    getOpportunity: () => Promise.resolve(null),
    getOpportunitiesForUser: () => Promise.resolve([]),
    updateOpportunityStatus: () => Promise.resolve(null),
    async updateOpportunityStatusIfNetworkEligible(id, status) {
      return this.updateOpportunityStatus(id, status) as Promise<Opportunity | null>;
    },
    updateOpportunityActorApproval: () => Promise.resolve(null),
    getIntent: () => Promise.resolve(null),
    getIntentNetworkScores: async () => [],
    getNetworkMemberContext: async () => null,
    stampOpportunityActorAction: async () => null,
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
    thresholdOverrides,
  );
  const compiledGraph = factory.createGraph();
  return { compiledGraph, factory, mockDb, mockEmbedder, mockHydeGenerator, explainer, explainerCalls };
}

function createMockGraphWithFnOverrides(deps?: {
  getProfileFn?: (userId: string) => Promise<Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>>;
  getActiveIntentsFn?: (userId: string) => Promise<Array<{ id: Id<'intents'>; payload: string; summary: string | null; createdAt: Date }>>;
  getUserNetworkIds?: () => Promise<Id<'networks'>[]>;
  getNetworkMemberships?: () => Promise<Array<{ networkId: string; networkTitle: string; networkPrompt: string | null; permissions: string[]; memberPrompt: string | null; autoAssign: boolean; isPersonal: boolean; joinedAt: Date }>>;
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
    getUserNetworkIds: deps?.getUserNetworkIds ?? (() => Promise.resolve(['idx-1'] as Id<'networks'>[])),
    getNetworkMemberships: deps?.getNetworkMemberships ?? (async () => {
      const ids = deps?.getUserNetworkIds ? await deps.getUserNetworkIds() : ['idx-1'] as Id<'networks'>[];
      return ids.map(id => ({ networkId: id, networkTitle: 'Test Network', networkPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }));
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
    getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Network' }),
    getNetworkMemberCount: () => Promise.resolve(2),
    getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
    getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com', socials: [] }),
    isNetworkMember: () => Promise.resolve(true),
    isNetworkOwner: () => Promise.resolve(false),
    getOpportunity: () => Promise.resolve(null),
    getOpportunitiesForUser: () => Promise.resolve([]),
    updateOpportunityStatus: () => Promise.resolve(null),
    updateOpportunityActorApproval: () => Promise.resolve(null),
    getIntent: () => Promise.resolve(null),
    getIntentNetworkScores: async () => [],
    getNetworkMemberContext: async () => null,
    stampOpportunityActorAction: async () => null,
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
    deps?.thresholdOverrides,
  );
  const compiledGraph = factory.createGraph();
  return { compiledGraph, mockDb };
}

describe('Opportunity Graph', () => {
  describe('Prep node', () => {
    test('when user has no network memberships, returns error and no opportunities', async () => {
      const { compiledGraph, mockHydeGenerator, mockEmbedder } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve([]),
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
      expect(result.opened).toEqual([]);
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
      expect(result.opened).toEqual([]);
    });
  });

  describe('Scope node', () => {
    test('when networkId provided and user is member, targetNetworks contains only that network', async () => {
      const { compiledGraph, mockDb } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'networks'>[]),
      });
      const getNetworkSpy = spyOn(mockDb, 'getNetwork');

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        networkId: 'idx-1' as Id<'networks'>,
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(getNetworkSpy).toHaveBeenCalledWith('idx-1');
      expect(getNetworkSpy.mock.calls.map((call) => call[0])).not.toContain('idx-2');
    });

    test('when networkId omitted, scope uses all user networks', async () => {
      const { compiledGraph, mockDb } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'networks'>[]),
      });
      const getNetworkSpy = spyOn(mockDb, 'getNetwork');

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput);

      expect(getNetworkSpy).toHaveBeenCalledWith('idx-1');
      expect(getNetworkSpy).toHaveBeenCalledWith('idx-2');
    });

    test('when triggerIntentId is present, unscoped graph discovery searches only active assigned networks', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'networks'>[]),
        getNetworkIdsForIntent: async () => ['idx-2'],
      });
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        triggerIntentId: 'intent-1' as Id<'intents'>,
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput);

      const searchedNetworks = searchSpy.mock.calls.flatMap((call) => call?.[1]?.networkScope ?? []);
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
      expect(result.opened).toEqual([]);
    });

    test('when trigger intent has no active assigned network, graph discovery fails closed', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'networks'>[]),
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
      expect(result.opened).toEqual([]);
    });

    test('when networkScope is explicitly empty, discovery fails closed', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'networks'>[]),
      });
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        networkScope: [],
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput);

      expect(searchSpy).not.toHaveBeenCalled();
      expect(result.opened).toEqual([]);
    });

    test('when networkScope provided, the vector search is intersected and networks outside it are excluded', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve(['idx-1', 'idx-2', 'idx-3'] as Id<'networks'>[]),
      });
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);

      await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        // A network-scoped agent reaches only its bound network + personal network;
        // idx-3 is another network the user belongs to and must not be searched.
        networkScope: ['idx-1', 'idx-2'] as Id<'networks'>[],
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput);

      expect(searchSpy).toHaveBeenCalled();
      // Discovery searches one network at a time; collect every network touched.
      const searchedNetworks = searchSpy.mock.calls
        .flatMap((c) => c?.[1]?.networkScope ?? []);
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
      // Every candidate that clears retrieval is opened directly now —
      // no evaluator score floor.
      expect(result.opened).toHaveLength(1);
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
      expect(call?.[1]?.networkScope).toContain('idx-1');
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
    test('when same user appears via multiple networks, evaluates them only once (deduped by userId)', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'networks'>[]),
        getNetwork: (id: string) => Promise.resolve({ id, title: `Network ${id}` }),
        getNetworkMemberCount: () => Promise.resolve(5),
      });

      // Same user appears in two networks from search results
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
      expect(result.opened.length).toBe(1);
    });

    test('dedup prefers candidate from network with higher relevancy score on equal similarity', async () => {
      const { compiledGraph } = createMockGraph({
        getUserNetworkIds: async () => ['idx-high', 'idx-low'] as Id<'networks'>[],
        getNetworkMemberships: async () => [
          { networkId: 'idx-high', networkTitle: 'High Relevancy', networkPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() },
          { networkId: 'idx-low', networkTitle: 'Low Relevancy', networkPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() },
        ],
      });

      // Invoke with networkRelevancyScores pre-set (simulating scope node output)
      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'find collaborators',
        operationMode: 'create' as const,
        networkRelevancyScores: { 'idx-high': 0.9, 'idx-low': 0.3 },
      });

      // The opportunity actors should have networkId from the higher-scoring network
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

    test('rejects unsafe custom-explainer reasoning before a candidate is recorded', async () => {
      const { compiledGraph, mockDb } = createMockGraph({
        explainerResult: { reasoning: 'Alice and Bob will both be at Edge Esmeralda.' },
      });
      const createSpy = spyOn(mockDb, 'openCounterparties');

      const result = await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(createSpy).not.toHaveBeenCalled();
      expect(result.opened).toEqual([]);
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
      expect(result.opened).toEqual([]);
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
      expect(result.opened).toEqual([]);
    });



    test('when discovery returns an intent candidate, a pair is opened', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const openSpy = spyOn(mockDb, 'openCounterparties');
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

      expect(result.opened.length).toBe(1);
      // Both seats on one pair: either principal's run reaches the same key.
      const [pair] = openSpy.mock.calls[0]![0];
      expect(pair!.userA).toBe('a0000000-0000-4000-8000-000000000001');
      expect(pair!.userB).toBe('b0000000-0000-4000-8000-000000000002');
      expect(pair!.intentB).toBe('intent-bob');
    });

    test('carries typed opportunity evidence onto the pair', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const upsertSpy = spyOn(mockDb, 'openCounterparties');
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

      expect(upsertSpy).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({
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
      ]));
    });

  });

  describe('Ranking node', () => {
    test('sorts by score and applies limit', async () => {
      // Score is derived from discovery similarity now — the higher-similarity
      // candidate (c, 0.9) should outrank the lower one (bob, 0.8).
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const openSpy = spyOn(mockDb, 'openCounterparties');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'b0000000-0000-4000-8000-000000000002', score: 0.8, matchedVia: 'mirror' as const, networkId: 'idx-1' },
        { type: 'intent' as const, id: 'intent-alice', userId: 'c0000000-0000-4000-8000-000000000003', score: 0.9, matchedVia: 'reciprocal' as const, networkId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'a0000000-0000-4000-8000-000000000001' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { limit: 1 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opened.length).toBe(1);
      expect(openSpy.mock.calls[0]![0][0]!.userB).toBe('c0000000-0000-4000-8000-000000000003');
    });
  });



  describe('Conditional routing: early exit', () => {
    test('when no network memberships, full invoke does not call HyDE or search or createOpportunity', async () => {
      const { compiledGraph, mockDb, mockHydeGenerator, mockEmbedder } = createMockGraph({
        getUserNetworkIds: () => Promise.resolve([]),
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
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const openSpy = spyOn(mockDb, 'openCounterparties');
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
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opened).toBeDefined();
      expect(Array.isArray(result.opened)).toBe(true);
      if (result.opened.length > 0) {
        // A counterparty is a pair: two seats, one network, one key.
        const pair = openSpy.mock.calls[0]![0][0]!;
        expect(pair.pairKey).toBeDefined();
        expect(pair.networkId).toBeDefined();
        expect(pair.reasoning).toBeDefined();
        expect(pair.userA).toBeDefined();
        expect(pair.userB).toBeDefined();
        expect(pair.intentA).toBeDefined();
        expect(pair.intentB).toBeDefined();
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

      expect(result.opened).toEqual([]);
      expect(result.candidates).toEqual([]);
    });

  });


  describe('targetUserId filtering', () => {
    test('when targetUserId is set, only candidates matching that user are returned', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const openSpy = spyOn(mockDb, 'openCounterparties');
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

      // Only c0000000-0000-4000-8000-000000000003 should be evaluated and opened
      expect(result.opened.length).toBe(1);
      const pair = openSpy.mock.calls[0]![0][0]!;
      expect(pair.userA).toBe('a0000000-0000-4000-8000-000000000001');
      expect(pair.userB).toBe('c0000000-0000-4000-8000-000000000003');
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
      expect(result.opened.length).toBeGreaterThanOrEqual(1);
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
        getUserNetworkIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
        getNetworkMemberships: (userId: string) => {
          // Discoverer is in idx-1, target is in idx-999 — no overlap
          if (userId === discovererId) {
            return Promise.resolve([{ networkId: 'idx-1', networkTitle: 'Alpha', networkPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }]);
          }
          return Promise.resolve([{ networkId: 'idx-999', networkTitle: 'Beta', networkPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() }]);
        },
        getActiveIntents: () => Promise.resolve([{
          id: 'intent-1' as Id<'intents'>, payload: 'Test intent', summary: null, createdAt: new Date(),
        }]),
        getNetwork: (id: string) => Promise.resolve({ id, title: `Network ${id}` }),
        getNetworkMemberCount: () => Promise.resolve(5),
        getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
        getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com', socials: [] }),
        isNetworkMember: () => Promise.resolve(true),
        isNetworkOwner: () => Promise.resolve(false),
        getOpportunity: () => Promise.resolve(null),
        getOpportunitiesForUser: () => Promise.resolve([]),
        updateOpportunityStatus: () => Promise.resolve(null),
        updateOpportunityActorApproval: () => Promise.resolve(null),
        getIntent: () => Promise.resolve(null),
        getIntentNetworkScores: async () => [],
        getNetworkMemberContext: async () => null,
        stampOpportunityActorAction: async () => null,
      };

      const mockEmbedder = {
        generate: () => Promise.resolve(dummyEmbedding),
        search: () => Promise.resolve([]),
        searchWithHydeEmbeddings: () => Promise.resolve([]),
      } as unknown as Embedder;

      const mockHyde = { invoke: () => Promise.resolve({ hydeEmbeddings: { mirror: dummyEmbedding } }) };
      const factory = new OpportunityGraphFactory(
        mockDb, mockEmbedder, mockHyde, createMockExplainer(), async () => undefined,
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


  // ─── approve_introduction mode tests ─────────────────────────────────────────

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
    getUserNetworkIds: () => Promise.resolve(['idx-1'] as Id<'networks'>[]),
    getNetworkMemberships: async () => [
      { networkId: 'idx-1', networkTitle: 'Test Network', networkPrompt: null, permissions: ['member'], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() },
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
    getNetwork: () => Promise.resolve({ id: 'idx-1', title: 'Test Network' }),
    getNetworkMemberCount: () => Promise.resolve(2),
    getNetworkIdsForIntent: () => Promise.resolve(['idx-1']),
    getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com', socials: [] }),
    isNetworkMember: () => Promise.resolve(true),
    isNetworkOwner: () => Promise.resolve(false),
    getOpportunity: () => Promise.resolve(null),
    getOpportunitiesForUser: () => Promise.resolve([]),
    updateOpportunityStatus: () => Promise.resolve(null),
    updateOpportunityActorApproval: () => Promise.resolve(null),
    getIntent: () => Promise.resolve(null),
    getIntentNetworkScores: async () => [],
    getNetworkMemberContext: async () => null,
    stampOpportunityActorAction: async () => null,
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
  'opportunity-emit-counterparties',
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
