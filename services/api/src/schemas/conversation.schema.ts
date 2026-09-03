import { pgTable, pgEnum, text, timestamp, jsonb, index, primaryKey, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm/relations';
import { sql } from 'drizzle-orm/sql';

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const participantTypeEnum = pgEnum('participant_type', ['user', 'agent']);

export const messageRoleEnum = pgEnum('message_role', ['user', 'agent']);

// ─────────────────────────────────────────────────────────────────────────────
// Tables
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Top-level conversation container. Participants, messages, and tasks hang off this.
 */
export const conversations = pgTable('conversations', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  dmPair: text('dm_pair'),
  /**
   * Chat persona driving this conversation's agent loop (H2A sessions only;
   * ignored for H2H DMs and A2A negotiation conversations). Plain text —
   * deliberately not a pg enum so future personas need no enum migration.
   *
   * Every H2A writer names its persona explicitly. The default exists only for
   * the rows where the column is meaningless (DMs, negotiation conversations)
   * and is the neutral sentinel 'none'.
   */
  persona: text('persona').notNull().default('none'),
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
    lastReadAt: timestamp('last_read_at', { withTimezone: true }),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.conversationId, table.participantId] }),
    participantIdIdx: index('conversation_participants_participant_id_idx').on(table.participantId),
    conversationIdIdx: index('conversation_participants_conversation_id_idx').on(table.conversationId),
  }),
);

/**
 * Durable timeline segment within a conversation, separated by the
 * server-side inactivity boundary.
 */
export const conversationSessions = pgTable(
  'conversation_sessions',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull(),
    lastMessageAt: timestamp('last_message_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    conversationStartedIdx: index('conversation_sessions_conversation_started_idx').on(
      table.conversationId,
      table.startedAt,
      table.id,
    ),
  }),
);

export const messages = pgTable(
  'messages',
  {
    id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
    conversationId: text('conversation_id')
      .notNull()
      .references(() => conversations.id, { onDelete: 'cascade' }),
    sessionId: text('session_id').references(() => conversationSessions.id, { onDelete: 'set null' }),
    senderId: text('sender_id').notNull(),
    role: messageRoleEnum('role').notNull(),
    parts: jsonb('parts').notNull(),
    metadata: jsonb('metadata'),
    extensions: jsonb('extensions'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    conversationCreatedAtIdx: index('messages_conversation_id_created_at_idx').on(
      table.conversationId,
      table.createdAt,
      table.id,
    ),
    senderIdIdx: index('messages_sender_id_idx').on(table.senderId),
    /** The agent DM's read: one conversation, filtered by the signal tag. */
    conversationIntentCreatedAtIdx: index('messages_conversation_intent_created_at_idx').on(
      table.conversationId,
      sql`(${table.metadata}->>'intentId')`,
      table.createdAt,
      table.id,
    ),
    sessionCreatedAtIdx: index('messages_session_id_created_at_idx').on(
      table.sessionId,
      table.createdAt,
      table.id,
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
  sessions: many(conversationSessions),
  messages: many(messages),
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

export const conversationSessionsRelations = relations(conversationSessions, ({ one, many }) => ({
  conversation: one(conversations, {
    fields: [conversationSessions.conversationId],
    references: [conversations.id],
  }),
  messages: many(messages),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  session: one(conversationSessions, {
    fields: [messages.sessionId],
    references: [conversationSessions.id],
  }),
}));

export const conversationMetadataRelations = relations(conversationMetadata, ({ one }) => ({
  conversation: one(conversations, {
    fields: [conversationMetadata.conversationId],
    references: [conversations.id],
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────────────────────────────────────

export type Conversation = typeof conversations.$inferSelect;
export type NewConversation = typeof conversations.$inferInsert;

export type ConversationSession = typeof conversationSessions.$inferSelect;
export type NewConversationSession = typeof conversationSessions.$inferInsert;

export type ConversationParticipant = typeof conversationParticipants.$inferSelect;
export type NewConversationParticipant = typeof conversationParticipants.$inferInsert;

export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;

export type ConversationMetadata = typeof conversationMetadata.$inferSelect;
export type NewConversationMetadata = typeof conversationMetadata.$inferInsert;
