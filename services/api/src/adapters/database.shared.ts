/**
 * Shared infrastructure for the database adapters: drizzle client, schema
 * tables, operators, DTO types, and cross-adapter helper functions.
 * No dependency on lib/protocol. Imported by every database/*.adapter.ts file.
 */
import type { NegotiationPauseReason } from './conversation.database.adapter';
import { eq, and, or, isNull, isNotNull, sql, count, desc, gt, gte, lt, lte, ne, inArray, ilike, notInArray, asc, not } from 'drizzle-orm/sql';
import * as schema from '../schemas/database.schema';
import db from '../lib/drizzle/drizzle';
import { traceAppOperation } from '../lib/sentry-performance';
import { normalizeEmbedding } from '../lib/embedding/vector';
import { normalizeTelegramSocialValue } from '../lib/telegram/socials';
import type { User, NotificationPreferences, OnboardingState, TelegramPrefs } from '../schemas/database.schema';
import type { Conversation, ConversationParticipant, ConversationSession, Message, Task, Artifact } from '../schemas/conversation.schema';
import type { Id } from '../types/common.types';
import { log } from '../lib/log';
import { NetworkMembershipEvents } from '../events/network_membership.event';

// Re-export the import surface so domain adapter files import everything from one module.
export { schema, db, traceAppOperation, normalizeEmbedding, normalizeTelegramSocialValue, log, NetworkMembershipEvents };
export { canActorSeeOpportunity } from './opportunity.visibility';
export { eq, and, or, isNull, isNotNull, sql, count, desc, gt, gte, lt, lte, ne, inArray, ilike, notInArray, asc, not };
export type { User, NotificationPreferences, OnboardingState, TelegramPrefs, Conversation, ConversationParticipant, ConversationSession, Message, Task, Artifact, Id };
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
  /** Count of pending intent-scoped questions awaiting the user for this intent. */
  pendingQuestionCount: number;
  /**
   * Count of distinct `pending` opportunities awaiting this owner that are
   * attributed to this signal by `detection.triggeredBy` or the owner's
   * actor intent. Rows the owner already acted on are excluded.
   */
  waitingOpportunityCount: number;
  /** True while a fresh intent has not completed its first discovery run. */
  warming: boolean;
  /**
   * The signal's agent asked its owner something and is still waiting: the
   * newest message in the signal's DM is an agent question offering canned
   * replies. Derived per read from the conversation itself — answering (by
   * typing or by tapping a chip) is what clears it.
   */
  awaitingReply: boolean;
  discoveryProgress?: {
    status: 'queued' | 'running' | 'retrying' | 'completed' | 'failed' | 'blocked' | 'unknown';
    attempt: number;
    maxAttempts: number;
    assignedCommunityCount: number;
    processedCommunityCount: number;
    possibleOverlapCount: number;
    conversationsStartedCount: number;
    queuedAt: Date | null;
    startedAt: Date | null;
    completedAt: Date | null;
    updatedAt: Date | null;
  };
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
  joinedAt: Date;
}

export const { intents, networks, networkMembers, intentNetworks, users, hydeDocuments, opportunities, discoveryMatchCandidates, userNotificationSettings, sessions, userSocials } = schema;

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

/**
 * Database adapter for intent CRUD (Intent Graph).
 */
export type ChatScopeType = 'network' | 'intent';
/**
 * Value of `conversations.persona`.
 *
 * - `personal` — the one live chat persona (PersonalAgent). The retired
 *   signal/negotiator/onboarding ids were collapsed into it by migration.
 * - `telegram` — Telegram notification transcript. Not a chat persona: nothing
 *   drives a turn in it, it only collects delivered notifications.
 * - `orchestrator` — retired pre-personafication default. No new rows are
 *   written with it; existing ones stay readable.
 */
export type ChatPersonaId =
  | 'personal'
  | 'telegram'
  | 'orchestrator';

export interface ChatSession {
  id: string;
  userId: string;
  title: string | null;
  /** Persona this session is persisted under (e.g. 'personal'). */
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
  /** Structured questions rendered by the chat question widget. */
  decisionQuestions?: unknown[] | null;
  /** True only after an explicit structured-question submission. */
  decisionQuestionsSubmitted?: boolean | null;
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
   * Legacy draft opportunities retained so historical chat cards survive
   * session reload; the frontend rehydrates these into message.streamingDrafts.
   */
  streamingDrafts?: unknown;
  /** Legacy discovery cards retained for historical chat-message rendering. */
  discoveries?: unknown;
  /** Set to true when the assistant message was partially generated before a steer interrupt. */
  interrupted?: boolean;
  /** Structured questions rendered by the chat question widget. */
  decisionQuestions?: unknown[];
  /** Set only after the principal explicitly submits this question form. */
  decisionQuestionsSubmitted?: boolean;
  [key: string]: unknown;
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  title?: string;
  /** Persona this session is persisted under. Required — there is no default. */
  persona: ChatPersonaId;
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
  /** Structured questions for an agent message; stored in messages.metadata. */
  questions?: unknown[];
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

/**
 * IND-610: owner-only projection of the outreach-gate decision.
 *
 * `source` keeps the provenance honest — the card that renders this must not
 * claim screen-node evidence it does not have:
 * - `screen`  — `tasks.metadata.screenDecision`. READ-ONLY HISTORY: the
 *   outreach gate that wrote it is gone, but existing task rows carry it.
 * - `outcome` — the negotiation-outcome artifact's `reasoning`, written when
 *   the agent refuses on its opening turn (IND-564). The only live source.
 */
export interface ProjectedScreenDecision {
  source: 'screen' | 'outcome';
  decision: 'reach_out' | 'pass';
  reasoning: string;
  /** Screen-node evidence on historical rows; null when the decision came from the outcome. */
  counterpartyPremiseFit: string | null;
  intentAlignment: string | null;
  screenedAt: string | null;
}

export interface NegotiationLifecycleSummary {
  taskId: string;
  state: 'submitted' | 'working' | 'completed' | 'failed' | 'canceled' | 'rejected' | 'auth_required' | 'waiting_for_agent' | 'claimed' | 'paused';
  statusTimestamp: Date | null;
  opportunityId: string | null;
  opportunityStatus: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired' | null;
  /** Whether the authenticated owner, rather than their counterpart, started the chat. */
  acceptedByViewer: boolean;
  turnCount: number;
  maxTurns: number | null;
  signalCount: number;
  outcome: { hasOpportunity: boolean; reason: string | null } | null;
  /**
   * Set only when `state === 'paused'`. `payload` is private to the seat that
   * paused (`pausedBy`) — every other viewer sees `reason` only, the same
   * privacy rule `negotiation.tools.ts`'s `pauseFor` applies A2A-side.
   */
  pause: { reason: NegotiationPauseReason; payload?: unknown } | null;
  updatedAt: Date;
  /**
   * IND-610: the owner-facing "did not reach out" decision, named-field
   * projected from the negotiation-outcome artifact's `reasoning` (an
   * opening-turn refusal) or, on historical rows, from
   * `tasks.metadata.screenDecision`. Populated only when the caller has
   * independently verified the viewer is the negotiation's initiator — never
   * the raw metadata blob.
   */
  screenDecision?: ProjectedScreenDecision | null;
}

/** Summary returned by getConversationsForUser. */
export interface ConversationSummary {
  id: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  participants: ResolvedParticipant[];
  /** The task session that produced the latest message, when it has one. */
  lastMessage: { parts: unknown[]; senderId: string; createdAt: Date; taskId: string | null } | null;
  metadata: Record<string, unknown> | null;
  via: Array<{ intentId: string; opportunityId: string; title: string }>;
  unreadCount: number;
  /**
   * Present only when negotiation lifecycle projection was requested. The one
   * task session that represents this conversation to the viewer: the most
   * latest task for the conversation.
   */
  negotiation?: NegotiationLifecycleSummary | null;
  /**
   * Viewer-scoped opportunities with an addressable negotiation task. Unlike
   * `negotiation`, this is not limited to one session per conversation.
   */
  negotiationOpportunities?: Array<{
    intentId: string;
    opportunityId: string;
    title: string;
    taskId: string;
    state: NegotiationLifecycleSummary['state'];
    opportunityStatus: NegotiationLifecycleSummary['opportunityStatus'];
    acceptedByViewer: boolean;
    turnCount: number;
    maxTurns: number | null;
    signalCount: number;
    outcome: NegotiationLifecycleSummary['outcome'];
    updatedAt: Date;
  }>;
}

/**
 * Database adapter for the A2A-aligned conversation tables.
 *
 * @remarks
 * Covers conversations, participants, messages, tasks, artifacts, and metadata.
 * Uses Drizzle ORM against the `conversations` family of tables.
 */

// ── De-duplicated query helpers (formerly copy-pasted across adapters) ──
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
