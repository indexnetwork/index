/**
 * Capability-narrowed views of {@link Database}.
 *
 * Graphs depend on these rather than the whole port so a graph's data reach is
 * visible in one line.
 */

import type { NegotiationContextDatabase } from './negotiation.js';
import type { Database } from '../database.js';


/**
 * Composite database interface for a tool composition that reaches every
 * subgraph (OpportunityGraph, IntentGraph, NetworkGraph).
 *
 * Access layer: Both UserDatabase + SystemDatabase (orchestrates all operations)
 */
export type CompositeToolDatabase = Pick<
  Database,
  | 'getProfile'
  // The MCP discovery path builds an OpportunityGraph too, and its terminal
  // stage opens the pairs it scored.
  | 'openCounterparties'
  | 'getActiveIntents'
  | 'getActiveIntentsAcrossNetworks'
  | 'getIntentsInNetworkForMember'
  | 'getUser'
  | 'updateUser'
  | 'getUserSocials'
  | 'setUserSocials'
  | 'saveProfile'
  // IntentGraph subgraph requirements (getActiveIntents already included)
  | 'createIntent'
  | 'updateIntent'
  | 'archiveIntent'
  | 'deleteIntentNetworkAssociations'
  | 'expireOpportunitiesByIntentActor'
  | 'transitionIntentLifecycle'
  | 'compensateFailedResume'
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
  | 'stampOpportunityActorAction'
  | 'getOrCreateDM'
  // HyDE graph (used by OpportunityGraph)
  | 'getHydeDocument'
  | 'getHydeDocumentsForSource'
  | 'saveHydeDocument'
  | 'getIntent'
  // NetworkGraph subgraph requirements (assign created intents to user's networks)
  | 'getPublicNetworksNotJoined'
  | 'getUserNetworkIds'
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
  | 'isIntentAssignedToNetwork'
  | 'assignIntentToNetwork'
  | 'assignIntentToNetworkIfMember'
  | 'unassignIntentFromNetwork'
  | 'getNetworkIdsForIntent'
  | 'getIntentNetworkScores'
  // Network Ownership Operations (owner-only)
  | 'getOwnedNetworks'
  | 'isNetworkOwner'
  | 'isNetworkMember'
  | 'getNetworkMembersForOwner'
  | 'getNetworkMembersForMember'
  | 'getMembersFromUserNetworks'
  | 'getNetworkIntentsForOwner'
  | 'getNetworkIntentsForMember'
  | 'updateNetworkSettings'
  | 'softDeleteNetwork'
  | 'deleteProfile'
  | 'getProfileByUserId'
  | 'createNetwork'
  | 'getNetworkMemberCount'
  | 'addMemberToNetwork'
  | 'removeMemberFromNetwork'
  // User context text for discovery in OpportunityGraph
  | 'getUserContext'
  | 'searchIntentsByContextEmbedding'
> & NegotiationContextDatabase;

/**
 * Database interface for Opportunity Graph operations.
 * Includes prep/scope (network membership, intents, network details), persist (create, dedupe),
 * and CRUD operations (read, update status, send).
 *
 * Access layer: SystemDatabase (cross-user opportunity operations)
 */
export type OpportunityGraphDatabase = Pick<
  Database,
  | 'getProfile'
  | 'openCounterparties'
  | 'createOpportunity'
  | 'createOpportunityIfNetworkEligible'
  | 'createOpportunityAndExpireIdsIfNetworkEligible'
  | 'persistIntentScopedOpportunityIfNetworkEligible'
  | 'updateOpportunityStatusIfNetworkEligible'
  | 'opportunityExistsBetweenActors'
  | 'findOpportunitiesByActors'
  | 'getUserNetworkIds'
  | 'getNetworkMemberships'
  | 'getActiveNetworkMembershipPairs'
  | 'getActiveIntents'
  | 'getNetworkIdsForIntent'
  | 'getNetwork'
  | 'getNetworkMemberCount'
  | 'getIntentNetworkScores'
  | 'getNetworkMemberContext'
  | 'getNetworkAssignmentContext'
  // Read/update/send modes
  | 'getOpportunity'
  | 'getOpportunitiesForUser'
  | 'updateOpportunityStatus'
  | 'stampOpportunityActorAction'
  | 'isNetworkMember'
  | 'isNetworkOwner'
  | 'getUser'
  | 'getOrCreateDM'
  // Load candidate intent payload/summary for evaluator
  | 'getIntent'
  // User context text for discovery
  | 'getUserContext'
  | 'searchIntentsByContextEmbedding'
  // HyDE documents for HyDE search
  | 'getHydeDocumentsForSource'
  // IND-567: Rejection cool-down (optional — adapters may omit)
  | 'getRecentlyRejectedOpportunityCounterparties'
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
  | 'isNetworkOwner'
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
  // Self-accept guard + actedAt stamping on service-layer status flips.
  | 'stampOpportunityActorAction'
>;

/**
 * Database interface narrowed for Intent Graph operations.
 * Provides state population (getActiveIntents), action execution (create/update/archive),
 * and read operations (query intents; getIntentsInNetworkForMember for network-scoped reads).
 *
 * Access layer: UserDatabase (mutations on own intents) + SystemDatabase (network-scoped reads)
 */
export type IntentGraphDatabase = Pick<
  Database,
  | 'getActiveIntents'
  | 'getActiveIntentsAcrossNetworks'
  | 'getIntentsInNetworkForMember'
  | 'createIntent'
  | 'updateIntent'
  | 'archiveIntent'
  // Read mode (queryNode) requirements
  | 'isNetworkMember'
  | 'getNetworkIntentsForMember'
  | 'getUser'
  // Create action links the new intent to exactly the networks the caller named.
  | 'assignIntentToNetworkIfMember'
  // Archive action's full cleanup (network associations, referencing opportunities)
  | 'deleteIntentNetworkAssociations'
  | 'expireOpportunitiesByIntentActor'
  // Status transition action (pause/resume)
  | 'transitionIntentLifecycle'
  | 'compensateFailedResume'
>;

/**
 * Database interface narrowed for Network Graph CRUD operations.
 * Handles create, read, update, delete of networks (communities).
 *
 * Access layer: UserDatabase (CRUD on own networks and memberships)
 */
export type NetworkGraphDatabase = Pick<
  Database,
  | 'getNetworkMemberships'
  | 'getOwnedNetworks'
  | 'getPublicNetworksNotJoined'
  | 'isNetworkOwner'
  | 'isNetworkMember'
  | 'getNetwork'
  | 'createNetwork'
  | 'addMemberToNetwork'
  | 'updateNetworkSettings'
  | 'softDeleteNetwork'
  | 'getNetworkMemberCount'
>;

/**
 * Database interface narrowed for Intent Network Graph operations.
 * Provides intent/network context and assignment for intent–network evaluation.
 * (Migrated from the old NetworkGraphDatabase.)
 *
 * Access layer: UserDatabase (own intent assignment) + SystemDatabase (network context)
 */
export type IntentNetworkGraphDatabase = Pick<
  Database,
  | 'getIntentForIndexing'
  | 'getNetworkMemberContext'
  | 'getNetworkAssignmentContext'
  | 'getNetwork'
  | 'isIntentAssignedToNetwork'
  | 'assignIntentToNetworkIfMember'
  | 'unassignIntentFromNetwork'
  | 'getIntent'
  | 'isNetworkMember'
  | 'isNetworkOwner'
  | 'getNetworkIdsForIntent'
  | 'getNetworkIntentsForMember'
  | 'getIntentsInNetworkForMember'
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
  | 'isNetworkOwner'
  | 'getNetworkWithPermissions'
  | 'addMemberToNetwork'
  | 'removeMemberFromNetwork'
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
 * Load opportunities, enrich with profile/network, and support presenter context.
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
> & NegotiationContextDatabase;
