/**
 * Shared infrastructure for the database adapters: drizzle client, schema
 * tables, operators, DTO types, and cross-adapter helper functions.
 * No dependency on lib/protocol. Imported by every database/*.adapter.ts file.
 */
import { eq, and, or, isNull, isNotNull, sql, count, desc, gt, gte, lt, lte, ne, inArray, ilike, notInArray, asc, not } from 'drizzle-orm/sql';
import * as schema from '../schemas/database.schema';
import db from '../lib/drizzle/drizzle';
import { traceAppOperation } from '../lib/sentry-performance';
import { normalizeEmbedding } from '../lib/embedding/vector';
import { normalizeTelegramSocialValue } from '../lib/telegram/socials';
import type { User, NotificationPreferences, OnboardingState } from '../schemas/database.schema';
import type { Conversation, ConversationParticipant, ConversationSession, Message } from '../schemas/conversation.schema';
import type { Id } from '../types/common.types';
import { log } from '../lib/log';

// Re-export the import surface so domain adapter files import everything from one module.
export { schema, db, traceAppOperation, normalizeEmbedding, normalizeTelegramSocialValue, log };
export { canActorSeeOpportunity } from './opportunity.visibility';
export { eq, and, or, isNull, isNotNull, sql, count, desc, gt, gte, lt, lte, ne, inArray, ilike, notInArray, asc, not };
export type { User, NotificationPreferences, OnboardingState, Conversation, ConversationParticipant, ConversationSession, Message, Id };
export const logger = log.lib.from('database.adapter');

export function detectSocialLabel(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes('linkedin.com')) return 'linkedin';
  if (lower.includes('x.com') || lower.includes('twitter.com')) return 'twitter';
  if (lower.includes('github.com')) return 'github';
  if (lower.includes('t.me') || lower.includes('telegram.me')) return 'telegram';
  return 'custom';
}

/** Sentinel participant ID for the built-in chat agent. */
export const SYSTEM_AGENT_ID = 'system-agent';


// Local types used by adapters (shapes only; protocol layer defines the contracts)
export interface ActiveIntentRow {
  id: string;
  payload: string;
  summary: string | null;
  createdAt: Date;
  relevancyScore?: number | null;
}
export type SourceType = 'integration' | 'discovery_form' | 'enrichment';

export interface CreateIntentInput {
  userId: string;
  payload: string;
  summary?: string | null;
  embedding?: number[];
  isIncognito?: boolean;
  sourceType?: SourceType | null;
  sourceId?: string | null;
  semanticEntropy?: number | null;
  referentialAnchor?: string | null;
  felicityAuthority?: number | null;
  felicitySincerity?: number | null;
  felicityClarity?: number | null;
  intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;
  speechActType?: 'COMMISSIVE' | 'DIRECTIVE' | null;
}
export interface UpdateIntentInput {
  payload?: string;
  summary?: string | null;
  embedding?: number[];
  isIncognito?: boolean;
  semanticEntropy?: number | null;
  referentialAnchor?: string | null;
  felicityAuthority?: number | null;
  felicitySincerity?: number | null;
  felicityClarity?: number | null;
  intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;
  speechActType?: 'COMMISSIVE' | 'DIRECTIVE' | null;
  /** Final row-lock compare-and-set guard for recovery-answer updates only. */
  expectedIntentFingerprint?: string;
  /** Expected owner paired with the recovery-answer fingerprint guard. */
  expectedIntentUserId?: string;
}
export interface CreatedIntentRow {
  id: string;
  payload: string;
  summary: string | null;
  isIncognito: boolean;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}
export interface ArchiveResultShape {
  success: boolean;
  error?: string;
}
export type IntentLifecycleStatus = 'ACTIVE' | 'PAUSED' | 'FULFILLED' | 'EXPIRED';

export interface IntentListRow {
  id: string;
  payload: string;
  summary: string | null;
  status: IntentLifecycleStatus | null;
  isIncognito: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  sourceType: string | null;
  sourceId: string | null;
  /**
   * Networks this intent is currently registered to. Empty when the intent is
   * still being evaluated (HyDE assignment not yet run) or genuinely matched
   * nothing — the frontend distinguishes those two via the intent's age. Lets
   * the UI surface orphaned intents instead of hiding the assignment outcome.
   */
  networks: { id: string; title: string }[];
  /**
   * Count of distinct `pending` opportunities awaiting this owner that are
   * attributed to this signal by `detection.triggeredBy` or the owner's
   * actor intent. Rows the owner already acted on are excluded.
   */
  waitingOpportunityCount: number;
  /** True while a fresh intent has not completed its first discovery run. */
  warming: boolean;
}
// UserIdentity shape (aligned with `@indexnetwork/protocol`'s UserIdentity; defined
// locally to honor the adapter layering rule of not importing protocol interfaces).
export interface UserIdentity {
  userId?: string;
  identity: { name: string; bio: string; location: string };
  context: string;
}

export interface NetworkMembershipRow {
  networkId: string;
  networkTitle: string;
  networkPrompt: string | null;
  permissions: string[];
  memberPrompt: string | null;
  autoAssign: boolean;
  joinedAt: Date;
}

export const { intents, networks, networkMembers, intentNetworks, users, hydeDocuments, opportunities, negotiations, negotiationTurns, userNotificationSettings, sessions, userSocials } = schema;

/**
 * Build a {@link UserIdentity} from the canonical `users` table (WS5 / IND-363),
 * replacing the retired `user_profiles` read. Identity (name/bio/location) is sourced
 * from `users` (`name`/`intro`->bio/`location`). The `context` paragraph is sourced
 * elsewhere (the global user_context) and is left empty here.
 *
 * @param userId - The user whose identity representation to build.
 * @returns A UserIdentity, or null when the user does not exist.
 */
export async function buildProfileFromUser(userId: string): Promise<UserIdentity | null> {
  const rows = await db.select({
    id: users.id,
    name: users.name,
    intro: users.intro,
    location: users.location,
  })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  const user = rows[0];
  if (!user) return null;
  return {
    userId: user.id,
    identity: { name: user.name ?? '', bio: user.intro ?? '', location: user.location ?? '' },
    context: '',
  };
}

/**
 * {@link buildProfileFromUser} variant returning the legacy `& { id }` shape. Since the
 * `user_profiles` row no longer exists, `id` is the stable `userId`. Its sole consumer
 * (the WS8-bound enrichment-graph aggregate node) only uses it for existence/merge.
 *
 * @param userId - The user whose identity representation to build.
 * @returns A UserIdentity with an `id`, or null when the user does not exist.
 */
export async function buildProfileWithIdFromUser(userId: string): Promise<(UserIdentity & { id: string }) | null> {
  const profile = await buildProfileFromUser(userId);
  if (!profile) return null;
  return { id: profile.userId ?? userId, ...profile };
}

/**
 * Persist a profile draft's identity to the canonical `users` table (WS8 / IND-365).
 * The `user_profiles` table was dropped; identity (name/bio/location) lives on `users`
 * (`name`/`intro`<-bio/`location`), while skills/interests/narrative are derived from
 * the global user_context and have no column to persist. Empty identity
 * fields are skipped so a partial draft never clobbers existing identity.
 *
 * @param userId - The user whose identity to update.
 * @param profile - The identity draft whose `identity` fields are persisted.
 */
export async function persistProfileIdentityToUser(userId: string, profile: UserIdentity): Promise<void> {
  const identity = profile.identity ?? { name: '', bio: '', location: '' };
  const update: { name?: string; intro?: string; location?: string } = {};
  if (identity.name?.trim()) update.name = identity.name.trim();
  if (identity.bio?.trim()) update.intro = identity.bio.trim();
  if (identity.location?.trim()) update.location = identity.location.trim();
  if (Object.keys(update).length === 0) return;
  await db.update(users)
    .set({ ...update, updatedAt: new Date() })
    .where(eq(users.id, userId));
}

// HyDE row to document shape (embedding may come as number[] or pg vector)
export type HydeSourceTypeLocal = 'intent' | 'query' | 'context';
export interface HydeDocumentRow {
  id: string;
  sourceType: HydeSourceTypeLocal;
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
export function toHydeDocument(row: typeof hydeDocuments.$inferSelect): HydeDocumentRow {
  const vec = normalizeEmbedding(row.hydeEmbedding);
  return {
    id: row.id,
    sourceType: row.sourceType as HydeSourceTypeLocal,
    sourceId: row.sourceId,
    sourceText: row.sourceText,
    strategy: row.strategy,
    targetCorpus: row.targetCorpus,
    hydeText: row.hydeText,
    hydeEmbedding: vec,
    context: row.context as Record<string, unknown> | null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Intent Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Canonical lifecycle predicate for intents eligible to drive discovery.
 * Legacy null status remains discoverable alongside explicit `ACTIVE` rows.
 *
 * @returns A Drizzle predicate matching active lifecycle states.
 */
export function activeIntentLifecycleWhere() {
  return or(
    isNull(schema.intents.status),
    eq(schema.intents.status, 'ACTIVE'),
  );
}

/**
 * Canonical "active own intents" WHERE predicate: an unarchived, discoverable
 * row owned by the user. REST own-intent list/detail reads intentionally do not
 * use this predicate so paused and terminal records remain visible there.
 *
 * @param userId - Intent owner.
 * @returns A Drizzle predicate matching the owner's discoverable intents.
 */
export function activeOwnIntentsWhere(userId: string) {
  return and(
    eq(schema.intents.userId, userId),
    isNull(schema.intents.archivedAt),
    activeIntentLifecycleWhere(),
  );
}

/**
 * Canonical predicate for the paginated own-intents list: ownership + an
 * archived toggle (archived rows when `archived` is true, active rows
 * otherwise) + an optional sourceType narrow. Shares the ownership/active spine
 * with {@link activeOwnIntentsWhere} so list `count()` totals and graph reads
 * agree for the same identity. See EDG-53.
 */
export function ownIntentsListWhere(
  userId: string,
  options: { archived: boolean; sourceType?: string },
) {
  const conditions = [
    eq(schema.intents.userId, userId),
    options.archived
      ? isNotNull(schema.intents.archivedAt)
      : isNull(schema.intents.archivedAt),
  ];
  const validSourceTypes: SourceType[] = ['integration', 'discovery_form', 'enrichment'];
  if (options.sourceType && validSourceTypes.includes(options.sourceType as SourceType)) {
    conditions.push(eq(schema.intents.sourceType, options.sourceType as SourceType));
  }
  return and(...conditions);
}

export interface OpportunityRow {
  id: string;
  detection: schema.OpportunityDetection;
  actors: schema.OpportunityActor[];
  interpretation: schema.OpportunityInterpretation;
  context: schema.OpportunityContext;
  confidence: string;
  status: 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired';
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  metadata: Record<string, unknown>;
}

/** Create opportunity input (matches protocol CreateOpportunityData). */
export interface CreateOpportunityInput {
  detection: schema.OpportunityDetection;
  actors: schema.OpportunityActor[];
  interpretation: schema.OpportunityInterpretation;
  context: schema.OpportunityContext;
  confidence: string;
  status?: 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired';
  expiresAt?: Date;
  metadata?: Record<string, unknown> | null;
}

export function toOpportunityRow(row: typeof opportunities.$inferSelect): OpportunityRow {
  const confidence = row.confidence;
  return {
    id: row.id,
    detection: row.detection as schema.OpportunityDetection,
    actors: row.actors as schema.OpportunityActor[],
    interpretation: row.interpretation as schema.OpportunityInterpretation,
    context: row.context as schema.OpportunityContext,
    confidence: typeof confidence === 'string' ? confidence : String(confidence),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
  };
}

/**
 * Database adapter for Opportunity Graph and opportunity controller.
 */
export interface SaveHydeDocumentInput {
  sourceType: HydeSourceTypeLocal;
  sourceId?: string | null;
  sourceText?: string | null;
  strategy: string;
  targetCorpus: string;
  hydeText: string;
  hydeEmbedding: number[];
  context?: Record<string, unknown> | null;
  expiresAt?: Date | null;
}

/**
 * Database adapter for HyDE document persistence (HyDE Graph, maintenance jobs).
 */
export interface UserWithGraph {
  id: string;
  email: string | null;
  name: string | null;
  intro: string | null;
  location: string | null;
  socials: Array<{ id: string; userId: string; label: string; value: string }>;
  onboarding: unknown;
  avatar: string | null;
  timezone: string | null;
  lastWeeklyEmailSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  /** True when the user has been enriched into a global user_context row (the user_profiles replacement). */
  hasProfile: boolean;
  notificationPreferences: {
    connectionUpdates: boolean;
  };
}

export interface NewsletterUserData {
  id: string;
  email: string | null;
  name: string | null;
  intro: string | null;
  timezone: string | null;
  lastSent: Date | null;
  prefs: {
    connectionUpdates?: boolean;
  } | null;
  unsubscribeToken: string | null;
  onboarding: {
    completedAt?: string;
    flow?: 1 | 2 | 3;
    currentStep?: string;
  } | null;
}

export interface BasicUserInfo {
  id: string;
  name: string | null;
  intro: string | null;
}

/**
 * UserDatabaseAdapter
 *
 * Wraps all database operations for users table and related tables.
 */
export interface VectorStore {
  search<T>(
    queryVector: number[],
    collection: string,
    options?: { limit?: number; filter?: Record<string, unknown>; minScore?: number },
  ): Promise<{ item: T; score: number }[]>;
}

/** Intent record with similarity score, returned by findSimilarIntentsInScope. */
export interface SimilarIntent {
  id: string;
  payload: string;
  summary: string | null;
  isIncognito: boolean;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  archivedAt: Date | null;
  similarity: number;
}

/**
 * Creates a UserDatabase bound to the authenticated user.
 * All operations are scoped to the user's own resources (no userId param needed).
 *
 * @param db - The raw ChatDatabaseAdapter
 * @param authUserId - The authenticated user's ID
 * @returns A UserDatabase bound to authUserId
 */
export interface ResolvedParticipant {
  participantId: string;
  participantType: 'user' | 'agent';
  name: string | null;
  avatar: string | null;
  /** For agent participants, the display name of the user the agent acts on behalf of. */
  ownerName?: string | null;
}

/** Summary returned by getConversationsForUser. */
export interface ConversationSummary {
  id: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  participants: ResolvedParticipant[];
  lastMessage: { parts: unknown[]; senderId: string; createdAt: Date } | null;
  metadata: Record<string, unknown> | null;
  via: Array<{ intentId: string; opportunityId: string; title: string }>;
  unreadCount: number;
}

/**
 * Database adapter for the A2A-aligned conversation tables.
 *
 * @remarks
 * Covers conversations, participants, messages, and metadata.
 * Uses Drizzle ORM against the `conversations` family of tables.
 */

// ── De-duplicated query helpers (formerly copy-pasted across adapters) ──
export async function upsertIntentNetworkAssignment(
    intentId: string,
    networkId: string,
    relevancyScore?: number,
    assignmentMetadata?: import('@indexnetwork/protocol').NetworkAssignmentMetadata,
  ): Promise<void> {
    await db.insert(intentNetworks)
      .values({
        intentId,
        networkId,
        relevancyScore: relevancyScore != null ? String(relevancyScore) : null,
        ...(assignmentMetadata !== undefined ? { assignmentMetadata } : {}),
      })
      .onConflictDoUpdate({
        target: [intentNetworks.intentId, intentNetworks.networkId],
        set: {
          relevancyScore: relevancyScore != null ? String(relevancyScore) : null,
          ...(assignmentMetadata !== undefined ? { assignmentMetadata } : {}),
        },
      });
  }
