import {
  pgTable,
  pgEnum,
  text,
  timestamp,
  jsonb,
  index,
  primaryKey,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const participantTypeEnum = pgEnum('participant_type', ['user', 'agent']);

export const messageRoleEnum = pgEnum('message_role', ['user', 'agent']);

export const taskStateEnum = pgEnum('task_state', [
  'submitted',
  'working',
  'input_required',
  'completed',
  'failed',
  'canceled',
  'rejected',
  'auth_required',
  'waiting_for_agent',
  'claimed',
]);

// ─────────────────────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top-level conversation container. Participants, messages, and tasks hang off this.
 */
export const conversations = pgTable('conversations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  dmPair: text('dm_pair'),
  lastMessageAt: timestamp('last_message_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  dmPairIdx: uniqueIndex('conversations_dm_pair_idx').on(table.dmPair),
}));

/**
 * Join table tracking which users or agents participate in a conversation.
 */
export const conversationParticipants = pgTable(
  'conversation_participants',
  {
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    participantId: text('participant_id').notNull(),
    participantType: participantTypeEnum('participant_type').notNull(),
    joinedAt: timestamp('joined_at', { withTimezone: true }).defaultNow().notNull(),
    hiddenAt: timestamp('hidden_at', { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.conversationId, table.participantId] }),
    participantIdIdx: index('conversation_participants_participant_id_idx').on(table.participantId),
    conversationIdIdx: index('conversation_participants_conversation_id_idx').on(table.conversationId),
  }),
);

/**
 * Async work units (A2A Tasks) scoped to a conversation.
 */
export const tasks = pgTable(
  'tasks',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    state: taskStateEnum('state').notNull().default('submitted'),
    statusMessage: jsonb('status_message'),
    statusTimestamp: timestamp('status_timestamp', { withTimezone: true }),
    metadata: jsonb('metadata'),
    extensions: jsonb('extensions'),
    claimedByAgentId: text('claimed_by_agent_id'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    conversationIdIdx: index('tasks_conversation_id_idx').on(table.conversationId),
    stateIdx: index('tasks_state_idx').on(table.state),
    metadataOpportunityIdIdx: index('tasks_metadata_opportunity_id_idx')
      .on(sql`(${table.metadata}->>'opportunityId')`)
      .where(sql`${table.metadata}->>'type' = 'negotiation'`),
  }),
);

/**
 * Individual messages sent within a conversation.
 *
 * @remarks
 * `parts` is a JSONB array of A2A message parts (text, data, file, etc.).
 * `referenceTaskIds` optionally links a message to related tasks.
 */
export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    senderId: text('sender_id').notNull(),
    role: messageRoleEnum('role').notNull(),
    parts: jsonb('parts').notNull(),
    metadata: jsonb('metadata'),
    extensions: jsonb('extensions'),
    referenceTaskIds: jsonb('reference_task_ids'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    conversationCreatedAtIdx: index('messages_conversation_id_created_at_idx').on(
      table.conversationId,
      table.createdAt,
    ),
    senderIdIdx: index('messages_sender_id_idx').on(table.senderId),
    taskIdIdx: index('messages_task_id_idx').on(table.taskId),
  }),
);

/**
 * Artifacts produced by a task (files, structured data, etc.).
 *
 * @remarks `parts` mirrors the A2A artifact parts array (JSONB).
 */
export const artifacts = pgTable(
  'artifacts',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    name: text('name'),
    description: text('description'),
    parts: jsonb('parts').notNull(),
    metadata: jsonb('metadata'),
    extensions: jsonb('extensions'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    taskIdIdx: index('artifacts_task_id_idx').on(table.taskId),
  }),
);

/**
 * Append-only rolling digest of a chat session (a conversation). Each row covers
 * messages from `fromMessageId` (start of the range this digest covers) through
 * `toMessageId` (end of the range at write time). Readers take the latest row
 * by `createdAt DESC` for a session — note that `toMessageId` is a text UUID,
 * so ordering by it is lexicographic, not chronological. New rows are inserted
 * as the session grows; old rows are retained for debug/replay.
 */
export const chatSessionSummaries = pgTable(
  'chat_session_summaries',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    fromMessageId: text('from_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'restrict' }),
    toMessageId: text('to_message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'restrict' }),
    digest: jsonb('digest').notNull(),
    model: text('model').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sessionLatestIdx: index('chat_session_summaries_session_latest_idx').on(
      table.conversationId,
      table.createdAt.desc(),
    ),
  }),
);

/**
 * One-to-one metadata sidecar for a conversation (arbitrary JSONB payload).
 */
export const conversationMetadata = pgTable('conversation_metadata', {
  conversationId: text('conversation_id')
    .primaryKey()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  metadata: jsonb('metadata').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Relations
// ─────────────────────────────────────────────────────────────────────────────

export const conversationsRelations = relations(conversations, ({ many, one }) => ({
  participants: many(conversationParticipants),
  messages: many(messages),
  tasks: many(tasks),
  metadata: one(conversationMetadata, {
    fields: [conversations.id],
    references: [conversationMetadata.conversationId],
  }),
}));

export const conversationParticipantsRelations = relations(conversationParticipants, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationParticipants.conversationId],
    references: [conversations.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  task: one(tasks, {
    fields: [messages.taskId],
    references: [tasks.id],
  }),
}));

export const tasksRelations = relations(tasks, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [tasks.conversationId],
    references: [conversations.id],
  }),
  messages: many(messages),
  artifacts: many(artifacts),
}));

export const artifactsRelations = relations(artifacts, ({ one }) => ({
  task: one(tasks, {
    fields: [artifacts.taskId],
    references: [tasks.id],
  }),
}));

export const conversationMetadataRelations = relations(conversationMetadata, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationMetadata.conversationId],
    references: [conversations.id],
  }),
}));

export const chatSessionSummariesRelations = relations(chatSessionSummaries, ({ one }) => ({
  conversation: one(conversations, {
    fields: [chatSessionSummaries.conversationId],
    references: [conversations.id],
  }),
  fromMessage: one(messages, {
    fields: [chatSessionSummaries.fromMessageId],
    references: [messages.id],
  }),
  toMessage: one(messages, {
    fields: [chatSessionSummaries.toMessageId],
    references: [messages.id],
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────────────────────────────────────

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type NewConversationParticipant = typeof conversationParticipants.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type Artifact = typeof artifacts.$inferSelect;
export type NewArtifact = typeof artifacts.$inferInsert;

export type ConversationMetadata = typeof conversationMetadata.$inferSelect;
export type NewConversationMetadata = typeof conversationMetadata.$inferInsert;

export type ChatSessionSummary = typeof chatSessionSummaries.$inferSelect;
export type NewChatSessionSummary = typeof chatSessionSummaries.$inferInsert;
