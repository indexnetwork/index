import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, test, expect } from 'bun:test';
import { OpportunityGraphFactory } from '../opportunity.graph.js';
import type { Id, OpportunityGraphDatabase, Opportunity } from '../../../platform/database.js';
import type { Embedder } from '../../../platform/discovery/embedder.js';

const dummyEmbedder = {
  generate: async () => [], search: async () => [],
  searchWithHydeEmbeddings: async () => [],
} as unknown as Embedder;
const dummyHyde = { invoke: async () => ({ hydeEmbeddings: { mirror: [], reciprocal: [] } }) };

const USER_ID = 'u0000000-0000-4000-8000-000000000001' as Id<'users'>;
const COUNTERPART_ID = 'u0000000-0000-4000-8000-000000000002' as Id<'users'>;
const OPP_ID = 'op000000-0000-4000-8000-000000000001';
const NET_ID = 'net00000-0000-4000-8000-000000000001' as Id<'networks'>;

const mockOpportunity = {
  id: OPP_ID,
  status: 'draft',
  actors: [
    { userId: USER_ID, role: 'patient', networkId: NET_ID },
    { userId: COUNTERPART_ID, role: 'agent', networkId: NET_ID },
  ],
  detection: { source: 'manual' },
  interpretation: { reasoning: '', confidence: 1 },
  context: {},
  confidence: 1,
  createdAt: new Date(), updatedAt: new Date(), expiresAt: null,
} as unknown as Opportunity;

function buildDb(overrides: Partial<OpportunityGraphDatabase>): OpportunityGraphDatabase {
  return {
    getProfile: async () => null,
    createOpportunity: async () => mockOpportunity,
    opportunityExistsBetweenActors: async () => false,
    findOpportunitiesByActors: async () => [],
    getUserIndexIds: async () => [] as Id<'networks'>[],
    getNetworkMemberships: async () => [],
    getActiveNetworkMembershipPairs: async (pairs) => pairs,
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
    getUser: async (id) => ({ id, name: 'Test', email: 'test@example.com', socials: [] }),
    getOrCreateDM: async () => ({ id: 'conv-default' }),
    getIntent: async () => null,
    getNegotiationTaskForOpportunity: async () => null,
    ...overrides,
  } as OpportunityGraphDatabase;
}

describe('opportunity graph — send node stamps actedAt', () => {
  test('patient sending a draft calls stampOpportunityActorAction with their userId', async () => {
    let stampCall: { id: string; actorUserId: string; status: string } | undefined;
    let plainStatusUpdateCalled = false;

    const db = buildDb({
      getOpportunity: async () => mockOpportunity,
      stampOpportunityActorAction: async (id, actorUserId, status) => {
        stampCall = { id, actorUserId, status };
        return { ...mockOpportunity, status: 'pending' } as unknown as Opportunity;
      },
      updateOpportunityStatus: async () => {
        plainStatusUpdateCalled = true;
        return null;
      },
    });

    const operations = new OpportunityGraphFactory(db, dummyEmbedder, dummyHyde, undefined, async () => undefined);
    const result = await operations.sendOpportunity({
      userId: USER_ID,
      opportunityId: OPP_ID,
    });

    expect(result.mutationResult?.success).toBe(true);
    expect(stampCall).toEqual({ id: OPP_ID, actorUserId: USER_ID, status: 'pending' });
    expect(plainStatusUpdateCalled).toBe(false);
  });
});
