import { config } from 'dotenv';
config({ path: '.env.test' });
process.env.OPENROUTER_API_KEY ??= 'test';

import { describe, test, expect } from 'bun:test';
import { OpportunityGraphFactory } from '../opportunity.graph.js';
import type { Id } from '../../types/common.types.js';
import type {
  OpportunityGraphDatabase,
  Opportunity,
} from '../../shared/interfaces/database.interface.js';
import type { Embedder } from '../../shared/interfaces/embedder.interface.js';
import type { OpportunityEvaluatorLike } from '../opportunity.graph.js';

const mockEvaluator: OpportunityEvaluatorLike = { invokeEntityBundle: async () => [] };
const dummyEmbedder = {
  generate: async () => [],
  search: async () => [],
  searchWithHydeEmbeddings: async () => [],
  searchWithProfileEmbedding: async () => [],
} as unknown as Embedder;
const dummyHyde = { invoke: async () => ({ hydeEmbeddings: { mirror: [], reciprocal: [] } }) };

const USER_ID = 'u0000000-0000-4000-8000-000000000001' as Id<'users'>;
const COUNTERPART_ID = 'u0000000-0000-4000-8000-000000000002' as Id<'users'>;
const OPP_ID = 'op000000-0000-4000-8000-000000000001';
const NET_ID = 'net00000-0000-4000-8000-000000000001' as Id<'networks'>;

function buildDb(overrides: Partial<OpportunityGraphDatabase>): OpportunityGraphDatabase {
  return {
    getProfile: async () => null,
    createOpportunity: async () => ({}) as unknown as Opportunity,
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
    ...overrides,
  } as OpportunityGraphDatabase;
}

describe('opportunity graph — update node self-accept guard', () => {
  test('blocks self-accept when caller has actedAt set on their actor', async () => {
    const oppWithSenderStamped = {
      id: OPP_ID,
      status: 'pending',
      actors: [
        { userId: USER_ID, role: 'patient', networkId: NET_ID, actedAt: '2026-05-12T10:00:00.000Z' },
        { userId: COUNTERPART_ID, role: 'agent', networkId: NET_ID },
      ],
      detection: { source: 'manual' },
      interpretation: { reasoning: '', confidence: 1 },
      context: {},
      confidence: 1,
      createdAt: new Date(), updatedAt: new Date(), expiresAt: null,
    } as unknown as Opportunity;

    let stampCalled = false;
    const db = buildDb({
      getOpportunity: async () => oppWithSenderStamped,
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
    expect(result.mutationResult?.error).toMatch(/already acted/i);
    expect(stampCalled).toBe(false);
  });

  test('allows counterparty to accept when their actedAt is unset', async () => {
    const oppPending = {
      id: OPP_ID,
      status: 'pending',
      actors: [
        { userId: USER_ID, role: 'patient', networkId: NET_ID, actedAt: '2026-05-12T10:00:00.000Z' },
        { userId: COUNTERPART_ID, role: 'agent', networkId: NET_ID },
      ],
      detection: { source: 'manual' },
      interpretation: { reasoning: '', confidence: 1 },
      context: {},
      confidence: 1,
      createdAt: new Date(), updatedAt: new Date(), expiresAt: null,
    } as unknown as Opportunity;

    let stampCall: { actorUserId: string; status: string; acceptedBy?: string } | null = null;
    const db = buildDb({
      getOpportunity: async () => oppPending,
      stampOpportunityActorAction: async (_id, actorUserId, status, acceptedBy) => {
        stampCall = { actorUserId, status, acceptedBy };
        return { ...oppPending, status: 'accepted' } as unknown as Opportunity;
      },
    });

    const graph = new OpportunityGraphFactory(db, dummyEmbedder, dummyHyde, mockEvaluator, async () => undefined).createGraph();
    const result = await graph.invoke({
      userId: COUNTERPART_ID,
      operationMode: 'update' as const,
      opportunityId: OPP_ID,
      newStatus: 'accepted',
    });

    expect(result.mutationResult?.success).toBe(true);
    expect(stampCall).toEqual({ actorUserId: COUNTERPART_ID, status: 'accepted', acceptedBy: COUNTERPART_ID });
  });

  test('rejecting (newStatus=rejected) does not require unset actedAt', async () => {
    // A patient should still be able to revoke/reject after sending. Reject is not "accept";
    // the self-accept guard targets only the accepted transition.
    const oppPending = {
      id: OPP_ID,
      status: 'pending',
      actors: [
        { userId: USER_ID, role: 'patient', networkId: NET_ID, actedAt: '2026-05-12T10:00:00.000Z' },
        { userId: COUNTERPART_ID, role: 'agent', networkId: NET_ID },
      ],
      detection: { source: 'manual' },
      interpretation: { reasoning: '', confidence: 1 },
      context: {},
      confidence: 1,
      createdAt: new Date(), updatedAt: new Date(), expiresAt: null,
    } as unknown as Opportunity;

    const db = buildDb({
      getOpportunity: async () => oppPending,
      updateOpportunityStatus: async () => oppPending,
    });

    const graph = new OpportunityGraphFactory(db, dummyEmbedder, dummyHyde, mockEvaluator, async () => undefined).createGraph();
    const result = await graph.invoke({
      userId: USER_ID,
      operationMode: 'update' as const,
      opportunityId: OPP_ID,
      newStatus: 'rejected',
    });

    expect(result.mutationResult?.success).toBe(true);
  });
});
