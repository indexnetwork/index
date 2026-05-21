import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, test, expect } from 'bun:test';
import { OpportunityGraphFactory } from '../opportunity.graph.js';
import type { Id } from '../../types/common.types.js';
import type {
  OpportunityGraphDatabase,
  Opportunity,
} from '../../shared/interfaces/database.interface.js';
import type { Embedder } from '../../shared/interfaces/embedder.interface.js';
import type { OpportunityEvaluatorLike } from '../opportunity.graph.js';

const mockEvaluator: OpportunityEvaluatorLike = {
  invokeEntityBundle: async () => [],
};

const dummyEmbedder = {
  generate: async () => [],
  search: async () => [],
  searchWithHydeEmbeddings: async () => [],
  searchWithProfileEmbedding: async () => [],
} as unknown as Embedder;

const dummyHyde = {
  invoke: async () => ({ hydeEmbeddings: { mirror: [], reciprocal: [] } }),
};

function buildDb(overrides: Partial<OpportunityGraphDatabase>): OpportunityGraphDatabase {
  const base: OpportunityGraphDatabase = {
    getProfile: async () => null,
    createOpportunity: async (data) => ({
      ...data,
      id: 'opp-1',
      status: 'pending' as const,
      createdAt: new Date(),
      updatedAt: new Date(),
      expiresAt: null,
    }),
    opportunityExistsBetweenActors: async () => false,
    findOpportunitiesByActors: async () => [],
    getUserIndexIds: async () => [] as Id<'networks'>[],
    getNetworkMemberships: async () => [],
    getActiveIntents: async () => [],
    getNetworkIdsForIntent: async () => [],
    getNetwork: async () => null,
    getNetworkMemberCount: async () => 0,
    getIntentIndexScores: async () => [],
    getNetworkMemberContext: async () => null,
    getOpportunity: async () => null,
    getOpportunitiesForUser: async () => [],
    updateOpportunityStatus: async () => null,
    stampOpportunityActorAction: async () => null,
    updateOpportunityActorApproval: async () => null,
    isNetworkMember: async () => true,
    isIndexOwner: async () => false,
    getUser: async (id) => ({ id, name: 'Test', email: 'test@example.com' }),
    getOrCreateDM: async () => ({ id: 'conv-default' }),
    getIntent: async () => null,
  };
  return { ...base, ...overrides };
}

const USER_ID = 'u0000000-0000-4000-8000-000000000001' as Id<'users'>;
const COUNTERPART_ID = 'u0000000-0000-4000-8000-000000000002' as Id<'users'>;
const OPP_ID = 'op000000-0000-4000-8000-000000000001';
const CONV_ID = 'conv0000-0000-4000-8000-000000000001';
const NET_ID = 'net00000-0000-4000-8000-000000000001' as Id<'networks'>;

const mockOpportunity = {
  id: OPP_ID,
  status: 'pending',
  actors: [
    { userId: USER_ID, role: 'party', networkId: NET_ID },
    { userId: COUNTERPART_ID, role: 'party', networkId: NET_ID },
  ],
  detection: { source: 'manual' },
  interpretation: { reasoning: '', confidence: 1 },
  context: {},
  confidence: 1,
  createdAt: new Date(),
  updatedAt: new Date(),
  expiresAt: null,
} as unknown as Opportunity;

describe('opportunity graph — update node (accepted)', () => {
  test('calls getOrCreateDM with userId and counterpart, returns conversationId', async () => {
    let dmCalledWith: [string, string] | null = null;

    const db = buildDb({
      getOpportunity: async () => mockOpportunity,
      stampOpportunityActorAction: async () => null,
      getOrCreateDM: async (a, b) => {
        dmCalledWith = [a, b];
        return { id: CONV_ID };
      },
    });

    const graph = new OpportunityGraphFactory(db, dummyEmbedder, dummyHyde, mockEvaluator, async () => undefined).createGraph();
    const result = await graph.invoke({
      userId: USER_ID,
      operationMode: 'update' as const,
      opportunityId: OPP_ID,
      newStatus: 'accepted',
    });

    expect(result.mutationResult?.success).toBe(true);
    expect(result.mutationResult?.conversationId).toBe(CONV_ID);
    expect(dmCalledWith).toEqual([USER_ID, COUNTERPART_ID]);
  });

  test('does NOT call getOrCreateDM when newStatus is rejected', async () => {
    let dmCalled = false;

    const db = buildDb({
      getOpportunity: async () => mockOpportunity,
      updateOpportunityStatus: async () => null,
      getOrCreateDM: async () => {
        dmCalled = true;
        return { id: CONV_ID };
      },
    });

    const graph = new OpportunityGraphFactory(db, dummyEmbedder, dummyHyde, mockEvaluator, async () => undefined).createGraph();
    const result = await graph.invoke({
      userId: USER_ID,
      operationMode: 'update' as const,
      opportunityId: OPP_ID,
      newStatus: 'rejected',
    });

    expect(result.mutationResult?.success).toBe(true);
    expect(result.mutationResult?.conversationId).toBeUndefined();
    expect(dmCalled).toBe(false);
  });

  test('does NOT flip status when getOrCreateDM throws', async () => {
    let stampCalled = false;

    const db = buildDb({
      getOpportunity: async () => mockOpportunity,
      getOrCreateDM: async () => {
        throw new Error('DM creation failed');
      },
      stampOpportunityActorAction: async () => {
        stampCalled = true;
        return null;
      },
    });

    const graph = new OpportunityGraphFactory(db, dummyEmbedder, dummyHyde, mockEvaluator, async () => undefined).createGraph();
    const result = await graph.invoke({
      userId: USER_ID,
      operationMode: 'update' as const,
      opportunityId: OPP_ID,
      newStatus: 'accepted',
    });

    expect(result.mutationResult?.success).toBe(false);
    expect(stampCalled).toBe(false);
  });
});
