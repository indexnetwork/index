import type { Opportunity, OpportunityGraphDatabase } from '../../shared/interfaces/database.interface.js';

/**
 * Provider-free defaults for graph tests that exercise only one workflow path.
 * Individual tests override the methods whose result is part of their contract.
 */
export function createOpportunityGraphDatabaseFixture(): OpportunityGraphDatabase {
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
    getProfile: async () => null,
    createOpportunity: async (data) => ({ ...emptyOpportunity('fixture-opportunity'), ...data }),
    createOpportunityIfNetworkEligible: async () => null,
    createOpportunityAndExpireIdsIfNetworkEligible: async () => null,
    persistIntentScopedOpportunityIfNetworkEligible: async () => null,
    updateOpportunityStatusIfNetworkEligible: async () => null,
    opportunityExistsBetweenActors: async () => false,
    findOpportunitiesByActors: async () => [],
    getUserIndexIds: async () => [],
    getNetworkMemberships: async () => [],
    getActiveNetworkMembershipPairs: async (pairs) => pairs,
    getActiveIntents: async () => [],
    getNetworkIdsForIntent: async () => [],
    getNetwork: async () => null,
    getNetworkMemberCount: async () => 0,
    getIntentIndexScores: async () => [],
    getNetworkMemberContext: async () => null,
    getNetworkAssignmentContext: async () => null,
    getOpportunity: async () => null,
    getOpportunitiesForUser: async () => [],
    updateOpportunityStatus: async () => null,
    compensateTasklessNegotiatingOpportunity: async () => null,
    stampOpportunityActorAction: async () => null,
    updateOpportunityActorApproval: async () => null,
    isNetworkMember: async () => false,
    isIndexOwner: async () => false,
    getUser: async () => null,
    getOrCreateDM: async () => ({ id: 'fixture-conversation' }),
    getIntent: async () => null,
    getPremisesForUser: async () => [],
    getPremisesForUserInNetworks: async () => [],
    searchPremisesBySimilarity: async () => [],
    searchPremisesBySimilarityBatch: async () => [],
    getUserContext: async () => null,
    getUserContexts: async () => [],
    searchIntentsByContextEmbedding: async () => [],
    getHydeDocumentsForSource: async () => [],
    getNegotiationTaskForOpportunity: async () => null,
  };
}
