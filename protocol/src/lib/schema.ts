import { pgTable, pgEnum, text, uuid, timestamp, bigint, boolean } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';


// Tables
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  privyId: text('privy_id').notNull().unique(),
  email: text('email'),
  name: text('name').notNull(),
  avatar: text('avatar'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
});

export const intents = pgTable('intents', {
  id: uuid('id').primaryKey().defaultRandom(),
  payload: text('payload').notNull(),
  // summary field will be removed from protocol
  summary: text('summary'),
  isPublic: boolean('is_public').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  archivedAt: timestamp('archived_at'),
  userId: uuid('user_id').notNull().references(() => users.id),
});

export const indexes = pgTable('indexes', {
  id: uuid('id').primaryKey().defaultRandom(),
  title: text('title').notNull(),
  isPublic: boolean('is_public').notNull().default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  deletedAt: timestamp('deleted_at'),
  userId: uuid('user_id').notNull().references(() => users.id),
});

export const indexMembers = pgTable('index_members', {
  indexId: uuid('index_id').notNull().references(() => indexes.id),
  userId: uuid('user_id').notNull().references(() => users.id),
});

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
});

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  intents: many(intents),
  indexes: many(indexes),
  memberOf: many(indexMembers),
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
  pair: text('pair').notNull(), // Format: "intent1-intent2" ordered by asc
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

// Export types
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type Intent = typeof intents.$inferSelect;
export type NewIntent = typeof intents.$inferInsert;
export type Index = typeof indexes.$inferSelect;
export type NewIndex = typeof indexes.$inferInsert;
export type File = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;
export type IntentStake = typeof intentStakes.$inferSelect;
export type NewIntentStake = typeof intentStakes.$inferInsert;