import { pgTable, pgEnum, text, uuid, timestamp, bigint, boolean, json, jsonb, varchar, integer, uniqueIndex, index, doublePrecision, numeric } from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import type { Id } from '../types/common.types';

// Enums
// Polymorphic source type for intents
export const sourceType = pgEnum('source_type', ['file', 'integration', 'link', 'discovery_form', 'enrichment']);

// Semantic Governance Enums
export const intentModeEnum = pgEnum('intent_mode', ['REFERENTIAL', 'ATTRIBUTIVE']);
export const speechActTypeEnum = pgEnum('speech_act_type', ['COMMISSIVE', 'DIRECTIVE']);
export const intentStatusEnum = pgEnum('intent_status', ['ACTIVE', 'PAUSED', 'FULFILLED', 'EXPIRED']);
// Opportunity redesign: lifecycle status (message-first: accepted = B replied, rejected = B skipped)
export const opportunityStatusEnum = pgEnum('opportunity_status', ['latent', 'pending', 'viewed', 'accepted', 'rejected', 'expired']);
// Onboarding state type
export interface OnboardingState {
  completedAt?: string;  // ISO timestamp when completed
  flow?: 1 | 2 | 3;
  currentStep?: 'profile' | 'summary' | 'connections' | 'create_index' | 'invite_members' | 'join_indexes';
  indexId?: string;  // Persisted index ID for flow 2
  invitationCode?: string;  // Store which invitation was used (reference only)
}

// Social links type
export interface UserSocials {
  x?: string;  // X (formerly Twitter)
  linkedin?: string;
  github?: string;
  websites?: string[];
}

export interface NotificationPreferences {
  connectionUpdates: boolean;
  weeklyNewsletter: boolean;
}

// Directory sync configuration type
export interface DirectorySyncConfig {
  enabled: boolean;
  source: {
    id: string;       // baseId/databaseId/spreadsheetId
    name: string;
    subId?: string;   // tableId/sheetId (not used for Notion)
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

// Slack-specific configuration
export interface SlackConfig {
  selectedChannels?: string[]; // Array of channel IDs to sync
}

// Twitter-specific configuration
export interface TwitterConfig {
  username: string; // Twitter username extracted from URL
}

// Integration configuration type
export interface IntegrationConfigType {
  directorySync?: DirectorySyncConfig;
  slack?: SlackConfig;
  twitter?: TwitterConfig;
}

// Tables
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  privyId: text('privy_id').notNull().unique(),
  // Email is required and must be unique.
  email: text('email').notNull(),
  name: text('name').notNull(),
  intro: text('intro'),
  avatar: text('avatar'),
  location: text('location'),
  socials: json('socials').$type<UserSocials>(),
  onboarding: json('onboarding').$type<OnboardingState>().default({}),
  timezone: text('timezone').default('UTC'),
  xmtpInboxId: text('xmtp_inbox_id').unique(),
  lastWeeklyEmailSentAt: timestamp('last_weekly_email_sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => ({
  // Enforce uniqueness on all emails (email is NOT NULL).
  usersEmailUnique: uniqueIndex('users_email_unique').on(table.email),
}));

export const userProfiles = pgTable('user_profiles', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }).unique(),
  identity: json('identity').$type<{ name: string; bio: string; location: string }>(),
  narrative: json('narrative').$type<{ context: string }>(),
  attributes: json('attributes').$type<{ interests: string[]; skills: string[] }>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  // Vector embedding for semantic search (2000 dimensions for text-embedding-3-large)
  embedding: vector('embedding', { dimensions: 2000 }),
  // 3. Implicit Goals (inferred purely from profile)
  implicitIntents: json('implicit_intents'),
}, (table) => ({
  // Enforce uniqueness on userId is already done by the column definition
  embeddingIndex: index('user_profiles_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
}));

export const userNotificationSettings = pgTable('user_notification_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  preferences: json('preferences').$type<NotificationPreferences>().default({
    connectionUpdates: true,
    weeklyNewsletter: true,
  }),
  unsubscribeToken: uuid('unsubscribe_token').defaultRandom().notNull().unique(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// HyDE documents: hypothetical documents for multi-strategy semantic search (opportunity redesign)
export type HydeSourceType = 'intent' | 'profile' | 'query';

export const hydeDocuments = pgTable('hyde_documents', {
  id: uuid('id').primaryKey().defaultRandom(),
  sourceType: text('source_type').$type<HydeSourceType>().notNull(),
  sourceId: uuid('source_id'),
  sourceText: text('source_text'),
  strategy: text('strategy').notNull(), // 'mirror' | 'reciprocal' | 'mentor' | ...
  targetCorpus: text('target_corpus').notNull(), // 'profiles' | 'intents'
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

// Opportunity redesign: JSON types for extensible opportunity model
export interface OpportunityDetection {
  source: 'opportunity_graph' | 'chat' | 'manual' | 'cron' | 'member_added' | 'enrichment';
  /** User id who created, or system label (e.g. 'agent-opportunity-finder'). */
  createdBy?: Id<'users'> | string;
  triggeredBy?: Id<'intents'>;
  timestamp: string;
  /** IDs of predecessor opportunities that were merged into this one. */
  enrichedFrom?: string[];
}

export interface OpportunityActor {
  // idx-1:usr-1:(intent-1)?
  /** The index this actor was matched within. */
  indexId: Id<'indexes'>;
  userId: Id<'users'>;
  intent?: Id<'intents'>; // Single intent that contributed to this match. Absent = profile-based match.
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
  /** Set when user explicitly searched within a specific index; undefined for global search. */
  indexId?: Id<'indexes'>;
  conversationId?: string;
}

// Opportunities table (redesign: detection, actors, interpretation, context as JSONB; indexId lives in context)
export const opportunities = pgTable('opportunities', {
  id: uuid('id').primaryKey().defaultRandom(),
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

export const intents = pgTable('intents', {
  id: uuid('id').primaryKey().defaultRandom(),
  payload: text('payload').notNull(),
  // summary field will be removed from protocol
  summary: text('summary'),
  isIncognito: boolean('is_incognito').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  archivedAt: timestamp('archived_at'),
  userId: uuid('user_id').notNull().references(() => users.id),
  // Polymorphic nullable source (file | integration | link)
  sourceId: uuid('source_id'),
  sourceType: sourceType('source_type'),
  // Vector embedding for semantic search (2000 dimensions for text-embedding-3-large)
  embedding: vector('embedding', { dimensions: 2000 }),
  // Semantic Governance Fields
  semanticEntropy: doublePrecision('semantic_entropy').default(1.0),
  referentialAnchor: text('referential_anchor'),
  intentMode: intentModeEnum('intent_mode').default('ATTRIBUTIVE'),
  speechActType: speechActTypeEnum('speech_act_type'),
  // Felicity Conditions
  felicityAuthority: integer('felicity_authority'),
  felicitySincerity: integer('felicity_sincerity'),
  status: intentStatusEnum('status').default('ACTIVE'),
}, (table) => [
  index('embeddingIndex').using('hnsw', table.embedding.op('vector_cosine_ops')),
]);

export const indexes = pgTable('indexes', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  prompt: text('prompt'), // Defines what people can share in this index
  /** Personal index = "My Own Private Index"; default write location; private; one per user. */
  isPersonal: boolean('is_personal').default(false).notNull(),
  permissions: json('permissions').$type<{
    joinPolicy: 'anyone' | 'invite_only';
    invitationLink: {
      code: string;
    } | null;
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
  indexId: uuid('index_id').notNull().references(() => indexes.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  permissions: text('permissions').array().notNull().default([]),
  prompt: text('prompt'), // Defines what the member is sharing (defaults to index prompt)
  autoAssign: boolean('auto_assign').notNull().default(false), // Whether system auto-generates or respects manual edits
  metadata: json('metadata').$type<Record<string, string | string[]>>(), // Custom metadata for the member in this index
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  pk: { name: 'index_members_pkey', columns: [table.indexId, table.userId] }
}));

export const files = pgTable('files', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  size: bigint('size', { mode: 'bigint' }).notNull(),
  type: text('type').notNull(),
  userId: uuid('user_id').references(() => users.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});


export const intentIndexes = pgTable('intent_indexes', {
  intentId: uuid('intent_id').notNull().references(() => intents.id),
  indexId: uuid('index_id').notNull().references(() => indexes.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});


export const userIntegrations = pgTable('integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  integrationType: varchar('integration_type', { length: 50 }).notNull(),
  connectedAccountId: varchar('connected_account_id', { length: 255 }),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  redirectUrl: text('redirect_url'),
  connectedAt: timestamp('connected_at'),
  lastSyncAt: timestamp('last_sync_at'),
  indexId: uuid('index_id').references(() => indexes.id), // Required for Slack/Discord (always process per user)
  config: json('config').$type<IntegrationConfigType>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at')
});

// Relations
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
  // Soft polymorphic joins (only one applies based on sourceType)
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

// Links: manage crawlable URLs per user (optionally associated with an index)
const linksTable = pgTable('links', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  lastSyncAt: timestamp('last_sync_at'),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});
// Export aliases for the links table
export const indexLinks = linksTable;
export const links = linksTable;

// Integration Items mapping (dedupe across integrations; provider='web' for crawled pages)
export type IndexLink = typeof linksTable.$inferSelect;
export type NewIndexLink = typeof linksTable.$inferInsert;

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

// Export types
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
export type HydeDocument = typeof hydeDocuments.$inferSelect;
export type NewHydeDocument = typeof hydeDocuments.$inferInsert;
export type Opportunity = typeof opportunities.$inferSelect;
export type NewOpportunity = typeof opportunities.$inferInsert;
