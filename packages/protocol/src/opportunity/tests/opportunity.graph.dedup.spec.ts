/**
 * Opportunity Graph: time-based dedup tests.
 * Tests the DEDUP_WINDOW_MS (30 days) gate in the Persist node.
 *
 * Run with: OPENROUTER_API_KEY=test bun test opportunity.graph.dedup.spec.ts
 * The env var must be set BEFORE Bun loads this file because ESM static imports
 * are resolved before the module body runs, and opportunity.evaluator.ts calls
 * createModel() at module load time.
 */

// Fallback for environments where the env var is already set (e.g., CI with .env.test)
import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY ??= 'test';

import { describe, test, expect } from 'bun:test';
import { OpportunityGraphFactory } from '../opportunity.graph.js';
import type { OpportunityEvaluatorLike, StampNewbornOpportunitiesFn } from '../opportunity.graph.js';
import type { Id } from '../../types/common.types.js';
import type { OpportunityGraphDatabase, Opportunity } from '../../shared/interfaces/database.interface.js';
import type { Embedder } from '../../shared/interfaces/embedder.interface.js';
import type { NegotiationGraphLike } from '../../negotiation/negotiation.state.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const USER_A = 'a0000000-0000-4000-8000-000000000001' as Id<'users'>;
const USER_B = 'b0000000-0000-4000-8000-000000000002' as Id<'users'>;
const USER_C = 'c0000000-0000-4000-8000-000000000003' as Id<'users'>;
const NET_ID = 'n0000000-0000-4000-8000-000000000001' as Id<'networks'>;
const OPP_ID = 'op000000-0000-4000-8000-000000000001' as Id<'opportunities'>;
const INTENT_A = 'intent-1' as Id<'intents'>;
const INTENT_OTHER = 'intent-other' as Id<'intents'>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Dummy embedding for HyDE and embedder mocks.
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

// Embedder that returns USER_B as a query-based candidate so the graph
// produces evaluated opportunities and reaches the Persist node.
const dummyEmbedder: Embedder = {
  generate: async () => DUMMY_EMBEDDING,
  search: async () => [],
  searchWithHydeEmbeddings: async () => [
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

// Minimal profile so the discovery node runs.
const mockProfile = {
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
    // Return a profile so discovery can run.
    getProfile: async () => mockProfile as unknown as Awaited<ReturnType<OpportunityGraphDatabase['getProfile']>>,
    createOpportunity: async (data) => ({
      ...data,
      id: 'opp-new',
      status: (data.status ?? 'latent') as Opportunity['status'],
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    }),
    async createOpportunityIfNetworkEligible(data) {
      return this.createOpportunity(data);
    },
    async persistIntentScopedOpportunityIfNetworkEligible(data) {
      return { created: await this.createOpportunity(data), expired: [] };
    },
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
    getActiveNetworkMembershipPairs: async (pairs) => pairs,
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
    async updateOpportunityStatusIfNetworkEligible(id, status) {
      return this.updateOpportunityStatus(id, status) as Promise<Opportunity | null>;
    },
    updateOpportunityActorApproval: async () => null,
    isNetworkMember: async () => true,
    isIndexOwner: async () => false,
    getUser: async (id) => ({ id, name: 'Test User', email: 'test@example.com' }),
    getOrCreateDM: async () => ({ id: 'conv-1' }),
    getIntent: async () => null,
    getNegotiationTaskForOpportunity: async () => null,
    compensateTasklessNegotiatingOpportunity: async () => null,
    stampOpportunityActorAction: async () => null,
    getPremisesForUser: async () => [],
    searchPremisesBySimilarity: async () => [],
  };
  return { ...base, ...overrides };
}

function buildGraph(
  db: OpportunityGraphDatabase,
  stamper?: StampNewbornOpportunitiesFn,
  overrides?: {
    embedder?: Embedder;
    evaluator?: OpportunityEvaluatorLike;
    negotiationGraph?: NegotiationGraphLike;
  },
) {
  return new OpportunityGraphFactory(
    db,
    overrides?.embedder ?? dummyEmbedder,
    dummyHyde,
    overrides?.evaluator ?? mockEvaluator,
    async () => undefined,
    overrides?.negotiationGraph,
    undefined,
    undefined,
    stamper,
  ).createGraph();
}

function resolvedNegotiationGraph(
  onInvoke?: (input: Parameters<NegotiationGraphLike['invoke']>[0]) => void,
): NegotiationGraphLike {
  return {
    invoke: async (input) => {
      onInvoke?.(input);
      return {
        outcome: {
          hasOpportunity: false,
          agreedRoles: [],
          reasoning: 'No agreement',
          turnCount: 0,
        },
        messages: [],
      };
    },
  };
}

const discoveryInput = {
  userId: USER_A,
  operationMode: 'discover' as const,
  searchQuery: 'co-founder',
  options: { initialStatus: 'latent' as const },
};

const ownedIntentInput = {
  userId: USER_A,
  operationMode: 'create' as const,
  searchQuery: 'co-founder',
  triggerIntentId: INTENT_A,
  options: { initialStatus: 'latent' as const },
};

const continuationInput = {
  userId: USER_A,
  operationMode: 'continue_discovery' as const,
  trigger: 'orchestrator' as const,
  searchQuery: 'co-founder',
  candidates: [{
    candidateUserId: USER_B,
    candidateIntentId: 'intent-bob' as Id<'intents'>,
    networkId: NET_ID,
    similarity: 0.9,
    lens: 'mirror',
    candidatePayload: 'Looking to join a startup',
    candidateSummary: 'Potential co-founder',
  }],
  options: {},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('opportunity graph — newborn stamping seam', () => {
  const intentInput = {
    userId: USER_A,
    operationMode: 'create' as const,
    searchQuery: 'co-founder',
    triggerIntentId: 'intent-1' as Id<'intents'>,
    options: { initialStatus: 'latent' as const },
  };

  test('calls after candidate construction/dedup and stamps reach create INSERT', async () => {
    let dedupFinished = false;
    let inserted: Parameters<OpportunityGraphDatabase['createOpportunity']>[0] | undefined;
    const db = buildDb({
      findOpportunitiesByActors: async () => {
        dedupFinished = true;
        return [];
      },
      createOpportunity: async (data) => {
        inserted = data;
        return { ...data, id: 'opp-new', status: 'latent', createdAt: new Date(), updatedAt: new Date(), expiresAt: null };
      },
    });
    const graph = buildGraph(db, async ({ items }) => {
      expect(dedupFinished).toBe(true);
      return items.map((item) => ({
        ...item,
        metadata: { ...(item.metadata ?? {}), stamped: true },
        interpretation: {
          ...item.interpretation,
          signals: [...(item.interpretation.signals ?? []), { type: 'pool_discriminator', weight: 1, detail: 'Style: Hands-on', questionId: 'q-1' }],
        },
      }));
    });
    await graph.invoke(intentInput);
    expect(inserted?.metadata).toMatchObject({ stamped: true });
    expect(inserted?.interpretation.signals?.at(-1)?.questionId).toBe('q-1');
  });

  test('callback error and length mismatch fail open with original items', async () => {
    for (const stamper of [
      async () => { throw new Error('classifier down'); },
      async () => [],
    ] satisfies StampNewbornOpportunitiesFn[]) {
      let inserted: Parameters<OpportunityGraphDatabase['createOpportunity']>[0] | undefined;
      const db = buildDb({
        createOpportunity: async (data) => {
          inserted = data;
          return { ...data, id: 'opp-new', status: 'latent', createdAt: new Date(), updatedAt: new Date(), expiresAt: null };
        },
      });
      await buildGraph(db, stamper).invoke(intentInput);
      expect(inserted?.metadata?.stamped).toBeUndefined();
      expect(inserted?.interpretation.signals?.some((signal) => signal.type === 'pool_discriminator')).toBe(false);
    }
  });

  test('rejects reordered callback output and preserves original INSERT order', async () => {
    const twoCandidateEmbedder = {
      ...dummyEmbedder,
      searchWithHydeEmbeddings: async () => [
        { type: 'intent' as const, id: 'intent-bob' as Id<'intents'>, userId: USER_B, score: 0.9, matchedVia: 'mirror' as const, networkId: NET_ID },
        { type: 'intent' as const, id: 'intent-carol' as Id<'intents'>, userId: USER_C, score: 0.8, matchedVia: 'mirror' as const, networkId: NET_ID },
      ],
    } as unknown as Embedder;
    const twoCandidateEvaluator: OpportunityEvaluatorLike = {
      invokeEntityBundle: async () => [
        {
          reasoning: 'Bob match', score: 90,
          actors: [{ userId: USER_A, role: 'patient', intentId: null }, { userId: USER_B, role: 'agent', intentId: null }],
        },
        {
          reasoning: 'Carol match', score: 80,
          actors: [{ userId: USER_A, role: 'patient', intentId: null }, { userId: USER_C, role: 'agent', intentId: null }],
        },
      ],
    };
    const inserted: Array<Parameters<OpportunityGraphDatabase['createOpportunity']>[0]> = [];
    const db = buildDb({
      createOpportunity: async (data) => {
        inserted.push(data);
        return { ...data, id: `opp-new-${inserted.length}`, status: 'latent', createdAt: new Date(), updatedAt: new Date(), expiresAt: null };
      },
    });

    await buildGraph(
      db,
      async ({ items }) => [...items].reverse(),
      { embedder: twoCandidateEmbedder, evaluator: twoCandidateEvaluator },
    ).invoke(intentInput);

    expect(inserted).toHaveLength(2);
    expect(inserted.map((entry) => entry.actors.find((actor) => actor.userId !== USER_A)?.userId)).toEqual([USER_B, USER_C]);
    expect(inserted.every((entry) => entry.metadata?.stamped === undefined)).toBe(true);
  });

  test('does not call for non-intent create, reactivation, or on-behalf-of introducer paths', async () => {
    let calls = 0;
    const stamper: StampNewbornOpportunitiesFn = async ({ items }) => { calls++; return items; };

    await buildGraph(buildDb({}), stamper).invoke({
      userId: USER_A,
      operationMode: 'create' as const,
      searchQuery: 'ad hoc query',
      options: { initialStatus: 'latent' as const },
    });

    const stalled = makeOpportunity({
      status: 'stalled',
      createdAt: new Date(),
      detection: {
        source: 'opportunity_graph',
        timestamp: new Date().toISOString(),
        triggeredBy: 'intent-1' as Id<'intents'>,
      },
    });
    await buildGraph(buildDb({
      findOpportunitiesByActors: async () => [stalled],
      updateOpportunityStatus: async () => ({ ...stalled, status: 'latent' }),
    }), stamper).invoke(intentInput);

    await buildGraph(buildDb({}), stamper).invoke({
      ...intentInput,
      userId: USER_B,
      onBehalfOfUserId: USER_A,
      networkId: NET_ID,
    });

    await buildGraph(buildDb({}), stamper).invoke({
      ...intentInput,
      targetUserId: USER_B,
    });

    expect(calls).toBe(0);
  });
});

describe('opportunity graph — continuation negotiation lifecycle', () => {
  test('continuation negotiates a newly persisted latent candidate with its exact task boundary', async () => {
    const persistedBoundary = new Date('2026-06-01T12:00:00.000Z');
    const negotiationInputs: Array<Parameters<NegotiationGraphLike['invoke']>[0]> = [];
    const observedTaskBoundaries: string[] = [];
    const compensationCalls: Array<[string, Date, 'latent' | 'draft']> = [];
    const db = buildDb({
      createOpportunity: async (data) => ({
        ...data,
        id: 'opp-continuation-new',
        status: 'latent',
        createdAt: new Date(),
        updatedAt: persistedBoundary,
        expiresAt: null,
      }),
      compensateTasklessNegotiatingOpportunity: async (id, expectedUpdatedAt, fallbackStatus) => {
        compensationCalls.push([id, expectedUpdatedAt, fallbackStatus]);
        return null;
      },
    });

    await buildGraph(db, undefined, {
      negotiationGraph: resolvedNegotiationGraph((input) => {
        negotiationInputs.push(input);
        if (input.opportunityId) observedTaskBoundaries.push(input.opportunityId);
      }),
    }).invoke(continuationInput);

    expect(negotiationInputs).toHaveLength(1);
    expect(negotiationInputs[0].opportunityId).toBe('opp-continuation-new');
    expect(negotiationInputs[0].opportunityStatus).toBe('latent');
    expect(negotiationInputs[0].opportunityUpdatedAt).toEqual(persistedBoundary);
    expect(observedTaskBoundaries).toEqual(['opp-continuation-new']);
    expect(compensationCalls).toEqual([]);
  });

  test('continuation leaves an active input-required task out of negotiation and compensation beyond five minutes', async () => {
    const existing = makeOpportunity({
      status: 'negotiating',
      createdAt: new Date(Date.now() - 60_000),
    });
    let negotiationInvocations = 0;
    let compensationInvocations = 0;
    const now = new Date();
    const db = buildDb({
      findOpportunitiesByActors: async () => [existing],
      getNegotiationTaskForOpportunity: async () => ({
        id: 'task-active',
        conversationId: 'conversation-active',
        state: 'input_required',
        metadata: { type: 'negotiation', opportunityId: existing.id },
        createdAt: new Date(now.getTime() - 10 * 60 * 1000),
        updatedAt: new Date(now.getTime() - 10 * 60 * 1000),
      }),
      compensateTasklessNegotiatingOpportunity: async () => {
        compensationInvocations += 1;
        return null;
      },
    });

    const result = await buildGraph(db, undefined, {
      negotiationGraph: resolvedNegotiationGraph(() => { negotiationInvocations += 1; }),
    }).invoke(continuationInput);

    expect(negotiationInvocations).toBe(0);
    expect(compensationInvocations).toBe(0);
    expect(result.opportunities).toHaveLength(0);
    expect(result.existingBetweenActors).toHaveLength(1);
  });

  test('pre-task negotiation init failure compensates the exact persisted version to draft', async () => {
    const persistedBoundary = new Date('2026-06-01T13:00:00.000Z');
    const compensationCalls: Array<[string, Date, 'latent' | 'draft']> = [];
    const db = buildDb({
      createOpportunity: async (data) => ({
        ...data,
        id: 'opp-init-failure',
        status: 'negotiating',
        createdAt: new Date(),
        updatedAt: persistedBoundary,
        expiresAt: null,
      }),
      compensateTasklessNegotiatingOpportunity: async (id, expectedUpdatedAt, fallbackStatus) => {
        compensationCalls.push([id, expectedUpdatedAt, fallbackStatus]);
        return null;
      },
    });
    const failingNegotiationGraph: NegotiationGraphLike = {
      invoke: async () => { throw new Error('init failed before task creation'); },
    };

    await buildGraph(db, undefined, { negotiationGraph: failingNegotiationGraph })
      .invoke(continuationInput);

    expect(compensationCalls).toEqual([
      ['opp-init-failure', persistedBoundary, 'draft'],
    ]);
  });

  test('unapproved introducer filtering compensates taskless negotiating state to latent', async () => {
    const persistedBoundary = new Date('2026-06-01T14:00:00.000Z');
    const compensationCalls: Array<[string, Date, 'latent' | 'draft']> = [];
    let negotiationInvocations = 0;
    const db = buildDb({
      createOpportunity: async (data) => ({
        ...data,
        id: 'opp-unapproved-introducer',
        actors: [
          ...data.actors,
          { userId: USER_C, role: 'introducer', networkId: NET_ID, approved: false },
        ],
        status: 'negotiating',
        createdAt: new Date(),
        updatedAt: persistedBoundary,
        expiresAt: null,
      }),
      compensateTasklessNegotiatingOpportunity: async (id, expectedUpdatedAt, fallbackStatus) => {
        compensationCalls.push([id, expectedUpdatedAt, fallbackStatus]);
        return null;
      },
    });

    await buildGraph(db, undefined, {
      negotiationGraph: resolvedNegotiationGraph(() => { negotiationInvocations += 1; }),
    }).invoke(continuationInput);

    expect(negotiationInvocations).toBe(0);
    expect(compensationCalls).toEqual([
      ['opp-unapproved-introducer', persistedBoundary, 'latent'],
    ]);
  });
});

describe('opportunity graph — time-based dedup (Persist node)', () => {
  test('parallel job dedup: recent existing opp skips creation (IND-166 regression)', async () => {
    // Existing opportunity created 2 minutes ago — within the 30-day window.
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
    // Existing accepted opportunity created 31 days ago — outside the 30-day window.
    const oldCreatedAt = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
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

  test('taskless negotiating dedup reactivates and invokes negotiation on a fresh orchestrator run', async () => {
    const oldNegotiatingOpp = makeOpportunity({
      status: 'negotiating',
      createdAt: new Date(Date.now() - 15 * 60 * 1000),
    });
    const reactivatedBoundary = new Date('2026-06-01T15:00:00.000Z');

    let createCalled = false;
    let updateCalledWith: [string, string] | null = null;
    const negotiationInputs: Array<Parameters<NegotiationGraphLike['invoke']>[0]> = [];
    const db = buildDb({
      findOpportunitiesByActors: async () => [oldNegotiatingOpp],
      updateOpportunityStatus: async (id, status) => {
        updateCalledWith = [id, status];
        return {
          ...oldNegotiatingOpp,
          status: 'negotiating',
          updatedAt: reactivatedBoundary,
        } as Opportunity;
      },
      createOpportunity: async (data) => {
        createCalled = true;
        return { ...data, id: 'opp-new', status: 'negotiating' as const, createdAt: new Date(), updatedAt: new Date(), expiresAt: null };
      },
    });

    const graph = buildGraph(db, undefined, {
      negotiationGraph: resolvedNegotiationGraph((input) => negotiationInputs.push(input)),
    });
    const result = await graph.invoke({
      userId: USER_A,
      operationMode: 'create' as const,
      trigger: 'orchestrator' as const,
      searchQuery: 'co-founder',
      options: {},
    });

    expect(createCalled).toBe(false);
    expect(updateCalledWith).toEqual([OPP_ID, 'negotiating']);
    expect(negotiationInputs).toHaveLength(1);
    expect(negotiationInputs[0].opportunityId).toBe(OPP_ID);
    expect(result.opportunities?.length).toBeGreaterThanOrEqual(1);
  });

  test('owned intent suppresses a recent same-trigger opportunity', async () => {
    const existing = makeOpportunity({
      status: 'pending',
      createdAt: new Date(Date.now() - 60_000),
      detection: {
        source: 'opportunity_graph',
        timestamp: new Date().toISOString(),
        triggeredBy: INTENT_A,
      },
    });
    let createCalled = false;
    const result = await buildGraph(buildDb({
      findOpportunitiesByActors: async () => [existing],
      createOpportunity: async (data) => {
        createCalled = true;
        return { ...data, id: 'unexpected', status: 'latent', createdAt: new Date(), updatedAt: new Date(), expiresAt: null };
      },
    })).invoke(ownedIntentInput);

    expect(createCalled).toBe(false);
    expect(result.existingBetweenActors[0]?.reason).toBe('same_trigger_recent_duplicate');
    expect(result.persistenceOutcome?.sameTriggerDuplicateSuppressions).toBe(1);
  });

  test('owned intent allows other-trigger terminal and non-negotiating lifecycle rows without mutating them', async () => {
    for (const status of ['pending', 'rejected', 'accepted', 'latent', 'expired'] as const) {
      const otherTrigger = makeOpportunity({
        id: `other-${status}` as Id<'opportunities'>,
        status,
        createdAt: new Date(Date.now() - 60_000),
        detection: {
          source: 'opportunity_graph',
          timestamp: new Date().toISOString(),
          triggeredBy: INTENT_OTHER,
        },
      });
      let updateCalls = 0;
      let inserted: Opportunity | undefined;
      const db = buildDb({
        findOpportunitiesByActors: async () => [otherTrigger],
        updateOpportunityStatus: async () => {
          updateCalls += 1;
          return null;
        },
        createOpportunity: async (data) => {
          inserted = {
            ...data,
            id: `new-${status}` as Id<'opportunities'>,
            status: data.status ?? 'latent',
            createdAt: new Date(),
            updatedAt: new Date(),
            expiresAt: null,
          };
          return inserted;
        },
      });

      const result = await buildGraph(db).invoke(ownedIntentInput);
      expect(updateCalls).toBe(0);
      expect(inserted?.detection.triggeredBy).toBe(INTENT_A);
      expect(result.opportunities).toHaveLength(1);
      expect(result.persistenceOutcome?.crossTriggerAllowedCount).toBe(1);
    }
  });

  test('owned intent inspects all overlaps when the first updated row belongs to another trigger', async () => {
    const otherTrigger = makeOpportunity({
      id: 'other-first' as Id<'opportunities'>,
      status: 'pending',
      createdAt: new Date(Date.now() - 30_000),
      updatedAt: new Date(),
      detection: { source: 'opportunity_graph', timestamp: new Date().toISOString(), triggeredBy: INTENT_OTHER },
    });
    const sameTrigger = makeOpportunity({
      id: 'same-second' as Id<'opportunities'>,
      status: 'rejected',
      createdAt: new Date(Date.now() - 60_000),
      updatedAt: new Date(Date.now() - 10 * 60_000),
      actors: [
        { userId: USER_A, role: 'patient', networkId: NET_ID, intent: INTENT_A },
        { userId: USER_B, role: 'agent', networkId: NET_ID },
      ],
    });
    let createCalled = false;
    const result = await buildGraph(buildDb({
      findOpportunitiesByActors: async () => [otherTrigger, sameTrigger],
      createOpportunity: async (data) => {
        createCalled = true;
        return { ...data, id: 'unexpected', status: 'latent', createdAt: new Date(), updatedAt: new Date(), expiresAt: null };
      },
    })).invoke(ownedIntentInput);

    expect(createCalled).toBe(false);
    expect(result.existingBetweenActors[0]?.existingOpportunityId).toBe('same-second');
    expect(result.existingBetweenActors[0]?.reason).toBe('same_trigger_recent_duplicate');
  });

  test('owned intent keeps a pair-global fresh active negotiation guard', async () => {
    const otherNegotiating = makeOpportunity({
      status: 'negotiating',
      createdAt: new Date(Date.now() - 60_000),
      detection: { source: 'opportunity_graph', timestamp: new Date().toISOString(), triggeredBy: INTENT_OTHER },
    });
    let createCalled = false;
    const result = await buildGraph(buildDb({
      findOpportunitiesByActors: async () => [otherNegotiating],
      getNegotiationTaskForOpportunity: async () => ({
        id: 'active-task', conversationId: 'conversation', state: 'working', metadata: null,
        createdAt: new Date(), updatedAt: new Date(),
      }),
      createOpportunity: async (data) => {
        createCalled = true;
        return { ...data, id: 'unexpected', status: 'latent', createdAt: new Date(), updatedAt: new Date(), expiresAt: null };
      },
    })).invoke(ownedIntentInput);

    expect(createCalled).toBe(false);
    expect(result.existingBetweenActors[0]?.reason).toBe('pair_active_negotiation');
    expect(result.persistenceOutcome?.pairActiveNegotiationSuppressions).toBe(1);
  });

  test('owned intent does not adopt a stale other-trigger negotiating row', async () => {
    const otherNegotiating = makeOpportunity({
      status: 'negotiating',
      createdAt: new Date(Date.now() - 60_000),
      detection: { source: 'opportunity_graph', timestamp: new Date().toISOString(), triggeredBy: INTENT_OTHER },
    });
    let updateCalls = 0;
    let inserted: Opportunity | undefined;
    const result = await buildGraph(buildDb({
      findOpportunitiesByActors: async () => [otherNegotiating],
      getNegotiationTaskForOpportunity: async () => ({
        id: 'stale-task', conversationId: 'conversation', state: 'working', metadata: null,
        createdAt: new Date(Date.now() - 60 * 60_000),
        updatedAt: new Date(Date.now() - 60 * 60_000),
      }),
      updateOpportunityStatus: async () => {
        updateCalls += 1;
        return null;
      },
      createOpportunity: async (data) => {
        inserted = {
          ...data,
          id: 'new-current-trigger' as Id<'opportunities'>,
          status: data.status ?? 'latent',
          createdAt: new Date(),
          updatedAt: new Date(),
          expiresAt: null,
        };
        return inserted;
      },
    })).invoke(ownedIntentInput);

    expect(updateCalls).toBe(0);
    expect(inserted?.detection.triggeredBy).toBe(INTENT_A);
    expect(result.opportunities[0]?.detection.triggeredBy).toBe(INTENT_A);
  });

  test('introduction path: recent existing opp skips creation (onBehalfOfUserId dedup)', async () => {
    // Discovery running on behalf of USER_A — USER_B already has a recent pending opp with USER_A.
    // Created 2 minutes ago — well within the 30-day dedup window.
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
      searchQuery: 'co-founder',
      options: { initialStatus: 'latent' as const },
    });

    expect(createCalled).toBe(false);
    expect(result.existingBetweenActors?.length).toBeGreaterThanOrEqual(1);
  });
});
