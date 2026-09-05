/**
 * The database port itself, plus the two access-scoped views over it.
 *
 * `Database` is the union of the four query groups; splitting it into composed
 * interfaces keeps each group readable without changing the type one bit —
 * every `Pick<Database, ...>` alias still resolves exactly as before.
 */

import type { UserIdentity } from '../../protocol/schemas/identity.schema.js';
import type { NetworkAssignmentMetadata } from '../../protocol/schemas/network-assignment.schema.js';
import type { ActiveIntent, ArchiveResult, CreateHydeDocumentData, CreateIntentData, CreateOpportunityData, CreatedIntent, HydeDocument, HydeSourceType, Id, IntentRecord, NetworkAssignmentContext, NetworkIntentDetails, NetworkMemberDetails, NetworkMembership, OnboardingState, Opportunity, OpportunityQueryOptions, OpportunityStatus, OwnedNetwork, SimilarIntent, SimilarIntentSearchOptions, UpdateIntentData, UpdateNetworkSettingsData, UserRecord, UserSocial } from './entities.js';
// ═══════════════════════════════════════════════════════════════════════════════
// USER DATABASE INTERFACE (Own Resources Only)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Context-bound database for accessing the authenticated user's own resources.
 * Created with authUserId bound at construction; no userId parameter needed on methods.
 *
 * **NOT network-scoped**: Returns ALL of the user's own resources regardless of network.
 * This is critical for the IntentReconciler which needs the full picture for deduplication.
 *
 * Use via `createUserDatabase(db, authUserId)` factory function.
 */
export interface UserDatabase {
  /** The bound authenticated user ID */
  readonly authUserId: string;

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile Operations (own only)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get the authenticated user's profile. */
  getProfile(): Promise<UserIdentity | null>;

  /** Get the authenticated user's profile with row ID. */
  getProfileByUserId(): Promise<(UserIdentity & { id: string }) | null>;

  /** Save/update the authenticated user's profile. */
  saveProfile(profile: UserIdentity): Promise<void>;

  /** Delete the authenticated user's profile. */
  deleteProfile(): Promise<void>;

  /** Get the authenticated user's basic record (name, email, socials). */
  getUser(): Promise<UserRecord | null>;

  /** Update the authenticated user's account fields. */
  updateUser(data: { name?: string; intro?: string; location?: string; onboarding?: OnboardingState }): Promise<UserRecord | null>;

  getUserSocials(): Promise<UserSocial[]>;
  setUserSocials(socials: { label: string; value: string }[]): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Intent Operations (own only, ALL intents - not network-scoped)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get ALL active intents for the authenticated user (not network-filtered). */
  getActiveIntents(): Promise<ActiveIntent[]>;

  /**
   * Case-insensitive substring search over the authenticated user's own
   * active intents. Matches against `payload` and `summary`. Most recent first.
   */
  searchOwnIntents(
    q: string,
    limit: number,
  ): Promise<Array<{ id: string; payload: string; summary: string | null; createdAt: Date }>>;

  /** Get a single intent by ID (ownership enforced). */
  getIntent(intentId: string): Promise<IntentRecord | null>;

  /** Create a new intent for the authenticated user. */
  createIntent(data: Omit<CreateIntentData, 'userId'>): Promise<CreatedIntent>;

  /** Update an intent owned by the authenticated user. */
  updateIntent(intentId: string, data: UpdateIntentData): Promise<CreatedIntent | null>;

  /** Archive an intent owned by the authenticated user. */
  archiveIntent(intentId: string): Promise<ArchiveResult>;

  /** Find similar intents among the user's own intents (for deduplication). */
  findSimilarIntents(embedding: number[], options?: SimilarIntentSearchOptions): Promise<SimilarIntent[]>;

  /** Get intent fields for network assignment (own intent). */
  getIntentForIndexing(intentId: string): Promise<{
    id: string;
    payload: string;
    userId: string;
    sourceType: string | null;
    sourceId: string | null;
  } | null>;

  /** Associate an intent with networks. */
  associateIntentWithNetworks(intentId: string, networkIds: string[]): Promise<void>;

  /** Assign an intent to a network. */
  assignIntentToNetwork(
    intentId: string,
    networkId: string,
    relevancyScore?: number,
    assignmentMetadata?: NetworkAssignmentMetadata,
  ): Promise<void>;

  /** Unassign an intent from a network. */
  unassignIntentFromNetwork(intentId: string, networkId: string): Promise<void>;

  /** Get network IDs for an intent. */
  getNetworkIdsForIntent(intentId: string): Promise<string[]>;

  /** Check if intent is assigned to network. */
  isIntentAssignedToNetwork(intentId: string, networkId: string): Promise<boolean>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Network Membership Operations (own memberships only)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get all network memberships for the authenticated user. */
  getNetworkMemberships(): Promise<NetworkMembership[]>;

  /** Get network IDs with auto-assign enabled for the authenticated user. */
  getUserNetworkIds(): Promise<string[]>;

  /** Get networks owned by the authenticated user. */
  getOwnedNetworks(): Promise<OwnedNetwork[]>;

  /** Get a specific network membership for the authenticated user. */
  getNetworkMembership(networkId: string): Promise<NetworkMembership | null>;

  /** Get network + member context for the authenticated user (for auto-assign). */
  getNetworkMemberContext(networkId: string): Promise<NetworkAssignmentContext | null>;

  /** Get network + member context for the authenticated user without auto-assign gating. */
  getNetworkAssignmentContext?(networkId: string): Promise<NetworkAssignmentContext | null>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Network CRUD Operations (owner operations on own networks)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Create a new network (user becomes owner). */
  createNetwork(data: {
    title: string;
    prompt?: string | null;
    imageUrl?: string | null;
    joinPolicy?: 'anyone' | 'invite_only';
  }): Promise<{
    id: string;
    title: string;
    prompt: string | null;
    imageUrl: string | null;
    permissions: { joinPolicy: 'anyone' | 'invite_only'; invitationLink: { code: string } | null };
  }>;

  /** Update network settings (owner only). */
  updateNetworkSettings(networkId: string, data: UpdateNetworkSettingsData): Promise<OwnedNetwork>;

  /** Soft-delete a network (owner only). */
  softDeleteNetwork(networkId: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Network Discovery (joinable networks the user is not a member of)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get public networks (joinPolicy 'anyone') that the user has not joined. */
  getPublicNetworksNotJoined(): Promise<{
    networks: Array<{
      id: string;
      title: string;
      prompt: string | null;
      memberCount: number;
      owner: { id: string; name: string; avatar: string | null } | null;
    }>;
  }>;

  /** Join a public network (validates joinPolicy === 'anyone'). */
  joinPublicNetwork(networkId: string): Promise<{ success: boolean; alreadyMember?: boolean }>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Opportunity Operations (where user is actor)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get opportunities where the authenticated user is an actor. */
  getOpportunitiesForUser(options?: OpportunityQueryOptions): Promise<Opportunity[]>;

  /** Get a specific opportunity (if user is an actor). */
  getOpportunity(id: string): Promise<Opportunity | null>;

  /** Update an opportunity's status (if user is an actor). acceptedBy is derived from the auth context. */
  updateOpportunityStatus(id: string, status: OpportunityStatus): Promise<Opportunity | null>;

  /** Accept sibling opportunities between the authenticated user and another actor. */
  acceptSiblingOpportunities(counterpartUserId: string, excludeOpportunityId: string): Promise<string[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // HyDE Operations (own sources only)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get a HyDE document for the user's own source. */
  getHydeDocument(sourceType: HydeSourceType, sourceId: string, strategy: string): Promise<HydeDocument | null>;

  /** Get all HyDE documents for the user's own source. */
  getHydeDocumentsForSource(sourceType: HydeSourceType, sourceId: string): Promise<HydeDocument[]>;

  /** Save a HyDE document for the user's own source. */
  saveHydeDocument(data: CreateHydeDocumentData): Promise<HydeDocument>;

  /** Delete HyDE documents for the user's own source. */
  deleteHydeDocumentsForSource(sourceType: HydeSourceType, sourceId: string): Promise<number>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SYSTEM DATABASE INTERFACE (Cross-User Within Shared Networks)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Context-bound database for LLM/system operations that access cross-user resources.
 * Created with authUserId + networkScope[]; validates membership before access.
 *
 * **Network-scoped**: All cross-user operations are restricted to users/resources
 * within the bound networkScope[]. This prevents the LLM from accessing arbitrary users' data.
 *
 * Use via `createSystemDatabase(db, authUserId, networkScope)` factory function.
 */
export interface SystemDatabase {
  /** The bound authenticated user ID */
  readonly authUserId: string;

  /** The networks the authenticated user has access to (determines cross-user scope) */
  readonly networkScope: string[];

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile Operations (any user in scope)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get a user's profile (requires shared network membership). */
  getProfile(userId: string): Promise<UserIdentity | null>;

  /** Get a user's basic record (requires shared network membership). */
  getUser(userId: string): Promise<UserRecord | null>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Intent Operations (cross-user within shared networks)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get all intents in a network (cross-user, requires membership). */
  getIntentsInNetwork(networkId: string, options?: { limit?: number; offset?: number }): Promise<NetworkIntentDetails[]>;

  /** Get a specific user's intents in a network (requires shared membership). */
  getUserIntentsInNetwork(userId: string, networkId: string): Promise<ActiveIntent[]>;

  /**
   * Get the caller's own active intents across a set of networks.
   * Returns intents owned by `userId` that are linked (via intent_networks)
   * to at least one of `networkIds`. Used by network-scoped agents to honor
   * networkScope without falling back to global getActiveIntents (which would
   * include intents in networks outside scope).
   *
   * @param userId - The intent owner (always the caller).
   * @param networkIds - The set of network IDs to filter on. Empty → empty result.
   * @returns Active intents owned by userId in any of networkIds, deduped by intent id.
   */
  getActiveIntentsAcrossNetworks(userId: string, networkIds: string[]): Promise<ActiveIntent[]>;

  /** Get a single intent by ID (if in scope). */
  getIntent(intentId: string): Promise<IntentRecord | null>;

  /** Find similar intents across users within the network scope. */
  findSimilarIntentsInScope(embedding: number[], options?: SimilarIntentSearchOptions): Promise<SimilarIntent[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Network Membership Operations (any network in scope)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Check if a user is a member of a network. */
  isNetworkMember(networkId: string, userId: string): Promise<boolean>;

  /** Check if a user is an owner of a network. */
  isNetworkOwner(networkId: string, userId: string): Promise<boolean>;

  /** Get all members of a network (requires membership). */
  getNetworkMembers(networkId: string): Promise<NetworkMemberDetails[]>;

  /** Get all members across all networks in scope (deduplicated). */
  getMembersFromScope(): Promise<{ userId: Id<'users'>; name: string; avatar: string | null }[]>;

  /** Add a user to a network (requires ownership or 'anyone' policy). */
  addMemberToNetwork(networkId: string, userId: string, role: 'owner' | 'member'): Promise<{ success: boolean; alreadyMember?: boolean }>;

  /** Remove a user from a network (requires ownership). Cannot remove the owner. */
  removeMemberFromNetwork(networkId: string, userId: string): Promise<{ success: boolean; wasOwner?: boolean; notMember?: boolean }>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Network Operations (any network in scope)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get network info by ID with core fields (requires scope). */
  getNetwork(networkId: string): Promise<{
    id: string;
    title: string;
    prompt?: string | null;
    type?: string;
    metadata?: Record<string, unknown> | null;
    permissions?: Record<string, unknown> | null;
  } | null>;

  /** Get network with permissions (requires scope). */
  getNetworkWithPermissions(networkId: string): Promise<{ id: string; title: string; permissions: { joinPolicy: 'anyone' | 'invite_only' } } | null>;

  /** Get member count for a network (requires scope). */
  getNetworkMemberCount(networkId: string): Promise<number>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Opportunity Operations (cross-user within scope)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Create an opportunity (cross-user). */
  createOpportunity(data: CreateOpportunityData): Promise<Opportunity>;

  /** Create opportunity and expire overlapping ones atomically. */
  createOpportunityAndExpireIds(data: CreateOpportunityData, expireIds: string[]): Promise<{ created: Opportunity; expired: Opportunity[] }>;

  /** Get an opportunity by ID (for system processing). */
  getOpportunity(id: string): Promise<Opportunity | null>;

  /** Get opportunities for a network (requires membership). */
  getOpportunitiesForNetwork(networkId: string, options?: OpportunityQueryOptions): Promise<Opportunity[]>;

  /** Update an opportunity's status (system-level). */
  updateOpportunityStatus(id: string, status: OpportunityStatus, acceptedBy?: string): Promise<Opportunity | null>;

  /** Stamp actor `actedAt` + update status atomically (system-level). */
  stampOpportunityActorAction(
    id: string,
    actorUserId: string,
    status: OpportunityStatus,
    acceptedBy?: string,
  ): Promise<Opportunity | null>;

  /** Check if opportunity exists between actors in a network. */
  opportunityExistsBetweenActors(actorIds: string[], networkId: string): Promise<boolean>;

  /** Find opportunities by actor IDs with optional include/exclude status filters. */
  findOpportunitiesByActors(
    actorIds: string[],
    options?: { includeIntroducers?: boolean; statuses?: OpportunityStatus[]; excludeStatuses?: OpportunityStatus[] }
  ): Promise<Opportunity[]>;

  /** Expire opportunities referencing an intent. */
  expireOpportunitiesByIntent(intentId: string): Promise<number>;

  /** Expire opportunities for a removed member. */
  expireOpportunitiesForRemovedMember(networkId: string, userId: string): Promise<number>;

  /** Expire stale opportunities (maintenance). */
  expireStaleOpportunities(): Promise<number>;

  // ─────────────────────────────────────────────────────────────────────────────
  // HyDE Operations (cross-user for opportunity matching)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get a HyDE document (cross-user for matching). */
  getHydeDocument(sourceType: HydeSourceType, sourceId: string, strategy: string): Promise<HydeDocument | null>;

  /** Get all HyDE documents for a source (cross-user). */
  getHydeDocumentsForSource(sourceType: HydeSourceType, sourceId: string): Promise<HydeDocument[]>;

  /** Save a HyDE document (system-level). */
  saveHydeDocument(data: CreateHydeDocumentData): Promise<HydeDocument>;

  /** Delete expired HyDE documents (maintenance). */
  deleteExpiredHydeDocuments(): Promise<number>;

  /** Get stale HyDE documents for refresh (maintenance). */
  getStaleHydeDocuments(threshold: Date): Promise<HydeDocument[]>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NARROWED DATABASE INTERFACES (Interface Segregation)
// ═══════════════════════════════════════════════════════════════════════════════
//
// These narrowed types are Pick types from the raw Database interface.
// They are used by graph factories to enforce interface segregation at compile time.
//
// Access control relationship to UserDatabase/SystemDatabase:
// - IntentGraphDatabase → maps to UserDatabase (mutations) + SystemDatabase (reads)
// - OpportunityGraphDatabase → maps to SystemDatabase (cross-user operations)
// - NetworkGraphDatabase → maps to UserDatabase (own networks)
// - IntentNetworkGraphDatabase → maps to both (own intent ↔ shared network)
// - NetworkMembershipGraphDatabase → maps to SystemDatabase (cross-user)
// - HydeGraphDatabase → maps to both (own HyDE vs cross-user matching)
//
// Graphs continue to use these narrowed types because:
// 1. They receive the raw database adapter with userId passed per method
// 2. Access control is enforced at the tool/factory layer via createUserDatabase/createSystemDatabase
// 3. These types ensure graphs only depend on methods they actually use
// ═══════════════════════════════════════════════════════════════════════════════
