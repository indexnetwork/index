import { config } from "dotenv";
config({ path: '.env.test', override: true });
process.env.OPENROUTER_API_KEY ??= 'test';

import { describe, test, expect } from 'bun:test';
import { OpportunityGraphFactory } from '../opportunity.graph.js';
import type { Id } from '../../types/common.types.js';
import type { OpportunityGraphDatabase, OpportunityActor } from '../../shared/interfaces/database.interface.js';
import type { Embedder } from '../../shared/interfaces/embedder.interface.js';
import type { EvaluatedOpportunityWithActors } from '../opportunity.evaluator.js';

/**
 * IND-396 — the negotiate node stamps `initiatorUserId` for every fresh
 * discovery origin. All origins resolve to `onBehalfOfUserId ?? userId`:
 *   - chat/tool/MCP fan-out → querying user (userId)
 *   - from-intent          → intent owner (userId)
 *   - from-enrichment / discovery-run → surfaced user (userId)
 *   - from-introducer      → represented user (onBehalfOfUserId)
 * The stamp rides `negotiateCandidates` opts into the negotiation graph input.
 */

const dummyEmbedding = new Array(2000).fill(0.1);

function makeFactory() {
  const negotiationInputs: Array<Record<string, unknown>> = [];

  const persistedOpp = {
    id: 'opp-init-1',
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
    createOpportunityIfNetworkEligible: async () => persistedOpp,
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
    getActiveNetworkMembershipPairs: async (pairs: Array<{ userId: string; networkId: string }>) => pairs,
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
    updateOpportunityStatusIfNetworkEligible: async () => null,
    updateOpportunityActorApproval: async () => null,
    getIntent: async () => null,
    getIntentIndexScores: async () => [],
    getNetworkMemberContext: async () => null,
    getOrCreateDM: async () => ({ id: 'conv-1' }),
    getNegotiationTaskForOpportunity: async () => null,
    stampOpportunityActorAction: async () => null,
    getPremisesForUser: async () => [],
    searchPremisesBySimilarity: async () => [],
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

  const mockNegotiationGraph = {
    invoke: async (input: Record<string, unknown>) => {
      negotiationInputs.push(input);
      return {
        outcome: {
          hasOpportunity: false,
          agreedRoles: [],
          reasoning: 'no deal',
          turnCount: 1,
        },
        messages: [],
      };
    },
  };

  const factory = new OpportunityGraphFactory(
    mockDb,
    mockEmbedder,
    mockHyde as never,
    mockEvaluator,
    async () => undefined,
    mockNegotiationGraph as never,
  );

  return { factory, negotiationInputs };
}

describe('opportunity graph: negotiate node initiator stamp (IND-396)', () => {
  test('fresh discovery: initiatorUserId = querying user (chat/tool/MCP, from-intent, from-enrichment)', async () => {
    const { factory, negotiationInputs } = makeFactory();
    const graph = factory.createGraph();

    await graph.invoke({
      userId: 'u-source' as Id<'users'>,
      searchQuery: 'find me a co-founder',
      options: {},
    });

    expect(negotiationInputs.length).toBeGreaterThanOrEqual(1);
    expect(negotiationInputs[0].initiatorUserId).toBe('u-source');
    expect((negotiationInputs[0].sourceUser as { id: string }).id).toBe('u-source');
  });

  test('introducer flow: initiatorUserId = represented user (onBehalfOfUserId), not the introducer', async () => {
    const { factory, negotiationInputs } = makeFactory();
    const graph = factory.createGraph();

    await graph.invoke({
      userId: 'u-introducer' as Id<'users'>,
      onBehalfOfUserId: 'u-source' as Id<'users'>,
      searchQuery: 'find me a co-founder',
      options: {},
    });

    expect(negotiationInputs.length).toBeGreaterThanOrEqual(1);
    expect(negotiationInputs[0].initiatorUserId).toBe('u-source');
  });
});
