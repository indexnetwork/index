import { pgTable, pgEnum, text, timestamp, bigint, boolean, json, jsonb, integer, uniqueIndex, index, doublePrecision, numeric, primaryKey } from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';
import type { Id } from '../types/common.types';

// Enums
export const sourceType = pgEnum('source_type', ['file', 'integration', 'link', 'discovery_form', 'enrichment']);
export const intentModeEnum = pgEnum('intent_mode', ['REFERENTIAL', 'ATTRIBUTIVE']);
export const speechActTypeEnum = pgEnum('speech_act_type', ['COMMISSIVE', 'DIRECTIVE']);
export const intentStatusEnum = pgEnum('intent_status', ['ACTIVE', 'PAUSED', 'FULFILLED', 'EXPIRED']);
export const opportunityStatusEnum = pgEnum('opportunity_status', ['latent', 'draft', 'negotiating', 'pending', 'stalled', 'accepted', 'rejected', 'expired']);
export const agentTypeEnum = pgEnum('agent_type', ['personal', 'system']);
export const agentStatusEnum = pgEnum('agent_status', ['active', 'inactive']);
export const transportChannelEnum = pgEnum('transport_channel', ['mcp']);
export const permissionScopeEnum = pgEnum('permission_scope', ['global', 'node', 'network']);

export interface OnboardingState {
  completedAt?: string;
  flow?: 1 | 2 | 3;
  currentStep?: 'profile' | 'summary' | 'connections' | 'create_network' | 'invite_members' | 'join_networks';
  networkId?: string;
  invitationCode?: string;
}

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

  // Ghost users (imported contacts who haven't signed up yet)
  isGhost: boolean('is_ghost').default(false).notNull(),

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

export const userProfiles = pgTable('user_profiles', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  identity: json('identity').$type<{ name: string; bio: string; location: string }>(),
  narrative: json('narrative').$type<{ context: string }>(),
  attributes: json('attributes').$type<{ interests: string[]; skills: string[] }>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  embedding: vector('embedding', { dimensions: 2000 }),
  implicitIntents: json('implicit_intents'),
}, (table) => ({
  embeddingIndex: index('user_profiles_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
}));

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

export type HydeSourceType = 'intent' | 'profile' | 'query';

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
}, (table) => ({
  statusIdx: index('opportunities_status_idx').on(table.status),
}));

export const intents = pgTable('intents', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  payload: text('payload').notNull(),
  summary: text('summary'),
  isIncognito: boolean('is_incognito').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  archivedAt: timestamp('archived_at'),
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
  isExperiment: boolean('is_experiment').default(false).notNull(),
  experimentMasterKeyHash: text('experiment_master_key_hash'),
  permissions: json('permissions').$type<{
    joinPolicy: 'anyone' | 'invite_only';
    invitationLink: { code: string } | null;
    allowGuestVibeCheck: boolean;
  }>().default({
    joinPolicy: 'invite_only',
    invitationLink: null,
    allowGuestVibeCheck: false
  }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => ({
  indexesKeyUnique: uniqueIndex('indexes_key_unique').on(table.key),
}));

export const networkMembers = pgTable('network_members', {
  networkId: text('network_id').notNull().references(() => networks.id),
  userId: text('user_id').notNull().references(() => users.id),
  permissions: text('permissions').array().notNull().default([]),
  prompt: text('prompt'),
  autoAssign: boolean('auto_assign').notNull().default(false),
  metadata: json('metadata').$type<Record<string, string | string[]>>(),
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
  type: agentTypeEnum('type').notNull().default('personal'),
  status: agentStatusEnum('status').notNull().default('active'),
  metadata: jsonb('metadata').$type<Record<string, unknown>>().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
  notifyOnOpportunity: boolean('notify_on_opportunity').notNull().default(true),
  dailySummaryEnabled: boolean('daily_summary_enabled').notNull().default(true),
  handleNegotiations: boolean('handle_negotiations').notNull().default(false),
  lastDailySummaryAt: timestamp('last_daily_summary_at', { withTimezone: true }),
}, (table) => ({
  ownerIdIdx: index('agents_owner_id_idx').on(table.ownerId),
  typeIdx: index('agents_type_idx').on(table.type),
  lastSeenAtIdx: index('agents_last_seen_at_idx').on(table.lastSeenAt),
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
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
}));

export const userSocialsRelations = relations(userSocials, ({ one }) => ({
  user: one(users, {
    fields: [userSocials.userId],
    references: [users.id],
  }),
}));

export const userProfilesRelations = relations(userProfiles, ({ one }) => ({
  user: one(users, {
    fields: [userProfiles.userId],
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

// ═══════════════════════════════════════════════════════════════════════════════
// Export types
// ═══════════════════════════════════════════════════════════════════════════════

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type UserProfile = typeof userProfiles.$inferSelect;
export type NewUserProfile = typeof userProfiles.$inferInsert;
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

export * from './conversation.schema';
