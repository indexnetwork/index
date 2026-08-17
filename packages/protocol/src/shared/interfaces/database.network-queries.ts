/**
 * Database operations for intent-network assignment and index ownership.
 */

import type { UserIdentity } from '../schemas/identity.schema.js';
import type { NetworkAssignmentMetadata } from '../schemas/network-assignment.schema.js';
import type { ActiveIntent, AssignmentNetworkMembership, Id, IndexMemberDetails, IndexedIntentDetails, IntentNetworkFinalAssignmentResult, NetworkAssignmentContext, OwnedIndex, UpdateIndexSettingsData } from './database.entities.js';
import type { Database } from './database.port.js';

/** Network assignment and owner-only index operations. */
export interface DatabaseNetworkQueries {
  // ─────────────────────────────────────────────────────────────────────────────
  // Network Graph Operations (Intent–Network Assignment)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Intent fields needed for index appropriateness evaluation.
   */
  getIntentForIndexing(intentId: string): Promise<{
    id: string;
    payload: string;
    userId: string;
    sourceType: string | null;
    sourceId: string | null;
  } | null>;

  /**
   * Index + member prompts for a user in an index (only when member has autoAssign).
   * Returns null if user is not a member or autoAssign is false.
   */
  getNetworkMemberContext(
    networkId: string,
    userId: string
  ): Promise<NetworkAssignmentContext | null>;

  /**
   * Network memberships that should be considered for assignment policy. Unlike
   * getUserIndexIds, this is not gated by network_members.autoAssign and carries
   * personal-index metadata so scoped writes can include the user's personal network.
   */
  getAssignmentNetworkMembershipsForUser(userId: string): Promise<AssignmentNetworkMembership[]>;

  /**
   * Network IDs that should be considered for assignment policy. Unlike
   * getUserIndexIds, this is not gated by network_members.autoAssign.
   * @deprecated Prefer getAssignmentNetworkMembershipsForUser for scope-aware assignment.
   */
  getAssignmentNetworkIdsForUser(userId: string): Promise<string[]>;

  /**
   * Prompt context for assignment policy. Unlike getNetworkMemberContext, this is
   * not gated by network_members.autoAssign.
   */
  getNetworkAssignmentContext(networkId: string, userId: string): Promise<NetworkAssignmentContext | null>;

  /**
   * Whether the intent is currently assigned to the index.
   */
  isIntentAssignedToIndex(intentId: string, networkId: string): Promise<boolean>;

  /**
   * Assigns an intent to an index (inserts intent_indexes row).
   */
  assignIntentToNetwork(
    intentId: string,
    networkId: string,
    relevancyScore?: number,
    assignmentMetadata?: NetworkAssignmentMetadata,
  ): Promise<void>;

  /**
   * Atomically assign an owned, non-archived intent only while the exact
   * accepted network membership and network remain active. Implementations
   * hold intent, network, and membership row locks through the insert.
   */
  assignIntentToNetworkIfMember(
    userId: string,
    intentId: string,
    networkId: string,
    relevancyScore?: number,
    assignmentMetadata?: NetworkAssignmentMetadata,
  ): Promise<IntentNetworkFinalAssignmentResult>;

  /**
   * Returns per-index relevancy scores for an intent's index assignments.
   */
  getIntentIndexScores(intentId: string): Promise<Array<{
    networkId: string;
    relevancyScore: number | null;
    assignmentMetadata?: NetworkAssignmentMetadata | null;
  }>>;

  /**
   * Removes an intent from an index (deletes intent_indexes row).
   */
  unassignIntentFromIndex(intentId: string, networkId: string): Promise<void>;

  /**
   * Returns all network IDs that an intent is registered to.
   */
  getNetworkIdsForIntent(intentId: string): Promise<string[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Ownership Operations (Owner-Only)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get indexes where the user has owner permissions.
   * Returns full index details with member and intent counts.
   *
   * @param userId - The user ID to check ownership for
   * @returns Array of owned indexes with counts
   */
  getOwnedIndexes(userId: string): Promise<OwnedIndex[]>;

  /**
   * Get public networks (joinPolicy 'anyone') that the user has not joined.
   * Used for discovering communities available to join.
   *
   * @param userId - The user ID to check memberships against
   * @returns Object containing array of public networks with owner info
   */
  getPublicIndexesNotJoined(userId: string): Promise<{
    networks: Array<{
      id: string;
      title: string;
      prompt: string | null;
      memberCount: number;
      owner: { id: string; name: string; avatar: string | null } | null;
    }>;
  }>;

  /**
   * Check if user is an owner of a specific index.
   *
   * @param networkId - The index to check
   * @param userId - The user to verify ownership for
   * @returns True if user is an owner
   */
  isIndexOwner(networkId: string, userId: string): Promise<boolean>;

  /**
   * Check if user is a member of a specific index.
   *
   * @param networkId - The index to check
   * @param userId - The user to verify membership for
   * @returns True if user is a member
   */
  isNetworkMember(networkId: string, userId: string): Promise<boolean>;

  /**
   * Get all members of an index with their details.
   * **OWNER ONLY** - throws if user is not an owner.
   *
   * @param networkId - The index to get members for
   * @param requestingUserId - The user requesting (must be owner)
   * @returns Array of member details with intent counts
   * @throws Error if requestingUserId is not an owner
   */
  getNetworkMembersForOwner(
    networkId: string,
    requestingUserId: string
  ): Promise<IndexMemberDetails[]>;

  /**
   * Get all members of an index with their details.
   * **MEMBER ONLY** - any member of the index can list members (not just owners).
   * Returns same shape as getNetworkMembersForOwner; email may be omitted for privacy.
   *
   * @param networkId - The index to get members for
   * @param requestingUserId - The user requesting (must be a member of the index)
   * @returns Array of member details with intent counts
   * @throws Error if requestingUserId is not a member of the index
   */
  getNetworkMembersForMember(
    networkId: string,
    requestingUserId: string
  ): Promise<IndexMemberDetails[]>;

  /**
   * Get all members from every network the user is a member of (deduplicated).
   * Used for mentionable-users: anyone who shares at least one index with the requesting user.
   *
   * @param userId - The signed-in user
   * @returns Array of member summaries (id, name, avatar only; no email)
   */
  getMembersFromUserIndexes(userId: Id<'users'>): Promise<{ userId: Id<'users'>; name: string; avatar: string | null }[]>;

  /**
   * Get all indexed intents for an index.
   * **OWNER ONLY** - throws if user is not an owner.
   *
   * @param networkId - The index to get intents for
   * @param requestingUserId - The user requesting (must be owner)
   * @param options - Pagination options
   * @returns Array of intent details with owner info
   * @throws Error if requestingUserId is not an owner
   */
  getNetworkIntentsForOwner(
    networkId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<IndexedIntentDetails[]>;

  /**
   * Get all indexed intents for an index.
   * **MEMBER ONLY** - any member of the index can list intents (not just owners).
   *
   * @param networkId - The index to get intents for
   * @param requestingUserId - The user requesting (must be a member of the index)
   * @param options - Pagination options
   * @returns Array of intent details with owner info
   * @throws Error if requestingUserId is not a member of the index
   */
  getNetworkIntentsForMember(
    networkId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<IndexedIntentDetails[]>;

  /**
   * Get the caller's own active intents across a set of indexes.
   * Returns intents owned by `userId` that are linked (via intent_networks)
   * to at least one of `indexIds`. Used by network-scoped agents to honor
   * indexScope without falling back to global getActiveIntents (which would
   * include intents in indexes outside scope).
   *
   * @param userId - The intent owner (always the caller).
   * @param indexIds - The set of network IDs to filter on. Empty → empty result.
   * @returns Active intents owned by userId in any of indexIds, deduped by intent id.
   */
  getActiveIntentsAcrossIndexes(userId: string, indexIds: string[]): Promise<ActiveIntent[]>;

  /**
   * Update index settings.
   * **OWNER ONLY** - throws if user is not an owner.
   *
   * @param networkId - The index to update
   * @param requestingUserId - The user requesting (must be owner)
   * @param data - The settings to update
   * @returns The updated index
   * @throws Error if requestingUserId is not an owner
   */
  updateIndexSettings(
    networkId: string,
    requestingUserId: string,
    data: UpdateIndexSettingsData
  ): Promise<OwnedIndex>;

  /**
   * Soft-delete a network (set deletedAt).
   * Caller must ensure network is not personal and has no other members.
   *
   * @param networkId - The network to soft-delete
   */
  softDeleteNetwork(networkId: string): Promise<void>;

  /**
   * Delete a user's profile (removes profile row).
   * Used after confirmation in chat tools.
   *
   * @param userId - User whose profile to delete
   */
  deleteProfile(userId: string): Promise<void>;

  /**
   * Get a user's profile including its row id (for update_user_context validation).
   *
   * @param userId - The user whose profile to fetch
   * @returns Profile with id, or null if not found
   */
  getProfileByUserId(userId: string): Promise<(UserIdentity & { id: string }) | null>;

  /**
   * Create a new index and return its record.
   *
   * @param data - Title, optional prompt, optional imageUrl, optional joinPolicy
   * @returns The created network with id, title, prompt, imageUrl, permissions
   */
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

  /**
   * Count members in an index (for delete guard).
   *
   * @param networkId - The index to count
   * @returns Number of members
   */
  getNetworkMemberCount(networkId: string): Promise<number>;

  /**
   * Add a user as a member of a network.
   *
   * @param networkId - The network to add to
   * @param userId - The user to add
   * @param role - owner | member
   * @returns success and optionally alreadyMember if they were already in the network
   */
  addMemberToNetwork(
    networkId: string,
    userId: string,
    role: 'owner' | 'member'
  ): Promise<{ success: boolean; alreadyMember?: boolean }>;

  /**
   * Removes a user from an index.
   * Only the network owner can remove members. Cannot remove the owner.
   *
   * @param networkId - The index to remove from
   * @param userId - The user to remove
   * @returns success, or wasOwner/notMember if removal failed
   */
  removeMemberFromIndex(
    networkId: string,
    userId: string
  ): Promise<{ success: boolean; wasOwner?: boolean; notMember?: boolean }>;

}
