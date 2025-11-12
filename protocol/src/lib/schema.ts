import { pgTable, pgEnum, text, uuid, timestamp, bigint, boolean, json, varchar, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { vector } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const connectionAction = pgEnum('connection_action', [
  'REQUEST', 'SKIP', 'CANCEL', 'ACCEPT', 'DECLINE', 'OWNER_APPROVE', 'OWNER_DENY'
]);
// Polymorphic source type for intents
export const sourceType = pgEnum('source_type', ['file', 'integration', 'link', 'discovery_form']);

// Onboarding state type
export interface OnboardingState {
  completedAt?: string;  // ISO timestamp when completed
  flow?: 1 | 2 | 3;
  currentStep?: 'profile' | 'connections' | 'create_index' | 'invite_members' | 'join_indexes';
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
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
}, (table) => ({
  // Enforce uniqueness on all emails (email is NOT NULL).
  usersEmailUnique: uniqueIndex('users_email_unique').on(table.email),
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
  // Vector embedding for semantic search (3072 dimensions for text-embedding-3-large)
  embedding: vector('embedding', { dimensions: 3072 }),
});

export const indexes = pgTable('indexes', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  prompt: text('prompt'), // Defines what people can share in this index
  permissions: json('permissions').$type<{
    joinPolicy: 'anyone' | 'invite_only';
    invitationLink: {
      code: string;
    } | null;
    allowGuestVibeCheck: boolean;
    requireApproval: boolean;
  }>().default({
    joinPolicy: 'invite_only',
    invitationLink: null,
    allowGuestVibeCheck: false,
    requireApproval: false
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

export const userConnectionEvents = pgTable('user_connection_events', {
  id: uuid('id').primaryKey().defaultRandom(),

  initiatorUserId: uuid('initiator_user_id').notNull().references(() => users.id),
  receiverUserId: uuid('receiver_user_id').notNull().references(() => users.id),

  eventType: connectionAction('connection_action').notNull(),

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
  indexId: uuid('index_id').references(() => indexes.id), // Optional: only required when enableUserAttribution is true
  enableUserAttribution: boolean('enable_user_attribution').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at')
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  intents: many(intents),
  indexes: many(indexes),
  memberOf: many(indexMembers),
  initiatedConnections: many(userConnectionEvents, { relationName: 'initiatedConnections' }),
  receivedConnections: many(userConnectionEvents, { relationName: 'receivedConnections' }),
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

export const agents = pgTable('agents', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  description: text('description').notNull(),
  avatar: text('avatar').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const intentStakes = pgTable('intent_stakes', {
  id: uuid('id').primaryKey().defaultRandom(),
  intents: text('intents').array().notNull(), // Array of intent IDs
  stake: bigint('stake', { mode: 'bigint' }).notNull(),
  reasoning: text('reasoning').notNull(),
  agentId: uuid('agent_id').notNull().references(() => agents.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const agentsRelations = relations(agents, ({ many }) => ({
  stakes: many(intentStakes),
}));

export const intentStakesRelations = relations(intentStakes, ({ one }) => ({
  agent: one(agents, {
    fields: [intentStakes.agentId],
    references: [agents.id],
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
// Backward-compatible export names
export const indexLinks = linksTable;
export const links = linksTable;

// Integration Items mapping (dedupe across integrations; provider='web' for crawled pages)
export type IndexLink = typeof linksTable.$inferSelect;
export type NewIndexLink = typeof linksTable.$inferInsert;

export const userConnectionEventsRelations = relations(userConnectionEvents, ({ one }) => ({
  initiatorUser: one(users, {
    fields: [userConnectionEvents.initiatorUserId],
    references: [users.id],
    relationName: 'initiatedConnections',
  }),
  receiverUser: one(users, {
    fields: [userConnectionEvents.receiverUserId],
    references: [users.id],
    relationName: 'receivedConnections',
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

// Export types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Intent = typeof intents.$inferSelect;
export type NewIntent = typeof intents.$inferInsert;
export type Index = typeof indexes.$inferSelect;
export type NewIndex = typeof indexes.$inferInsert;
export type IndexMember = typeof indexMembers.$inferSelect;
export type NewIndexMember = typeof indexMembers.$inferInsert;
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type IntentStake = typeof intentStakes.$inferSelect;
export type NewIntentStake = typeof intentStakes.$inferInsert;
export type UserConnectionEvent = typeof userConnectionEvents.$inferSelect;
export type NewUserConnectionEvent = typeof userConnectionEvents.$inferInsert;
export type UserIntegration = typeof userIntegrations.$inferSelect;
export type NewUserIntegration = typeof userIntegrations.$inferInsert;
