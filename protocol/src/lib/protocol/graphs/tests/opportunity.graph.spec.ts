/**
 * Opportunity Graph: tests for the refactored linear workflow.
 * Flow: Prep → Scope → Discovery → Evaluation → Ranking → Persist.
 * Invoke API: { userId, searchQuery?, indexId?, options }.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, test, expect, spyOn } from 'bun:test';
import { OpportunityGraphFactory, type OpportunityEvaluatorLike } from '../opportunity.graph';
import type { Id } from '../../../../types/common.types';
import type {
  OpportunityGraphDatabase,
  OpportunityActor,
  Opportunity,
} from '../../interfaces/database.interface';
import type { Embedder } from '../../interfaces/embedder.interface';
import type { EvaluatedOpportunityWithActors } from '../../agents/opportunity.evaluator';
import type { ProfileDocument } from '../../agents/profile.generator';

type OpportunityGraphInvokeInput = Parameters<ReturnType<OpportunityGraphFactory['createGraph']>['invoke']>[0];
type OpportunityGraphInvokeResult = Awaited<ReturnType<ReturnType<OpportunityGraphFactory['createGraph']>['invoke']>>;

const dummyEmbedding = new Array(2000).fill(0.1);

const defaultMockEvaluatorResult: EvaluatedOpportunityWithActors[] = [
  {
    reasoning: 'The source user is building a DeFi protocol and the candidate has relevant community and marketing expertise in the crypto space.',
    score: 88,
    actors: [
      { userId: 'user-source', role: 'patient' as const, intentId: null },
      { userId: 'user-bob', role: 'agent' as const, intentId: null },
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
  getUserIndexIds?: () => Promise<Id<'indexes'>[]>;
  getActiveIntents?: () => Promise<Array<{ id: Id<'intents'>; payload: string; summary: string | null; createdAt: Date }>>;
  getIndex?: (id: string) => Promise<{ id: string; title: string } | null>;
  getIndexMemberCount?: (id: string) => Promise<number>;
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
    getOpportunityBetweenActors: () => Promise.resolve(null),
    findOverlappingOpportunities: () => Promise.resolve([]),
    getUserIndexIds: deps?.getUserIndexIds ?? (() => Promise.resolve(['idx-1'] as Id<'indexes'>[])),
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
    getIndex: deps?.getIndex ?? (() => Promise.resolve({ id: 'idx-1', title: 'Test Index' })),
    getIndexMemberCount: deps?.getIndexMemberCount ?? (() => Promise.resolve(2)),
    getIndexIdsForIntent: () => Promise.resolve(['idx-1']),
    getUser: (_userId: string) => Promise.resolve({ id: _userId, name: 'Test User', email: 'test@example.com' }),
    isIndexMember: () => Promise.resolve(true),
    getOpportunity: () => Promise.resolve(null),
    getOpportunitiesForUser: () => Promise.resolve([]),
    updateOpportunityStatus: () => Promise.resolve(null),
    getIntent: () => Promise.resolve(null),
  };

  const mockEmbedder: Embedder = {
    generate: () => Promise.resolve(dummyEmbedding),
    search: () => Promise.resolve([]),
    searchWithHydeEmbeddings: () =>
      Promise.resolve([
        {
          type: 'intent' as const,
          id: 'intent-bob' as Id<'intents'>,
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
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

describe('Opportunity Graph', () => {
  describe('Prep node', () => {
    test('when user has no index memberships, returns error and no opportunities', async () => {
      const { compiledGraph, mockHydeGenerator, mockEmbedder } = createMockGraph({
        getUserIndexIds: () => Promise.resolve([]),
      });
      const hydeSpy = spyOn(mockHydeGenerator, 'invoke');
      const searchSpy = spyOn(mockEmbedder, 'searchWithHydeEmbeddings');

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
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
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.error).toBeUndefined();
      expect(result.opportunities).toEqual([]);
    });
  });

  describe('Scope node', () => {
    test('when indexId provided and user is member, targetIndexes contains only that index', async () => {
      const { compiledGraph, mockDb } = createMockGraph({
        getUserIndexIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'indexes'>[]),
      });
      const getIndexSpy = spyOn(mockDb, 'getIndex');

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        indexId: 'idx-1' as Id<'indexes'>,
        options: {},
      } as OpportunityGraphInvokeInput);

      expect(getIndexSpy).toHaveBeenCalledWith('idx-1');
    });

    test('when indexId omitted, scope uses all user indexes', async () => {
      const { compiledGraph, mockDb } = createMockGraph({
        getUserIndexIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'indexes'>[]),
      });
      const getIndexSpy = spyOn(mockDb, 'getIndex');

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
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
          userId: 'user-bob',
          score: 0.92,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { limit: 5 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(searchSpy).toHaveBeenCalled();
      const call = searchSpy.mock.calls[0];
      expect(call?.[1]?.indexScope).toContain('idx-1');
      expect(call?.[1]?.excludeUserId).toBe('user-source');
      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    });

    test('when search returns only profile type (no intent), profile candidates are included', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'profile' as const,
          id: 'user-bob',
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: {},
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // Profile-only candidates are now valid (no candidateIntentId)
      expect(result.candidates.length).toBe(1);
      expect(result.candidates[0].candidateUserId).toBe('user-bob');
      expect(result.candidates[0].candidateIntentId).toBeUndefined();
    });
  });

  describe('Evaluation node: userId dedup', () => {
    test('when same user appears via multiple indexes, evaluates them only once (deduped by userId)', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        getUserIndexIds: () => Promise.resolve(['idx-1', 'idx-2'] as Id<'indexes'>[]),
        getIndex: (id: string) => Promise.resolve({ id, title: `Index ${id}` }),
        getIndexMemberCount: () => Promise.resolve(5),
        evaluatorResult: [
          {
            reasoning: 'Bob is a great match.',
            score: 88,
            actors: [
              { userId: 'user-source', role: 'patient' as const, intentId: null },
              { userId: 'user-bob', role: 'agent' as const, intentId: null },
            ],
          },
        ],
      });

      // Same user appears in two indexes from search results
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob-1', userId: 'user-bob', score: 0.9, matchedVia: 'mirror' as const, indexId: 'idx-1' },
        { type: 'intent' as const, id: 'intent-bob-2', userId: 'user-bob', score: 0.85, matchedVia: 'mirror' as const, indexId: 'idx-2' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      // Should have deduped to 1 candidate (user-bob), not 2
      const candidateTraceEntries = result.trace.filter(
        (t: { node: string; data?: Record<string, unknown> }) =>
          t.node === 'candidate' && t.data?.userId === 'user-bob'
      );
      expect(candidateTraceEntries.length).toBe(1);
      expect(result.opportunities.length).toBe(1);
    });
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
        userId: `user-query-${i}`,
        score: 0.9 - i * 0.01,
        matchedVia: 'Painters' as const,
        indexId: 'idx-1',
      }));
      const profileCandidates = Array.from({ length: 25 }, (_, i) => ({
        type: 'profile' as const,
        id: `user-profile-${i}`,
        userId: `user-profile-${i}`,
        score: 0.6 - i * 0.005,
        matchedVia: 'profile-similarity' as const,
        indexId: 'idx-1',
      }));

      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [],
        getProfile: {
          userId: 'user-source',
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
        userId: 'user-source' as Id<'users'>,
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
        userId: `user-q-${i}`,
        score: 0.95 - i * 0.01,
        matchedVia: 'Painters' as const,
        indexId: 'idx-1',
      }));

      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [],
      });

      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue(allQueryCandidates);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
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
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].detection.source).toBe('opportunity_graph');
      expect(result.opportunities[0].actors.length).toBe(2);
      expect(result.opportunities[0].actors.some((a: OpportunityActor) => a.userId === 'user-bob')).toBe(true);
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
              { userId: 'user-source', role: 'patient' as const, intentId: null },
              { userId: 'user-bob', role: 'agent' as const, intentId: null },
              { userId: 'third-user', role: 'peer' as const, intentId: null },
            ],
          },
        ],
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'user-bob', score: 0.9, matchedVia: 'mirror' as const, indexId: 'idx-1' },
        { type: 'intent' as const, id: 'intent-third', userId: 'third-user', score: 0.85, matchedVia: 'reciprocal' as const, indexId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(2);
      for (const opp of result.opportunities) {
        expect(opp.actors.length).toBe(2);
        expect(opp.actors.some((a: OpportunityActor) => a.userId === 'user-source')).toBe(true);
      }
      const candidateUserIds = result.opportunities.map(
        (opp: { actors: OpportunityActor[] }) => opp.actors.find((a: OpportunityActor) => a.userId !== 'user-source')?.userId
      );
      expect(candidateUserIds).toContain('user-bob');
      expect(candidateUserIds).toContain('third-user');
    });
  });

  describe('Ranking node', () => {
    test('sorts by score and applies limit', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          { reasoning: 'Technical help match.', score: 85, actors: [{ userId: 'user-source', role: 'patient', intentId: null }, { userId: 'user-bob', role: 'agent', intentId: null }] },
          { reasoning: 'Complementary interests in developer tools.', score: 92, actors: [{ userId: 'user-source', role: 'peer', intentId: null }, { userId: 'user-alice', role: 'peer', intentId: null }] },
        ],
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'user-bob', score: 0.8, matchedVia: 'mirror' as const, indexId: 'idx-1' },
        { type: 'intent' as const, id: 'intent-alice', userId: 'user-alice', score: 0.9, matchedVia: 'reciprocal' as const, indexId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { limit: 1, minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].actors.some((a: OpportunityActor) => a.userId === 'user-alice')).toBe(true);
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
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
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
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }));
    });

    test('when evaluator assigns discoverer as agent (no introducer), persist swaps discoverer to patient', async () => {
      // Evaluator thinks the discoverer (user-source) is the agent (provider) and
      // the candidate (user-bob) is the patient (seeker). The lifecycle guard in the
      // persist node should swap them so the discoverer always sees first at latent.
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Source can offer mentoring to candidate.',
            score: 85,
            actors: [
              { userId: 'user-source', role: 'agent' as const, intentId: null },
              { userId: 'user-bob', role: 'patient' as const, intentId: null },
            ],
          },
        ],
      });
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { initialStatus: 'latent', minScore: 70 },
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalled();
      const createdData = createSpy.mock.calls[0][0];
      const discovererActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'user-source');
      const counterpartActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'user-bob');
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
              { userId: 'user-source', role: 'patient' as const, intentId: null },
              { userId: 'user-bob', role: 'agent' as const, intentId: null },
            ],
          },
        ],
      });
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { initialStatus: 'latent', minScore: 70 },
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalled();
      const createdData = createSpy.mock.calls[0][0];
      const discovererActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'user-source');
      const counterpartActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'user-bob');
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
              { userId: 'user-source', role: 'peer' as const, intentId: null },
              { userId: 'user-bob', role: 'peer' as const, intentId: null },
            ],
          },
        ],
      });
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob',
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'collaborator' as const,
          indexId: 'idx-1',
        },
      ]);

      await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { initialStatus: 'latent', minScore: 70 },
      } as OpportunityGraphInvokeInput);

      expect(createSpy).toHaveBeenCalled();
      const createdData = createSpy.mock.calls[0][0];
      const discovererActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'user-source');
      const counterpartActor = createdData.actors.find((a: OpportunityActor) => a.userId === 'user-bob');
      // Both stay peer — no swap needed
      expect(discovererActor?.role).toBe('peer');
      expect(counterpartActor?.role).toBe('peer');
    });
  });

  describe('Persist node: dedup via findOverlappingOpportunities', () => {
    test('when pending opportunity exists between actors, skips creation and adds to existingBetweenActors', async () => {
      const existingOpp: Opportunity = {
        id: 'opp-existing-pending',
        status: 'pending',
        actors: [
          { indexId: 'idx-1', userId: 'user-source', role: 'patient' as const },
          { indexId: 'idx-1', userId: 'user-bob', role: 'agent' as const },
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
      spyOn(mockDb, 'findOverlappingOpportunities').mockResolvedValue([existingOpp]);
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'user-bob', score: 0.9, matchedVia: 'mirror' as const, indexId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(createSpy).not.toHaveBeenCalled();
      expect(result.opportunities.length).toBe(0);
      expect(result.existingBetweenActors.length).toBe(1);
      expect(result.existingBetweenActors[0].candidateUserId).toBe('user-bob');
      expect(result.existingBetweenActors[0].existingStatus).toBe('pending');
    });

    test('when expired opportunity exists between actors, reactivates it as draft', async () => {
      const expiredOpp: Opportunity = {
        id: 'opp-expired',
        status: 'expired',
        actors: [
          { indexId: 'idx-1', userId: 'user-source', role: 'patient' as const },
          { indexId: 'idx-1', userId: 'user-bob', role: 'agent' as const },
        ],
        detection: { source: 'opportunity_graph' as const, timestamp: new Date().toISOString() },
        interpretation: { category: 'collaboration', reasoning: 'Old match', confidence: 0.7 },
        context: { indexId: 'idx-1' },
        confidence: '0.7',
        createdAt: new Date(),
        updatedAt: new Date(),
        expiresAt: null,
      };
      const reactivatedOpp: Opportunity = { ...expiredOpp, status: 'draft', updatedAt: new Date() };

      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockDb, 'findOverlappingOpportunities').mockResolvedValue([expiredOpp]);
      spyOn(mockDb, 'updateOpportunityStatus').mockResolvedValue(reactivatedOpp);
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'user-bob', score: 0.9, matchedVia: 'mirror' as const, indexId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
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
          { indexId: 'idx-1', userId: 'user-source', role: 'patient' as const },
          { indexId: 'idx-1', userId: 'user-bob', role: 'agent' as const },
          { indexId: 'idx-1', userId: 'user-alex', role: 'peer' as const },
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
      spyOn(mockDb, 'findOverlappingOpportunities').mockResolvedValue([threeActorOpp]);
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'user-bob', score: 0.9, matchedVia: 'mirror' as const, indexId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(createSpy).not.toHaveBeenCalled();
      expect(result.opportunities.length).toBe(0);
      expect(result.existingBetweenActors.length).toBe(1);
      expect(result.existingBetweenActors[0].candidateUserId).toBe('user-bob');
      expect(result.existingBetweenActors[0].existingStatus).toBe('pending');
    });

    test('when no overlapping opportunity exists, creates new opportunity normally', async () => {
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      spyOn(mockDb, 'findOverlappingOpportunities').mockResolvedValue([]);
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'user-bob', score: 0.9, matchedVia: 'mirror' as const, indexId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(createSpy).toHaveBeenCalled();
      expect(result.opportunities.length).toBe(1);
      expect(result.existingBetweenActors.length).toBe(0);
    });

    test('when existing draft opportunity exists between actors, allows creation (does not dedup)', async () => {
      // Draft opportunities are excluded via excludeStatuses in the DB query,
      // so findOverlappingOpportunities returns [] when only drafts exist.
      const { compiledGraph, mockDb, mockEmbedder } = createMockGraph();
      const createSpy = spyOn(mockDb, 'createOpportunity');
      const findOverlappingSpy = spyOn(mockDb, 'findOverlappingOpportunities').mockResolvedValue([]);
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        { type: 'intent' as const, id: 'intent-bob', userId: 'user-bob', score: 0.9, matchedVia: 'mirror' as const, indexId: 'idx-1' },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 70 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(findOverlappingSpy).toHaveBeenCalledWith(
        expect.arrayContaining(['user-source', 'user-bob']),
        { excludeStatuses: ['draft', 'latent'] },
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
        userId: 'user-source' as Id<'users'>,
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
        userId: 'user-source' as Id<'users'>,
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
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
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
        // context.indexId is set only when user explicitly scoped search; actor tokens carry discovery indexId
        expect(opp.actors.length).toBeGreaterThanOrEqual(1);
        expect(opp.actors[0].indexId).toBeDefined();
        expect(opp.actors[0].userId).toBeDefined();
        expect(opp.status).toBe('latent');
      }
    });

    test('when search returns empty, opportunities remain empty', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph();
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
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
          userId: 'user-bob',
          score: 0.6,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      const result = (await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'co-founder',
        options: { minScore: 80 },
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.candidates.length).toBeGreaterThanOrEqual(1);
      expect(result.opportunities).toEqual([]);
    });
  });

  describe('create_introduction path', () => {
    const introEntities = [
      { userId: 'user-alice', profile: { name: 'Alice' }, indexId: 'idx-1' },
      { userId: 'user-bob', profile: { name: 'Bob' }, indexId: 'idx-1' },
    ];

    test('with valid entities and hint returns one opportunity with manual detection and introducer actor', async () => {
      const { compiledGraph, mockDb } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Alice and Bob should collaborate.',
            score: 85,
            actors: [
              { userId: 'user-alice', role: 'peer' as const, intentId: null },
              { userId: 'user-bob', role: 'peer' as const, intentId: null },
            ],
          },
        ],
      });
      const createSpy = spyOn(mockDb, 'createOpportunity');

      const result = (await compiledGraph.invoke({
        operationMode: 'create_introduction',
        userId: 'user-source' as Id<'users'>,
        indexId: 'idx-1' as Id<'indexes'>,
        introductionEntities: introEntities,
        introductionHint: 'both AI devs',
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.error).toBeUndefined();
      expect(result.opportunities.length).toBe(1);
      expect(result.opportunities[0].detection.source).toBe('manual');
      expect(result.opportunities[0].detection.createdBy).toBe('user-source');
      expect(result.opportunities[0].actors.some((a: OpportunityActor) => a.role === 'introducer' && a.userId === 'user-source')).toBe(true);
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          detection: expect.objectContaining({ source: 'manual', createdBy: 'user-source' }),
          status: 'latent',
        })
      );
    });

    test('when requiredIndexId does not match indexId returns error', async () => {
      const { compiledGraph } = createMockGraph();

      const result = (await compiledGraph.invoke({
        operationMode: 'create_introduction',
        userId: 'user-source' as Id<'users'>,
        indexId: 'idx-1' as Id<'indexes'>,
        introductionEntities: introEntities,
        requiredIndexId: 'idx-other' as Id<'indexes'>,
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
        userId: 'user-source' as Id<'users'>,
        indexId: 'idx-1' as Id<'indexes'>,
        introductionEntities: introEntities,
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.error).toBeDefined();
      expect(result.error).toContain('already exists');
      expect(result.opportunities?.length ?? 0).toBe(0);
    });

    test('when introducer is not index member returns error', async () => {
      const { compiledGraph, mockDb } = createMockGraph();
      spyOn(mockDb, 'isIndexMember').mockImplementation(async (indexId: string, userId: string) => {
        if (userId === 'user-source') return false;
        return true;
      });

      const result = (await compiledGraph.invoke({
        operationMode: 'create_introduction',
        userId: 'user-source' as Id<'users'>,
        indexId: 'idx-1' as Id<'indexes'>,
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
        userId: 'user-source' as Id<'users'>,
        indexId: 'idx-1' as Id<'indexes'>,
        introductionEntities: introEntities,
        introductionHint: 'both AI devs',
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.opportunities.length).toBe(1);
      expect(result.error).toBeUndefined();
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
              { userId: 'user-source', role: 'patient' as const, intentId: null },
              { userId: 'user-alice', role: 'agent' as const, intentId: null },
            ],
          },
        ],
      });
      // Return two candidates: user-bob and user-alice
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob' as Id<'intents'>,
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
        {
          type: 'intent' as const,
          id: 'intent-alice' as Id<'intents'>,
          userId: 'user-alice',
          score: 0.85,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      const result = await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
        searchQuery: 'design and technology overlap',
        targetUserId: 'user-alice' as Id<'users'>,
        options: {},
      });

      // Only user-alice should be evaluated and persisted
      expect(result.opportunities.length).toBe(1);
      const actors = result.opportunities[0].actors;
      const candidateActor = actors.find((a: { userId: string }) => a.userId !== 'user-source');
      expect(candidateActor?.userId).toBe('user-alice');
    });

    test('when targetUserId is not set, all candidates proceed to evaluation', async () => {
      const { compiledGraph, mockEmbedder } = createMockGraph({
        evaluatorResult: [
          {
            reasoning: 'Both building DeFi.',
            score: 88,
            actors: [
              { userId: 'user-source', role: 'patient' as const, intentId: null },
              { userId: 'user-bob', role: 'agent' as const, intentId: null },
            ],
          },
          {
            reasoning: 'Shared design interest.',
            score: 82,
            actors: [
              { userId: 'user-source', role: 'patient' as const, intentId: null },
              { userId: 'user-alice', role: 'agent' as const, intentId: null },
            ],
          },
        ],
      });
      spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
        {
          type: 'intent' as const,
          id: 'intent-bob' as Id<'intents'>,
          userId: 'user-bob',
          score: 0.9,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
        {
          type: 'intent' as const,
          id: 'intent-alice' as Id<'intents'>,
          userId: 'user-alice',
          score: 0.85,
          matchedVia: 'mirror' as const,
          indexId: 'idx-1',
        },
      ]);

      const result = await compiledGraph.invoke({
        userId: 'user-source' as Id<'users'>,
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
          { indexId: 'idx-1', userId: 'user-source', role: 'party' as const },
          { indexId: 'idx-1', userId: 'user-other', role: 'party' as const },
        ],
        detection: { source: 'opportunity_graph' as const, timestamp: new Date().toISOString() },
        interpretation: { category: 'collaboration', reasoning: 'Match', confidence: 0.8 },
        context: { indexId: 'idx-1', conversationId: 'chat-1' },
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
        userId: 'user-source' as Id<'users'>,
        opportunityId,
      } as OpportunityGraphInvokeInput)) as OpportunityGraphInvokeResult;

      expect(result.mutationResult?.success).toBe(true);
      expect(result.mutationResult?.opportunityId).toBe(opportunityId);
      expect(updateStatusSpy).toHaveBeenCalledWith(opportunityId, 'pending');
    });
  });
});
