import { pgTable, pgEnum, text, uuid, timestamp, bigint, boolean, json, varchar, integer, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Enums
export const connectionAction = pgEnum('connection_action', [
  'REQUEST', 'SKIP', 'CANCEL', 'ACCEPT', 'DECLINE'
]);

// Tables
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  privyId: text('privy_id').notNull().unique(),
  // Email is required and must be unique.
  email: text('email').notNull(),
  name: text('name').notNull(),
  intro: text('intro'),
  avatar: text('avatar'),
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
});

export const indexes = pgTable('indexes', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  linkPermissions: json('link_permissions').$type<{
    permissions: string[];
    code: string;
  } | null>().default(null),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
  userId: uuid('user_id').notNull().references(() => users.id),
});

export const indexMembers = pgTable('index_members', {
  indexId: uuid('index_id').notNull().references(() => indexes.id),
  userId: uuid('user_id').notNull().references(() => users.id),
  permissions: text('permissions').array().notNull().default([]),
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
  indexId: uuid('index_id').notNull().references(() => indexes.id),
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

export const userIntegrations = pgTable('user_integrations', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  integrationType: varchar('integration_type', { length: 50 }).notNull(),
  connectionRequestId: varchar('connection_request_id', { length: 255 }),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  redirectUrl: text('redirect_url'),
  connectedAt: timestamp('connected_at'),
  lastSyncAt: timestamp('last_sync_at'),
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
}));

export const indexesRelations = relations(indexes, ({ one, many }) => ({
  user: one(users, {
    fields: [indexes.userId],
    references: [users.id],
  }),
  members: many(indexMembers),
  files: many(files),
  intents: many(intentIndexes),
}));

export const filesRelations = relations(files, ({ one }) => ({
  index: one(indexes, {
    fields: [files.indexId],
    references: [indexes.id],
  }),
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

// Index Links: manage crawlable URLs per index
export const indexLinks = pgTable('index_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  indexId: uuid('index_id').notNull().references(() => indexes.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  lastContentHash: text('last_content_hash'),
  lastSyncAt: timestamp('last_sync_at'),
  lastStatus: text('last_status'),
  lastError: text('last_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const indexLinksRelations = relations(indexLinks, ({ one }) => ({
  index: one(indexes, {
    fields: [indexLinks.indexId],
    references: [indexes.id],
  }),
}));

// Integration Items mapping (dedupe across integrations; provider='web' for crawled pages)
export type IndexLink = typeof indexLinks.$inferSelect;
export type NewIndexLink = typeof indexLinks.$inferInsert;

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

// Unified Sync tables
export const syncRuns = pgTable('sync_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  provider: varchar('provider', { length: 50 }).notNull(),
  status: varchar('status', { length: 20 }).notNull().default('queued'),
  params: json('params').$type<Record<string, any>>().default({}),
  progress: json('progress').$type<{ total?: number; completed?: number; notes?: string[] } | null>().default(null),
  stats: json('stats').$type<Record<string, any> | null>().default(null),
  error: text('error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  startedAt: timestamp('started_at'),
  finishedAt: timestamp('finished_at'),
});

export const syncRunItems = pgTable('sync_run_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  runId: uuid('run_id').notNull().references(() => syncRuns.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull(),
  status: varchar('status', { length: 20 }).notNull().default('pending'),
  error: text('error'),
  meta: json('meta').$type<Record<string, any> | null>().default(null),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const providerCursors = pgTable('provider_cursors', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  provider: varchar('provider', { length: 50 }).notNull(),
  cursor: json('cursor').$type<Record<string, any> | null>().default(null),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export type SyncRun = typeof syncRuns.$inferSelect;
export type NewSyncRun = typeof syncRuns.$inferInsert;
export type NewUserConnectionEvent = typeof userConnectionEvents.$inferInsert;
