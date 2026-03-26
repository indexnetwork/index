import { ProfileDocument } from '../agents/profile.generator';
import type {
  OpportunityDetection,
  OpportunityActor,
  OpportunityInterpretation,
  OpportunityContext,
  UserSocials,
  OnboardingState,
} from '../../../schemas/database.schema';
import type { Id } from '../../../types/common.types';

/** User record returned by getUser (minimal fields plus optional profile fields). */
export interface UserRecord {
  id: string;
  name: string;
  email: string;
  intro?: string | null;
  avatar?: string | null;
  location?: string | null;
  socials?: UserSocials | null;
  onboarding?: OnboardingState | null;
  isGhost?: boolean;
  deletedAt?: Date | null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Minimal intent representation used for graph state population.
 * Contains only the fields needed for reconciliation logic.
 */
export interface ActiveIntent {
  /** Unique identifier of the intent */
  id: string;
  /** Full intent description/payload */
  payload: string;
  /** Short summary of the intent (may be null if not generated) */
  summary: string | null;
  /** When the intent was created */
  createdAt: Date;
}

/**
 * Input data for creating a new intent.
 * Supports the full intent pipeline including embedding and index association.
 */
export interface CreateIntentData {
  /** The user who owns this intent */
  userId: string;
  /** Full intent description/payload */
  payload: string;
  /** Pre-computed summary (optional, will be generated if not provided) */
  summary?: string | null;
  /** Pre-computed embedding vector (optional, will be generated if not provided) */
  embedding?: number[];
  /** Whether the intent should be hidden from public views */
  isIncognito?: boolean;
  /** Index IDs to associate with (optional, uses dynamic scoping if empty) */
  indexIds?: string[];
  /** Source type for provenance tracking */
  sourceType?: 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment';
  /** Source ID for provenance tracking */
  sourceId?: string;
  /** Confidence score from inference (0-1, required) */
  confidence: number;
  /** How the intent was inferred */
  inferenceType: 'explicit' | 'implicit';
  /** Semantic entropy from verifier (0 specific -> 1 vague) */
  semanticEntropy?: number | null;
  /** Referential anchor extracted by verifier (if any) */
  referentialAnchor?: string | null;
  /** Felicity authority score from verifier (0-100) */
  felicityAuthority?: number | null;
  /** Felicity sincerity score from verifier (0-100) */
  felicitySincerity?: number | null;
  /** Donnellan intent mode */
  intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;
  /** Speech act category used by protocol enum */
  speechActType?: 'COMMISSIVE' | 'DIRECTIVE' | null;
}

/**
 * Input data for updating an existing intent.
 * All fields are optional - only provided fields will be updated.
 */
export interface UpdateIntentData {
  /** Updated intent description/payload */
  payload?: string;
  /** Updated summary */
  summary?: string | null;
  /** Updated embedding vector */
  embedding?: number[];
  /** Updated incognito status */
  isIncognito?: boolean;
  /** Updated index associations (replaces existing) */
  indexIds?: string[];
  /** Semantic entropy from verifier (0 specific -> 1 vague) */
  semanticEntropy?: number | null;
  /** Referential anchor extracted by verifier (if any) */
  referentialAnchor?: string | null;
  /** Felicity authority score from verifier (0-100) */
  felicityAuthority?: number | null;
  /** Felicity sincerity score from verifier (0-100) */
  felicitySincerity?: number | null;
  /** Donnellan intent mode */
  intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;
  /** Speech act category used by protocol enum */
  speechActType?: 'COMMISSIVE' | 'DIRECTIVE' | null;
}

/**
 * The result of a successful intent creation.
 * Contains the core fields needed for immediate use.
 */
export interface CreatedIntent {
  /** Unique identifier of the created intent */
  id: string;
  /** Full intent description/payload */
  payload: string;
  /** Generated or provided summary */
  summary: string | null;
  /** Incognito status */
  isIncognito: boolean;
  /** Creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Owner user ID */
  userId: string;
}

/**
 * Full intent record with all fields (for detailed queries).
 */
export interface IntentRecord extends CreatedIntent {
  /** Archival timestamp (null if active) */
  archivedAt: Date | null;
  /** Embedding vector (may be null) */
  embedding?: number[] | null;
  /** Source type for provenance */
  sourceType?: string | null;
  /** Source ID for provenance */
  sourceId?: string | null;
}

/**
 * Intent with similarity score from vector search.
 */
export interface SimilarIntent extends IntentRecord {
  /** Cosine similarity score (0-1) */
  similarity: number;
}

/**
 * Result of an archive operation.
 */
export interface ArchiveResult {
  /** Whether the operation succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Options for vector similarity search.
 */
export interface SimilarIntentSearchOptions {
  /** Maximum number of results to return (default: 10) */
  limit?: number;
  /** Minimum similarity threshold (default: 0.7) */
  threshold?: number;
}

/**
 * Represents a user's membership in an index with full details.
 * Used for displaying index memberships in chat (index_query).
 */
export interface IndexMembership {
  /** Unique identifier of the index */
  indexId: string;
  /** Display title of the index */
  indexTitle: string;
  /** Index description/prompt (what the community is about) */
  indexPrompt: string | null;
  /** Member's permissions in this index */
  permissions: string[];
  /** Member's custom prompt (overrides index prompt for their intents) */
  memberPrompt: string | null;
  /** Whether new intents are auto-assigned to this index */
  autoAssign: boolean;
  /** Whether this is the user's personal index ("My Network") */
  isPersonal: boolean;
  /** When the user joined the index */
  joinedAt: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INDEX OWNERSHIP TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Represents an index owned by the user with full details.
 */
export interface OwnedIndex {
  /** Index ID */
  id: string;
  /** Display title */
  title: string;
  /** Index purpose/scope prompt */
  prompt: string | null;
  /** Cover image URL */
  imageUrl: string | null;
  /** Permission settings */
  permissions: {
    joinPolicy: 'anyone' | 'invite_only';
    allowGuestVibeCheck: boolean;
    invitationLink: { code: string } | null;
  };
  /** Whether this is a personal index */
  isPersonal: boolean;
  /** When the index was created */
  createdAt: Date;
  /** When the index was last updated */
  updatedAt: Date;
  /** Member count */
  memberCount: number;
  /** Total intents indexed */
  intentCount: number;
  /** Owner summary */
  user: { id: string; name: string; avatar: string | null };
  /** Aggregate counts for frontend compatibility */
  _count: { members: number };
}

/**
 * Member details visible to index owners (and optionally to members with privacy rules).
 */
export interface IndexMemberDetails {
  /** User ID */
  userId: string;
  /** User's display name */
  name: string;
  /** User's avatar URL */
  avatar: string | null;
  /** User's email; only present when viewer is owner/admin or the member themselves (privacy-safe) */
  email?: string | null;
  /** Member's permissions in this index */
  permissions: string[];
  /** Member's custom prompt */
  memberPrompt: string | null;
  /** Whether auto-assign is enabled */
  autoAssign: boolean;
  /** When they joined */
  joinedAt: Date;
  /** Count of their intents in this index */
  intentCount: number;
  /** Whether this user is a ghost (not yet onboarded) */
  isGhost?: boolean;
}

/**
 * Intent details visible to index owners.
 */
export interface IndexedIntentDetails {
  /** Intent ID */
  id: string;
  /** Intent payload/description */
  payload: string;
  /** Intent summary */
  summary: string | null;
  /** Owner's user ID */
  userId: string;
  /** Owner's name */
  userName: string;
  /** When the intent was created */
  createdAt: Date;
}

/**
 * Options for updating index settings.
 */
export interface UpdateIndexSettingsData {
  /** New title (optional) */
  title?: string;
  /** New prompt (optional) */
  prompt?: string | null;
  /** New image URL (optional) */
  imageUrl?: string | null;
  /** New join policy (optional) */
  joinPolicy?: 'anyone' | 'invite_only';
  /** Allow guest vibe check (optional) */
  allowGuestVibeCheck?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HYDE DOCUMENT TYPES (Opportunity Redesign)
// ═══════════════════════════════════════════════════════════════════════════════

export type HydeSourceType = 'intent' | 'profile' | 'query';

export interface HydeDocument {
  id: string;
  sourceType: HydeSourceType;
  sourceId: string | null;
  sourceText: string | null;
  strategy: string;
  targetCorpus: string;
  hydeText: string;
  hydeEmbedding: number[];
  context: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date | null;
}

export interface CreateHydeDocumentData {
  sourceType: HydeSourceType;
  sourceId?: string;
  sourceText?: string;
  strategy: string;
  targetCorpus: string;
  hydeText: string;
  hydeEmbedding: number[];
  context?: Record<string, unknown>;
  expiresAt?: Date;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPPORTUNITY TYPES (Opportunity Redesign)
// ═══════════════════════════════════════════════════════════════════════════════

export type {
  OpportunityDetection,
  OpportunityActor,
  OpportunityInterpretation,
  OpportunityContext,
  OpportunitySignal,
} from '../../../schemas/database.schema';

export type OpportunityStatus = 'latent' | 'draft' | 'pending' | 'accepted' | 'rejected' | 'expired';

export interface Opportunity {
  id: string;
  detection: OpportunityDetection;
  actors: OpportunityActor[];
  interpretation: OpportunityInterpretation;
  context: OpportunityContext;
  confidence: string;
  status: OpportunityStatus;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

export interface CreateOpportunityData {
  detection: OpportunityDetection;
  actors: OpportunityActor[];
  interpretation: OpportunityInterpretation;
  context: OpportunityContext;
  confidence: string;
  status?: OpportunityStatus;
  expiresAt?: Date;
}

export interface OpportunityQueryOptions {
  status?: OpportunityStatus;
  indexId?: string;
  role?: string;
  limit?: number;
  offset?: number;
  /** When set, include draft opportunities for this chat session. When unset, exclude all draft opportunities (e.g. home view, API). */
  conversationId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DATABASE INTERFACE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Abstract database interface for performing specific domain operations.
 * Decouples the protocol layer from the infrastructure layer.
 */
export interface Database {
  // ─────────────────────────────────────────────────────────────────────────────
  // Profile Operations (Preserved)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Retrieves a user profile by userId.
   * @param userId - The unique identifier of the user
   * @returns The user's profile or null if not found
   */
  getProfile(userId: string): Promise<ProfileDocument | null>;

  /**
   * Creates or updates a user profile.
   * @param userId - The unique identifier of the user
   * @param profile - The profile data to save
   */
  saveProfile(userId: string, profile: ProfileDocument): Promise<void>;

  /**
   * Retrieves basic user information (name, email, socials) by userId.
   * @param userId - The unique identifier of the user
   * @returns The user record or null if not found
   */
  getUser(userId: string): Promise<UserRecord | null>;

  /**
   * Updates user account fields (name, location, socials).
   * Merges socials with existing values (does not overwrite the whole object).
   * Used by create_user_profile tool to persist user-provided info before
   * invoking the Profile Graph in generate mode.
   *
   * @param userId - The unique identifier of the user
   * @param data - Partial user fields to update
   * @returns The updated user record or null if not found
   */
  updateUser(userId: string, data: { name?: string; intro?: string; location?: string; socials?: UserSocials; onboarding?: OnboardingState }): Promise<UserRecord | null>;

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
   * @param indexNameOrId - Index UUID or display name (e.g. "Commons")
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
   *   console.error(`Failed to archive: ${result.error}`);
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
   * Gets Index IDs where the user has auto-assign membership enabled.
   * Used for determining which indexes to associate new intents with.
   *
   * @param userId - The unique identifier of the user
   * @returns Array of index IDs
   *
   * @example
   * ```typescript
   * const indexIds = await db.getUserIndexIds(userId);
   * if (indexIds.length > 0) {
   *   await db.associateIntentWithIndexes(intentId, indexIds);
   * }
   * ```
   */
  getUserIndexIds(userId: string): Promise<string[]>;

  /**
   * Retrieves all indexes the user is a member of with full details.
   * Used for displaying index memberships in chat (index_query).
   *
   * @param userId - The unique identifier of the user
   * @returns Array of index memberships with details
   */
  getIndexMemberships(userId: string): Promise<IndexMembership[]>;

  /**
   * Get a single index membership by index and user.
   * Used when the preloaded memberships list may not contain this index (e.g. after isIndexMember check).
   *
   * @param indexId - The index ID
   * @param userId - The user ID
   * @returns The membership or null if not found
   */
  getIndexMembership(indexId: string, userId: string): Promise<IndexMembership | null>;

  /**
   * Get index by ID (id and title only). Used for opportunity presentation.
   */
  getIndex(indexId: string): Promise<{ id: string; title: string } | null>;

  /**
   * Get index by ID with permissions (e.g. joinPolicy). Used by chat tools for create_index_membership.
   */
  getIndexWithPermissions(indexId: string): Promise<{ id: string; title: string; permissions: { joinPolicy: 'anyone' | 'invite_only' } } | null>;

  /**
   * Associates an intent with one or more indexes.
   * Creates entries in the intentIndexes join table.
   *
   * @param intentId - The intent to associate
   * @param indexIds - Array of index IDs to associate with
   *
   * @example
   * ```typescript
   * await db.associateIntentWithIndexes(intentId, ['idx_1', 'idx_2']);
   * ```
   */
  associateIntentWithIndexes(intentId: string, indexIds: string[]): Promise<void>;

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

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Graph Operations (Intent–Index Assignment)
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
  getIndexMemberContext(
    indexId: string,
    userId: string
  ): Promise<{
    indexId: string;
    indexPrompt: string | null;
    memberPrompt: string | null;
  } | null>;

  /**
   * Whether the intent is currently assigned to the index.
   */
  isIntentAssignedToIndex(intentId: string, indexId: string): Promise<boolean>;

  /**
   * Assigns an intent to an index (inserts intent_indexes row).
   */
  assignIntentToIndex(intentId: string, indexId: string, relevancyScore?: number): Promise<void>;

  /**
   * Returns per-index relevancy scores for an intent's index assignments.
   */
  getIntentIndexScores(intentId: string): Promise<Array<{ indexId: string; relevancyScore: number | null }>>;

  /**
   * Removes an intent from an index (deletes intent_indexes row).
   */
  unassignIntentFromIndex(intentId: string, indexId: string): Promise<void>;

  /**
   * Returns all index IDs that an intent is registered to.
   */
  getIndexIdsForIntent(intentId: string): Promise<string[]>;

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
   * Get public indexes (joinPolicy 'anyone') that the user has not joined.
   * Used for discovering communities available to join.
   *
   * @param userId - The user ID to check memberships against
   * @returns Object containing array of public indexes with owner info
   */
  getPublicIndexesNotJoined(userId: string): Promise<{
    indexes: Array<{
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
   * @param indexId - The index to check
   * @param userId - The user to verify ownership for
   * @returns True if user is an owner
   */
  isIndexOwner(indexId: string, userId: string): Promise<boolean>;

  /**
   * Check if user is a member of a specific index.
   *
   * @param indexId - The index to check
   * @param userId - The user to verify membership for
   * @returns True if user is a member
   */
  isIndexMember(indexId: string, userId: string): Promise<boolean>;

  /**
   * Get all members of an index with their details.
   * **OWNER ONLY** - throws if user is not an owner.
   *
   * @param indexId - The index to get members for
   * @param requestingUserId - The user requesting (must be owner)
   * @returns Array of member details with intent counts
   * @throws Error if requestingUserId is not an owner
   */
  getIndexMembersForOwner(
    indexId: string,
    requestingUserId: string
  ): Promise<IndexMemberDetails[]>;

  /**
   * Get all members of an index with their details.
   * **MEMBER ONLY** - any member of the index can list members (not just owners).
   * Returns same shape as getIndexMembersForOwner; email may be omitted for privacy.
   *
   * @param indexId - The index to get members for
   * @param requestingUserId - The user requesting (must be a member of the index)
   * @returns Array of member details with intent counts
   * @throws Error if requestingUserId is not a member of the index
   */
  getIndexMembersForMember(
    indexId: string,
    requestingUserId: string
  ): Promise<IndexMemberDetails[]>;

  /**
   * Get all members from every index the user is a member of (deduplicated).
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
   * @param indexId - The index to get intents for
   * @param requestingUserId - The user requesting (must be owner)
   * @param options - Pagination options
   * @returns Array of intent details with owner info
   * @throws Error if requestingUserId is not an owner
   */
  getIndexIntentsForOwner(
    indexId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<IndexedIntentDetails[]>;

  /**
   * Get all indexed intents for an index.
   * **MEMBER ONLY** - any member of the index can list intents (not just owners).
   *
   * @param indexId - The index to get intents for
   * @param requestingUserId - The user requesting (must be a member of the index)
   * @param options - Pagination options
   * @returns Array of intent details with owner info
   * @throws Error if requestingUserId is not a member of the index
   */
  getIndexIntentsForMember(
    indexId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<IndexedIntentDetails[]>;

  /**
   * Update index settings.
   * **OWNER ONLY** - throws if user is not an owner.
   *
   * @param indexId - The index to update
   * @param requestingUserId - The user requesting (must be owner)
   * @param data - The settings to update
   * @returns The updated index
   * @throws Error if requestingUserId is not an owner
   */
  updateIndexSettings(
    indexId: string,
    requestingUserId: string,
    data: UpdateIndexSettingsData
  ): Promise<OwnedIndex>;

  /**
   * Soft-delete an index (set deletedAt).
   * Caller must ensure index is not personal and has no other members.
   *
   * @param indexId - The index to soft-delete
   */
  softDeleteIndex(indexId: string): Promise<void>;

  /**
   * Delete a user's profile (removes profile row).
   * Used after confirmation in chat tools.
   *
   * @param userId - User whose profile to delete
   */
  deleteProfile(userId: string): Promise<void>;

  /**
   * Get a user's profile including its row id (for update_user_profile validation).
   *
   * @param userId - The user whose profile to fetch
   * @returns Profile with id, or null if not found
   */
  getProfileByUserId(userId: string): Promise<(ProfileDocument & { id: string }) | null>;

  /**
   * Create a new index and return its record.
   *
   * @param data - Title, optional prompt, optional imageUrl, optional joinPolicy
   * @returns The created index with id, title, prompt, imageUrl, permissions
   */
  createIndex(data: {
    title: string;
    prompt?: string | null;
    imageUrl?: string | null;
    joinPolicy?: 'anyone' | 'invite_only';
  }): Promise<{
    id: string;
    title: string;
    prompt: string | null;
    imageUrl: string | null;
    permissions: { joinPolicy: 'anyone' | 'invite_only'; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean };
  }>;

  /**
   * Count members in an index (for delete guard).
   *
   * @param indexId - The index to count
   * @returns Number of members
   */
  getIndexMemberCount(indexId: string): Promise<number>;

  /**
   * Add a user as a member of an index (replaces deprecated lib/index-members.ts).
   *
   * @param indexId - The index to add to
   * @param userId - The user to add
   * @param role - owner | admin | member
   * @returns success and optionally alreadyMember if they were already in the index
   */
  addMemberToIndex(
    indexId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member'
  ): Promise<{ success: boolean; alreadyMember?: boolean }>;

  /**
   * Removes a user from an index.
   * Only the index owner can remove members. Cannot remove the owner.
   *
   * @param indexId - The index to remove from
   * @param userId - The user to remove
   * @returns success, or wasOwner/notMember if removal failed
   */
  removeMemberFromIndex(
    indexId: string,
    userId: string
  ): Promise<{ success: boolean; wasOwner?: boolean; notMember?: boolean }>;

  // ─────────────────────────────────────────────────────────────────────────────
  // HyDE Document Operations (Opportunity Redesign)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a HyDE document by source and strategy/lens hash.
   * Returns the first matching document when multiple target corpuses exist.
   *
   * @param sourceType - 'intent' | 'profile' | 'query'
   * @param sourceId - Source entity ID (e.g. intent ID, user ID)
   * @param strategy - Lens hash (SHA-256 of lens label) or legacy strategy name
   * @returns The HyDE document or null if not found
   */
  getHydeDocument(
    sourceType: HydeSourceType,
    sourceId: string,
    strategy: string
  ): Promise<HydeDocument | null>;

  /**
   * Get all HyDE documents for a source (all strategies).
   *
   * @param sourceType - 'intent' | 'profile' | 'query'
   * @param sourceId - Source entity ID
   * @returns Array of HyDE documents for that source
   */
  getHydeDocumentsForSource(
    sourceType: HydeSourceType,
    sourceId: string
  ): Promise<HydeDocument[]>;

  /**
   * Save a HyDE document (upsert by sourceType + sourceId + strategy/lensHash + targetCorpus).
   *
   * @param data - HyDE document data
   * @returns The saved HyDE document
   */
  saveHydeDocument(data: CreateHydeDocumentData): Promise<HydeDocument>;

  /**
   * Delete all HyDE documents for a source (e.g. when intent/profile archived).
   *
   * @param sourceType - 'intent' | 'profile' | 'query'
   * @param sourceId - Source entity ID
   * @returns Number of documents deleted
   */
  deleteHydeDocumentsForSource(
    sourceType: HydeSourceType,
    sourceId: string
  ): Promise<number>;

  /**
   * Delete expired HyDE documents (expires_at <= now). Used by maintenance jobs.
   *
   * @returns Number of documents deleted
   */
  deleteExpiredHydeDocuments(): Promise<number>;

  /**
   * Get stale HyDE documents for refresh (e.g. createdAt < threshold).
   *
   * @param threshold - Date threshold; documents created before this are considered stale
   * @returns Array of stale HyDE documents
   */
  getStaleHydeDocuments(threshold: Date): Promise<HydeDocument[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Opportunity Operations (Opportunity Redesign)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new opportunity.
   *
   * @param data - Opportunity creation data
   * @returns The created opportunity
   */
  createOpportunity(data: CreateOpportunityData): Promise<Opportunity>;

  /**
   * Get a single opportunity by ID.
   *
   * @param id - Opportunity ID
   * @returns The opportunity or null if not found
   */
  getOpportunity(id: string): Promise<Opportunity | null>;

  /**
   * Get opportunities for a user (as any actor role).
   *
   * @param userId - User ID (actor userId)
   * @param options - Optional filters and pagination
   * @returns Array of opportunities
   */
  getOpportunitiesForUser(
    userId: string,
    options?: OpportunityQueryOptions
  ): Promise<Opportunity[]>;

  /**
   * Get opportunities in an index (for index admins).
   *
   * @param indexId - Index ID
   * @param options - Optional filters and pagination
   * @returns Array of opportunities
   */
  getOpportunitiesForIndex(
    indexId: string,
    options?: OpportunityQueryOptions
  ): Promise<Opportunity[]>;

  /**
   * Update an opportunity's status.
   *
   * @param id - Opportunity ID
   * @param status - New status
   * @returns The updated opportunity or null if not found
   */
  updateOpportunityStatus(
    id: string,
    status: OpportunityStatus
  ): Promise<Opportunity | null>;

  /**
   * Create one opportunity and expire others in a single transaction.
   * Atomic: insert then update status to 'expired' for each id in expireIds.
   * Used when enriching replaces overlapping opportunities so subscribers see consistent state.
   *
   * @param data - Opportunity creation data (caller may set status when enriched)
   * @param expireIds - Opportunity IDs to set status to 'expired'
   * @returns The created opportunity and the list of opportunities that were expired
   */
  createOpportunityAndExpireIds(
    data: CreateOpportunityData,
    expireIds: string[]
  ): Promise<{ created: Opportunity; expired: Opportunity[] }>;

  /**
   * Check if an opportunity already exists between the given actors in the index (deduplication).
   *
   * @param actorIds - Array of user IDs that would be actors
   * @param indexId - Index ID
   * @returns True if a non-expired opportunity exists with exactly these actors in this index
   */
  opportunityExistsBetweenActors(
    actorIds: string[],
    indexId: string
  ): Promise<boolean>;

  /**
   * Return one non-expired opportunity between the given actors in the index, if any.
   * Used to avoid creating a duplicate and to surface existing opportunity id/status.
   *
   * @param actorIds - Array of user IDs that would be actors
   * @param indexId - Index ID
   * @returns The first matching opportunity's id and status, or null
   */
  getOpportunityBetweenActors(
    actorIds: string[],
    indexId: string
  ): Promise<{ id: Id<'opportunities'>; status: OpportunityStatus } | null>;

  /**
   * Find opportunities whose non-introducer actor set exactly matches the given user IDs.
   * Overlap semantics: exact actor-set equality — an opportunity is returned only if its set of
   * non-introducer actor userIds (ignoring introducers) equals the set of actorUserIds. Index-agnostic;
   * opportunities are not scoped to a single index.
   *
   * @param actorUserIds - Typed user IDs of non-introducer actors (order-independent; compared as sets)
   * @param options - Optional excludeStatuses (no default). Uses OpportunityStatus.
   * @returns Promise of opportunities matching the exact actor set, excluding specified statuses
   */
  findOverlappingOpportunities(
    actorUserIds: Id<'users'>[],
    options?: { excludeStatuses?: OpportunityStatus[] }
  ): Promise<Opportunity[]>;

  /**
   * Expire opportunities referencing an intent (e.g. when intent is archived).
   *
   * @param intentId - Intent ID to match in opportunity actors
   * @returns Number of opportunities updated to expired
   */
  expireOpportunitiesByIntent(intentId: string): Promise<number>;

  /**
   * Expire opportunities for a user removed from an index.
   *
   * @param indexId - Index ID
   * @param userId - User ID that was removed
   * @returns Number of opportunities updated to expired
   */
  expireOpportunitiesForRemovedMember(
    indexId: string,
    userId: string
  ): Promise<number>;

  /**
   * Expire opportunities whose expires_at <= now. Used by maintenance cron.
   *
   * @returns Number of opportunities updated to expired
   */
  expireStaleOpportunities(): Promise<number>;

  /**
   * Get accepted opportunities between two actors (same actor pair, status accepted).
   * Used when building accepted-opportunities meta after accept (e.g. for chat channel).
   *
   * @param userId - First actor user ID
   * @param counterpartUserId - Second actor user ID
   * @returns Accepted opportunities between these two users, newest first
   */
  getAcceptedOpportunitiesBetweenActors(
    userId: string,
    counterpartUserId: string
  ): Promise<Opportunity[]>;

  /**
   * Accept all sibling opportunities between the same actor pair in one transaction.
   * Selects opportunities where both userId and counterpartUserId are actors and status
   * is not accepted/expired/rejected, excludes excludeOpportunityId, then bulk-updates status to accepted.
   * Rolls back on any failure.
   *
   * @param userId - First actor user ID
   * @param counterpartUserId - Second actor user ID
   * @param excludeOpportunityId - Opportunity ID to exclude (the one already being accepted)
   * @returns IDs of opportunities that were updated to accepted
   */
  acceptSiblingOpportunities(
    userId: string,
    counterpartUserId: string,
    excludeOpportunityId: string
  ): Promise<string[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Contact / My Network Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /** Create a ghost user (unregistered contact) with empty profile. */
  createGhostUser(data: { name: string; email: string }): Promise<{ id: string }>;

  /** Upsert a contact membership in the owner's personal index (index_members with permissions=['contact']). */
  upsertContactMembership(ownerId: string, contactUserId: string, options?: { restore?: boolean }): Promise<void>;

  /** Hard-delete a contact membership from the owner's personal index. */
  hardDeleteContactMembership(ownerId: string, contactUserId: string): Promise<void>;

  /** Get all contact members from the owner's personal index with user details. */
  getContactMembers(ownerId: string): Promise<Array<{
    userId: string;
    user: { id: string; name: string; email: string; avatar: string | null; isGhost: boolean };
  }>>;

  /** Clear a reverse opt-out (reactivate soft-deleted contact membership in another user's personal index). */
  clearReverseOptOut(ownerId: string, otherUserId: string): Promise<void>;

  /**
   * Returns the IDs of personal indexes where the given user is a contact member.
   * Used for auto-assigning new intents to personal indexes of contacts who imported this user.
   *
   * @param userId - The user whose contact memberships to look up
   * @returns Array of personal index IDs
   */
  getPersonalIndexesForContact(userId: string): Promise<{ indexId: string }[]>;

  /** Find a user by email. */
  getUserByEmail(email: string): Promise<{ id: string; name: string; email: string; isGhost: boolean } | null>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// USER DATABASE INTERFACE (Own Resources Only)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Context-bound database for accessing the authenticated user's own resources.
 * Created with authUserId bound at construction; no userId parameter needed on methods.
 *
 * **NOT index-scoped**: Returns ALL of the user's own resources regardless of index.
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
  getProfile(): Promise<ProfileDocument | null>;

  /** Get the authenticated user's profile with row ID. */
  getProfileByUserId(): Promise<(ProfileDocument & { id: string }) | null>;

  /** Save/update the authenticated user's profile. */
  saveProfile(profile: ProfileDocument): Promise<void>;

  /** Delete the authenticated user's profile. */
  deleteProfile(): Promise<void>;

  /** Get the authenticated user's basic record (name, email, socials). */
  getUser(): Promise<UserRecord | null>;

  /** Update the authenticated user's account fields. */
  updateUser(data: { name?: string; intro?: string; location?: string; socials?: UserSocials; onboarding?: OnboardingState }): Promise<UserRecord | null>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Intent Operations (own only, ALL intents - not index-scoped)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get ALL active intents for the authenticated user (not index-filtered). */
  getActiveIntents(): Promise<ActiveIntent[]>;

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

  /** Get intent fields for indexing (own intent). */
  getIntentForIndexing(intentId: string): Promise<{
    id: string;
    payload: string;
    userId: string;
    sourceType: string | null;
    sourceId: string | null;
  } | null>;

  /** Associate an intent with indexes. */
  associateIntentWithIndexes(intentId: string, indexIds: string[]): Promise<void>;

  /** Assign an intent to an index. */
  assignIntentToIndex(intentId: string, indexId: string, relevancyScore?: number): Promise<void>;

  /** Unassign an intent from an index. */
  unassignIntentFromIndex(intentId: string, indexId: string): Promise<void>;

  /** Get index IDs for an intent. */
  getIndexIdsForIntent(intentId: string): Promise<string[]>;

  /** Check if intent is assigned to index. */
  isIntentAssignedToIndex(intentId: string, indexId: string): Promise<boolean>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Membership Operations (own memberships only)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get all index memberships for the authenticated user. */
  getIndexMemberships(): Promise<IndexMembership[]>;

  /** Get index IDs with auto-assign enabled for the authenticated user. */
  getUserIndexIds(): Promise<string[]>;

  /** Get indexes owned by the authenticated user. */
  getOwnedIndexes(): Promise<OwnedIndex[]>;

  /** Get a specific index membership for the authenticated user. */
  getIndexMembership(indexId: string): Promise<IndexMembership | null>;

  /** Get index + member context for the authenticated user (for auto-assign). */
  getIndexMemberContext(indexId: string): Promise<{
    indexId: string;
    indexPrompt: string | null;
    memberPrompt: string | null;
  } | null>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Index CRUD Operations (owner operations on own indexes)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Create a new index (user becomes owner). */
  createIndex(data: {
    title: string;
    prompt?: string | null;
    imageUrl?: string | null;
    joinPolicy?: 'anyone' | 'invite_only';
  }): Promise<{
    id: string;
    title: string;
    prompt: string | null;
    imageUrl: string | null;
    permissions: { joinPolicy: 'anyone' | 'invite_only'; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean };
  }>;

  /** Update index settings (owner only). */
  updateIndexSettings(indexId: string, data: UpdateIndexSettingsData): Promise<OwnedIndex>;

  /** Soft-delete an index (owner only). */
  softDeleteIndex(indexId: string): Promise<void>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Public Index Discovery (joinable indexes the user is not a member of)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get public indexes (joinPolicy 'anyone') that the user has not joined. */
  getPublicIndexesNotJoined(): Promise<{
    indexes: Array<{
      id: string;
      title: string;
      prompt: string | null;
      memberCount: number;
      owner: { id: string; name: string; avatar: string | null } | null;
    }>;
  }>;

  /** Join a public index (validates joinPolicy === 'anyone'). */
  joinPublicIndex(indexId: string): Promise<{ success: boolean; alreadyMember?: boolean }>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Opportunity Operations (where user is actor)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get opportunities where the authenticated user is an actor. */
  getOpportunitiesForUser(options?: OpportunityQueryOptions): Promise<Opportunity[]>;

  /** Get a specific opportunity (if user is an actor). */
  getOpportunity(id: string): Promise<Opportunity | null>;

  /** Update an opportunity's status (if user is an actor). */
  updateOpportunityStatus(id: string, status: OpportunityStatus): Promise<Opportunity | null>;

  /** Get accepted opportunities between the authenticated user and another actor. */
  getAcceptedOpportunitiesBetweenActors(counterpartUserId: string): Promise<Opportunity[]>;

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
// SYSTEM DATABASE INTERFACE (Cross-User Within Shared Indexes)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Context-bound database for LLM/system operations that access cross-user resources.
 * Created with authUserId + indexScope[]; validates membership before access.
 *
 * **Index-scoped**: All cross-user operations are restricted to users/resources
 * within the bound indexScope[]. This prevents the LLM from accessing arbitrary users' data.
 *
 * Use via `createSystemDatabase(db, authUserId, indexScope)` factory function.
 */
export interface SystemDatabase {
  /** The bound authenticated user ID */
  readonly authUserId: string;

  /** The indexes the authenticated user has access to (determines cross-user scope) */
  readonly indexScope: string[];

  // ─────────────────────────────────────────────────────────────────────────────
  // Profile Operations (any user in scope)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get a user's profile (requires shared index membership). */
  getProfile(userId: string): Promise<ProfileDocument | null>;

  /** Get a user's basic record (requires shared index membership). */
  getUser(userId: string): Promise<UserRecord | null>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Intent Operations (cross-user within shared indexes)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get all intents in an index (cross-user, requires membership). */
  getIntentsInIndex(indexId: string, options?: { limit?: number; offset?: number }): Promise<IndexedIntentDetails[]>;

  /** Get a specific user's intents in an index (requires shared membership). */
  getUserIntentsInIndex(userId: string, indexId: string): Promise<ActiveIntent[]>;

  /** Get a single intent by ID (if in scope). */
  getIntent(intentId: string): Promise<IntentRecord | null>;

  /** Find similar intents across users within the index scope. */
  findSimilarIntentsInScope(embedding: number[], options?: SimilarIntentSearchOptions): Promise<SimilarIntent[]>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Membership Operations (any index in scope)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Check if a user is a member of an index. */
  isIndexMember(indexId: string, userId: string): Promise<boolean>;

  /** Check if a user is an owner of an index. */
  isIndexOwner(indexId: string, userId: string): Promise<boolean>;

  /** Get all members of an index (requires membership). */
  getIndexMembers(indexId: string): Promise<IndexMemberDetails[]>;

  /** Get all members across all indexes in scope (deduplicated). */
  getMembersFromScope(): Promise<{ userId: Id<'users'>; name: string; avatar: string | null }[]>;

  /** Add a user to an index (requires ownership or 'anyone' policy). */
  addMemberToIndex(indexId: string, userId: string, role: 'owner' | 'admin' | 'member'): Promise<{ success: boolean; alreadyMember?: boolean }>;

  /** Remove a user from an index (requires ownership). Cannot remove the owner. */
  removeMemberFromIndex(indexId: string, userId: string): Promise<{ success: boolean; wasOwner?: boolean; notMember?: boolean }>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Operations (any index in scope)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Get index info by ID (requires scope). */
  getIndex(indexId: string): Promise<{ id: string; title: string } | null>;

  /** Get index with permissions (requires scope). */
  getIndexWithPermissions(indexId: string): Promise<{ id: string; title: string; permissions: { joinPolicy: 'anyone' | 'invite_only' } } | null>;

  /** Get member count for an index (requires scope). */
  getIndexMemberCount(indexId: string): Promise<number>;

  // ─────────────────────────────────────────────────────────────────────────────
  // Opportunity Operations (cross-user within scope)
  // ─────────────────────────────────────────────────────────────────────────────

  /** Create an opportunity (cross-user). */
  createOpportunity(data: CreateOpportunityData): Promise<Opportunity>;

  /** Create opportunity and expire overlapping ones atomically. */
  createOpportunityAndExpireIds(data: CreateOpportunityData, expireIds: string[]): Promise<{ created: Opportunity; expired: Opportunity[] }>;

  /** Get an opportunity by ID (for system processing). */
  getOpportunity(id: string): Promise<Opportunity | null>;

  /** Get opportunities for an index (requires membership). */
  getOpportunitiesForIndex(indexId: string, options?: OpportunityQueryOptions): Promise<Opportunity[]>;

  /** Update an opportunity's status (system-level). */
  updateOpportunityStatus(id: string, status: OpportunityStatus): Promise<Opportunity | null>;

  /** Check if opportunity exists between actors in an index. */
  opportunityExistsBetweenActors(actorIds: string[], indexId: string): Promise<boolean>;

  /** Return one opportunity between actors in the index (id + status), or null. */
  getOpportunityBetweenActors(actorIds: string[], indexId: string): Promise<{ id: Id<'opportunities'>; status: OpportunityStatus } | null>;

  /** Find overlapping opportunities by actor set. */
  findOverlappingOpportunities(actorUserIds: Id<'users'>[], options?: { excludeStatuses?: OpportunityStatus[] }): Promise<Opportunity[]>;

  /** Expire opportunities referencing an intent. */
  expireOpportunitiesByIntent(intentId: string): Promise<number>;

  /** Expire opportunities for a removed member. */
  expireOpportunitiesForRemovedMember(indexId: string, userId: string): Promise<number>;

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
// - ProfileGraphDatabase → maps to UserDatabase (user's own profile operations)
// - IntentGraphDatabase → maps to UserDatabase (mutations) + SystemDatabase (reads)
// - OpportunityGraphDatabase → maps to SystemDatabase (cross-user operations)
// - IndexGraphDatabase → maps to UserDatabase (own indexes)
// - IntentIndexGraphDatabase → maps to both (own intent ↔ shared index)
// - IndexMembershipGraphDatabase → maps to SystemDatabase (cross-user)
// - HydeGraphDatabase → maps to both (own HyDE vs cross-user matching)
//
// Graphs continue to use these narrowed types because:
// 1. They receive the raw database adapter with userId passed per method
// 2. Access control is enforced at the tool/factory layer via createUserDatabase/createSystemDatabase
// 3. These types ensure graphs only depend on methods they actually use
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database interface narrowed for Profile Graph operations.
 * Provides full profile lifecycle: read, write, HyDE management, and query mode.
 *
 * Access layer: Primarily UserDatabase (user's own profile)
 */
export type ProfileGraphDatabase = Pick<
  Database,
  'getProfile' | 'getUser' | 'updateUser' | 'saveProfile' | 'getProfileByUserId' | 'getHydeDocument' | 'saveHydeDocument'
>;

/**
 * Composite database interface for Chat Graph.
 * Includes direct ChatGraph operations plus all methods needed by
 * internally composed subgraphs (ProfileGraph, OpportunityGraph, IntentGraph, IndexGraph).
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
  | 'getIntentsInIndexForMember'
  // ProfileGraph subgraph requirements
  | 'getUser'
  | 'updateUser'
  | 'saveProfile'
  // IntentGraph subgraph requirements (getActiveIntents already included)
  | 'createIntent'
  | 'updateIntent'
  | 'archiveIntent'
  // OpportunityGraph subgraph requirements (getProfile already included)
  | 'createOpportunity'
  | 'getOpportunity'
  | 'opportunityExistsBetweenActors'
  | 'getOpportunityBetweenActors'
  | 'findOverlappingOpportunities'
  | 'getOpportunitiesForUser'
  | 'updateOpportunityStatus'
  // HyDE graph (used by OpportunityGraph)
  | 'getHydeDocument'
  | 'getHydeDocumentsForSource'
  | 'saveHydeDocument'
  | 'getIntent'
  // IndexGraph subgraph requirements (index created intents in user's indexes)
  | 'getPublicIndexesNotJoined'
  | 'getUserIndexIds'
  | 'getIndexMemberships'
  | 'getIndexMembership'
  | 'getIndex'
  | 'getIndexWithPermissions'
  | 'getIntentForIndexing'
  | 'getIndexMemberContext'
  | 'isIntentAssignedToIndex'
  | 'assignIntentToIndex'
  | 'unassignIntentFromIndex'
  | 'getIndexIdsForIntent'
  | 'getIntentIndexScores'
  // Personal index auto-assignment (used by intent graph executor)
  | 'getPersonalIndexesForContact'
  // Index Ownership Operations (owner-only)
  | 'getOwnedIndexes'
  | 'isIndexOwner'
  | 'isIndexMember'
  | 'getIndexMembersForOwner'
  | 'getIndexMembersForMember'
  | 'getMembersFromUserIndexes'
  | 'getIndexIntentsForOwner'
  | 'getIndexIntentsForMember'
  | 'updateIndexSettings'
  | 'softDeleteIndex'
  | 'deleteProfile'
  | 'getProfileByUserId'
  | 'createIndex'
  | 'getIndexMemberCount'
  | 'addMemberToIndex'
  | 'removeMemberFromIndex'
>;

/**
 * Database interface for Opportunity Graph operations.
 * Includes prep/scope (index membership, intents, index details), persist (create, dedupe),
 * and CRUD operations (read, update status, send).
 *
 * Access layer: SystemDatabase (cross-user opportunity operations)
 */
export type OpportunityGraphDatabase = Pick<
  Database,
  | 'getProfile'
  | 'createOpportunity'
  | 'opportunityExistsBetweenActors'
  | 'getOpportunityBetweenActors'
  | 'findOverlappingOpportunities'
  | 'getUserIndexIds'
  | 'getIndexMemberships'
  | 'getActiveIntents'
  | 'getIndexIdsForIntent'
  | 'getIndex'
  | 'getIndexMemberCount'
  | 'getIntentIndexScores'
  | 'getIndexMemberContext'
  // Read/update/send modes
  | 'getOpportunity'
  | 'getOpportunitiesForUser'
  | 'updateOpportunityStatus'
  | 'isIndexMember'
  | 'getUser'
  // Load candidate intent payload/summary for evaluator
  | 'getIntent'
>;

/**
 * Database interface for the negotiation graph (A2A conversation/task/artifact persistence).
 *
 * Access layer: ConversationDatabaseAdapter
 */
export interface NegotiationDatabase {
  /**
   * Creates an A2A conversation between negotiation agents.
   * @param participants - Agent participant descriptors
   * @returns The created conversation with its id
   */
  createConversation(participants: { participantId: string; participantType: 'user' | 'agent' }[]): Promise<{ id: string }>;

  /**
   * Persists a negotiation turn message within a conversation.
   * @param data - Message payload including conversation, sender, role, and structured parts
   * @returns The persisted message record
   */
  createMessage(data: {
    conversationId: string;
    senderId: string;
    role: 'user' | 'agent';
    parts: unknown[];
    taskId?: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<{ id: string; senderId: string; role: 'user' | 'agent'; parts: unknown; createdAt: Date }>;

  /**
   * Creates a task to track the negotiation lifecycle within a conversation.
   * @param conversationId - Parent conversation id
   * @param metadata - Task metadata (type, sourceUserId, candidateUserId)
   * @returns The created task with id, conversationId, and initial state
   */
  createTask(conversationId: string, metadata?: Record<string, unknown>): Promise<{ id: string; conversationId: string; state: string }>;

  /**
   * Transitions a task to a new state (e.g. working, completed, failed).
   * @param taskId - Task to update
   * @param state - Target state
   * @param statusMessage - Optional status message or structured status
   * @returns The updated task record
   */
  updateTaskState(taskId: string, state: string, statusMessage?: unknown): Promise<{ id: string; conversationId: string; state: string }>;

  /**
   * Persists a negotiation outcome artifact attached to a task.
   * @param data - Artifact payload including task reference, name, structured parts, and metadata
   * @returns The created artifact with its id
   */
  createArtifact(data: { taskId: string; name?: string; parts: unknown[]; metadata?: Record<string, unknown> | null }): Promise<{ id: string }>;
}

/**
 * Database interface for opportunity controller (API).
 *
 * Access layer: Both UserDatabase + SystemDatabase (API handles auth)
 */
export type OpportunityControllerDatabase = Pick<
  Database,
  | 'getOpportunity'
  | 'getOpportunitiesForUser'
  | 'getOpportunitiesForIndex'
  | 'updateOpportunityStatus'
  | 'createOpportunity'
  | 'createOpportunityAndExpireIds'
  | 'opportunityExistsBetweenActors'
  | 'findOverlappingOpportunities'
  | 'getAcceptedOpportunitiesBetweenActors'
  | 'acceptSiblingOpportunities'
  | 'isIndexOwner'
  | 'isIndexMember'
  | 'getUser'
  | 'getIndex'
  | 'getIndexMemberships'
  | 'getProfile'
  | 'getActiveIntents'
  | 'upsertContactMembership'
>;

/**
 * Database interface narrowed for Intent Graph operations.
 * Provides state population (getActiveIntents), action execution (create/update/archive),
 * and read operations (query intents; getIntentsInIndexForMember for index-scoped reads).
 *
 * Access layer: UserDatabase (mutations on own intents) + SystemDatabase (index-scoped reads)
 */
export type IntentGraphDatabase = Pick<
  Database,
  | 'getActiveIntents'
  | 'getIntentsInIndexForMember'
  | 'createIntent'
  | 'updateIntent'
  | 'archiveIntent'
  // Read mode (queryNode) requirements
  | 'isIndexMember'
  | 'getIndexIntentsForMember'
  | 'getUser'
  // Profile check (prepNode gate for write operations)
  | 'getProfile'
  // Personal index auto-assignment
  | 'getPersonalIndexesForContact'
  | 'assignIntentToIndex'
>;

/**
 * Database interface narrowed for Index Graph CRUD operations.
 * Handles create, read, update, delete of indexes (communities).
 *
 * Access layer: UserDatabase (CRUD on own indexes and memberships)
 */
export type IndexGraphDatabase = Pick<
  Database,
  | 'getIndexMemberships'
  | 'getOwnedIndexes'
  | 'getPublicIndexesNotJoined'
  | 'isIndexOwner'
  | 'isIndexMember'
  | 'getIndex'
  | 'createIndex'
  | 'addMemberToIndex'
  | 'updateIndexSettings'
  | 'softDeleteIndex'
  | 'getIndexMemberCount'
>;

/**
 * Database interface narrowed for Intent Index Graph operations.
 * Provides intent/index context and assignment for intent–index evaluation.
 * (Migrated from the old IndexGraphDatabase.)
 *
 * Access layer: UserDatabase (own intent assignment) + SystemDatabase (index context)
 */
export type IntentIndexGraphDatabase = Pick<
  Database,
  | 'getIntentForIndexing'
  | 'getIndexMemberContext'
  | 'isIntentAssignedToIndex'
  | 'assignIntentToIndex'
  | 'unassignIntentFromIndex'
  | 'getIntent'
  | 'isIndexMember'
  | 'getIndexIdsForIntent'
  | 'getIndexIntentsForMember'
  | 'getIntentsInIndexForMember'
>;

/**
 * Database interface narrowed for Index Membership Graph operations.
 * Handles CRUD for index memberships (add, list, remove members).
 *
 * Access layer: SystemDatabase (cross-user membership operations)
 */
export type IndexMembershipGraphDatabase = Pick<
  Database,
  | 'isIndexMember'
  | 'isIndexOwner'
  | 'getIndexWithPermissions'
  | 'addMemberToIndex'
  | 'removeMemberFromIndex'
  | 'getIndexMembersForMember'
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
 * Database interface for Home Graph (opportunity home view).
 * Load opportunities, enrich with profile/index, and support presenter context.
 *
 * Access layer: UserDatabase (own opportunities and profile)
 */
export type HomeGraphDatabase = Pick<
  Database,
  | 'getOpportunitiesForUser'
  | 'getOpportunity'
  | 'getProfile'
  | 'getActiveIntents'
  | 'getIndex'
  | 'getUser'
>;
