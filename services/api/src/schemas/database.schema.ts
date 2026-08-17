import { pgTable, pgEnum, text, timestamp, bigint, boolean, check, json, jsonb, integer, uniqueIndex, index, doublePrecision, numeric, primaryKey, real } from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm/relations';
import { sql } from 'drizzle-orm/sql';
import type { Id } from '../types/common.types';

// Enums
export const sourceType = pgEnum('source_type', ['file', 'integration', 'link', 'discovery_form', 'enrichment']);
export const intentModeEnum = pgEnum('intent_mode', ['REFERENTIAL', 'ATTRIBUTIVE']);
export const speechActTypeEnum = pgEnum('speech_act_type', ['COMMISSIVE', 'DIRECTIVE']);
export const intentStatusEnum = pgEnum('intent_status', ['ACTIVE', 'PAUSED', 'FULFILLED', 'EXPIRED']);
export const opportunityStatusEnum = pgEnum('opportunity_status', ['latent', 'draft', 'negotiating', 'pending', 'stalled', 'accepted', 'rejected', 'expired']);
export const agentTypeEnum = pgEnum('agent_type', ['personal', 'external', 'system']);
export const agentStatusEnum = pgEnum('agent_status', ['active', 'inactive']);
export const transportChannelEnum = pgEnum('transport_channel', ['mcp']);
export const permissionScopeEnum = pgEnum('permission_scope', ['global', 'node', 'network']);
export const premiseStatusEnum = pgEnum('premise_status', ['ACTIVE', 'RETRACTED', 'EXPIRED']);
export const questionStatusEnum = pgEnum('question_status', ['pending', 'answered', 'dismissed']);
export const discoveryRunStatusEnum = pgEnum('discovery_run_status', ['queued', 'running', 'succeeded', 'failed', 'cancelled']);
export const intentProposalStatusEnum = pgEnum('intent_proposal_status', ['pending', 'consumed', 'rejected']);

export interface HistoricalQualityBaseAttestation {
  version: 1;
  corpusVersion: string;
  planFingerprint: string;
  seedProjectionFingerprint: string;
  documentSetFingerprint: string;
  embedding: {
    provider: string;
    model: string;
    dimensions: number;
    configurationFingerprint: string;
  };
  vectors: Array<{
    documentId: string;
    textFingerprint: string;
    vectorFingerprint: string;
  }>;
}

export interface OnboardingProfileSeed {
  source: 'experiment_signup' | 'experiment_csv_import';
  networkId: string;
  capturedAt: string;
  name?: string;
  bio?: string;
  location?: string;
  socials?: { label: string; value: string }[];
}

export interface OnboardingState {
  completedAt?: string;
  profileConfirmedAt?: string;
  firstSignalIntentId?: string;
  flow?: 1 | 2 | 3;
  currentStep?: 'profile' | 'summary' | 'connections' | 'create_network' | 'invite_members' | 'join_networks' | 'first_signal' | 'complete';
  networkId?: string;
  invitationCode?: string;
  profileSeeds?: OnboardingProfileSeed[];
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

export interface TelegramPrefs {
  chatId: string;
  sessionId?: string;       // lazily created on first outbound message
  connectedAt: string;      // ISO timestamp
  notifications: {
    opportunityAccepted: boolean;
  };
}

export interface NotificationPreferences {
  connectionUpdates: boolean;
  weeklyNewsletter: boolean;
  telegram?: TelegramPrefs;
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

export const connectLinks = pgTable(
  'connect_links',
  {
    code: text('code').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    opportunityId: text('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    greeting: text('greeting'),
    preferredSurface: text('preferred_surface'), // null = web; 'telegram' activates t.me redirect
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uqKindPerRecipient: uniqueIndex('connect_links_kind_recipient_uq').on(
      t.opportunityId,
      t.userId,
      t.kind,
    ),
    idxExpires: index('connect_links_expires_at_idx').on(t.expiresAt),
  }),
);

export type ConnectLink = typeof connectLinks.$inferSelect;
export type NewConnectLink = typeof connectLinks.$inferInsert;

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
 * API keys for external agent authentication (Better Auth apiKey plugin).
 * Keys are hashed before storage; the raw key is only returned on creation.
 */
export const apikeys = pgTable('apikey', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  key: text('key').notNull(),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  referenceId: text('reference_id'),
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
    weeklyNewsletter: true,
  }),
  unsubscribeToken: text('unsubscribe_token').$defaultFn(() => crypto.randomUUID()).notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export interface PremiseAssertion {
  text: string;
  tier: 'assertive' | 'contextual';
  summary?: string;
}

export interface PremiseProvenance {
  source: 'explicit' | 'enrichment' | 'integration' | 'onboarding';
  sourceId?: string;
  confidence: number;
  timestamp: string;
}

export interface PremiseAnalysis {
  speechActType: 'DECLARATIVE' | 'ASSERTIVE';
  felicityAuthority: number;
  felicitySincerity: number;
  felicityClarity: number;
  semanticEntropy: number;
}

export interface PremiseValidity {
  validFrom?: string;
  validUntil?: string;
  volatile: boolean;
}

export const premises = pgTable('premises', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  assertion: jsonb('assertion').$type<PremiseAssertion>().notNull(),
  provenance: jsonb('provenance').$type<PremiseProvenance>().notNull(),
  analysis: jsonb('analysis').$type<PremiseAnalysis>(),
  validity: jsonb('validity').$type<PremiseValidity>().notNull(),
  embedding: vector('embedding', { dimensions: 2000 }),
  status: premiseStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  retractedAt: timestamp('retracted_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
}, (table) => ({
  embeddingIdx: index('premises_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  userIdIdx: index('premises_user_id_idx').on(table.userId),
  statusIdx: index('premises_status_idx').on(table.status),
}));

export const premiseNetworks = pgTable('premise_networks', {
  premiseId: text('premise_id').notNull().references(() => premises.id, { onDelete: 'cascade' }),
  networkId: text('network_id').notNull().references(() => networks.id),
  relevancyScore: numeric('relevancy_score'),
  assignmentMetadata: jsonb('assignment_metadata').$type<import('@indexnetwork/protocol').NetworkAssignmentMetadata>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.premiseId, t.networkId] }),
  networkIdIdx: index('premise_networks_network_id_idx').on(t.networkId),
}));

export const userContexts = pgTable('user_contexts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  // Nullable: a null networkId is the user's single global, profile-replacing
  // context row. Per-network rows carry a concrete networkId.
  networkId: text('network_id').references(() => networks.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  embedding: vector('embedding', { dimensions: 2000 }),
  premiseHash: text('premise_hash'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  // One row per (user, network) for concrete networks. A NULL networkId is excluded
  // here (Postgres treats NULLs as distinct), so the global row is enforced separately.
  userNetworkUniq: uniqueIndex('user_contexts_user_network_uniq')
    .on(table.userId, table.networkId)
    .where(sql`${table.networkId} IS NOT NULL`),
  // Exactly one global (networkId IS NULL) row per user.
  userGlobalUniq: uniqueIndex('user_contexts_user_global_uniq')
    .on(table.userId)
    .where(sql`${table.networkId} IS NULL`),
  embeddingIdx: index('user_contexts_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  userIdIdx: index('user_contexts_user_id_idx').on(table.userId),
  networkIdIdx: index('user_contexts_network_id_idx').on(table.networkId),
}));

/** Durable protected-base fingerprints used to reject stale matrix child runs. */
export const evalMatrixMetadata = pgTable('eval_matrix_metadata', {
  key: text('key').primaryKey(),
  schemaMigrationFingerprint: text('schema_migration_fingerprint').notNull(),
  fixtureFingerprint: text('fixture_fingerprint').notNull(),
  fixtureCorpusVersion: text('fixture_corpus_version').notNull(),
  seededAt: timestamp('seeded_at', { withTimezone: true }).notNull(),
  qualityAttestation: jsonb('quality_attestation').$type<HistoricalQualityBaseAttestation>(),
});
/** Precomputed fast-intake artifact: one row per user. */
export const signalIntakePacks = pgTable('signal_intake_packs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().unique().references(() => users.id, { onDelete: 'cascade' }),
  brief: text('brief').notNull(),
  question: jsonb('question').$type<{
    title: string;
    prompt: string;
    options: Array<{ label: string; description: string }>;
    multiSelect: boolean;
  }>().notNull(),
  premiseHash: text('premise_hash'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
});
// No explicit user_id index: `.unique()` on user_id already creates
// `signal_intake_packs_user_id_unique`, a btree on exactly that column, which
// serves every lookup (getPack) and the upsert's ON CONFLICT target.

export type SignalIntakePackRow = typeof signalIntakePacks.$inferSelect;
export type NewSignalIntakePackRow = typeof signalIntakePacks.$inferInsert;

export const signalIntakeRunStatusEnum = pgEnum('signal_intake_run_status', ['pending', 'ready', 'failed']);

/** Single-flight record for speculative intake synthesis. */
export const signalIntakeRuns = pgTable('signal_intake_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  answersHash: text('answers_hash').notNull(),
  status: signalIntakeRunStatusEnum('status').notNull().default('pending'),
  proposalId: text('proposal_id'),
  /** "Looking for" card summary from the synthesis that settled this run. */
  lookingFor: text('looking_for'),
  /** "You bring" card summary from the synthesis that settled this run. */
  youBring: text('you_bring'),
  error: text('error'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userAnswersUniq: uniqueIndex('signal_intake_runs_user_answers_uniq').on(table.userId, table.answersHash),
  userIdIdx: index('signal_intake_runs_user_id_idx').on(table.userId),
  createdAtIdx: index('signal_intake_runs_created_at_idx').on(table.createdAt),
}));

export type SignalIntakeRunRow = typeof signalIntakeRuns.$inferSelect;

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
  source: 'opportunity_graph' | 'chat' | 'manual' | 'cron' | 'member_added' | 'enrichment' | 'introducer_discovery';
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
  /** Which premise grounded this match (set when discoverySource is 'premise-similarity'). */
  premise?: Id<'premises'>;
  role: string;
  /** Only set on role === 'introducer'. false until the introducer explicitly approves; true after approval. */
  approved?: boolean;
  /**
   * ISO-8601 timestamp set the first time this actor advanced the opportunity's
   * state (patient sending, agent accepting, peer "accepting" on draft = sending
   * under the hood, peer accepting on pending, introducer sending). Once set,
   * this actor has committed and cannot be the one to subsequently `accept` the
   * same opportunity — enforced by the self-accept guard in `updateNode`.
   */
  actedAt?: string;
}

export interface OpportunitySignal {
  type: string;
  weight: number;
  detail?: string;
  /** Question provenance for reversible pool-discriminator signals (IND-419). */
  questionId?: string;
  /** Recipient provenance for pool-discriminator signals. */
  recipientUserId?: string;
  /** Intent-pool provenance for pool-discriminator signals. */
  intentId?: string;
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

export const opportunityDiscoveryRuns = pgTable('opportunity_discovery_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  status: discoveryRunStatusEnum('status').notNull().default('queued'),
  input: jsonb('input').$type<Record<string, unknown>>().notNull(),
  context: jsonb('context').$type<Record<string, unknown>>().notNull(),
  progress: jsonb('progress').$type<Record<string, unknown>>(),
  result: jsonb('result').$type<unknown>(),
  error: text('error'),
  cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => ({
  userCreatedIdx: index('opportunity_discovery_runs_user_created_idx').on(table.userId, table.createdAt),
  statusCreatedIdx: index('opportunity_discovery_runs_status_created_idx').on(table.status, table.createdAt),
  expiresAtIdx: index('opportunity_discovery_runs_expires_at_idx').on(table.expiresAt),
}));

export const enrichmentToolRuns = pgTable('enrichment_tool_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  agentId: text('agent_id').references(() => agents.id, { onDelete: 'set null' }),
  operation: text('operation').notNull(),
  status: discoveryRunStatusEnum('status').notNull().default('queued'),
  input: jsonb('input').$type<Record<string, unknown>>().notNull(),
  context: jsonb('context').$type<Record<string, unknown>>().notNull(),
  progress: jsonb('progress').$type<Record<string, unknown>>(),
  result: jsonb('result').$type<unknown>(),
  error: text('error'),
  cancelRequestedAt: timestamp('cancel_requested_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp('started_at', { withTimezone: true }),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => ({
  userCreatedIdx: index('enrichment_tool_runs_user_created_idx').on(table.userId, table.createdAt),
  statusCreatedIdx: index('enrichment_tool_runs_status_created_idx').on(table.status, table.createdAt),
  operationCreatedIdx: index('enrichment_tool_runs_operation_created_idx').on(table.operation, table.createdAt),
  expiresAtIdx: index('enrichment_tool_runs_expires_at_idx').on(table.expiresAt),
}));

export interface QuestionDetection {
  mode: 'intent' | 'negotiation' | 'negotiation_inflight' | 'chat' | 'pool_discovery';
  /** Internal generation purpose; stripped from public API responses. */
  purpose?: import('@indexnetwork/protocol').QuestionPurpose;
  /** Exact negotiation recipient/intent/task routing provenance. Internal only. */
  negotiation?: import('@indexnetwork/protocol').NegotiationQuestionProvenance;
  sourceType: string;
  sourceId: string;
  triggeredBy?: string;
  timestamp: string;
  /** Generation strategy — persisted as metadata, not exposed on read. */
  strategy?: import('@indexnetwork/protocol').QuestionStrategy;
  /** QUD repair category — persisted as metadata, not exposed on read. */
  underspecificationType?: import('@indexnetwork/protocol').UnderspecificationType | null;
  /** ID of the assistant message that triggered this question. */
  messageId?: string;
  /** Durable conversation-session binding for verified in-chat rendering. */
  sessionId?: string;
  /**
   * pool_discovery only: mined pool snapshot (assignments + chain alternates).
   * INTERNAL — stripped from every client-facing read (web + MCP).
   */
  pool?: import('@indexnetwork/protocol').QuestionPoolSnapshot;
  /** Post-discovery intent recovery snapshot. Never exposed publicly. */
  recovery?: import('@indexnetwork/protocol').QuestionRecoverySnapshot;
  /** Durable proactive-delivery request marker. Never exposed publicly. */
  pushRequestedAt?: string;
  /** Last bounded recovery sweep that selected this request. Never exposed publicly. */
  pushRecoveryAttemptedAt?: string;
  /** Durable request outcome. Never exposed publicly. */
  pushRequestStatus?: import('@indexnetwork/protocol').QuestionPoolPushRequestStatus;
  /** Permanent suppression reason for an unclaimed request. Never exposed publicly. */
  pushRequestReason?: import('@indexnetwork/protocol').QuestionPoolPushRequestReason;
  /** Timestamp at which an unclaimed request was suppressed. Never exposed publicly. */
  pushRequestSuppressedAt?: string;
  /** Internal proactive push claim/delivery state. Never exposed publicly. */
  push?: import('@indexnetwork/protocol').QuestionPoolPush;
  /** Internal reason a pool question was voided after drift. */
  voidedReason?: import('@indexnetwork/protocol').QuestionVoidedReason;
  /** Authoritative successful-delivery ledger timestamp. Never exposed publicly. */
  pushedAt?: string;
}

export interface QuestionActor {
  userId: string;
  networkId?: string;
  role: 'subject';
}

export interface QuestionAnswer {
  selectedOptions: string[];
  freeText?: string;
  answeredBy: string;
  answeredAt: string;
}

export const questions = pgTable('questions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  detection: jsonb('detection').$type<QuestionDetection>().notNull(),
  actors: jsonb('actors').$type<QuestionActor[]>().notNull(),
  payload: jsonb('payload').$type<import('@indexnetwork/protocol').Question>().notNull(),
  status: questionStatusEnum('status').notNull().default('pending'),
  answer: jsonb('answer').$type<QuestionAnswer>(),
  conversationId: text('conversation_id'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  statusIdx: index('questions_status_idx').on(table.status),
  conversationIdx: index('questions_conversation_id_idx').on(table.conversationId),
  // Durable negotiation-family idempotency across every lifecycle status.
  // Ordinal preserves the existing up-to-two-card generator cardinality.
  negotiationProvenanceUnique: uniqueIndex('questions_negotiation_provenance_uniq')
    .on(
      sql`(${table.detection}->'negotiation'->>'recipientUserId')`,
      sql`(${table.detection}->'negotiation'->>'recipientIntentId')`,
      sql`(${table.detection}->'negotiation'->>'opportunityId')`,
      sql`COALESCE(${table.detection}->'negotiation'->>'taskId', '')`,
      sql`(${table.detection}->'negotiation'->>'purpose')`,
      sql`(${table.detection}->'negotiation'->>'questionOrdinal')`,
    )
    .where(sql`${table.detection}->'negotiation'->>'version' = '1'`),
  // One recovery refinement per recipient + intent + material fingerprint
  // across every status and expiry state. Advisory locking is the application
  // gate; this expression index is the final cross-worker race guard.
  recoveryRecipientIntentFingerprintUnique: uniqueIndex('questions_recovery_recipient_intent_fingerprint_uniq')
    .on(
      sql`(${table.actors}->0->>'userId')`,
      sql`(${table.detection}->>'sourceId')`,
      sql`(${table.detection}->'recovery'->>'intentFingerprint')`,
    )
    .where(sql`${table.detection}->>'purpose' = 'recovery' AND ${table.detection}->>'mode' = 'intent' AND ${table.detection}->>'sourceType' = 'intent'`),
  // One claim per recipient + intent + pool refresh cycle. The advisory lock
  // enforces budgets; this expression index is the final cross-worker guard.
  poolPushRecipientIntentCycleUnique: uniqueIndex('questions_pool_push_recipient_intent_cycle_uniq')
    .on(
      sql`(${table.detection}->'push'->>'recipientId')`,
      sql`(${table.detection}->'push'->>'intentId')`,
      sql`(${table.detection}->'push'->>'cycleKey')`,
    )
    .where(sql`${table.detection}->>'mode' = 'pool_discovery' AND ${table.detection}->'push'->>'claimedAt' IS NOT NULL`),
  // Supports the strict UTC daily budget ledger, including claims whose
  // question lifecycle later resolves.
  poolPushRecipientClaimedAtIndex: index('questions_pool_push_recipient_claimed_at_idx')
    .on(
      sql`(${table.actors}->0->>'userId')`,
      sql`(${table.detection}->'push'->>'claimedAt')`,
    )
    .where(sql`${table.detection}->'push'->>'claimedAt' IS NOT NULL`),
}));

export type QuestionRow = typeof questions.$inferSelect;
export type NewQuestionRow = typeof questions.$inferInsert;

export interface IntentProposalVerifierOutputRecord {
  reasoning: string;
  classification: 'COMMISSIVE' | 'DIRECTIVE' | 'ASSERTIVE' | 'EXPRESSIVE' | 'DECLARATION' | 'UNKNOWN';
  felicity_scores: {
    clarity: number;
    authority: number;
    sincerity: number;
  };
  semantic_entropy: number;
  referential_anchor: string | null;
  referential_breadth: 'narrow' | 'moderate' | 'broad';
  missing_selectional_constraints: Array<'role' | 'outcome' | 'location' | 'timeframe' | 'domain' | 'concrete_need'>;
  specificity_warning: string | null;
  flags: string[];
}

export interface IntentProposalAnalysisRecord {
  verifierOutput: IntentProposalVerifierOutputRecord;
  combinedScore: number | null;
}

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
   * (any path: web from-intent queue or async MCP discovery-run). Null until
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
  isPersonal: boolean('is_personal').default(false).notNull(),
  masterKeyHash: text('master_key_hash'),
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
  indexesKeyUnique: uniqueIndex('indexes_key_unique').on(table.key),
}));

export const intentProposals = pgTable('intent_proposals', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  networkId: text('network_id'),
  analysis: jsonb('analysis').$type<IntentProposalAnalysisRecord>().notNull(),
  status: intentProposalStatusEnum('status').notNull().default('pending'),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  consumedIntentId: text('consumed_intent_id').references(() => intents.id, { onDelete: 'set null' }),
}, (table) => ({
  userIdIdx: index('intent_proposals_user_id_idx').on(table.userId),
  expiresAtIdx: index('intent_proposals_expires_at_idx').on(table.expiresAt),
}));

export type IntentProposalRow = typeof intentProposals.$inferSelect;
export type NewIntentProposalRow = typeof intentProposals.$inferInsert;

/**
 * Immutable header for a bounded verification-analysis repair run.  Keeping
 * this separate from `intents` is deliberate: a backfill must not repurpose
 * product timestamps or add opaque metadata to the canonical intent record.
 */
export const intentVerificationBackfillRuns = pgTable('intent_verification_backfill_runs', {
  id: text('id').primaryKey(),
  predicateVersion: text('predicate_version').notNull(),
  verifierName: text('verifier_name').notNull(),
  verifierModel: text('verifier_model').notNull(),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, (table) => ({
  statusIdx: index('intent_verification_backfill_runs_status_idx').on(table.status),
  statusCheck: check('intent_verification_backfill_runs_status_check', sql`${table.status} IN ('running', 'completed', 'failed')`),
}));

/**
 * One durable outcome per run/intent.  A successful row is the resume marker;
 * invalid and failed outcomes are preserved for review rather than fabricated
 * into an intent analysis.
 */
export const intentVerificationBackfillAttempts = pgTable('intent_verification_backfill_attempts', {
  runId: text('run_id').notNull().references(() => intentVerificationBackfillRuns.id, { onDelete: 'cascade' }),
  intentId: text('intent_id').notNull().references(() => intents.id),
  partition: text('partition').notNull(),
  status: text('status').notNull(),
  payloadHash: text('payload_hash').notNull(),
  contextHash: text('context_hash').notNull(),
  verifierOutput: jsonb('verifier_output'),
  errorCode: text('error_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  appliedAt: timestamp('applied_at', { withTimezone: true }),
}, (table) => ({
  runIntentPk: primaryKey({ columns: [table.runId, table.intentId] }),
  statusIdx: index('intent_verification_backfill_attempts_status_idx').on(table.runId, table.status),
  intentIdx: index('intent_verification_backfill_attempts_intent_idx').on(table.intentId),
  partitionCheck: check('intent_verification_backfill_attempts_partition_check', sql`${table.partition} IN ('proposal_confirm_default_only', 'proposal_confirm_partial_missing', 'legacy_discovery_missing_analysis', 'other_missing_analysis')`),
  statusCheck: check('intent_verification_backfill_attempts_status_check', sql`${table.status} IN ('updated', 'skipped', 'failed', 'unchanged_control')`),
}));

export type FrameCentroidCorpus = 'premise' | 'intent' | 'user_context';
export type FrameDriftExecutionTerminalStatus = 'inserted' | 'duplicate' | 'skipped' | 'failed';
export type FrameDriftExecutionFailureCategory = 'measurement';

export const frameDriftExecutionAttempts = pgTable('frame_drift_execution_attempts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  queueName: text('queue_name').notNull(),
  schedulerId: text('scheduler_id').notNull(),
  jobId: text('job_id').notNull(),
  jobName: text('job_name').notNull(),
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
  bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
  bucketEnd: timestamp('bucket_end', { withTimezone: true }).notNull(),
  attempt: integer('attempt').notNull(),
  maxAttempts: integer('max_attempts').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  terminalStatus: text('terminal_status').$type<FrameDriftExecutionTerminalStatus>(),
  willRetry: boolean('will_retry'),
  failureCategory: text('failure_category').$type<FrameDriftExecutionFailureCategory>(),
}, (table) => ({
  jobAttemptUnique: uniqueIndex('frame_drift_execution_attempts_job_attempt_uniq')
    .on(table.jobId, table.attempt),
  bucketStartIdx: index('frame_drift_execution_attempts_bucket_start_idx').on(table.bucketStart),
  incompleteIdx: index('frame_drift_execution_attempts_incomplete_idx')
    .on(table.startedAt)
    .where(sql`${table.completedAt} IS NULL`),
  identityCheck: check('frame_drift_execution_attempts_identity_check', sql`
    length(btrim(${table.queueName})) > 0
    AND length(btrim(${table.schedulerId})) > 0
    AND length(btrim(${table.jobId})) > 0
    AND length(btrim(${table.jobName})) > 0
  `),
  dailyBucketCheck: check('frame_drift_execution_attempts_daily_bucket_check', sql`
    ${table.bucketEnd} = ${table.bucketStart} + interval '1 day'
    AND date_trunc('day', ${table.bucketStart} AT TIME ZONE 'UTC') = ${table.bucketStart} AT TIME ZONE 'UTC'
    AND date_trunc('day', ${table.bucketEnd} AT TIME ZONE 'UTC') = ${table.bucketEnd} AT TIME ZONE 'UTC'
    AND ${table.scheduledAt} >= ${table.bucketEnd}
    AND ${table.scheduledAt} < ${table.bucketEnd} + interval '1 day'
  `),
  attemptBoundsCheck: check('frame_drift_execution_attempts_attempt_bounds_check', sql`
    ${table.attempt} BETWEEN 1 AND ${table.maxAttempts}
    AND ${table.maxAttempts} BETWEEN 1 AND 100
  `),
  terminalStatusCheck: check('frame_drift_execution_attempts_terminal_status_check', sql`
    ${table.terminalStatus} IS NULL
    OR ${table.terminalStatus} IN ('inserted', 'duplicate', 'skipped', 'failed')
  `),
  failureCategoryCheck: check('frame_drift_execution_attempts_failure_category_check', sql`
    ${table.failureCategory} IS NULL OR ${table.failureCategory} = 'measurement'
  `),
  terminalStateCheck: check('frame_drift_execution_attempts_terminal_state_check', sql`
    (
      ${table.terminalStatus} IS NULL
      AND ${table.completedAt} IS NULL
      AND ${table.willRetry} IS NULL
      AND ${table.failureCategory} IS NULL
    ) OR (
      ${table.terminalStatus} IN ('inserted', 'duplicate', 'skipped')
      AND ${table.completedAt} IS NOT NULL
      AND ${table.completedAt} >= ${table.startedAt}
      AND ${table.willRetry} IS NOT NULL
      AND ${table.willRetry} = false
      AND ${table.failureCategory} IS NULL
    ) OR (
      ${table.terminalStatus} = 'failed'
      AND ${table.completedAt} IS NOT NULL
      AND ${table.completedAt} >= ${table.startedAt}
      AND ${table.willRetry} IS NOT NULL
      AND ${table.failureCategory} IS NOT NULL
      AND ${table.failureCategory} = 'measurement'
    )
  `),
}));

export const frameDriftObservationRuns = pgTable('frame_drift_observation_runs', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
  bucketEnd: timestamp('bucket_end', { withTimezone: true }).notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
  configuredEmbeddingModel: text('configured_embedding_model').notNull(),
  maxNetworks: integer('max_networks').notNull(),
  maxPairs: integer('max_pairs').notNull(),
  minUsers: integer('min_users').notNull(),
  stableCohortHash: text('stable_cohort_hash'),
  aggregateDiagnostics: jsonb('aggregate_diagnostics').$type<Record<string, unknown>>().notNull().default({}),
}, (table) => ({
  bucketStartUnique: uniqueIndex('frame_drift_observation_runs_bucket_start_uniq').on(table.bucketStart),
  bucketCheck: check('frame_drift_observation_runs_bucket_check', sql`${table.bucketEnd} = ${table.bucketStart} + interval '1 day' AND ${table.capturedAt} >= ${table.bucketEnd}`),
  configuredEmbeddingModelCheck: check('frame_drift_observation_runs_configured_embedding_model_check', sql`length(btrim(${table.configuredEmbeddingModel})) > 0`),
  maxNetworksCheck: check('frame_drift_observation_runs_max_networks_check', sql`${table.maxNetworks} BETWEEN 1 AND 200`),
  maxPairsCheck: check('frame_drift_observation_runs_max_pairs_check', sql`${table.maxPairs} BETWEEN 1 AND 10000`),
  minUsersCheck: check('frame_drift_observation_runs_min_users_check', sql`${table.minUsers} BETWEEN 2 AND 100`),
  stableCohortHashCheck: check('frame_drift_observation_runs_stable_cohort_hash_check', sql`${table.stableCohortHash} IS NULL OR ${table.stableCohortHash} ~ '^[0-9a-f]{64}$'`),
  aggregateDiagnosticsCheck: check('frame_drift_observation_runs_aggregate_diagnostics_check', sql`jsonb_typeof(${table.aggregateDiagnostics}) = 'object'`),
}));

export const frameCentroidSnapshots = pgTable('frame_centroid_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text('run_id').notNull().references(() => frameDriftObservationRuns.id, { onDelete: 'cascade' }),
  networkId: text('network_id').notNull().references(() => networks.id, { onDelete: 'cascade' }),
  corpus: text('corpus').$type<FrameCentroidCorpus>().notNull(),
  centroid: vector('centroid', { dimensions: 2000 }).notNull(),
  sampleCount: integer('sample_count').notNull(),
  configuredEmbeddingModel: text('configured_embedding_model').notNull(),
  cosineDrift: doublePrecision('cosine_drift'),
  priorBucketStart: timestamp('prior_bucket_start', { withTimezone: true }),
  bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
  bucketEnd: timestamp('bucket_end', { withTimezone: true }).notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  corpusCheck: check('frame_centroid_snapshots_corpus_check', sql`${table.corpus} IN ('premise', 'intent', 'user_context')`),
  sampleCountCheck: check('frame_centroid_snapshots_sample_count_check', sql`${table.sampleCount} > 0`),
  cosineDriftCheck: check('frame_centroid_snapshots_cosine_drift_check', sql`${table.cosineDrift} IS NULL OR (${table.cosineDrift} >= 0 AND ${table.cosineDrift} <= 2)`),
  bucketRangeCheck: check('frame_centroid_snapshots_bucket_range_check', sql`${table.bucketEnd} > ${table.bucketStart}`),
  dailyUnique: uniqueIndex('frame_centroid_snapshots_daily_uniq')
    .on(table.networkId, table.corpus, table.configuredEmbeddingModel, table.bucketStart),
}));

export const crossNetworkYieldSnapshots = pgTable('cross_network_yield_snapshots', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  runId: text('run_id').notNull().references(() => frameDriftObservationRuns.id, { onDelete: 'cascade' }),
  networkAId: text('network_a_id').notNull().references(() => networks.id, { onDelete: 'cascade' }),
  networkBId: text('network_b_id').notNull().references(() => networks.id, { onDelete: 'cascade' }),
  opportunityCount: bigint('opportunity_count', { mode: 'number' }).notNull(),
  potentialIntentPairCount: bigint('potential_active_intent_pair_count', { mode: 'number' }).notNull(),
  yieldRate: doublePrecision('yield_rate').notNull(),
  yieldRateDelta: doublePrecision('yield_rate_delta'),
  priorBucketStart: timestamp('prior_bucket_start', { withTimezone: true }),
  bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
  bucketEnd: timestamp('bucket_end', { withTimezone: true }).notNull(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  canonicalPairCheck: check('cross_network_yield_snapshots_canonical_pair_check', sql`${table.networkAId} < ${table.networkBId}`),
  opportunityCountCheck: check('cross_network_yield_snapshots_opportunity_count_check', sql`${table.opportunityCount} >= 0`),
  potentialPairCountCheck: check('cross_network_yield_snapshots_potential_pair_count_check', sql`${table.potentialIntentPairCount} > 0`),
  yieldRateCheck: check('cross_network_yield_snapshots_yield_rate_check', sql`${table.yieldRate} >= 0`),
  bucketRangeCheck: check('cross_network_yield_snapshots_bucket_range_check', sql`${table.bucketEnd} > ${table.bucketStart}`),
  dailyUnique: uniqueIndex('cross_network_yield_snapshots_daily_uniq')
    .on(table.networkAId, table.networkBId, table.bucketStart),
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

export const personalNetworks = pgTable('personal_networks', {
  userId: text('user_id').notNull().references(() => users.id),
  networkId: text('network_id').notNull().references(() => networks.id),
}, (t) => ({
  pk: primaryKey({ columns: [t.userId] }),
  networkUnique: uniqueIndex('personal_networks_network_id_unique').on(t.networkId),
}));

export const networkIntegrations = pgTable('network_integrations', {
  networkId: text('network_id').notNull().references(() => networks.id),
  toolkit: text('toolkit').notNull(),
  connectedAccountId: text('connected_account_id').notNull(),
  syncConfig: jsonb('sync_config').$type<{
    intervalMs?: number;
    lastSyncAt?: string;
    calendarId?: string;
    status?: 'active' | 'paused' | 'error';
  }>().default({}).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.networkId, table.toolkit] }),
}));

export const files = pgTable('files', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  name: text('name').notNull(),
  size: bigint('size', { mode: 'bigint' }).notNull(),
  type: text('type').notNull(),
  userId: text('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

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


// Links
const linksTable = pgTable('links', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  lastSyncAt: timestamp('last_sync_at'),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
export const links = linksTable;

export type Link = typeof linksTable.$inferSelect;
export type NewLink = typeof linksTable.$inferInsert;

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
  lastNegotiationPickupAt: timestamp('last_negotiation_pickup_at', { withTimezone: true }),
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
  lastNegotiationPickupAtIdx: index('agents_last_negotiation_pickup_at_idx').on(table.lastNegotiationPickupAt),
  // One active personal negotiator row per owner. External (poller) and system
  // rows are unconstrained.
  uniquePersonalPerOwner: uniqueIndex('uniq_agents_personal_per_owner')
    .on(table.ownerId)
    .where(sql`${table.type} = 'personal' AND ${table.deletedAt} IS NULL`),
  uniqueHermesInstallation: uniqueIndex('uniq_agents_hermes_installation')
    .on(table.ownerId, table.runtimeKind, table.installationId)
    .where(sql`${table.type} = 'external' AND ${table.runtimeKind} = 'hermes' AND ${table.installationId} IS NOT NULL AND ${table.deletedAt} IS NULL`),
  uniqueSelectedNegotiationExecutor: uniqueIndex('uniq_agents_selected_negotiation_executor')
    .on(table.ownerId)
    .where(sql`${table.type} = 'external' AND ${table.handleNegotiations} = true AND ${table.deletedAt} IS NULL`),
}));

export const agentTransports = pgTable('agent_transports', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  channel: transportChannelEnum('channel').notNull(),
  config: jsonb('config').$type<Record<string, unknown>>().default({}),
  priority: integer('priority').notNull().default(0),
  active: boolean('active').notNull().default(true),
  failureCount: integer('failure_count').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentIdIdx: index('agent_transports_agent_id_idx').on(table.agentId),
}));

export const agentPermissions = pgTable('agent_permissions', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  scope: permissionScopeEnum('scope').notNull().default('global'),
  scopeId: text('scope_id'),
  actions: text('actions').array().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentIdIdx: index('agent_permissions_agent_id_idx').on(table.agentId),
  userIdIdx: index('agent_permissions_user_id_idx').on(table.userId),
  agentUserIdx: index('agent_permissions_agent_user_idx').on(table.agentId, table.userId),
  uniqueGlobalPermission: uniqueIndex('uniq_agent_permissions_global')
    .on(table.agentId, table.userId)
    .where(sql`${table.scope} = 'global'`),
}));

/**
 * Negotiator memory kinds (IND-405):
 * - `playbook`: negotiation tactics/strategies the negotiator has learned for its client.
 * - `disclosure_rule`: standing rules about what may/may not be shared, with whom.
 * - `counterparty_dossier`: private notes about a specific counterparty (subjectUserId).
 * - `threshold`: client-specific limits (pricing floors, time budgets, deal-breakers).
 *
 * Plain text column (not a pg enum) by design: adding kinds is a code-only change,
 * avoiding ALTER TYPE ... ADD VALUE same-deploy hazards (55P04).
 */
export type NegotiatorMemoryKind = 'playbook' | 'disclosure_rule' | 'counterparty_dossier' | 'threshold';

/** Provenance pointer for a negotiator memory (e.g. the negotiation it was learned from). */
export interface NegotiatorMemorySourceRef {
  type: 'negotiation' | 'question_answer' | 'chat' | 'manual';
  id: string;
  /** For negotiation refs: 0-based turn indexes evidencing the memory. */
  turnIndexes?: number[];
}

/**
 * Private operational memory of a user's personal negotiator agent row (IND-405).
 *
 * Strictly separate from premises: premises are public-ish identity assertions
 * that feed discovery; negotiator memories are private operational knowledge
 * (playbooks, disclosure rules, dossiers, thresholds) and MUST NOT be exposed
 * to discovery, user contexts, or any counterparty-visible surface.
 *
 * Nothing reads or writes this table in production paths yet — adapter + tests only.
 */
export const negotiatorMemories = pgTable('negotiator_memories', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  /** The owning negotiator agent row (type='personal'). Memories die with the agent. */
  agentId: text('agent_id').notNull().references(() => agents.id, { onDelete: 'cascade' }),
  /** Denormalized owner (matches agents.ownerId) for cheap user-scoped queries. */
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<NegotiatorMemoryKind>().notNull(),
  /**
   * For counterparty dossiers: who the memory is about. Cascade delete is a
   * privacy stance — when the subject user is deleted, notes about them go too.
   */
  subjectUserId: text('subject_user_id').references(() => users.id, { onDelete: 'cascade' }),
  content: text('content').notNull(),
  /** Same embedding space as premises: text-embedding-3-large @ 2000 dims. */
  embedding: vector('embedding', { dimensions: 2000 }),
  sourceRefs: jsonb('source_refs').$type<NegotiatorMemorySourceRef[]>().notNull().default([]),
  confidence: real('confidence').notNull().default(0.5),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  agentKindIdx: index('negotiator_memories_agent_kind_idx').on(table.agentId, table.kind),
  userSubjectIdx: index('negotiator_memories_user_subject_idx').on(table.userId, table.subjectUserId),
  embeddingIdx: index('negotiator_memories_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
}));

export const agentTestMessages = pgTable(
  'agent_test_messages',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    agentId: text('agent_id')
      .notNull()
      .references(() => agents.id, { onDelete: 'cascade' }),
    requestedByUserId: text('requested_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    reservationToken: text('reservation_token'),
    reservedAt: timestamp('reserved_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    byAgent: index('idx_agent_test_messages_agent_pending').on(
      t.agentId,
      t.reservedAt,
    ),
  }),
);

export type AgentTestMessage = typeof agentTestMessages.$inferSelect;
export type NewAgentTestMessage = typeof agentTestMessages.$inferInsert;

export const opportunityDeliveries = pgTable(
  'opportunity_deliveries',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    opportunityId: text('opportunity_id')
      .notNull()
      .references(() => opportunities.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').references(() => agents.id, {
      onDelete: 'set null',
    }),
    channel: text('channel').notNull(),
    trigger: text('trigger').notNull(),
    deliveredAtStatus: text('delivered_at_status').notNull(),
    reservationToken: text('reservation_token'),
    reservedAt: timestamp('reserved_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    uniqueCommitted: uniqueIndex('uniq_opp_deliveries_committed')
      .on(t.userId, t.opportunityId, t.channel, t.deliveredAtStatus)
      .where(sql`${t.deliveredAt} IS NOT NULL`),
    reservationLookup: index('idx_opp_deliveries_open_reservations')
      .on(t.userId, t.channel, t.reservedAt)
      .where(sql`${t.deliveredAt} IS NULL`),
  }),
);

export type OpportunityDelivery = typeof opportunityDeliveries.$inferSelect;
export type NewOpportunityDelivery = typeof opportunityDeliveries.$inferInsert;

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
  premises: many(premises),
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

export const premisesRelations = relations(premises, ({ one, many }) => ({
  user: one(users, {
    fields: [premises.userId],
    references: [users.id],
  }),
  networks: many(premiseNetworks),
}));

export const premiseNetworksRelations = relations(premiseNetworks, ({ one }) => ({
  premise: one(premises, {
    fields: [premiseNetworks.premiseId],
    references: [premises.id],
  }),
  network: one(networks, {
    fields: [premiseNetworks.networkId],
    references: [networks.id],
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
  file: one(files, {
    fields: [intents.sourceId],
    references: [files.id],
    relationName: 'intent_file',
  }),
  link: one(links, {
    fields: [intents.sourceId],
    references: [links.id],
    relationName: 'intent_link',
  }),
}));

export const networksRelations = relations(networks, ({ many }) => ({
  members: many(networkMembers),
  intents: many(intentNetworks),
  premises: many(premiseNetworks),
  integrations: many(networkIntegrations),
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

export const personalNetworksRelations = relations(personalNetworks, ({ one }) => ({
  user: one(users, {
    fields: [personalNetworks.userId],
    references: [users.id],
  }),
  network: one(networks, {
    fields: [personalNetworks.networkId],
    references: [networks.id],
  }),
}));

export const networkIntegrationsRelations = relations(networkIntegrations, ({ one }) => ({
  network: one(networks, {
    fields: [networkIntegrations.networkId],
    references: [networks.id],
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

export const agentsRelations = relations(agents, ({ one, many }) => ({
  owner: one(users, {
    fields: [agents.ownerId],
    references: [users.id],
  }),
  transports: many(agentTransports),
  permissions: many(agentPermissions),
}));

export const agentTransportsRelations = relations(agentTransports, ({ one }) => ({
  agent: one(agents, {
    fields: [agentTransports.agentId],
    references: [agents.id],
  }),
}));

export const agentPermissionsRelations = relations(agentPermissions, ({ one }) => ({
  agent: one(agents, {
    fields: [agentPermissions.agentId],
    references: [agents.id],
  }),
  user: one(users, {
    fields: [agentPermissions.userId],
    references: [users.id],
  }),
}));

export const negotiatorMemoriesRelations = relations(negotiatorMemories, ({ one }) => ({
  agent: one(agents, {
    fields: [negotiatorMemories.agentId],
    references: [agents.id],
  }),
  user: one(users, {
    fields: [negotiatorMemories.userId],
    references: [users.id],
  }),
  subjectUser: one(users, {
    fields: [negotiatorMemories.subjectUserId],
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
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type UserNotificationSettings = typeof userNotificationSettings.$inferSelect;
export type NewUserNotificationSettings = typeof userNotificationSettings.$inferInsert;
export type HydeDocument = typeof hydeDocuments.$inferSelect;
export type NewHydeDocument = typeof hydeDocuments.$inferInsert;
export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
export type PersonalNetwork = typeof personalNetworks.$inferSelect;
export type NewPersonalNetwork = typeof personalNetworks.$inferInsert;
export type NetworkIntegration = typeof networkIntegrations.$inferSelect;
export type NewNetworkIntegration = typeof networkIntegrations.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type AgentTransport = typeof agentTransports.$inferSelect;
export type NewAgentTransport = typeof agentTransports.$inferInsert;
export type AgentPermission = typeof agentPermissions.$inferSelect;
export type NewAgentPermission = typeof agentPermissions.$inferInsert;
export type NegotiatorMemory = typeof negotiatorMemories.$inferSelect;
export type NewNegotiatorMemory = typeof negotiatorMemories.$inferInsert;
export type Premise = typeof premises.$inferSelect;
export type NewPremise = typeof premises.$inferInsert;
export type PremiseNetwork = typeof premiseNetworks.$inferSelect;
export type NewPremiseNetwork = typeof premiseNetworks.$inferInsert;
export type UserContext = typeof userContexts.$inferSelect;
export type NewUserContext = typeof userContexts.$inferInsert;

export * from './conversation.schema';
