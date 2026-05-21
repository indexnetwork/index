import { config } from "dotenv";
config({ path: '.env.test' });
// Guard against the existing flake where `.env.test` resolves to
// `packages/protocol/.env.test` (which doesn't exist) when bun is invoked
// from this workspace. Matches the pattern in opportunity.tools.mcp-orchestrator.spec.ts.
process.env.OPENROUTER_API_KEY ??= 'test';

import { describe, test, expect } from 'bun:test';
import { OpportunityGraphFactory } from '../opportunity.graph.js';
import type { Id } from '../../types/common.types.js';
import type {
  OpportunityGraphDatabase,
  OpportunityActor,
} from '../../shared/interfaces/database.interface.js';
import type { Embedder } from '../../shared/interfaces/embedder.interface.js';
import type { EvaluatedOpportunityWithActors } from '../opportunity.evaluator.js';

const dummyEmbedding = new Array(2000).fill(0.1);

function makeFactory(opts: { hangNegotiationForever: boolean }) {
  const persistedOpp = {
    id: 'opp-hang-1',
    detection: { source: 'auto' },
    actors: [
      { userId: 'u-source', role: 'patient', networkId: 'idx-1', intentId: null },
      { userId: 'u-candidate', role: 'agent', networkId: 'idx-1', intentId: null },
    ] satisfies OpportunityActor[],
    interpretation: { reasoning: 'mock', confidence: 0.8 },
    context: { conversationId: undefined },
    confidence: '0.8',
    status: 'negotiating' as const,
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };

  const mockDb = {
    getProfile: async () => null,
    createOpportunity: async () => persistedOpp,
    opportunityExistsBetweenActors: async () => false,
    findOpportunitiesByActors: async () => [],
    getUserIndexIds: async () => (['idx-1'] as Id<'networks'>[]),
    getNetworkMemberships: async () => [{
      networkId: 'idx-1' as Id<'networks'>,
      networkTitle: 'Test',
      indexPrompt: null,
      permissions: ['member'],
      memberPrompt: null,
      autoAssign: true,
      isPersonal: false,
      joinedAt: new Date(),
    }],
    getActiveIntents: async () => [{
      id: 'intent-1' as Id<'intents'>,
      payload: 'Looking for a co-founder',
      summary: 'Co-founder',
      createdAt: new Date(),
    }],
    getNetwork: async () => ({ id: 'idx-1', title: 'Test' }),
    getNetworkMemberCount: async () => 2,
    getNetworkIdsForIntent: async () => ['idx-1'],
    getUser: async (id: string) => ({ id, name: 'Test User', email: 'test@example.com' }),
    isNetworkMember: async () => true,
    isIndexOwner: async () => false,
    getOpportunity: async () => null,
    getOpportunitiesForUser: async () => [],
    updateOpportunityStatus: async () => null,
    updateOpportunityActorApproval: async () => null,
    getIntent: async () => null,
    getIntentIndexScores: async () => [],
    getNetworkMemberContext: async () => null,
    getOrCreateDM: async () => ({ id: 'conv-1' }),
  } as unknown as OpportunityGraphDatabase;

  const mockEmbedder = {
    generate: async () => dummyEmbedding,
    search: async () => [],
    searchWithHydeEmbeddings: async () => ([{
      type: 'intent' as const,
      id: 'intent-candidate' as Id<'intents'>,
      userId: 'u-candidate',
      score: 0.9,
      matchedVia: 'mirror' as const,
      networkId: 'idx-1',
    }]),
    searchWithProfileEmbedding: async () => [],
  } as unknown as Embedder;

  const mockHyde = {
    invoke: async () => ({
      hydeEmbeddings: { mirror: dummyEmbedding, reciprocal: dummyEmbedding },
    }),
  };

  const evaluatorResult: EvaluatedOpportunityWithActors[] = [{
    reasoning: 'mock',
    score: 88,
    actors: [
      { userId: 'u-source', role: 'patient' as const, intentId: null },
      { userId: 'u-candidate', role: 'agent' as const, intentId: null },
    ],
  }];

  const mockEvaluator = { invokeEntityBundle: async () => evaluatorResult };

  // Negotiation graph: hang forever if requested, or return a real outcome + messages.
  const mockNegotiationGraph = {
    invoke: opts.hangNegotiationForever
      ? () => new Promise(() => { /* never resolves */ })
      : async (_input: unknown) => ({
          outcome: {
            hasOpportunity: true,
            agreedRoles: [
              { userId: 'u-source', role: 'peer' as const },
              { userId: 'u-candidate', role: 'peer' as const },
            ],
            reasoning: 'test outcome',
            turnCount: 2,
          },
          messages: [
            {
              id: 'm1',
              senderId: 'agent:u-source',
              role: 'agent' as const,
              parts: [{ kind: 'data' as const, data: {
                action: 'propose' as const,
                assessment: { reasoning: 'first turn', suggestedRoles: { ownUser: 'peer' as const, otherUser: 'peer' as const } },
              } }],
              createdAt: new Date(),
            },
            {
              id: 'm2',
              senderId: 'agent:u-candidate',
              role: 'agent' as const,
              parts: [{ kind: 'data' as const, data: {
                action: 'accept' as const,
                assessment: { reasoning: 'agreed', suggestedRoles: { ownUser: 'peer' as const, otherUser: 'peer' as const } },
              } }],
              createdAt: new Date(),
            },
          ],
        }),
  };

  return new OpportunityGraphFactory(
    mockDb,
    mockEmbedder,
    mockHyde as never,
    mockEvaluator,
    async () => undefined,
    mockNegotiationGraph as never,
  );
}

describe('opportunity graph: negotiateTimeoutMs', () => {
  test('returns within the budget with a timed_out trace when negotiateCandidates hangs', async () => {
    const factory = makeFactory({ hangNegotiationForever: true });
    const graph = factory.createGraph();

    const start = Date.now();
    const result = await graph.invoke({
      userId: 'u-source' as Id<'users'>,
      searchQuery: 'find me a co-founder',
      options: { negotiateTimeoutMs: 50 },
    });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(2000); // budget + slack for prep/scope/persist
    const negotiateTrace = (result.trace ?? []).find((t) => t.node === 'negotiate');
    expect(negotiateTrace).toBeDefined();
    expect(negotiateTrace?.detail).toBe('timed_out');
    expect(negotiateTrace?.data).toMatchObject({ negotiateTimeoutMs: 50 });
  });

  test('returns the normal trace shape when negotiate finishes before the budget', async () => {
    const factory = makeFactory({ hangNegotiationForever: false });
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: 'u-source' as Id<'users'>,
      searchQuery: 'find me a co-founder',
      options: { negotiateTimeoutMs: 5_000 },
    });

    const negotiateTrace = (result.trace ?? []).find((t) => t.node === 'negotiate');
    expect(negotiateTrace).toBeDefined();
    expect(negotiateTrace?.detail).not.toBe('timed_out');
  });

  test('negotiateNode populates discoveryNegotiations and discoverySummary on the state', async () => {
    // Verifies the mapping from negotiation resolutions → discoveryNegotiations/discoverySummary
    // so downstream question-generation can consume negotiation context.
    //
    // Determinism guarantee: resolutions are accumulated via an async per-candidate hook that
    // fires in completion order (non-deterministic across runs). The negotiate node sorts them
    // by their original candidate-list index before building discoveryNegotiations, so the LLM
    // always sees negotiations in a stable, candidate-order sequence regardless of timing.
    const factory = makeFactory({ hangNegotiationForever: false });
    const graph = factory.createGraph();

    const result = await graph.invoke({
      userId: 'u-source' as Id<'users'>,
      searchQuery: 'find me a co-founder',
      options: { negotiateTimeoutMs: 5_000 },
    });

    // discoveryNegotiations: one entry per resolved candidate
    const negs = result.discoveryNegotiations ?? [];
    expect(negs.length).toBeGreaterThanOrEqual(1);

    // Verify the captured record carries through correctly.
    const first = negs[0];
    expect(first.counterpartyId).toBeDefined();
    // counterpartyId must match u-candidate (the only candidate in the fixture),
    // confirming candidate-list order is preserved.
    expect(first.counterpartyId).toBe('u-candidate');
    expect(first.outcome.hasOpportunity).toBe(true);
    expect(first.outcome.reasoning).toBe('test outcome');
    expect(first.turns.length).toBeGreaterThanOrEqual(1);
    expect(first.turns[0].action).toBe('propose');
    expect(first.turns[first.turns.length - 1].action).toBe('accept');

    // And the aggregate summary
    const summary = result.discoverySummary;
    expect(summary).not.toBeNull();
    expect(summary?.totalCandidates).toBe(negs.length);
    expect(summary?.opportunitiesFound).toBeGreaterThanOrEqual(1);
  });
});
