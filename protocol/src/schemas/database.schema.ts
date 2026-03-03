import { pgTable, pgEnum, text, timestamp, bigint, boolean, json, jsonb, varchar, integer, uniqueIndex, index, doublePrecision, numeric, primaryKey } from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { Id } from '../types/common.types';

// Enums
export const sourceType = pgEnum('source_type', ['file', 'integration', 'link', 'discovery_form', 'enrichment']);
export const intentModeEnum = pgEnum('intent_mode', ['REFERENTIAL', 'ATTRIBUTIVE']);
export const speechActTypeEnum = pgEnum('speech_act_type', ['COMMISSIVE', 'DIRECTIVE']);
export const intentStatusEnum = pgEnum('intent_status', ['ACTIVE', 'PAUSED', 'FULFILLED', 'EXPIRED']);
export const opportunityStatusEnum = pgEnum('opportunity_status', ['latent', 'draft', 'pending', 'viewed', 'accepted', 'rejected', 'expired']);
export const negotiationStatusEnum = pgEnum('negotiation_status', ['initiated', 'in_progress', 'resolved', 'expired']);
export const negotiationOutcomeEnum = pgEnum('negotiation_outcome', ['opportunity', 'disengaged', 'deferred']);

export interface OnboardingState {
  completedAt?: string;
  flow?: 1 | 2 | 3;
  currentStep?: 'profile' | 'summary' | 'connections' | 'create_index' | 'invite_members' | 'join_indexes';
  indexId?: string;
  invitationCode?: string;
}

export interface UserSocials {
  x?: string;
  linkedin?: string;
  github?: string;
  websites?: string[];
}

export interface NotificationPreferences {
  connectionUpdates: boolean;
  weeklyNewsletter: boolean;
}

export interface DirectorySyncConfig {
  enabled: boolean;
  source: {
    id: string;
    name: string;
    subId?: string;
    subName?: string;
  };
  columnMappings: {
    email: string;
    name?: string;
    intro?: string;
    location?: string;
    twitter?: string;
    linkedin?: string;
    github?: string;
    website?: string;
  };
  excludedColumns?: string[];
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'error' | 'partial';
  lastSyncError?: string;
  memberCount?: number;
}

export interface SlackConfig {
  selectedChannels?: string[];
}

export interface TwitterConfig {
  username: string;
}

export interface IntegrationConfigType {
  directorySync?: DirectorySyncConfig;
  slack?: SlackConfig;
  twitter?: TwitterConfig;
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
  avatar: text('avatar'),
  intro: text('intro'),
  location: text('location'),
  socials: json('socials').$type<UserSocials>(),
  onboarding: json('onboarding').$type<OnboardingState>().default({}),
  timezone: text('timezone').default('UTC'),
  lastWeeklyEmailSentAt: timestamp('last_weekly_email_sent_at'),

  // XMTP wallet
  walletAddress: text('wallet_address').unique(),
  walletEncryptedKey: text('wallet_encrypted_key'),
  xmtpInboxId: text('xmtp_inbox_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => ({
  usersEmailUnique: uniqueIndex('users_email_unique').on(table.email),
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
// Domain tables
// ═══════════════════════════════════════════════════════════════════════════════

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
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
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
  source: 'opportunity_graph' | 'chat' | 'manual' | 'cron' | 'member_added' | 'enrichment' | 'negotiation';
  createdBy?: Id<'users'> | string;
  createdByName?: string;
  triggeredBy?: Id<'intents'>;
  timestamp: string;
  enrichedFrom?: string[];
  negotiationId?: Id<'negotiations'>;
}

export interface OpportunityActor {
  indexId: Id<'indexes'>;
  userId: Id<'users'>;
  intent?: Id<'intents'>;
  role: string;
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
  indexId?: Id<'indexes'>;
  conversationId?: Id<'chatSessions'>;
}

export const opportunities = pgTable('opportunities', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  detection: jsonb('detection').$type<OpportunityDetection>().notNull(),
  actors: jsonb('actors').$type<OpportunityActor[]>().notNull(),
  interpretation: jsonb('interpretation').$type<OpportunityInterpretation>().notNull(),
  context: jsonb('context').$type<OpportunityContext>().notNull(),
  confidence: numeric('confidence').notNull(),
  status: opportunityStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => ({
  statusIdx: index('opportunities_status_idx').on(table.status),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// Negotiations (agent-to-agent negotiation protocol)
// ═══════════════════════════════════════════════════════════════════════════════

import type {
  NegotiationParticipant,
  NegotiationTrigger,
  NegotiationTurn,
  NegotiationResolution,
} from '../types/negotiation.types';

export const negotiations = pgTable('negotiations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  status: negotiationStatusEnum('status').notNull().default('initiated'),
  outcome: negotiationOutcomeEnum('outcome'),
  participants: jsonb('participants').$type<NegotiationParticipant[]>().notNull(),
  trigger: jsonb('trigger').$type<NegotiationTrigger>().notNull(),
  turns: jsonb('turns').$type<NegotiationTurn[]>().notNull().default([]),
  resolution: jsonb('resolution').$type<NegotiationResolution>(),
  opportunityId: text('opportunity_id').references(() => opportunities.id),
  currentTurn: integer('current_turn').notNull().default(0),
  maxTurns: integer('max_turns').notNull().default(3),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
}, (table) => ({
  statusIdx: index('negotiations_status_idx').on(table.status),
  participantsIdx: index('negotiations_participants_idx').using('gin', table.participants),
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
  status: intentStatusEnum('status').default('ACTIVE'),
}, (table) => [
  index('embeddingIndex').using('hnsw', table.embedding.op('vector_cosine_ops')),
]);

export const indexes = pgTable('indexes', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  title: text('title').notNull(),
  prompt: text('prompt'),
  isPersonal: boolean('is_personal').default(false).notNull(),
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
});

export const indexMembers = pgTable('index_members', {
  indexId: text('index_id').notNull().references(() => indexes.id),
  userId: text('user_id').notNull().references(() => users.id),
  permissions: text('permissions').array().notNull().default([]),
  prompt: text('prompt'),
  autoAssign: boolean('auto_assign').notNull().default(false),
  metadata: json('metadata').$type<Record<string, string | string[]>>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.indexId, table.userId] }),
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

export const intentIndexes = pgTable('intent_indexes', {
  intentId: text('intent_id').notNull().references(() => intents.id),
  indexId: text('index_id').notNull().references(() => indexes.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const userIntegrations = pgTable('integrations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  integrationType: varchar('integration_type', { length: 50 }).notNull(),
  connectedAccountId: varchar('connected_account_id', { length: 255 }),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  redirectUrl: text('redirect_url'),
  connectedAt: timestamp('connected_at'),
  lastSyncAt: timestamp('last_sync_at'),
  indexId: text('index_id').references(() => indexes.id),
  config: json('config').$type<IntegrationConfigType>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at')
});

export const chatMessageRoleEnum = pgEnum('chat_message_role', ['user', 'assistant', 'system']);

export const chatSessions = pgTable('chat_sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  title: text('title'),
  indexId: text('index_id').references(() => indexes.id, { onDelete: 'set null' }),
  shareToken: text('share_token'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata'),
}, (table) => ({
  userIdx: index('chat_sessions_user_idx').on(table.userId),
  shareTokenUnique: uniqueIndex('chat_sessions_share_token_unique').on(table.shareToken),
}));

export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  sessionId: text('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
  role: chatMessageRoleEnum('role').notNull(),
  content: text('content').notNull(),
  routingDecision: jsonb('routing_decision'),
  subgraphResults: jsonb('subgraph_results'),
  tokenCount: integer('token_count'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  sessionIdx: index('chat_messages_session_idx').on(table.sessionId),
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
export const indexLinks = linksTable;
export const links = linksTable;

export type IndexLink = typeof linksTable.$inferSelect;
export type NewIndexLink = typeof linksTable.$inferInsert;

// ═══════════════════════════════════════════════════════════════════════════════
// Relations
// ═══════════════════════════════════════════════════════════════════════════════

export const usersRelations = relations(users, ({ one, many }) => ({
  intents: many(intents),
  indexes: many(indexes),
  memberOf: many(indexMembers),
  notificationSettings: one(userNotificationSettings, {
    fields: [users.id],
    references: [userNotificationSettings.userId],
  }),
  profile: one(userProfiles, {
    fields: [users.id],
    references: [userProfiles.userId],
  }),
  chatSessions: many(chatSessions),
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
  indexes: many(intentIndexes),
  file: one(files, {
    fields: [intents.sourceId],
    references: [files.id],
    relationName: 'intent_file',
  }),
  integration: one(userIntegrations, {
    fields: [intents.sourceId],
    references: [userIntegrations.id],
    relationName: 'intent_integration',
  }),
  link: one(indexLinks, {
    fields: [intents.sourceId],
    references: [indexLinks.id],
    relationName: 'intent_link',
  }),
}));

export const indexesRelations = relations(indexes, ({ many }) => ({
  members: many(indexMembers),
  intents: many(intentIndexes),
  integrations: many(userIntegrations),
}));

export const indexMembersRelations = relations(indexMembers, ({ one }) => ({
  index: one(indexes, {
    fields: [indexMembers.indexId],
    references: [indexes.id],
  }),
  user: one(users, {
    fields: [indexMembers.userId],
    references: [users.id],
  }),
}));

export const intentIndexesRelations = relations(intentIndexes, ({ one }) => ({
  intent: one(intents, {
    fields: [intentIndexes.intentId],
    references: [intents.id],
  }),
  index: one(indexes, {
    fields: [intentIndexes.indexId],
    references: [indexes.id],
  }),
}));

export const userIntegrationsRelations = relations(userIntegrations, ({ one }) => ({
  user: one(users, {
    fields: [userIntegrations.userId],
    references: [users.id],
  }),
  index: one(indexes, {
    fields: [userIntegrations.indexId],
    references: [indexes.id],
  }),
}));

export const chatSessionsRelations = relations(chatSessions, ({ one, many }) => ({
  user: one(users, {
    fields: [chatSessions.userId],
    references: [users.id],
  }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  session: one(chatSessions, {
    fields: [chatMessages.sessionId],
    references: [chatSessions.id],
  }),
}));

export const negotiationsRelations = relations(negotiations, ({ one }) => ({
  opportunity: one(opportunities, {
    fields: [negotiations.opportunityId],
    references: [opportunities.id],
  }),
}));

// ═══════════════════════════════════════════════════════════════════════════════
// Hidden conversations (persistent chat deletion)
// ═══════════════════════════════════════════════════════════════════════════════

export const hiddenConversations = pgTable('hidden_conversations', {
  userId: text('user_id').notNull().references(() => users.id),
  conversationId: text('conversation_id').notNull(),
  hiddenAt: timestamp('hidden_at').defaultNow().notNull(),
}, (table) => ({
  pk: primaryKey({ columns: [table.userId, table.conversationId] }),
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
export type Index = typeof indexes.$inferSelect;
export type NewIndex = typeof indexes.$inferInsert;
export type IndexMember = typeof indexMembers.$inferSelect;
export type NewIndexMember = typeof indexMembers.$inferInsert;
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type UserIntegration = typeof userIntegrations.$inferSelect;
export type NewUserIntegration = typeof userIntegrations.$inferInsert;
export type UserNotificationSettings = typeof userNotificationSettings.$inferSelect;
export type NewUserNotificationSettings = typeof userNotificationSettings.$inferInsert;
export type ChatSession = typeof chatSessions.$inferSelect;
export type NewChatSession = typeof chatSessions.$inferInsert;
export type ChatMessage = typeof chatMessages.$inferSelect;
export type NewChatMessage = typeof chatMessages.$inferInsert;
export type HydeDocument = typeof hydeDocuments.$inferSelect;
export type NewHydeDocument = typeof hydeDocuments.$inferInsert;
export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
export type Negotiation = typeof negotiations.$inferSelect;
export type NewNegotiation = typeof negotiations.$inferInsert;
