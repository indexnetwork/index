import { pgTable, pgEnum, text, timestamp, boolean, json, jsonb, integer, uniqueIndex, index, doublePrecision, numeric, primaryKey } from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm/relations';
import { sql } from 'drizzle-orm/sql';
import type { Id } from '../types/common.types';

// Enums
export const sourceType = pgEnum('source_type', ['integration', 'discovery_form', 'enrichment']);
export const intentModeEnum = pgEnum('intent_mode', ['REFERENTIAL', 'ATTRIBUTIVE']);
export const speechActTypeEnum = pgEnum('speech_act_type', ['COMMISSIVE', 'DIRECTIVE']);
export const intentStatusEnum = pgEnum('intent_status', ['ACTIVE', 'PAUSED', 'FULFILLED', 'EXPIRED']);
export const opportunityStatusEnum = pgEnum('opportunity_status', ['negotiating', 'pending', 'accepted', 'rejected', 'expired']);
export const agentTypeEnum = pgEnum('agent_type', ['external', 'system']);
export const agentStatusEnum = pgEnum('agent_status', ['active', 'inactive']);
export const negotiationOutcomeEnum = pgEnum('negotiation_outcome', ['agreed', 'declined', 'closed']);
export const negotiationTurnActionEnum = pgEnum('negotiation_turn_action', ['propose', 'counter', 'accept', 'decline']);

export interface OnboardingState {
  completedAt?: string;
  profileConfirmedAt?: string;
  firstSignalIntentId?: string;
  flow?: 1 | 2 | 3;
  currentStep?: 'profile' | 'summary' | 'connections' | 'create_network' | 'invite_members' | 'join_networks' | 'first_signal' | 'complete';
  networkId?: string;
  invitationCode?: string;
}

export interface NetworkPermissionsState {
  joinPolicy: 'anyone' | 'invite_only';
  invitationLink: { code: string } | null;
  contextInjection?: { discovery: boolean };
}

/**
 * Early-access "request a network" details, stored under `networks.metadata.request`.
 * A network row carrying a non-null `requestStatus` is a pending request, not a
 * usable network: it has no members and is hidden from discovery until a staff
 * reviewer approves it (which clears `requestStatus` and adds the owner).
 */
export interface NetworkRequestDetails {
  requestedByUserId: string;
  purpose?: string;
  audience?: string;
  expectedSize?: string;
  notes?: string;
  // Optional preferred access, mirrored onto networks.permissions on create/update
  // so approval does not have to re-ask. Same values as create-network joinPolicy.
  joinPolicy?: 'anyone' | 'invite_only';
  reviewNote?: string;
  submittedAt: string;
  reviewedAt?: string;
}

export type NetworkRequestStatus = 'pending' | 'needs_changes';

export interface NotificationPreferences {
  connectionUpdates: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Users table (unified: Better Auth + domain fields)
// Better Auth maps "image" -> "avatar" via auth config
// ═══════════════════════════════════════════════════════════════════════════════

export const users = pgTable('users', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: text('email').notNull(),
  emailVerified: boolean('email_verified').notNull().default(false),
  name: text('name').notNull(),
  key: text('key'),
  avatar: text('avatar'),
  intro: text('intro'),
  location: text('location'),
  onboarding: json('onboarding').$type<OnboardingState>().default({}),
  timezone: text('timezone').default('UTC'),
  lastWeeklyEmailSentAt: timestamp('last_weekly_email_sent_at'),


  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => ({
  usersEmailUnique: uniqueIndex('users_email_unique').on(table.email),
  usersKeyUnique: uniqueIndex('users_key_unique').on(table.key),
}));

export const userSocials = pgTable('user_socials', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  value: text('value').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  userSocialsUserIdIdx: index('idx_user_socials_user_id').on(table.userId),
  userSocialsCanonicalUniqueIdx: uniqueIndex('uniq_user_socials_user_label')
    .on(table.userId, table.label)
    .where(sql`${table.label} <> 'custom'`),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// Better Auth tables (sessions, accounts, verifications)
// ═══════════════════════════════════════════════════════════════════════════════

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  expiresAt: timestamp('expires_at').notNull(),
  token: text('token').notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
});

export const accounts = pgTable('accounts', {
  id: text('id').primaryKey(),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at'),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const verifications = pgTable('verifications', {
  id: text('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at'),
  updatedAt: timestamp('updated_at'),
});

export const jwks = pgTable('jwks', {
  id: text('id').primaryKey(),
  publicKey: text('public_key').notNull(),
  privateKey: text('private_key').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ═══════════════════════════════════════════════════════════════════════════════
// Better Auth MCP OAuth tables
// ═══════════════════════════════════════════════════════════════════════════════

export const oauthApplications = pgTable('oauth_application', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  icon: text('icon'),
  metadata: text('metadata'),
  clientId: text('client_id').notNull().unique(),
  clientSecret: text('client_secret'),
  redirectUrls: text('redirect_urls').notNull(),
  type: text('type').notNull(),
  disabled: boolean('disabled').default(false),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  userIdIdx: index('oauth_application_user_id_idx').on(table.userId),
}));

export const oauthAccessTokens = pgTable('oauth_access_token', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  accessToken: text('access_token').notNull().unique(),
  refreshToken: text('refresh_token').unique(),
  accessTokenExpiresAt: timestamp('access_token_expires_at').notNull(),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
  clientId: text('client_id').notNull().references(() => oauthApplications.clientId, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  clientIdIdx: index('oauth_access_token_client_id_idx').on(table.clientId),
  userIdIdx: index('oauth_access_token_user_id_idx').on(table.userId),
}));

export const oauthConsents = pgTable('oauth_consent', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  clientId: text('client_id').notNull().references(() => oauthApplications.clientId, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scopes: text('scopes').notNull(),
  consentGiven: boolean('consent_given').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  clientIdIdx: index('oauth_consent_client_id_idx').on(table.clientId),
  userIdIdx: index('oauth_consent_user_id_idx').on(table.userId),
}));

/**
 * API keys, owned and managed entirely by the Better Auth `apiKey` plugin.
 * Keys are hashed before storage; the raw secret is only returned on creation.
 * `reference_id` is the plugin's owner pointer — the only column that names the
 * user, which is why the foreign key hangs off it.
 */
export const apikeys = pgTable('apikey', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: text('key').notNull(),
  referenceId: text('reference_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  configId: text('config_id').default('default'),
  name: text('name'),
  prefix: text('prefix'),
  start: text('start'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  enabled: boolean('enabled').default(true).notNull(),
  rateLimitEnabled: boolean('rate_limit_enabled').default(false).notNull(),
  rateLimitMax: integer('rate_limit_max'),
  rateLimitTimeWindow: integer('rate_limit_time_window'),
  requestCount: integer('request_count').default(0).notNull(),
  remaining: integer('remaining'),
  refillAmount: integer('refill_amount'),
  refillInterval: integer('refill_interval'),
  lastRefillAt: timestamp('last_refill_at', { withTimezone: true }),
  lastRequest: timestamp('last_request', { withTimezone: true }),
  metadata: text('metadata'),
  permissions: text('permissions'),
});

export const userNotificationSettings = pgTable('user_notification_settings', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  preferences: json('preferences').$type<NotificationPreferences>().default({
    connectionUpdates: true,
  }),
  unsubscribeToken: text('unsubscribe_token').$defaultFn(() => crypto.randomUUID()).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type HydeSourceType = 'intent' | 'query' | 'context';

export const hydeDocuments = pgTable('hyde_documents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  sourceType: text('source_type').$type<HydeSourceType>().notNull(),
  sourceId: text('source_id'),
  sourceText: text('source_text'),
  strategy: text('strategy').notNull(),
  targetCorpus: text('target_corpus').notNull(),
  context: jsonb('context'),
  hydeText: text('hyde_text').notNull(),
  hydeEmbedding: vector('hyde_embedding', { dimensions: 2000 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => ({
  sourceIdx: index('hyde_source_idx').on(table.sourceType, table.sourceId),
  strategyIdx: index('hyde_strategy_idx').on(table.strategy),
  embeddingIdx: index('hyde_embedding_idx').using('hnsw', table.hydeEmbedding.op('vector_cosine_ops')),
  expiresIdx: index('hyde_expires_idx').on(table.expiresAt),
  sourceStrategyUnique: uniqueIndex('hyde_source_strategy_unique').on(table.sourceType, table.sourceId, table.strategy, table.targetCorpus),
}));

export interface OpportunityDetection {
  source: 'opportunity_graph' | 'chat' | 'cron' | 'member_added';
  createdBy?: Id<'users'> | string;
  createdByName?: string;
  triggeredBy?: Id<'intents'>;
  timestamp: string;
  enrichedFrom?: string[];
}

export interface OpportunityActor {
  networkId: Id<'networks'>;
  userId: Id<'users'>;
  intent?: Id<'intents'>;
  role: string;
  /**
   * ISO-8601 timestamp set the first time this actor advanced the opportunity's
   * state (patient sending, agent accepting, peer "accepting" on draft = sending
   * under the hood, peer accepting on pending). Once set,
   * this actor has committed and cannot be the one to subsequently `accept` the
   * same opportunity — enforced by the self-accept guard in `updateNode`.
   */
  actedAt?: string;
}

export interface OpportunitySignal {
  type: string;
  weight: number;
  detail?: string;
}

export interface OpportunityInterpretation {
  category: string;
  reasoning: string;
  confidence: number;
  signals?: OpportunitySignal[];
}

export interface OpportunityContext {
  networkId?: Id<'networks'>;
  conversationId?: Id<'conversations'>;
}

export const opportunities = pgTable('opportunities', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  detection: jsonb('detection').$type<OpportunityDetection>().notNull(),
  actors: jsonb('actors').$type<OpportunityActor[]>().notNull(),
  interpretation: jsonb('interpretation').$type<OpportunityInterpretation>().notNull(),
  context: jsonb('context').$type<OpportunityContext>().notNull(),
  confidence: numeric('confidence').notNull(),
  status: opportunityStatusEnum('status').notNull().default('pending'),
  acceptedBy: text('accepted_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
}, (table) => ({
  statusIdx: index('opportunities_status_idx').on(table.status),
}));

/**
 * The negotiation between the two seats of one opportunity. Index is the
 * server: both seats read this record and take turns against it, and Index
 * computes the settlement from its own turn log.
 */
export const negotiations = pgTable('negotiations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  /**
   * Stable identity of the two-intent pair, from the protocol's `pairKeyOf`.
   * Unique: both principals' discovery runs converge here instead of opening
   * two negotiations between the same two intents.
   */
  pairKey: text('pair_key').notNull(),
  opportunityId: text('opportunity_id').notNull().references(() => opportunities.id, { onDelete: 'cascade' }),
  initiatorUserId: text('initiator_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  initiatorIntentId: text('initiator_intent_id').notNull().references(() => intents.id, { onDelete: 'cascade' }),
  responderUserId: text('responder_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  responderIntentId: text('responder_intent_id').notNull().references(() => intents.id, { onDelete: 'cascade' }),
  /** The seat whose turn it is. Null once settled; never a third value. */
  awaitingUserId: text('awaiting_user_id').references(() => users.id, { onDelete: 'set null' }),
  outcome: negotiationOutcomeEnum('outcome'),
  settledAt: timestamp('settled_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pairKeyIdx: uniqueIndex('negotiations_pair_key_idx').on(table.pairKey),
  opportunityIdx: uniqueIndex('negotiations_opportunity_id_idx').on(table.opportunityId),
  initiatorIntentIdx: index('negotiations_initiator_intent_idx').on(table.initiatorIntentId),
  responderIntentIdx: index('negotiations_responder_intent_idx').on(table.responderIntentId),
  awaitingIdx: index('negotiations_awaiting_user_idx').on(table.awaitingUserId),
}));

/**
 * One structured decision from one seat. The unique index on
 * `(negotiation_id, turn_index)` is the concurrency control: a seat racing
 * its counterparty, or retrying, collides rather than appending twice.
 */
export const negotiationTurns = pgTable('negotiation_turns', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  negotiationId: text('negotiation_id').notNull().references(() => negotiations.id, { onDelete: 'cascade' }),
  turnIndex: integer('turn_index').notNull(),
  seatUserId: text('seat_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  action: negotiationTurnActionEnum('action').notNull(),
  message: text('message').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  orderIdx: uniqueIndex('negotiation_turns_negotiation_turn_idx').on(table.negotiationId, table.turnIndex),
}));

export const intents = pgTable('intents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  payload: text('payload').notNull(),
  summary: text('summary'),
  isIncognito: boolean('is_incognito').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  archivedAt: timestamp('archived_at'),
  lastVisitedAt: timestamp('last_visited_at', { withTimezone: true }),
  /**
   * When the intent's first background discovery run completed successfully
   * (any path: web discovery queue or async MCP discovery-run). Null until
   * then. Read-side "warming" derivation clears as soon as this is stamped,
   * instead of waiting out the 24-hour freshness window (IND-482).
   */
  firstDiscoverySucceededAt: timestamp('first_discovery_succeeded_at', { withTimezone: true }),
  userId: text('user_id').notNull().references(() => users.id),
  sourceId: text('source_id'),
  sourceType: sourceType('source_type'),
  embedding: vector('embedding', { dimensions: 2000 }),
  semanticEntropy: doublePrecision('semantic_entropy').default(1.0),
  referentialAnchor: text('referential_anchor'),
  intentMode: intentModeEnum('intent_mode').default('ATTRIBUTIVE'),
  speechActType: speechActTypeEnum('speech_act_type'),
  felicityAuthority: integer('felicity_authority'),
  felicitySincerity: integer('felicity_sincerity'),
  felicityClarity: integer('felicity_clarity'),
  status: intentStatusEnum('status').default('ACTIVE'),
}, (table) => [
  index('embeddingIndex').using('hnsw', table.embedding.op('vector_cosine_ops')),
]);

export const networks = pgTable('networks', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  key: text('key'),
  prompt: text('prompt'),
  imageUrl: text('image_url'),
  // Non-null only while this row is an unapproved "create a network" request
  // (early access). Cleared to null when a staff reviewer approves it.
  requestStatus: text('request_status').$type<NetworkRequestStatus>(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  permissions: json('permissions').$type<NetworkPermissionsState>().default({
    joinPolicy: 'invite_only',
    invitationLink: null,
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => ({
  networksKeyUnique: uniqueIndex('networks_key_unique').on(table.key),
}));

export const networkMembers = pgTable('network_members', {
  networkId: text('network_id').notNull().references(() => networks.id),
  userId: text('user_id').notNull().references(() => users.id),
  permissions: text('permissions').array().notNull().default([]),
  prompt: text('prompt'),
  autoAssign: boolean('auto_assign').notNull().default(false),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => ({
  pk: primaryKey({ columns: [table.networkId, table.userId] }),
}));

export const intentNetworks = pgTable('intent_networks', {
  intentId: text('intent_id').notNull().references(() => intents.id),
  networkId: text('network_id').notNull().references(() => networks.id),
  relevancyScore: numeric('relevancy_score'),
  assignmentMetadata: jsonb('assignment_metadata').$type<import('@indexnetwork/protocol').NetworkAssignmentMetadata>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.intentId, t.networkId] }),
  networkIdIdx: index('intent_networks_network_id_idx').on(t.networkId),
}));


// ═══════════════════════════════════════════════════════════════════════════════
// Agents
// ═══════════════════════════════════════════════════════════════════════════════

export const agents = pgTable('agents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  type: agentTypeEnum('type').notNull(),
  status: agentStatusEnum('status').notNull().default('active'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  runtimeKind: text('runtime_kind').$type<'hermes' | null>(),
  installationId: text('installation_id'),
  runtimeSetupAttemptId: text('runtime_setup_attempt_id'),
  notifyOnOpportunity: boolean('notify_on_opportunity').notNull().default(true),
  dailySummaryEnabled: boolean('daily_summary_enabled').notNull().default(true),
  handleNegotiations: boolean('handle_negotiations').notNull().default(false),
  lastDailySummaryAt: timestamp('last_daily_summary_at', { withTimezone: true }),
}, (table) => ({
  ownerIdIdx: index('agents_owner_id_idx').on(table.ownerId),
  typeIdx: index('agents_type_idx').on(table.type),
  lastSeenAtIdx: index('agents_last_seen_at_idx').on(table.lastSeenAt),
  uniqueHermesInstallation: uniqueIndex('uniq_agents_hermes_installation')
    .on(table.ownerId, table.runtimeKind, table.installationId)
    .where(sql`${table.type} = 'external' AND ${table.runtimeKind} = 'hermes' AND ${table.installationId} IS NOT NULL AND ${table.deletedAt} IS NULL`),
  uniqueSelectedNegotiationExecutor: uniqueIndex('uniq_agents_selected_negotiation_executor')
    .on(table.ownerId)
    .where(sql`${table.type} = 'external' AND ${table.handleNegotiations} = true AND ${table.deletedAt} IS NULL`),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// Lens B outcome feedback events (IND-434)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Append-only, idempotent log of EXPLICIT owner opportunity actions used as
 * Lens B feedback (IND-434). One row per (recipient, opportunity, action);
 * retries of the same action collapse via `idempotencyKey`.
 *
 * Written only from the authoritative owner-action service paths when
 * OUTCOME_QUESTIONS_MODE != off. Counterparty, agent, screening, timeout,
 * merge, cascade, TTL/expiry, and delivery transitions are NEVER recorded here.
 * Content is bounded and presentation-safe: no raw model reasoning, vectors, or
 * user text beyond the sanitized snapshot; the counterpart identity is stored
 * only as a non-reversible dedup hash.
 */
export const opportunityOutcomeEvents = pgTable(
  'opportunity_outcome_events',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    /**
     * The owner (recipient) who took the explicit action. Cascades on user
     * deletion — a user's own outcome history is erased when the user is
     * deleted (privacy), but never by routine intent/opportunity cleanup.
     */
    recipientUserId: text('recipient_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /**
     * Recipient-owned intent that scopes this decision. Retained as a plain
     * provenance id with NO cascading source FK: append-only feedback history
     * must survive routine intent deletion/cleanup (IND-434 hardening).
     */
    intentId: text('intent_id').notNull(),
    /** Stable hash of normalized intent payload + summary at event time. */
    intentFingerprint: text('intent_fingerprint').notNull(),
    /**
     * Opportunity the decision was taken on. Retained as a plain provenance id
     * with NO cascading source FK, for the same append-only reason as intentId.
     */
    opportunityId: text('opportunity_id').notNull(),
    /** Recipient actor's network at action time (context, not a label). */
    networkId: text('network_id'),
    /** Explicit owner action: 'accepted' | 'rejected'. */
    action: text('action').notNull(),
    /** Bounded, presentation-safe candidate snapshot text (for manual review). */
    candidateSnapshot: text('candidate_snapshot').notNull(),
    /** SHA-256 of the snapshot text (content hash for audit/change detection). */
    snapshotHash: text('snapshot_hash').notNull(),
    /** Recipient-scoped, non-reversible hash of the sole counterpart identity. */
    dedupKey: text('dedup_key').notNull(),
    /** SHA-256(recipient, intent, fingerprint, opportunity, action). */
    idempotencyKey: text('idempotency_key').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    idempotent: uniqueIndex('uniq_opp_outcome_events_idempotency').on(t.idempotencyKey),
    scopeLookup: index('idx_opp_outcome_events_scope').on(
      t.recipientUserId,
      t.intentId,
      t.intentFingerprint,
    ),
  }),
);

export type OpportunityOutcomeEvent = typeof opportunityOutcomeEvents.$inferSelect;
export type NewOpportunityOutcomeEvent = typeof opportunityOutcomeEvents.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// Relations
// ═══════════════════════════════════════════════════════════════════════════════

export const usersRelations = relations(users, ({ one, many }) => ({
  intents: many(intents),
  memberOf: many(networkMembers),
  socials: many(userSocials),
  notificationSettings: one(userNotificationSettings, {
    fields: [users.id],
    references: [userNotificationSettings.userId],
  }),
}));

export const userSocialsRelations = relations(userSocials, ({ one }) => ({
  user: one(users, {
    fields: [userSocials.userId],
    references: [users.id],
  }),
}));

export const userNotificationSettingsRelations = relations(userNotificationSettings, ({ one }) => ({
  user: one(users, {
    fields: [userNotificationSettings.userId],
    references: [users.id],
  }),
}));

export const intentsRelations = relations(intents, ({ one, many }) => ({
  user: one(users, {
    fields: [intents.userId],
    references: [users.id],
  }),
  networks: many(intentNetworks),
}));

export const networksRelations = relations(networks, ({ many }) => ({
  members: many(networkMembers),
  intents: many(intentNetworks),
}));

export const networkMembersRelations = relations(networkMembers, ({ one }) => ({
  network: one(networks, {
    fields: [networkMembers.networkId],
    references: [networks.id],
  }),
  user: one(users, {
    fields: [networkMembers.userId],
    references: [users.id],
  }),
}));

export const intentNetworksRelations = relations(intentNetworks, ({ one }) => ({
  intent: one(intents, {
    fields: [intentNetworks.intentId],
    references: [intents.id],
  }),
  network: one(networks, {
    fields: [intentNetworks.networkId],
    references: [networks.id],
  }),
}));

export const agentsRelations = relations(agents, ({ one }) => ({
  owner: one(users, {
    fields: [agents.ownerId],
    references: [users.id],
  }),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// Export types
// ═══════════════════════════════════════════════════════════════════════════════

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Intent = typeof intents.$inferSelect;
export type NewIntent = typeof intents.$inferInsert;
export type Network = typeof networks.$inferSelect;
export type NewNetwork = typeof networks.$inferInsert;
export type NetworkMember = typeof networkMembers.$inferSelect;
export type NewNetworkMember = typeof networkMembers.$inferInsert;
export type UserNotificationSettings = typeof userNotificationSettings.$inferSelect;
export type NewUserNotificationSettings = typeof userNotificationSettings.$inferInsert;
export type HydeDocument = typeof hydeDocuments.$inferSelect;
export type NewHydeDocument = typeof hydeDocuments.$inferInsert;
export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Negotiation = typeof negotiations.$inferSelect;
export type NewNegotiation = typeof negotiations.$inferInsert;
export type NegotiationTurn = typeof negotiationTurns.$inferSelect;
export type NewNegotiationTurn = typeof negotiationTurns.$inferInsert;

export * from './conversation.schema';
