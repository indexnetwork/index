/**
 * Shared infrastructure for the database adapters: drizzle client, schema
 * tables, operators, DTO types, and cross-adapter helper functions.
 * No dependency on lib/protocol. Imported by every database/*.adapter.ts file.
 */
import { eq, and, or, isNull, isNotNull, sql, count, desc, gt, lt, lte, ne, inArray, ilike, notInArray, asc, not } from 'drizzle-orm/sql';
import * as schema from '../schemas/database.schema';
import db from '../lib/drizzle/drizzle';
import { traceAppOperation } from '../lib/sentry-performance';
import { normalizeEmbedding } from '../lib/embedding/vector';
import { normalizeTelegramSocialValue } from '../lib/telegram/socials';
import type { User, NotificationPreferences, OnboardingState, TelegramPrefs } from '../schemas/database.schema';
import type { Conversation, ConversationParticipant, Message, Task, Artifact } from '../schemas/conversation.schema';
import type { Id } from '../types/common.types';
import { log } from '../lib/log';
import { NetworkMembershipEvents } from '../events/network_membership.event';

// Re-export the import surface so domain adapter files import everything from one module.
export { schema, db, traceAppOperation, normalizeEmbedding, normalizeTelegramSocialValue, log, NetworkMembershipEvents };
export { eq, and, or, isNull, isNotNull, sql, count, desc, gt, lt, lte, ne, inArray, ilike, notInArray, asc, not };
export type { User, NotificationPreferences, OnboardingState, TelegramPrefs, Conversation, ConversationParticipant, Message, Task, Artifact, Id };
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

/**
 * Creates a personal network for the user if one doesn't exist.
 * Adds the user as the owner member.
 * @param userId - The user to create a personal network for
 * @returns The personal network ID
 */
export async function ensurePersonalNetwork(userId: string): Promise<string> {
  // Fast path: check mapping table
  const existing = await db
    .select({ networkId: schema.personalNetworks.networkId })
    .from(schema.personalNetworks)
    .where(eq(schema.personalNetworks.userId, userId))
    .limit(1);

  if (existing.length > 0) return existing[0].networkId;

  const networkId = crypto.randomUUID();

  // Personal networks are prompt-less by default so the assignment policy treats
  // them as "no filtration" (score 1.0) — every one of the owner's intents lands
  // in their own personal network. The owner may later set a prompt to curate it.
  await db.insert(schema.networks).values({
    id: networkId,
    title: 'My Network',
    isPersonal: true,
  }).onConflictDoNothing();

  await db.insert(schema.personalNetworks).values({
    userId,
    networkId,
  }).onConflictDoNothing();

  await db.insert(schema.networkMembers).values({
    networkId,
    userId,
    permissions: ['owner'],
    autoAssign: true,
  }).onConflictDoNothing();

  // Re-query to return the actual persisted ID (handles race with concurrent calls)
  const persisted = await db
    .select({ networkId: schema.personalNetworks.networkId })
    .from(schema.personalNetworks)
    .where(eq(schema.personalNetworks.userId, userId))
    .limit(1);

  return persisted[0]?.networkId ?? networkId;
}

/**
 * Returns the personal network ID for a user.
 * @param userId - The user to look up
 * @returns The personal network ID, or null if not found
 */
export async function getPersonalIndexId(userId: string): Promise<string | null> {
  const result = await db
    .select({ networkId: schema.personalNetworks.networkId })
    .from(schema.personalNetworks)
    .where(eq(schema.personalNetworks.userId, userId))
    .limit(1);

  return result[0]?.networkId ?? null;
}

// Local types used by adapters (shapes only; protocol layer defines the contracts)
export interface ActiveIntentRow {
  id: string;
  payload: string;
  summary: string | null;
  createdAt: Date;
  relevancyScore?: number | null;
}
export type SourceType = 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment';

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
export interface IntentListRow {
  id: string;
  payload: string;
  summary: string | null;
  status: string | null;
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
  /** Count of pending intent-scoped questions awaiting the user for this intent. */
  pendingQuestionCount: number;
  /** Count of `pending` opportunities anchored on this intent, awaiting the user. */
  waitingOpportunityCount: number;
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
  indexPrompt: string | null;
  permissions: string[];
  memberPrompt: string | null;
  autoAssign: boolean;
  isPersonal: boolean;
  joinedAt: Date;
}

export const { intents, networks, networkMembers, intentNetworks, users, hydeDocuments, opportunities, userNotificationSettings, files, links, sessions, userSocials, userContexts } = schema;

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
 * premises + the global user_context and have no column to persist. Empty identity
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
 * Canonical "active own intents" WHERE predicate: a row the user owns that has
 * not been archived. No status filter — `intents.status` is vestigial (selected
 * but never filtered). Both the REST (IntentDatabaseAdapter) and MCP
 * (ChatDatabaseAdapter) surfaces route through this so their counts cannot
 * drift between them. See EDG-53.
 */
export function activeOwnIntentsWhere(userId: string) {
  return and(
    eq(schema.intents.userId, userId),
    isNull(schema.intents.archivedAt),
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
  const validSourceTypes: SourceType[] = ['file', 'integration', 'link', 'discovery_form', 'enrichment'];
  if (options.sourceType && validSourceTypes.includes(options.sourceType as SourceType)) {
    conditions.push(eq(schema.intents.sourceType, options.sourceType as SourceType));
  }
  return and(...conditions);
}

/**
 * Database adapter for intent CRUD (Intent Graph).
 */
export type ChatScopeType = 'network' | 'intent';

export interface ChatSession {
  id: string;
  userId: string;
  title: string | null;
  /** Chat persona driving this session's agent loop (e.g. 'orchestrator'). */
  persona: string;
  /** Legacy network alias. Prefer scopeType/scopeId for new code. */
  networkId: string | null;
  /** Canonical focused scope for this orchestrator chat, when persisted. */
  scopeType: ChatScopeType | null;
  /** Canonical focused scope id. Network scope uses a network id; intent scope uses an intent id. */
  scopeId: string | null;
  shareToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  routingDecision: Record<string, unknown> | null;
  subgraphResults: Record<string, unknown> | null;
  tokenCount: number | null;
  interrupted?: boolean | null;
  createdAt: Date;
}

/** Shape stored inside conversation_metadata.metadata for agent-chat sessions. */
export interface ChatConversationMeta {
  title?: string | null;
  /** Legacy network alias retained for existing clients and session rows. */
  networkId?: string | null;
  /** Canonical focused scope for this orchestrator chat. */
  scopeType?: ChatScopeType | null;
  /** Canonical focused scope id. */
  scopeId?: string | null;
  shareToken?: string | null;
  ghostInviteSent?: boolean;
  [key: string]: unknown;
}

/** Shape stored inside messages.metadata for agent-chat messages. */
export interface ChatMessageMeta {
  routingDecision?: Record<string, unknown> | null;
  subgraphResults?: Record<string, unknown> | null;
  tokenCount?: number | null;
  traceEvents?: unknown;
  debugMeta?: unknown;
  /**
   * Orchestrator-driven draft opportunities streamed back via
   * `opportunity_draft_ready` events during the response. Persisted so the
   * rendered chat cards survive session reload — the frontend rehydrates
   * these into message.streamingDrafts on loadSession.
   */
  streamingDrafts?: unknown;
  /** Set to true when the assistant message was partially generated before a steer interrupt. */
  interrupted?: boolean;
  [key: string]: unknown;
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  title?: string;
  /** Chat persona for this session. Omit for the default ('orchestrator'). */
  persona?: string;
  /** Legacy network alias. Prefer scopeType/scopeId for new code. */
  networkId?: string;
  scopeType?: ChatScopeType;
  scopeId?: string;
}

export interface CreateMessageInput {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  routingDecision?: Record<string, unknown>;
  subgraphResults?: Record<string, unknown>;
  tokenCount?: number;
  interrupted?: boolean;
}

/**
 * Lazy getter for the ConversationDatabaseAdapter singleton.
 * Avoids circular reference since conversationDatabaseAdapter is instantiated after chatDatabaseAdapter.
 */
export interface OpportunityRow {
  id: string;
  detection: schema.OpportunityDetection;
  actors: schema.OpportunityActor[];
  interpretation: schema.OpportunityInterpretation;
  context: schema.OpportunityContext;
  confidence: string;
  status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired';
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
  status?: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired';
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
    weeklyNewsletter: boolean;
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
    weeklyNewsletter?: boolean;
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
export interface FileRow {
  id: string;
  name: string;
  type: string;
  size: bigint;
  createdAt: Date;
  userId: string | null;
}

export interface FileMetadata {
  id: string;
  name: string;
  type: string;
  size: bigint;
}

export interface CreateFileInput {
  id: string;
  name: string;
  size: bigint;
  type: string;
  userId: string;
}

export interface FileListResult {
  files: FileRow[];
  total: number;
}

/**
 * FileDatabaseAdapter
 *
 * Wraps all database operations for files table.
 */
export interface LinkRow {
  id: string;
  url: string;
  createdAt: Date;
  lastSyncAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
}

/**
 * LinkDatabaseAdapter
 *
 * Wraps all database operations for the links table.
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
/**
 * Role-based opportunity visibility check.
 * Mirrors the Latent Opportunity Lifecycle visibility matrix:
 * - Introducer/peer: always visible.
 * - Patient/party: visible unless status is latent AND an introducer exists.
 * - Agent: visible only for terminal statuses, or non-latent when no introducer.
 */
export function canActorSeeOpportunity(
  actors: Array<{ userId: string; role: string }>,
  status: string,
  userId: string,
): boolean {
  const hasIntroducer = actors.some((a) => a.role === 'introducer');
  const userRoles = actors.filter((a) => a.userId === userId).map((a) => a.role);
  if (userRoles.length === 0) return false;

  return userRoles.some((role) => {
    if (role === 'introducer' || role === 'peer') return true;
    if (role === 'patient' || role === 'party')
      return status !== 'latent' || !hasIntroducer;
    if (role === 'agent')
      return (
        ['accepted', 'rejected', 'expired'].includes(status) ||
        (status !== 'latent' && !hasIntroducer)
      );
    return false;
  });
}

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
}

/**
 * Database adapter for the A2A-aligned conversation tables.
 *
 * @remarks
 * Covers conversations, participants, messages, tasks, artifacts, and metadata.
 * Uses Drizzle ORM against the `conversations` family of tables.
 */

// ── De-duplicated query helpers (formerly copy-pasted across adapters) ──
export async function readUserContext(userId: string, networkId: string | null) {
  const rows = await db.select()
    .from(userContexts)
    .where(and(
      eq(userContexts.userId, userId),
      networkId === null ? isNull(userContexts.networkId) : eq(userContexts.networkId, networkId),
    ))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return { id: r.id, text: r.text, embedding: r.embedding as unknown as number[], premiseHash: r.premiseHash ?? '', generatedAt: r.generatedAt };
}

export async function readPremisesForUser(userId: string, status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED'): Promise<Array<{
    id: string; userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null;
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding: number[] | null;
    status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    createdAt: Date; updatedAt: Date; retractedAt: Date | null;
  }>> {
    const conditions: ReturnType<typeof eq>[] = [
      eq(schema.premises.userId, userId),
      isNull(schema.premises.deletedAt),
    ];
    if (status) {
      conditions.push(eq(schema.premises.status, status));
    }
    const rows = await db
      .select()
      .from(schema.premises)
      .where(and(...conditions))
      .orderBy(desc(schema.premises.createdAt));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      assertion: row.assertion as { text: string; tier: 'assertive' | 'contextual'; summary?: string },
      provenance: row.provenance as { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string },
      analysis: row.analysis as { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null,
      validity: row.validity as { validFrom?: string; validUntil?: string; volatile: boolean },
      embedding: row.embedding,
      status: row.status as 'ACTIVE' | 'RETRACTED' | 'EXPIRED',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      retractedAt: row.retractedAt ?? null,
    }));
  }

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
