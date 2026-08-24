/**
 * Capability-narrowed views of {@link Database}.
 *
 * Graphs depend on these rather than the whole port so a graph's data reach is
 * visible in one line.
 */

import type { Opportunity } from './entities.js';
import type { NegotiationGraphDatabase } from './negotiation.js';
import type { Database } from '../database.js';
import type { SystemDatabase, UserDatabase } from './port.js';


/**
 * Database interface narrowed for Premise Graph operations.
 * Provides premise lifecycle: create, read, update, and network assignment.
 *
 * Access layer: UserDatabase (user's own premises)
 */
export type PremiseGraphDatabase = Pick<
  Database,
  'createPremise' | 'getPremise' | 'getPremisesForUser' | 'updatePremise' | 'assignPremiseToNetwork' | 'getPremiseNetworks' | 'getAssignmentNetworkMembershipsForUser' | 'getAssignmentNetworkIdsForUser' | 'getNetworkAssignmentContext' | 'getUserIndexIds' | 'getNetwork' | 'getNetworkMemberContext' | 'findSimilarActivePremise' | 'getUser' | 'updateUser'
>;

/**
 * Composite database interface for Chat Graph.
 * Includes direct ChatGraph operations plus all methods needed by
 * internally composed subgraphs (ProfileGraph, OpportunityGraph, IntentGraph, NetworkGraph).
 *
 * Use this type when ChatGraph orchestrates subgraphs internally.
 *
 * Access layer: Both UserDatabase + SystemDatabase (orchestrates all operations)
 */
export type ChatGraphCompositeDatabase = Pick<
  Database,
  // Direct ChatGraph operations
  | 'getProfile'
  | 'getActiveIntents'
  | 'getActiveIntentsAcrossIndexes'
  | 'getIntentsInIndexForMember'
  // ProfileGraph subgraph requirements
  | 'getUser'
  | 'updateUser'
  | 'getUserSocials'
  | 'setUserSocials'
  | 'saveProfile'
  // IntentGraph subgraph requirements (getActiveIntents already included)
  | 'createIntent'
  | 'updateIntent'
  | 'archiveIntent'
  | 'deleteIntentIndexAssociations'
  | 'expireOpportunitiesByIntentActor'
  | 'transitionIntentLifecycle'
  | 'compensateFailedResume'
  | 'getProposalForOwner'
  | 'revisePendingProposal'
  | 'confirmProposalIntent'
  // OpportunityGraph subgraph requirements (getProfile already included)
  | 'createOpportunity'
  | 'createOpportunityIfNetworkEligible'
  | 'createOpportunityAndExpireIdsIfNetworkEligible'
  | 'persistIntentScopedOpportunityIfNetworkEligible'
  | 'updateOpportunityStatusIfNetworkEligible'
  | 'getOpportunity'
  | 'getOpportunitiesByIds'
  | 'opportunityExistsBetweenActors'
  | 'findOpportunitiesByActors'
  | 'getOpportunitiesForUser'
  | 'updateOpportunityStatus'
  | 'updateOpportunityActorApproval'
  | 'stampOpportunityActorAction'
  | 'getOrCreateDM'
  // HyDE graph (used by OpportunityGraph)
  | 'getHydeDocument'
  | 'getHydeDocumentsForSource'
  | 'saveHydeDocument'
  | 'getIntent'
  // NetworkGraph subgraph requirements (index created intents in user's indexes)
  | 'getPublicIndexesNotJoined'
  | 'getUserIndexIds'
  | 'getAssignmentNetworkMembershipsForUser'
  | 'getAssignmentNetworkIdsForUser'
  | 'getNetworkMemberships'
  | 'getNetworkMembership'
  | 'getActiveNetworkMembershipPairs'
  | 'getNetwork'
  | 'getNetworkWithPermissions'
  | 'getIntentForIndexing'
  | 'getNetworkMemberContext'
  | 'getNetworkAssignmentContext'
  | 'isIntentAssignedToIndex'
  | 'assignIntentToNetwork'
  | 'assignIntentToNetworkIfMember'
  | 'unassignIntentFromIndex'
  | 'getNetworkIdsForIntent'
  | 'getIntentIndexScores'
  // Index Ownership Operations (owner-only)
  | 'getOwnedIndexes'
  | 'isIndexOwner'
  | 'isNetworkMember'
  | 'getNetworkMembersForOwner'
  | 'getNetworkMembersForMember'
  | 'getMembersFromUserIndexes'
  | 'getNetworkIntentsForOwner'
  | 'getNetworkIntentsForMember'
  | 'updateIndexSettings'
  | 'softDeleteNetwork'
  | 'deleteProfile'
  | 'getProfileByUserId'
  | 'createNetwork'
  | 'getNetworkMemberCount'
  | 'addMemberToNetwork'
  | 'removeMemberFromIndex'
  // ProfileGraph post-enrichment ghost deduplication
  // ProfileGraph aggregate mode (premise-to-profile materialization)
  // Premise lifecycle (CRUD + network assignment)
  | 'getPremisesForUser'
  | 'getPremisesForUserInNetworks'
  | 'createPremise'
  | 'getPremise'
  | 'updatePremise'
  | 'assignPremiseToNetwork'
  | 'getPremiseNetworks'
  // Premise-to-premise discovery (path D) in OpportunityGraph
  | 'searchPremisesBySimilarity'
  | 'searchPremisesBySimilarityBatch'
  // User context text for context-to-intent discovery in OpportunityGraph
  | 'getUserContext'
  | 'searchIntentsByContextEmbedding'
> & Pick<
  NegotiationGraphDatabase,
  // Orphan heal in OpportunityGraph persist node
  | 'getNegotiationTaskForOpportunity'
  // negotiateNode bumps the round once per (intentId) in a kickoff batch
  | 'bumpIntentNegotiationRound'
>;

/**
 * Database interface for Opportunity Graph operations.
 * Includes prep/scope (network membership, intents, index details), persist (create, dedupe),
 * and CRUD operations (read, update status, send).
 *
 * Access layer: SystemDatabase (cross-user opportunity operations)
 */
export type OpportunityGraphDatabase = Pick<
  Database,
  | 'getProfile'
  | 'createOpportunity'
  | 'createOpportunityIfNetworkEligible'
  | 'createOpportunityAndExpireIdsIfNetworkEligible'
  | 'persistIntentScopedOpportunityIfNetworkEligible'
  | 'updateOpportunityStatusIfNetworkEligible'
  | 'opportunityExistsBetweenActors'
  | 'findOpportunitiesByActors'
  | 'getUserIndexIds'
  | 'getNetworkMemberships'
  | 'getActiveNetworkMembershipPairs'
  | 'getActiveIntents'
  | 'getNetworkIdsForIntent'
  | 'getNetwork'
  | 'getNetworkMemberCount'
  | 'getIntentIndexScores'
  | 'getNetworkMemberContext'
  | 'getNetworkAssignmentContext'
  // Read/update/send modes
  | 'getOpportunity'
  | 'getOpportunitiesForUser'
  | 'updateOpportunityStatus'
  | 'stampOpportunityActorAction'
  | 'updateOpportunityActorApproval'
  | 'isNetworkMember'
  | 'isIndexOwner'
  | 'getUser'
  | 'getOrCreateDM'
  // Load candidate intent payload/summary for evaluator
  | 'getIntent'
  // IND-567 Fix A: fetch candidate premise text for evaluator (prevents empty-text query_premise false-positives)
  | 'getPremise'
  // Premise-to-premise discovery (path D)
  | 'getPremisesForUser'
  | 'getPremisesForUserInNetworks'
  | 'searchPremisesBySimilarity'
  | 'searchPremisesBySimilarityBatch'
  // User context text for context-to-intent discovery
  | 'getUserContext'
  | 'searchIntentsByContextEmbedding'
  // HyDE documents for context-to-intent HyDE search
  | 'getHydeDocumentsForSource'
  // IND-567: Rejection cool-down (optional — adapters may omit)
  | 'getRecentlyRejectedOpportunityCounterparties'
> & Pick<
  NegotiationGraphDatabase,
  // Orphan heal: check if a prior negotiating opportunity has a stale task
  | 'getNegotiationTaskForOpportunity'
  // negotiateNode bumps the round once per (intentId) in a kickoff batch and
  // passes it to every open() in that batch — a round is the batch, not one opportunity.
  | 'bumpIntentNegotiationRound'
>;
export interface OutcomeOutbox {
  event: unknown;
  actorResolution: 'selected_intent' | 'unique_owned_scope';
  result: { inserted: boolean };
}

export type OpportunityControllerDatabase = Pick<
  Database,
  | 'getOpportunity'
  | 'getOpportunitiesByIds'
  | 'findEnrichedReplacementOpportunities'
  | 'getOpportunitiesForUser'
  | 'getOpportunitiesForNetwork'
  | 'resolveOpportunityId'
  | 'updateOpportunityStatus'
  | 'createOpportunity'
  | 'createOpportunityAndExpireIds'
  | 'opportunityExistsBetweenActors'
  | 'findOpportunitiesByActors'
  | 'acceptSiblingOpportunities'
  | 'isIndexOwner'
  | 'isNetworkMember'
  | 'getUser'
  | 'getNetwork'
  | 'getNetworkMemberships'
  | 'getProfile'
  | 'getActiveIntents'
  // Start Chat endpoint (Plan B Task 8): atomic pair → conversation resolution
  // for the "Open h2h chat from this opportunity" flow. Kept on this interface
  // (rather than ConversationControllerDatabase) because the transition is
  // owned by OpportunityService — services cannot import other services.
  | 'getOrCreateDM'
  | 'unhideConversation'
  // Approve-introduction endpoint: flip introducer actor's approved flag.
  | 'updateOpportunityActorApproval'
  // Self-accept guard + actedAt stamping on service-layer status flips.
  | 'stampOpportunityActorAction'
>;

/**
 * Database interface narrowed for Intent Graph operations.
 * Provides state population (getActiveIntents), action execution (create/update/archive),
 * and read operations (query intents; getIntentsInIndexForMember for network-scoped reads).
 *
 * Access layer: UserDatabase (mutations on own intents) + SystemDatabase (network-scoped reads)
 */
export type IntentGraphDatabase = Pick<
  Database,
  | 'getActiveIntents'
  | 'getActiveIntentsAcrossIndexes'
  | 'getIntentsInIndexForMember'
  | 'createIntent'
  | 'updateIntent'
  | 'archiveIntent'
  // Read mode (queryNode) requirements
  | 'isNetworkMember'
  | 'getNetworkIntentsForMember'
  | 'getUser'
  // Global user_context paragraph, read to verify an owner-edited proposal.
  // Never used to rewrite a description: intents derive from what the user said.
  | 'getUserContext'
  | 'assignIntentToNetwork'
  // Archive action's full cleanup (network associations, referencing opportunities)
  | 'deleteIntentIndexAssociations'
  | 'expireOpportunitiesByIntentActor'
  // Status transition action (pause/resume)
  | 'transitionIntentLifecycle'
  | 'compensateFailedResume'
  // Confirm action (chat/MCP proposal → persisted intent). Ownership is
  // enforced by the proposal row itself (owner-scoped) and by the caller
  // for archive/transition, same as create/update today.
  | 'getProposalForOwner'
  | 'revisePendingProposal'
  | 'confirmProposalIntent'
>;

/**
 * Database interface narrowed for Network Graph CRUD operations.
 * Handles create, read, update, delete of indexes (communities).
 *
 * Access layer: UserDatabase (CRUD on own networks and memberships)
 */
export type NetworkGraphDatabase = Pick<
  Database,
  | 'getNetworkMemberships'
  | 'getOwnedIndexes'
  | 'getPublicIndexesNotJoined'
  | 'isIndexOwner'
  | 'isNetworkMember'
  | 'getNetwork'
  | 'createNetwork'
  | 'addMemberToNetwork'
  | 'updateIndexSettings'
  | 'softDeleteNetwork'
  | 'getNetworkMemberCount'
>;

/**
 * Database interface narrowed for Intent Index Graph operations.
 * Provides intent/index context and assignment for intent–index evaluation.
 * (Migrated from the old NetworkGraphDatabase.)
 *
 * Access layer: UserDatabase (own intent assignment) + SystemDatabase (index context)
 */
export type IntentNetworkGraphDatabase = Pick<
  Database,
  | 'getIntentForIndexing'
  | 'getNetworkMemberContext'
  | 'getNetworkAssignmentContext'
  | 'getNetwork'
  | 'isIntentAssignedToIndex'
  | 'assignIntentToNetworkIfMember'
  | 'unassignIntentFromIndex'
  | 'getIntent'
  | 'isNetworkMember'
  | 'isIndexOwner'
  | 'getNetworkIdsForIntent'
  | 'getNetworkIntentsForMember'
  | 'getIntentsInIndexForMember'
>;

/**
 * Database interface narrowed for Network Membership Graph operations.
 * Handles CRUD for network memberships (add, list, remove members).
 *
 * Access layer: SystemDatabase (cross-user membership operations)
 */
export type NetworkMembershipGraphDatabase = Pick<
  Database,
  | 'isNetworkMember'
  | 'isIndexOwner'
  | 'getNetworkWithPermissions'
  | 'addMemberToNetwork'
  | 'removeMemberFromIndex'
  | 'getNetworkMembersForMember'
>;

/**
 * Database interface narrowed for HyDE Graph operations.
 * Provides HyDE document CRUD and intent lookup for refresh.
 *
 * Access layer: UserDatabase (own HyDE) + SystemDatabase (cross-user matching)
 */
export type HydeGraphDatabase = Pick<
  Database,
  'getHydeDocument' | 'getHydeDocumentsForSource' | 'saveHydeDocument' | 'getIntent'
>;

/**
 * Database interface for Radar Graph (opportunity radar view).
 * Load opportunities, enrich with profile/index, and support presenter context.
 *
 * Access layer: UserDatabase (own opportunities and profile)
 */
export type RadarGraphDatabase = Pick<
  Database,
  | 'getOpportunitiesForUser'
  | 'getOpportunity'
  | 'getProfile'
  | 'getActiveIntents'
  | 'getNetwork'
  | 'getUser'
> & Pick<
  NegotiationGraphDatabase,
  | 'getNegotiationTaskForOpportunity'
  | 'getNegotiationMessages'
  | 'getArtifactsForTask'
>;
