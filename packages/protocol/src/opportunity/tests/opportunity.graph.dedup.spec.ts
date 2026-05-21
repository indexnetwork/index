/**
 * Opportunity Graph: time-based dedup tests.
 * Tests the DEDUP_WINDOW_MS (10 min) gate in the Persist node.
 *
 * Run with: OPENROUTER_API_KEY=test bun test opportunity.graph.dedup.spec.ts
 * The env var must be set BEFORE Bun loads this file because ESM static imports
 * are resolved before the module body runs, and opportunity.evaluator.ts calls
 * createModel() at module load time.
 */

// Fallback for environments where the env var is already set (e.g., CI with .env.test)
import { config } from 'dotenv';
config({ path: '.env.test' });
process.env.OPENROUTER_API_KEY ??= 'test';

import { describe, test, expect } from 'bun:test';
import { OpportunityGraphFactory } from '../opportunity.graph.js';
import type { OpportunityEvaluatorLike } from '../opportunity.graph.js';
import type { Id } from '../../types/common.types.js';
import type {
  OpportunityGraphDatabase,
  Opportunity,
} from '../../shared/interfaces/database.interface.js';
import type { Embedder } from '../../shared/interfaces/embedder.interface.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const USER_A = 'a0000000-0000-4000-8000-000000000001' as Id<'users'>;
const USER_B = 'b0000000-0000-4000-8000-000000000002' as Id<'users'>;
const NET_ID = 'n0000000-0000-4000-8000-000000000001' as Id<'networks'>;
const OPP_ID = 'op000000-0000-4000-8000-000000000001' as Id<'opportunities'>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Dummy embedding — non-empty so profile-based discovery runs.
const DUMMY_EMBEDDING = new Array(512).fill(0.1);

const mockEvaluator: OpportunityEvaluatorLike = {
  invokeEntityBundle: async () => [
    {
      reasoning: 'Good match',
      score: 80,
      actors: [
        { userId: USER_A, role: 'patient' as const, intentId: null },
        { userId: USER_B, role: 'agent' as const, intentId: null },
      ],
    },
  ],
};

// Embedder that returns USER_B as a profile-based candidate so the graph
// produces evaluated opportunities and reaches the Persist node.
const dummyEmbedder: Embedder = {
  generate: async () => DUMMY_EMBEDDING,
  search: async () => [],
  searchWithHydeEmbeddings: async () => [],
  searchWithProfileEmbedding: async () => [
    {
      type: 'intent' as const,
      id: 'intent-bob' as Id<'intents'>,
      userId: USER_B,
      score: 0.9,
      matchedVia: 'mirror' as const,
      networkId: NET_ID,
    },
  ],
} as unknown as Embedder;

const dummyHyde = {
  invoke: async () => ({ hydeEmbeddings: { mirror: DUMMY_EMBEDDING, reciprocal: DUMMY_EMBEDDING } }),
};

// Minimal profile with an embedding so the discovery node picks up the vector.
const mockProfile = {
  embedding: DUMMY_EMBEDDING,
  identity: { name: 'Alice', bio: 'Builder' },
  narrative: { context: 'Building things' },
  attributes: { skills: ['TypeScript'], interests: ['startups'] },
};

function makeOpportunity(
  overrides: Partial<Opportunity> & { status: Opportunity['status']; createdAt: Date },
): Opportunity {
  return {
    id: OPP_ID,
    actors: [
      { userId: USER_A, role: 'patient', networkId: NET_ID },
      { userId: USER_B, role: 'agent', networkId: NET_ID },
    ],
    detection: { source: 'opportunity_graph', timestamp: new Date().toISOString() },
    interpretation: { category: 'collaboration', reasoning: 'test', confidence: 0.8, signals: [] },
    context: { networkId: NET_ID },
    confidence: '0.8',
    updatedAt: new Date(),
    expiresAt: null,
    ...overrides,
  } as unknown as Opportunity;
}

function buildDb(overrides: Partial<OpportunityGraphDatabase>): OpportunityGraphDatabase {
  const base: OpportunityGraphDatabase = {
    // Return a profile with embedding so discovery can run without a search query.
    getProfile: async () => mockProfile as unknown as Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>,
    createOpportunity: async (data) => ({
      ...data,
      id: 'opp-new',
      status: (data.status ?? 'latent') as Opportunity['status'],
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    }),
    opportunityExistsBetweenActors: async () => false,
    findOpportunitiesByActors: async () => [],
    getUserIndexIds: async () => [NET_ID],
    getNetworkMemberships: async () => [
      {
        networkId: NET_ID,
        networkTitle: 'Test Index',
        indexPrompt: null,
        permissions: ['member'],
        memberPrompt: null,
        autoAssign: true,
        isPersonal: false,
        joinedAt: new Date(),
      },
    ],
    getActiveIntents: async () => [
      {
        id: 'intent-1' as Id<'intents'>,
        payload: 'Looking for co-founder',
        summary: 'Co-founder',
        createdAt: new Date(),
      },
    ],
    getNetworkIdsForIntent: async () => [NET_ID],
    getNetwork: async () => ({ id: NET_ID, title: 'Test Index' }),
    getNetworkMemberCount: async () => 2,
    getIntentIndexScores: async () => [],
    getNetworkMemberContext: async () => null,
    getOpportunity: async () => null,
    getOpportunitiesForUser: async () => [],
    updateOpportunityStatus: async () => null,
    updateOpportunityActorApproval: async () => null,
    isNetworkMember: async () => true,
    isIndexOwner: async () => false,
    getUser: async (id) => ({ id, name: 'Test User', email: 'test@example.com' }),
    getOrCreateDM: async () => ({ id: 'conv-1' }),
    getIntent: async () => null,
  };
  return { ...base, ...overrides };
}

function buildGraph(db: OpportunityGraphDatabase) {
  return new OpportunityGraphFactory(
    db,
    dummyEmbedder,
    dummyHyde,
    mockEvaluator,
    async () => undefined,
  ).createGraph();
}

const discoveryInput = {
  userId: USER_A,
  operationMode: 'discover' as const,
  options: { initialStatus: 'latent' as const },
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('opportunity graph — time-based dedup (Persist node)', () => {
  test('parallel job dedup: recent existing opp skips creation (IND-166 regression)', async () => {
    // Existing opportunity created 2 minutes ago — within the 10-minute window.
    const recentCreatedAt = new Date(Date.now() - 2 * 60 * 1000);
    const existingOpp = makeOpportunity({ status: 'pending', createdAt: recentCreatedAt });

    let createCalled = false;
    const db = buildDb({
      findOpportunitiesByActors: async () => [existingOpp],
      createOpportunity: async (data) => {
        createCalled = true;
        return { ...data, id: 'opp-new', status: 'latent' as const, createdAt: new Date(), updatedAt: new Date(), expiresAt: null };
      },
    });

    const graph = buildGraph(db);
    const result = await graph.invoke(discoveryInput);

    expect(createCalled).toBe(false);
    expect(result.existingBetweenActors?.length).toBeGreaterThanOrEqual(1);
    expect(result.opportunities).toHaveLength(0);
  });

  test('old accepted pair allows new opportunity creation (outside dedup window)', async () => {
    // Existing accepted opportunity created 20 minutes ago — outside the 10-minute window.
    const oldCreatedAt = new Date(Date.now() - 20 * 60 * 1000);
    const oldOpp = makeOpportunity({ status: 'accepted', createdAt: oldCreatedAt });

    let createCalled = false;
    const db = buildDb({
      findOpportunitiesByActors: async () => [oldOpp],
      createOpportunity: async (data) => {
        createCalled = true;
        return { ...data, id: 'opp-new', status: 'latent' as const, createdAt: new Date(), updatedAt: new Date(), expiresAt: null };
      },
    });

    const graph = buildGraph(db);
    await graph.invoke(discoveryInput);

    expect(createCalled).toBe(true);
  });

  test('stalled reactivation: calls updateOpportunityStatus instead of creating new', async () => {
    const stalledOpp = makeOpportunity({ status: 'stalled', createdAt: new Date(Date.now() - 30 * 60 * 1000) });
    const reactivated: Opportunity = { ...stalledOpp, status: 'latent' };

    let updateCalledWith: [string, string] | null = null;
    let createCalled = false;

    const db = buildDb({
      findOpportunitiesByActors: async () => [stalledOpp],
      updateOpportunityStatus: async (id, status) => {
        updateCalledWith = [id, status];
        return reactivated;
      },
      createOpportunity: async (data) => {
        createCalled = true;
        return { ...data, id: 'opp-new', status: 'latent' as const, createdAt: new Date(), updatedAt: new Date(), expiresAt: null };
      },
    });

    const graph = buildGraph(db);
    const result = await graph.invoke(discoveryInput);

    expect(createCalled).toBe(false);
    expect(updateCalledWith).not.toBeNull();
    expect(updateCalledWith![0]).toBe(OPP_ID);
    // The reactivated opportunity should appear in the output
    expect(result.opportunities?.length).toBeGreaterThanOrEqual(1);
  });

  test('latent upgrade: existing latent opp is upgraded when initialStatus is higher priority', async () => {
    // A background-discovered latent opportunity already exists; a chat-initiated discovery with
    // initialStatus 'pending' should upgrade the latent opp rather than creating a new one.
    const latentOpp = makeOpportunity({ status: 'latent', createdAt: new Date(Date.now() - 5 * 60 * 1000) });
    const upgraded: Opportunity = { ...latentOpp, status: 'pending' };

    let updateCalledWith: [string, string] | null = null;
    let createCalled = false;

    const db = buildDb({
      findOpportunitiesByActors: async () => [latentOpp],
      updateOpportunityStatus: async (id, status) => {
        updateCalledWith = [id, status];
        return upgraded;
      },
      createOpportunity: async (data) => {
        createCalled = true;
        return { ...data, id: 'opp-new', status: 'pending' as const, createdAt: new Date(), updatedAt: new Date(), expiresAt: null };
      },
    });

    const graph = buildGraph(db);
    await graph.invoke({ ...discoveryInput, options: { initialStatus: 'pending' as const } });

    expect(createCalled).toBe(false);
    expect(updateCalledWith).not.toBeNull();
    expect(updateCalledWith![0]).toBe(OPP_ID);
    expect(updateCalledWith![1]).toBe('pending');
  });

  test('stuck negotiating fix: old negotiating opp allows new opportunity creation', async () => {
    // Existing negotiating opportunity created 15 minutes ago — outside the 10-minute window.
    const oldNegotiatingOpp = makeOpportunity({
      status: 'negotiating',
      createdAt: new Date(Date.now() - 15 * 60 * 1000),
    });

    let createCalled = false;
    const db = buildDb({
      findOpportunitiesByActors: async () => [oldNegotiatingOpp],
      createOpportunity: async (data) => {
        createCalled = true;
        return { ...data, id: 'opp-new', status: 'latent' as const, createdAt: new Date(), updatedAt: new Date(), expiresAt: null };
      },
    });

    const graph = buildGraph(db);
    await graph.invoke(discoveryInput);

    expect(createCalled).toBe(true);
  });

  test('introduction path: recent existing opp skips creation (onBehalfOfUserId dedup)', async () => {
    // Discovery running on behalf of USER_A — USER_B already has a recent pending opp with USER_A.
    const recentCreatedAt = new Date(Date.now() - 2 * 60 * 1000);
    const existingOpp = makeOpportunity({ status: 'pending', createdAt: recentCreatedAt });

    let createCalled = false;
    const db = buildDb({
      findOpportunitiesByActors: async () => [existingOpp],
      createOpportunity: async (data) => {
        createCalled = true;
        return { ...data, id: 'opp-new', status: 'latent' as const, createdAt: new Date(), updatedAt: new Date(), expiresAt: null };
      },
      // Return USER_A's user record when the graph looks up the introducer.
      getUser: async (id) => ({ id, name: 'Alice', email: 'alice@example.com' }),
    });

    const graph = buildGraph(db);
    // userId = introducer (USER_B running discovery on behalf of USER_A)
    const result = await graph.invoke({
      userId: USER_B,
      onBehalfOfUserId: USER_A,
      networkId: NET_ID,
      operationMode: 'discover' as const,
      options: { initialStatus: 'latent' as const },
    });

    expect(createCalled).toBe(false);
    expect(result.existingBetweenActors?.length).toBeGreaterThanOrEqual(1);
  });
});
