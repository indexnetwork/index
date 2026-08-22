/**
 * Database operations for profiles, intents, and their vector search.
 */

import type { UserIdentity } from '../../protocol/schemas/identity.schema.js';
import type { ActiveIntent, ActiveNetworkMembershipPair, ArchiveResult, CreateIntentData, CreatedIntent, IntentRecord, NetworkMembership, OnboardingState, SimilarIntent, SimilarIntentSearchOptions, UpdateIntentData, UserRecord, UserSocial } from './entities.js';
import type { Database } from '../database.js';

/** Profile, intent-lifecycle and retrieval operations. */
export interface DatabaseIdentityQueries {
  // ─────────────────────────────────────────────────────────────────────────────
  // Profile Operations (Preserved)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Retrieves a user profile by userId.
   * @param userId - The unique identifier of the user
   * @returns The user's profile or null if not found
   */
  getProfile(userId: string): Promise<UserIdentity | null>;

  /**
   * Creates or updates a user profile.
   * @param userId - The unique identifier of the user
   * @param profile - The profile data to save
   */
  saveProfile(userId: string, profile: UserIdentity): Promise<void>;

  /**
   * Retrieves basic user information (name, email, socials) by userId.
   * @param userId - The unique identifier of the user
   * @returns The user record or null if not found
   */
  getUser(userId: string): Promise<UserRecord | null>;

  /**
   * Updates user account fields (name, location, socials).
   * Merges socials with existing values (does not overwrite the whole object).
   * Used by create_user_context tool to persist user-provided info before
   * invoking the Profile Graph in generate mode.
   *
   * @param userId - The unique identifier of the user
   * @param data - Partial user fields to update
   * @returns The updated user record or null if not found
   */
  updateUser(userId: string, data: { name?: string; intro?: string; location?: string; onboarding?: OnboardingState }): Promise<UserRecord | null>;

  getUserSocials(userId: string): Promise<UserSocial[]>;
  setUserSocials(userId: string, socials: { label: string; value: string }[]): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Pre-Graph Operations (State Population)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Retrieves all active (non-archived) intents for a user.
   * Used to populate the `activeIntents` field in the Intent Graph state
   * before graph execution.
   *
   * @param userId - The unique identifier of the user
   * @returns Array of active intents with minimal fields needed for reconciliation
   *
   * @example
   * ```typescript
   * const activeIntents = await db.getActiveIntents(userId);
   * const formattedIntents = activeIntents
   *   .map(i => `ID: ${i.id}, Description: ${i.payload}, Summary: ${i.summary || 'N/A'}`)
   *   .join('\n');
   * ```
   */
  getActiveIntents(userId: string): Promise<ActiveIntent[]>;

  /**
   * Get active intents that belong to the user and are assigned to a specific index.
   * Caller must be a member of that index; only the user's own intents are returned.
   *
   * @param userId - The user requesting (must be a member of the index)
   * @param indexNameOrId - Network UUID or display name (e.g. "Commons")
   * @returns Array of active intents in that index for the user, or empty if not a member / no match
   */
  getIntentsInIndexForMember(userId: string, indexNameOrId: string): Promise<ActiveIntent[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Post-Graph Operations (Action Execution)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Creates a new intent with full processing pipeline.
   * Handles summarization, embedding generation, and index association.
   *
   * Called when the reconciler outputs a "create" action.
   *
   * @param data - The intent creation data
   * @returns The created intent with generated fields
   *
   * @example
   * ```typescript
   * // After graph outputs CREATE action
   * const newIntent = await db.createIntent({
   *   userId,
   *   payload: action.payload,
   *   confidence: action.score / 100,
   *   inferenceType: 'explicit',
   *   sourceType: 'discovery_form'
   * });
   * ```
   */
  createIntent(data: CreateIntentData): Promise<CreatedIntent>;

  /**
   * Updates an existing intent.
   * Re-generates summary and embedding if payload changes.
   *
   * Called when the reconciler outputs an "update" action.
   *
   * @param intentId - The unique identifier of the intent to update
   * @param data - The fields to update
   * @returns The updated intent or null if not found
   * @throws Error if the intent exists but user doesn't have access
   *
   * @example
   * ```typescript
   * // After graph outputs UPDATE action
   * const updated = await db.updateIntent(action.id, {
   *   payload: action.payload
   * });
   * ```
   */
  updateIntent(intentId: string, data: UpdateIntentData): Promise<CreatedIntent | null>;

  /**
   * Archives (soft-deletes) an intent.
   * Sets the archivedAt timestamp rather than hard deleting.
   *
   * Called when the reconciler outputs an "expire" action.
   *
   * @param intentId - The unique identifier of the intent to archive
   * @returns Result object indicating success or failure with error message
   *
   * @example
   * ```typescript
   * // After graph outputs EXPIRE action
   * const result = await db.archiveIntent(action.id);
   * if (!result.success) {
   *   console.error('Failed to archive intent', { error: result.error });
   * }
   * ```
   */
  archiveIntent(intentId: string): Promise<ArchiveResult>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Query Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Retrieves a single intent by ID.
   *
   * @param intentId - The unique identifier of the intent
   * @returns The full intent record or null if not found
   */
  getIntent(intentId: string): Promise<IntentRecord | null>;

  /**
   * Retrieves an intent with ownership verification.
   * Ensures the requesting user owns the intent before returning.
   *
   * Used for processing operations (refine, suggestions) that require ownership.
   *
   * @param intentId - The unique identifier of the intent
   * @param userId - The user requesting access
   * @returns The intent if found and owned by user, null if not found
   * @throws Error with message 'Access denied' if intent exists but is not owned by user
   *
   * @example
   * ```typescript
   * try {
   *   const intent = await db.getIntentWithOwnership(intentId, userId);
   *   if (!intent) return res.status(404).json({ error: 'Not found' });
   *   // Process intent...
   * } catch (e) {
   *   if (e.message === 'Access denied') {
   *     return res.status(403).json({ error: 'Forbidden' });
   *   }
   *   throw e;
   * }
   * ```
   */
  getIntentWithOwnership(intentId: string, userId: string): Promise<IntentRecord | null>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Association Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Gets Network IDs where the user has auto-assign membership enabled.
   * Used for determining which indexes to associate new intents with.
   *
   * @param userId - The unique identifier of the user
   * @returns Array of network IDs
   *
   * @example
   * ```typescript
   * const networkIds = await db.getUserIndexIds(userId);
   * if (networkIds.length > 0) {
   *   await db.associateIntentWithNetworks(intentId, networkIds);
   * }
   * ```
   */
  getUserIndexIds(userId: string): Promise<string[]>;

  /**
   * Retrieves all networks the user is a member of with full details.
   * Used for displaying network memberships in chat (index_query).
   *
   * @param userId - The unique identifier of the user
   * @returns Array of network memberships with details
   */
  getNetworkMemberships(userId: string): Promise<NetworkMembership[]>;

  /**
   * Get a single network membership by index and user.
   * Used when the preloaded memberships list may not contain this network (e.g. after isNetworkMember check).
   *
   * @param networkId - The network ID
   * @param userId - The user ID
   * @returns The membership or null if not found
   */
  getNetworkMembership(networkId: string, userId: string): Promise<NetworkMembership | null>;

  /**
   * Return only requested user/network pairs backed by a live membership row
   * and a non-deleted network. Permissions are intentionally not filtered.
   */
  getActiveNetworkMembershipPairs(
    pairs: ActiveNetworkMembershipPair[],
  ): Promise<ActiveNetworkMembershipPair[]>;

  /**
   * Get index by ID with core fields. Used for opportunity presentation and context rendering.
   */
  getNetwork(networkId: string): Promise<{
    id: string;
    title: string;
    prompt?: string | null;
    type?: string;
    metadata?: Record<string, unknown> | null;
    permissions?: Record<string, unknown> | null;
  } | null>;

  /**
   * Get index by ID with permissions (e.g. joinPolicy). Used by chat tools for create_index_membership.
   */
  getNetworkWithPermissions(networkId: string): Promise<{ id: string; title: string; permissions: { joinPolicy: 'anyone' | 'invite_only' } } | null>;

  /**
   * Associates an intent with one or more networks.
   * Creates entries in the intentNetworks join table.
   *
   * @param intentId - The intent to associate
   * @param networkIds - Array of network IDs to associate with
   *
   * @example
   * ```typescript
   * await db.associateIntentWithNetworks(intentId, ['idx_1', 'idx_2']);
   * ```
   */
  associateIntentWithNetworks(intentId: string, networkIds: string[]): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Vector Search Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Finds semantically similar intents using vector search.
   * Used for deduplication during intent creation and discovery.
   *
   * Privacy scoping: Results are always filtered by userId to ensure
   * users only see their own intents.
   *
   * @param embedding - The query embedding vector
   * @param userId - The user ID for privacy scoping (required)
   * @param options - Search options (limit, threshold)
   * @returns Array of intents with similarity scores, sorted by similarity
   *
   * @example
   * ```typescript
   * // Check for duplicates before creating
   * const embedding = await embedder.generate(payload);
   * const similar = await db.findSimilarIntents(embedding, userId, {
   *   limit: 5,
   *   threshold: 0.85
   * });
   * if (similar.length > 0 && similar[0].similarity > 0.95) {
   *   // Likely duplicate - consider updating instead
   * }
   * ```
   */
  findSimilarIntents(
    embedding: number[],
    userId: string,
    options?: SimilarIntentSearchOptions
  ): Promise<SimilarIntent[]>;

}
