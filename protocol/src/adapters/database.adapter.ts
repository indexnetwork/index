/**
 * Database adapters used by controllers and queues.
 * Postgres implementations; no dependency on lib/protocol.
 */

import { eq, and, or, isNull, isNotNull, sql, count, desc, lt, lte, ne, inArray, ilike, notInArray } from 'drizzle-orm';

import * as schema from '../schemas/database.schema';
import db from '../lib/drizzle/drizzle';
import type { User, NotificationPreferences, OnboardingState } from '../schemas/database.schema';
import type { Id } from '../types/common.types';
import type { MessagingStore } from '../lib/xmtp';
import { generateWallet, decryptKey } from '../lib/xmtp';
import { log } from '../lib/log';
import { IndexMembershipEvents } from '../events/index_membership.event';

const logger = log.lib.from('database.adapter');

// Local types used by adapters (shapes only; protocol layer defines the contracts)
interface ActiveIntentRow {
  id: string;
  payload: string;
  summary: string | null;
  createdAt: Date;
}
type SourceType = 'file' | 'integration' | 'link' | 'discovery_form' | 'enrichment';

interface CreateIntentInput {
  userId: string;
  payload: string;
  summary?: string | null;
  embedding?: number[];
  isIncognito?: boolean;
  sourceType?: SourceType | null;
  sourceId?: string | null;
  semanticEntropy?: number | null;
  referentialAnchor?: string | null;
  felicityAuthority?: number | null;
  felicitySincerity?: number | null;
  intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;
  speechActType?: 'COMMISSIVE' | 'DIRECTIVE' | null;
}
interface UpdateIntentInput {
  payload?: string;
  summary?: string | null;
  embedding?: number[];
  isIncognito?: boolean;
  semanticEntropy?: number | null;
  referentialAnchor?: string | null;
  felicityAuthority?: number | null;
  felicitySincerity?: number | null;
  intentMode?: 'REFERENTIAL' | 'ATTRIBUTIVE' | null;
  speechActType?: 'COMMISSIVE' | 'DIRECTIVE' | null;
}
interface CreatedIntentRow {
  id: string;
  payload: string;
  summary: string | null;
  isIncognito: boolean;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
}
interface ArchiveResultShape {
  success: boolean;
  error?: string;
}
interface IntentListRow {
  id: string;
  payload: string;
  summary: string | null;
  isIncognito: boolean;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  sourceType: string | null;
  sourceId: string | null;
}
// Shapes matching schemas/database.schema userProfiles columns (no lib/protocol import)
interface ProfileIdentity {
  name: string;
  bio: string;
  location: string;
}
interface ProfileNarrative {
  context: string;
}
interface ProfileAttributes {
  interests: string[];
  skills: string[];
}
interface ProfileRow {
  userId: string;
  identity: ProfileIdentity;
  narrative: ProfileNarrative;
  attributes: ProfileAttributes;
  embedding: number[] | number[][] | null;
}

interface IndexMembershipRow {
  indexId: string;
  indexTitle: string;
  indexPrompt: string | null;
  permissions: string[];
  memberPrompt: string | null;
  autoAssign: boolean;
  joinedAt: Date;
}

const { intents, indexes, indexMembers, intentIndexes, users, hydeDocuments, opportunities, userNotificationSettings, userProfiles, files, links } = schema;

// HyDE row to document shape (embedding may come as number[] or pg vector)
type HydeSourceTypeLocal = 'intent' | 'profile' | 'query';
interface HydeDocumentRow {
  id: string;
  sourceType: HydeSourceTypeLocal;
  sourceId: string | null;
  sourceText: string | null;
  strategy: string;
  targetCorpus: string;
  hydeText: string;
  hydeEmbedding: number[];
  context: Record<string, unknown> | null;
  createdAt: Date;
  expiresAt: Date | null;
}
function toHydeDocument(row: typeof hydeDocuments.$inferSelect): HydeDocumentRow {
  const embedding = row.hydeEmbedding;
  const vec = Array.isArray(embedding) ? embedding : (typeof embedding === 'string' ? (JSON.parse(embedding) as number[]) : []);
  return {
    id: row.id,
    sourceType: row.sourceType as HydeSourceTypeLocal,
    sourceId: row.sourceId,
    sourceText: row.sourceText,
    strategy: row.strategy,
    targetCorpus: row.targetCorpus,
    hydeText: row.hydeText,
    hydeEmbedding: vec,
    context: row.context as Record<string, unknown> | null,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Intent Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database adapter for intent CRUD (Intent Graph).
 */
export class IntentDatabaseAdapter {
  async getActiveIntents(userId: string): Promise<ActiveIntentRow[]> {
    try {
      const result = await db.select({
        id: schema.intents.id,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        createdAt: schema.intents.createdAt,
      })
        .from(schema.intents)
        .where(
          and(
            eq(schema.intents.userId, userId),
            isNull(schema.intents.archivedAt)
          )
        )
        .orderBy(desc(schema.intents.createdAt));
      return result;
    } catch (error: unknown) {
      logger.error('IntentDatabaseAdapter.getActiveIntents error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async createIntent(data: CreateIntentInput): Promise<CreatedIntentRow> {
    try {
      const [created] = await db.insert(schema.intents)
        .values({
          userId: data.userId,
          payload: data.payload,
          summary: data.summary ?? null,
          embedding: data.embedding,
          isIncognito: data.isIncognito ?? false,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
          semanticEntropy: data.semanticEntropy ?? undefined,
          referentialAnchor: data.referentialAnchor ?? undefined,
          felicityAuthority: data.felicityAuthority ?? undefined,
          felicitySincerity: data.felicitySincerity ?? undefined,
          intentMode: data.intentMode ?? undefined,
          speechActType: data.speechActType ?? undefined,
        })
        .returning({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          isIncognito: schema.intents.isIncognito,
          createdAt: schema.intents.createdAt,
          updatedAt: schema.intents.updatedAt,
          userId: schema.intents.userId,
        });
      if (!created) throw new Error('Insert did not return a row');
      return created;
    } catch (error: unknown) {
      logger.error('IntentDatabaseAdapter.createIntent error', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async updateIntent(intentId: string, data: UpdateIntentInput): Promise<CreatedIntentRow | null> {
    try {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (data.payload !== undefined) updateData.payload = data.payload;
      if (data.summary !== undefined) updateData.summary = data.summary;
      if (data.embedding !== undefined) updateData.embedding = data.embedding;
      if (data.isIncognito !== undefined) updateData.isIncognito = data.isIncognito;
      if (data.semanticEntropy !== undefined) updateData.semanticEntropy = data.semanticEntropy;
      if (data.referentialAnchor !== undefined) updateData.referentialAnchor = data.referentialAnchor;
      if (data.felicityAuthority !== undefined) updateData.felicityAuthority = data.felicityAuthority;
      if (data.felicitySincerity !== undefined) updateData.felicitySincerity = data.felicitySincerity;
      if (data.intentMode !== undefined) updateData.intentMode = data.intentMode;
      if (data.speechActType !== undefined) updateData.speechActType = data.speechActType;

      const [updated] = await db.update(schema.intents)
        .set(updateData)
        .where(eq(schema.intents.id, intentId))
        .returning({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          isIncognito: schema.intents.isIncognito,
          createdAt: schema.intents.createdAt,
          updatedAt: schema.intents.updatedAt,
          userId: schema.intents.userId,
        });
      return updated ?? null;
    } catch (error: unknown) {
      logger.error('IntentDatabaseAdapter.updateIntent error', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  async archiveIntent(intentId: string): Promise<ArchiveResultShape> {
    try {
      const [archived] = await db.update(schema.intents)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.intents.id, intentId))
        .returning({ id: schema.intents.id });
      if (!archived) return { success: false, error: 'Intent not found' };
      return { success: true };
    } catch (error: unknown) {
      logger.error('IntentDatabaseAdapter.archiveIntent error', { error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async deleteIntentIndexAssociations(intentId: string): Promise<void> {
    await db.delete(schema.intentIndexes)
      .where(eq(schema.intentIndexes.intentId, intentId));
  }

  /**
   * Expires all non-expired opportunities where the given intent appears in the actors JSONB array.
   * @param intentId - The intent ID to match inside actors[].intent
   * @returns The number of opportunities expired
   */
  async expireOpportunitiesByIntentActor(intentId: string): Promise<number> {
    const result = await db.update(schema.opportunities)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(and(
        sql`${schema.opportunities.actors} @> ${JSON.stringify([{ intent: intentId }])}::jsonb`,
        ne(schema.opportunities.status, 'expired'),
      ))
      .returning({ id: schema.opportunities.id });
    return result.length;
  }

  async getIntentsInIndexForMember(userId: string, indexNameOrId: string): Promise<ActiveIntentRow[]> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let indexId: string | null = null;

    if (uuidRegex.test(indexNameOrId.trim())) {
      const membership = await db
        .select({ indexId: schema.indexMembers.indexId })
        .from(schema.indexMembers)
        .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
        .where(
          and(
            eq(schema.indexMembers.userId, userId),
            eq(schema.indexMembers.indexId, indexNameOrId.trim()),
            isNull(schema.indexes.deletedAt)
          )
        )
        .limit(1);
      indexId = membership[0]?.indexId ?? null;
    } else {
      const memberships = await db
        .select({
          indexId: schema.indexMembers.indexId,
          indexTitle: schema.indexes.title,
        })
        .from(schema.indexMembers)
        .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
        .where(
          and(
            eq(schema.indexMembers.userId, userId),
            isNull(schema.indexes.deletedAt)
          )
        );
      const needle = indexNameOrId.trim().toLowerCase();
      const match = memberships.find(
        (m) => (m.indexTitle ?? '').toLowerCase() === needle || (m.indexTitle ?? '').toLowerCase().includes(needle)
      );
      indexId = match?.indexId ?? null;
    }

    if (!indexId) {
      return [];
    }

    try {
      const result = await db
        .select({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          createdAt: schema.intents.createdAt,
        })
        .from(schema.intents)
        .innerJoin(schema.intentIndexes, eq(schema.intents.id, schema.intentIndexes.intentId))
        .where(
          and(
            eq(schema.intentIndexes.indexId, indexId),
            eq(schema.intents.userId, userId),
            isNull(schema.intents.archivedAt)
          )
        );
      return result;
    } catch (error: unknown) {
      logger.error('IntentDatabaseAdapter.getIntentsInIndexForMember error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async listIntents(userId: string, options: {
    page: number;
    limit: number;
    archived: boolean;
    sourceType?: string;
  }): Promise<{ rows: IntentListRow[]; total: number }> {
    const offset = (options.page - 1) * options.limit;
    const conditions = [eq(schema.intents.userId, userId)];
    if (options.archived) {
      conditions.push(isNotNull(schema.intents.archivedAt));
    } else {
      conditions.push(isNull(schema.intents.archivedAt));
    }
    const validSourceTypes: SourceType[] = ['file', 'integration', 'link', 'discovery_form', 'enrichment'];
    if (options.sourceType && validSourceTypes.includes(options.sourceType as SourceType)) {
      conditions.push(eq(schema.intents.sourceType, options.sourceType as SourceType));
    }
    const where = and(...conditions);

    const [rows, totalResult] = await Promise.all([
      db.select({
        id: schema.intents.id,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        isIncognito: schema.intents.isIncognito,
        createdAt: schema.intents.createdAt,
        updatedAt: schema.intents.updatedAt,
        archivedAt: schema.intents.archivedAt,
        sourceType: schema.intents.sourceType,
        sourceId: schema.intents.sourceId,
      })
        .from(schema.intents)
        .where(where)
        .orderBy(desc(schema.intents.createdAt))
        .offset(offset)
        .limit(options.limit),
      db.select({ count: count() }).from(schema.intents).where(where),
    ]);

    return { rows, total: Number(totalResult[0]?.count ?? 0) };
  }

  async getIntentById(intentId: string, userId: string): Promise<IntentListRow | null> {
    const row = await db.select({
      id: schema.intents.id,
      payload: schema.intents.payload,
      summary: schema.intents.summary,
      isIncognito: schema.intents.isIncognito,
      createdAt: schema.intents.createdAt,
      updatedAt: schema.intents.updatedAt,
      archivedAt: schema.intents.archivedAt,
      sourceType: schema.intents.sourceType,
      sourceId: schema.intents.sourceId,
    })
      .from(schema.intents)
      .where(and(eq(schema.intents.id, intentId), eq(schema.intents.userId, userId)))
      .limit(1);

    return row[0] ?? null;
  }

  async isOwnedByUser(intentId: string, userId: string): Promise<boolean> {
    const row = await db.select({ id: schema.intents.id })
      .from(schema.intents)
      .where(and(eq(schema.intents.id, intentId), eq(schema.intents.userId, userId)))
      .limit(1);
    return row.length > 0;
  }

  /**
   * Finds an intent by sourceId and userId (e.g. for idempotent proposal confirmation).
   * @param sourceId - The source identifier (e.g. proposalId from chat).
   * @param userId - The owning user's ID.
   * @returns The intent id if found, otherwise null.
   * @throws May throw database/query errors.
   */
  async getIntentBySourceId(sourceId: string, userId: string): Promise<{ id: string; archivedAt: Date | null } | null> {
    const rows = await db.select({ id: schema.intents.id, archivedAt: schema.intents.archivedAt })
      .from(schema.intents)
      .where(and(
        eq(schema.intents.sourceId, sourceId),
        eq(schema.intents.userId, userId),
      ))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Associates an intent with an index (inserts intent_indexes row).
   * @param intentId - The intent identifier.
   * @param indexId - The index identifier.
   * @returns Promise that resolves when the row is inserted.
   * @throws May throw on database insertion errors (db.insert/schema.intentIndexes).
   */
  async assignIntentToIndex(intentId: string, indexId: string): Promise<void> {
    await db.insert(schema.intentIndexes).values({ intentId, indexId });
  }

  /**
   * Delete all intents for a user (for test teardown).
   */
  async deleteByUserId(userId: string): Promise<void> {
    await db.delete(schema.intents).where(eq(schema.intents.userId, userId));
  }

  // --- Profile check (required by IntentGraphDatabase for prepNode gate) ---

  async getProfile(userId: string): Promise<ProfileRow | null> {
    const result = await db.select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1);
    const profile = result[0];
    if (!profile) return null;
    return {
      userId: profile.userId,
      identity: profile.identity as ProfileIdentity,
      narrative: profile.narrative as ProfileNarrative,
      attributes: profile.attributes as ProfileAttributes,
      embedding: profile.embedding,
    };
  }

  // --- Read mode methods (required by IntentGraphDatabase for queryNode) ---

  async getUser(userId: string) {
    const result = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const user = result[0];
    if (!user) return null;
    return {
      id: user.id,
      name: user.name ?? '',
      email: user.email ?? '',
      intro: user.intro ?? null,
      avatar: user.avatar ?? null,
      location: user.location ?? null,
      socials: user.socials ?? null,
      onboarding: user.onboarding ?? null,
    };
  }

  async isIndexMember(indexId: string, userId: string): Promise<boolean> {
    const result = await db
      .select({ indexId: schema.indexMembers.indexId })
      .from(schema.indexMembers)
      .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
      .where(
        and(
          eq(schema.indexMembers.indexId, indexId),
          eq(schema.indexMembers.userId, userId),
          isNull(schema.indexes.deletedAt)
        )
      )
      .limit(1);
    return result.length > 0;
  }

  async getIndexIntentsForMember(
    indexId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const isMember = await this.isIndexMember(indexId, requestingUserId);
    if (!isMember) throw new Error('Access denied: Not a member of this index');

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const result = await db
      .select({
        id: schema.intents.id,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        userId: schema.intents.userId,
        userName: schema.users.name,
        createdAt: schema.intents.createdAt,
      })
      .from(schema.intents)
      .innerJoin(schema.intentIndexes, eq(schema.intents.id, schema.intentIndexes.intentId))
      .leftJoin(schema.users, eq(schema.intents.userId, schema.users.id))
      .where(
        and(
          eq(schema.intentIndexes.indexId, indexId),
          isNull(schema.intents.archivedAt)
        )
      )
      .orderBy(desc(schema.intents.createdAt))
      .limit(limit)
      .offset(offset);

    return result.map((r) => ({
      id: r.id,
      payload: r.payload,
      summary: r.summary,
      userId: r.userId,
      userName: r.userName ?? 'Unknown',
      createdAt: r.createdAt,
    }));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Chat Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

// Chat Session and Message interfaces (internal to ChatDatabaseAdapter)
interface ChatSession {
  id: string;
  userId: string;
  title: string | null;
  indexId: string | null;
  shareToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  routingDecision: Record<string, unknown> | null;
  subgraphResults: Record<string, unknown> | null;
  tokenCount: number | null;
  createdAt: Date;
}

interface CreateSessionInput {
  id: string;
  userId: string;
  title?: string;
  indexId?: string;
}

interface CreateMessageInput {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  routingDecision?: Record<string, unknown>;
  subgraphResults?: Record<string, unknown>;
  tokenCount?: number;
}

/**
 * Database adapter for Chat Graph and its subgraphs.
 */
export class ChatDatabaseAdapter {
  private readonly hydeAdapter = new HydeDatabaseAdapter();
  private _opportunityAdapter: OpportunityDatabaseAdapter | null = null;
  private get opportunityAdapter(): OpportunityDatabaseAdapter {
    if (!this._opportunityAdapter) this._opportunityAdapter = new OpportunityDatabaseAdapter();
    return this._opportunityAdapter;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Chat Session Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a new chat session
   */
  async createSession(data: CreateSessionInput): Promise<void> {
    await db.insert(schema.chatSessions).values({
      id: data.id,
      userId: data.userId,
      title: data.title || null,
      indexId: data.indexId?.trim() || null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<ChatSession | null> {
    const [session] = await db.select()
      .from(schema.chatSessions)
      .where(eq(schema.chatSessions.id, sessionId))
      .limit(1);
    
    return session || null;
  }

  /**
   * Get all sessions for a user
   */
  async getUserSessions(userId: string, limit: number): Promise<ChatSession[]> {
    return db.select()
      .from(schema.chatSessions)
      .where(eq(schema.chatSessions.userId, userId))
      .orderBy(desc(schema.chatSessions.updatedAt))
      .limit(limit);
  }

  /**
   * Update session index
   */
  async updateSessionIndex(sessionId: string, indexId: string | null): Promise<void> {
    await db
      .update(schema.chatSessions)
      .set({ indexId, updatedAt: new Date() })
      .where(eq(schema.chatSessions.id, sessionId));
  }

  /**
   * Update session title
   */
  async updateSessionTitle(sessionId: string, title: string): Promise<void> {
    await db.update(schema.chatSessions)
      .set({ title, updatedAt: new Date() })
      .where(eq(schema.chatSessions.id, sessionId));
  }

  /**
   * Update session timestamp
   */
  async updateSessionTimestamp(sessionId: string): Promise<void> {
    await db.update(schema.chatSessions)
      .set({ updatedAt: new Date() })
      .where(eq(schema.chatSessions.id, sessionId));
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string): Promise<void> {
    await db.delete(schema.chatSessions)
      .where(eq(schema.chatSessions.id, sessionId));
  }

  async setShareToken(sessionId: string, token: string | null): Promise<void> {
    await db.update(schema.chatSessions)
      .set({ shareToken: token, updatedAt: new Date() })
      .where(eq(schema.chatSessions.id, sessionId));
  }

  async getSessionByShareToken(token: string): Promise<ChatSession | null> {
    const [session] = await db.select()
      .from(schema.chatSessions)
      .where(eq(schema.chatSessions.shareToken, token))
      .limit(1);
    return session || null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Chat Message Methods
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Create a message
   */
  async createMessage(data: CreateMessageInput): Promise<void> {
    await db.insert(schema.chatMessages).values({
      id: data.id,
      sessionId: data.sessionId,
      role: data.role,
      content: data.content,
      routingDecision: data.routingDecision || null,
      subgraphResults: data.subgraphResults || null,
      tokenCount: data.tokenCount || null,
      createdAt: new Date(),
    });
  }

  /**
   * Get messages for a session
   */
  async getSessionMessages(sessionId: string, limit?: number): Promise<ChatMessage[]> {
    let query = db.select()
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.sessionId, sessionId))
      .orderBy(schema.chatMessages.createdAt);
    
    const messages = limit ? await query.limit(limit) : await query;
    
    // Cast unknown fields to proper types
    return messages.map(msg => ({
      ...msg,
      routingDecision: msg.routingDecision as Record<string, unknown> | null,
      subgraphResults: msg.subgraphResults as Record<string, unknown> | null,
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Chat Graph Methods (Profiles, Intents, Indexes)
  // ─────────────────────────────────────────────────────────────────────────────

  async getProfile(userId: string): Promise<ProfileRow | null> {
    const result = await db.select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1);
    const profile = result[0];
    if (!profile) return null;
    return {
      userId: profile.userId,
      identity: profile.identity as ProfileIdentity,
      narrative: profile.narrative as ProfileNarrative,
      attributes: profile.attributes as ProfileAttributes,
      embedding: profile.embedding,
    };
  }

  async getActiveIntents(userId: string): Promise<ActiveIntentRow[]> {
    try {
      const result = await db.select({
        id: schema.intents.id,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        createdAt: schema.intents.createdAt,
      })
        .from(schema.intents)
        .where(
          and(
            eq(schema.intents.userId, userId),
            isNull(schema.intents.archivedAt)
          )
        )
        .orderBy(desc(schema.intents.createdAt));
      return result;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getActiveIntents error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async getIntentsInIndexForMember(userId: string, indexNameOrId: string): Promise<ActiveIntentRow[]> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let indexId: string | null = null;

    if (uuidRegex.test(indexNameOrId.trim())) {
      const membership = await db
        .select({ indexId: schema.indexMembers.indexId })
        .from(schema.indexMembers)
        .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
        .where(
          and(
            eq(schema.indexMembers.userId, userId),
            eq(schema.indexMembers.indexId, indexNameOrId.trim()),
            isNull(schema.indexes.deletedAt)
          )
        )
        .limit(1);
      indexId = membership[0]?.indexId ?? null;
    } else {
      const memberships = await db
        .select({
          indexId: schema.indexMembers.indexId,
          indexTitle: schema.indexes.title,
        })
        .from(schema.indexMembers)
        .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
        .where(
          and(
            eq(schema.indexMembers.userId, userId),
            isNull(schema.indexes.deletedAt)
          )
        );
      const needle = indexNameOrId.trim().toLowerCase();
      const match = memberships.find(
        (m) => (m.indexTitle ?? '').toLowerCase() === needle || (m.indexTitle ?? '').toLowerCase().includes(needle)
      );
      indexId = match?.indexId ?? null;
    }

    if (!indexId) {
      return [];
    }

    try {
      const result = await db
        .select({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          createdAt: schema.intents.createdAt,
        })
        .from(schema.intents)
        .innerJoin(schema.intentIndexes, eq(schema.intents.id, schema.intentIndexes.intentId))
        .where(
          and(
            eq(schema.intentIndexes.indexId, indexId),
            eq(schema.intents.userId, userId),
            isNull(schema.intents.archivedAt)
          )
        );
      return result;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getIntentsInIndexForMember error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async getUser(userId: string): Promise<User | null> {
    const result = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return result[0] ?? null;
  }

  async updateUser(
    userId: string,
    data: { name?: string; location?: string; socials?: { x?: string; linkedin?: string; github?: string; websites?: string[] }; onboarding?: OnboardingState }
  ) {
    // Delegate to ProfileDatabaseAdapter which has the merge logic
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.updateUser(userId, data);
  }

  async saveProfile(userId: string, profile: ProfileRow): Promise<void> {
    const data = {
      userId,
      identity: profile.identity,
      narrative: profile.narrative,
      attributes: profile.attributes,
      embedding: profile.embedding === null 
        ? null 
        : (Array.isArray(profile.embedding[0])
          ? (profile.embedding as number[][])[0]
          : (profile.embedding as number[])),
      updatedAt: new Date(),
    };
    await db.insert(schema.userProfiles)
      .values(data)
      .onConflictDoUpdate({
        target: schema.userProfiles.userId,
        set: data,
      });
  }

  async createIntent(data: CreateIntentInput): Promise<CreatedIntentRow> {
    try {
      const [created] = await db.insert(schema.intents)
        .values({
          userId: data.userId,
          payload: data.payload,
          summary: data.summary ?? null,
          embedding: data.embedding,
          isIncognito: data.isIncognito ?? false,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
          semanticEntropy: data.semanticEntropy ?? undefined,
          referentialAnchor: data.referentialAnchor ?? undefined,
          felicityAuthority: data.felicityAuthority ?? undefined,
          felicitySincerity: data.felicitySincerity ?? undefined,
          intentMode: data.intentMode ?? undefined,
          speechActType: data.speechActType ?? undefined,
        })
        .returning({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          isIncognito: schema.intents.isIncognito,
          createdAt: schema.intents.createdAt,
          updatedAt: schema.intents.updatedAt,
          userId: schema.intents.userId,
        });
      if (!created) throw new Error('Insert did not return a row');
      return created;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.createIntent error', { error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  async updateIntent(intentId: string, data: UpdateIntentInput): Promise<CreatedIntentRow | null> {
    try {
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (data.payload !== undefined) updateData.payload = data.payload;
      if (data.summary !== undefined) updateData.summary = data.summary;
      if (data.embedding !== undefined) updateData.embedding = data.embedding;
      if (data.isIncognito !== undefined) updateData.isIncognito = data.isIncognito;
      if (data.semanticEntropy !== undefined) updateData.semanticEntropy = data.semanticEntropy;
      if (data.referentialAnchor !== undefined) updateData.referentialAnchor = data.referentialAnchor;
      if (data.felicityAuthority !== undefined) updateData.felicityAuthority = data.felicityAuthority;
      if (data.felicitySincerity !== undefined) updateData.felicitySincerity = data.felicitySincerity;
      if (data.intentMode !== undefined) updateData.intentMode = data.intentMode;
      if (data.speechActType !== undefined) updateData.speechActType = data.speechActType;

      const [updated] = await db.update(schema.intents)
        .set(updateData)
        .where(eq(schema.intents.id, intentId))
        .returning({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          isIncognito: schema.intents.isIncognito,
          createdAt: schema.intents.createdAt,
          updatedAt: schema.intents.updatedAt,
          userId: schema.intents.userId,
        });
      return updated ?? null;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.updateIntent error', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  async archiveIntent(intentId: string): Promise<ArchiveResultShape> {
    try {
      const [archived] = await db.update(schema.intents)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.intents.id, intentId))
        .returning({ id: schema.intents.id });
      if (!archived) return { success: false, error: 'Intent not found' };
      return { success: true };
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.archiveIntent error', { error: error instanceof Error ? error.message : String(error) });
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  async getIndexMemberships(userId: string): Promise<IndexMembershipRow[]> {
    try {
      const result = await db
        .select({
          indexId: schema.indexMembers.indexId,
          indexTitle: schema.indexes.title,
          indexPrompt: schema.indexes.prompt,
          permissions: schema.indexMembers.permissions,
          memberPrompt: schema.indexMembers.prompt,
          autoAssign: schema.indexMembers.autoAssign,
          joinedAt: schema.indexMembers.createdAt,
        })
        .from(schema.indexMembers)
        .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
        .where(
          and(
            eq(schema.indexMembers.userId, userId),
            isNull(schema.indexes.deletedAt),
          )
        );
      return result;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getIndexMemberships error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async getIndexMembership(indexId: string, userId: string): Promise<IndexMembershipRow | null> {
    try {
      const result = await db
        .select({
          indexId: schema.indexMembers.indexId,
          indexTitle: schema.indexes.title,
          indexPrompt: schema.indexes.prompt,
          permissions: schema.indexMembers.permissions,
          memberPrompt: schema.indexMembers.prompt,
          autoAssign: schema.indexMembers.autoAssign,
          joinedAt: schema.indexMembers.createdAt,
        })
        .from(schema.indexMembers)
        .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
        .where(
          and(
            eq(schema.indexMembers.indexId, indexId),
            eq(schema.indexMembers.userId, userId),
            isNull(schema.indexes.deletedAt)
          )
        )
        .limit(1);
      return result[0] ?? null;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getIndexMembership error', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  async getIndex(indexId: string): Promise<{ id: string; title: string } | null> {
    const rows = await db
      .select({ id: schema.indexes.id, title: schema.indexes.title })
      .from(schema.indexes)
      .where(and(eq(schema.indexes.id, indexId), isNull(schema.indexes.deletedAt)))
      .limit(1);
    const row = rows[0];
    return row ? { id: row.id, title: row.title } : null;
  }

  async getIndexWithPermissions(indexId: string): Promise<{ id: string; title: string; permissions: { joinPolicy: 'anyone' | 'invite_only' } } | null> {
    const rows = await db
      .select({ id: indexes.id, title: indexes.title, permissions: indexes.permissions })
      .from(indexes)
      .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const perms = (row.permissions as { joinPolicy?: string }) ?? {};
    return {
      id: row.id,
      title: row.title,
      permissions: { joinPolicy: (perms.joinPolicy === 'anyone' ? 'anyone' : 'invite_only') as 'anyone' | 'invite_only' },
    };
  }

  async getIndexesForUser(userId: string) {
    const memberIndexIds = await db
      .select({ indexId: schema.indexMembers.indexId })
      .from(schema.indexMembers)
      .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
      .where(
        and(
          eq(schema.indexMembers.userId, userId),
          isNull(schema.indexes.deletedAt)
        )
      );

    const ids = [...new Set(memberIndexIds.map((r) => r.indexId))];
    if (ids.length === 0) {
      return {
        indexes: [],
        pagination: { current: 1, total: 0, count: 0, totalCount: 0 },
      };
    }

    const rows = await db
      .select({
        id: schema.indexes.id,
        title: schema.indexes.title,
        prompt: schema.indexes.prompt,
        imageUrl: schema.indexes.imageUrl,
        permissions: schema.indexes.permissions,
        isGlobal: schema.indexes.isGlobal,
        createdAt: schema.indexes.createdAt,
        updatedAt: schema.indexes.updatedAt,
        ownerId: schema.indexMembers.userId,
        userName: schema.users.name,
        userAvatar: schema.users.avatar,
      })
      .from(schema.indexes)
      .leftJoin(
        schema.indexMembers,
        and(
          eq(schema.indexes.id, schema.indexMembers.indexId),
          sql`'owner' = ANY(${schema.indexMembers.permissions})`
        )
      )
      .leftJoin(schema.users, eq(schema.indexMembers.userId, schema.users.id))
      .where(
        and(
          isNull(schema.indexes.deletedAt),
          inArray(schema.indexes.id, ids)
        )
      )
      .orderBy(desc(schema.indexes.isGlobal), desc(schema.indexes.createdAt));

    const indexesWithCounts = await Promise.all(
      rows.map(async (row) => {
        const [memberCount] = await db
          .select({ count: count() })
          .from(schema.indexMembers)
          .where(eq(schema.indexMembers.indexId, row.id));
        return {
          id: row.id,
          title: row.title,
          prompt: row.prompt,
          imageUrl: row.imageUrl,
          permissions: row.permissions,
          isGlobal: row.isGlobal,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          user: {
            id: row.ownerId ?? '',
            name: row.userName ?? 'System',
            avatar: row.userAvatar ?? null,
          },
          _count: {
            members: Number(memberCount?.count ?? 0),
          },
        };
      })
    );

    const totalCount = indexesWithCounts.length;
    return {
      indexes: indexesWithCounts,
      pagination: {
        current: 1,
        total: totalCount > 0 ? 1 : 0,
        count: totalCount,
        totalCount,
      },
    };
  }

  /**
   * Get public indexes that the user has not joined (for discovery).
   */
  async getPublicIndexesNotJoined(userId: string) {
    const userIndexIds = await db
      .select({ indexId: schema.indexMembers.indexId })
      .from(schema.indexMembers)
      .where(eq(schema.indexMembers.userId, userId));
    
    const excludeIds = userIndexIds.map(r => r.indexId);
    
    const whereConditions = [
      isNull(schema.indexes.deletedAt),
    ];
    
    if (excludeIds.length > 0) {
      whereConditions.push(notInArray(schema.indexes.id, excludeIds));
    }

    const publicIndexes = await db
      .select({
        id: schema.indexes.id,
        title: schema.indexes.title,
        prompt: schema.indexes.prompt,
        imageUrl: schema.indexes.imageUrl,
        createdAt: schema.indexes.createdAt,
        permissions: schema.indexes.permissions,
      })
      .from(schema.indexes)
      .where(and(...whereConditions))
      .orderBy(desc(schema.indexes.createdAt));

    const result = [];
    for (const row of publicIndexes) {
      const perms = (row.permissions as { joinPolicy?: string } | null);
      if (perms?.joinPolicy !== 'anyone') continue;

      const [ownerMember] = await db
        .select({
          userId: schema.indexMembers.userId,
          userName: schema.users.name,
          userAvatar: schema.users.avatar,
        })
        .from(schema.indexMembers)
        .innerJoin(schema.users, eq(schema.indexMembers.userId, schema.users.id))
        .where(
          and(
            eq(schema.indexMembers.indexId, row.id),
            sql`'owner' = ANY(${schema.indexMembers.permissions})`
          )
        )
        .limit(1);

      const [countResult] = await db
        .select({ count: count() })
        .from(schema.indexMembers)
        .where(eq(schema.indexMembers.indexId, row.id));

      result.push({
        id: row.id,
        title: row.title,
        prompt: row.prompt,
        imageUrl: row.imageUrl,
        createdAt: row.createdAt,
        permissions: row.permissions,
        memberCount: Number(countResult?.count ?? 0),
        owner: ownerMember ? {
          id: ownerMember.userId,
          name: ownerMember.userName,
          avatar: ownerMember.userAvatar,
        } : null,
      });
    }

    return {
      indexes: result,
      pagination: {
        current: 1,
        total: result.length > 0 ? 1 : 0,
        count: result.length,
        totalCount: result.length,
      },
    };
  }

  async getUserIndexIds(userId: string): Promise<string[]> {
    try {
      const result = await db
        .select({ indexId: schema.indexMembers.indexId })
        .from(schema.indexMembers)
        .innerJoin(schema.indexes, eq(schema.indexMembers.indexId, schema.indexes.id))
        .where(
          and(
            eq(schema.indexMembers.userId, userId),
            eq(schema.indexMembers.autoAssign, true),
            isNull(schema.indexes.deletedAt)
          )
        );
      return result.map((r) => r.indexId);
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getUserIndexIds error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async getIntent(intentId: string) {
    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        isIncognito: intents.isIncognito,
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt,
        userId: intents.userId,
        archivedAt: intents.archivedAt,
        embedding: intents.embedding,
        sourceType: intents.sourceType,
        sourceId: intents.sourceId,
      })
      .from(intents)
      .where(eq(intents.id, intentId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const emb = row.embedding;
    const embedding: number[] | null =
      emb == null
        ? null
        : Array.isArray(emb) && emb.length > 0 && Array.isArray(emb[0])
          ? (emb[0] as number[])
          : Array.isArray(emb)
            ? (emb as number[])
            : null;
    return {
      id: row.id,
      payload: row.payload,
      summary: row.summary,
      isIncognito: row.isIncognito,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      userId: row.userId,
      archivedAt: row.archivedAt,
      embedding: embedding ?? undefined,
      sourceType: row.sourceType ?? undefined,
      sourceId: row.sourceId ?? undefined,
    };
  }

  async getIntentForIndexing(intentId: string) {
    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        sourceType: intents.sourceType,
        sourceId: intents.sourceId,
      })
      .from(intents)
      .where(eq(intents.id, intentId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getIndexMemberContext(indexId: string, userId: string) {
    const rows = await db
      .select({
        indexId: indexes.id,
        indexPrompt: indexes.prompt,
        memberPrompt: indexMembers.prompt,
      })
      .from(indexes)
      .innerJoin(indexMembers, eq(indexes.id, indexMembers.indexId))
      .where(
        and(
          eq(indexes.id, indexId),
          eq(indexMembers.userId, userId),
          eq(indexMembers.autoAssign, true),
          isNull(indexes.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async isIntentAssignedToIndex(intentId: string, indexId: string): Promise<boolean> {
    const rows = await db
      .select({ indexId: intentIndexes.indexId })
      .from(intentIndexes)
      .where(
        and(
          eq(intentIndexes.intentId, intentId),
          eq(intentIndexes.indexId, indexId)
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async assignIntentToIndex(intentId: string, indexId: string): Promise<void> {
    await db.insert(intentIndexes).values({ intentId, indexId });
  }

  async unassignIntentFromIndex(intentId: string, indexId: string): Promise<void> {
    await db
      .delete(intentIndexes)
      .where(
        and(
          eq(intentIndexes.intentId, intentId),
          eq(intentIndexes.indexId, indexId)
        )
      );
  }

  async getIndexIdsForIntent(intentId: string): Promise<string[]> {
    const rows = await db
      .select({ indexId: intentIndexes.indexId })
      .from(intentIndexes)
      .where(eq(intentIndexes.intentId, intentId));
    return rows.map((r) => r.indexId);
  }

  // HyDE document operations (delegate to HydeDatabaseAdapter)
  async getHydeDocument(
    sourceType: 'intent' | 'profile' | 'query',
    sourceId: string,
    strategy: string
  ): Promise<HydeDocumentRow | null> {
    return this.hydeAdapter.getHydeDocument(sourceType, sourceId, strategy);
  }

  async getHydeDocumentsForSource(
    sourceType: 'intent' | 'profile' | 'query',
    sourceId: string
  ): Promise<HydeDocumentRow[]> {
    return this.hydeAdapter.getHydeDocumentsForSource(sourceType, sourceId);
  }

  async saveHydeDocument(data: SaveHydeDocumentInput): Promise<HydeDocumentRow> {
    return this.hydeAdapter.saveHydeDocument(data);
  }

  async deleteHydeDocumentsForSource(
    sourceType: 'intent' | 'profile' | 'query',
    sourceId: string
  ): Promise<number> {
    return this.hydeAdapter.deleteHydeDocumentsForSource(sourceType, sourceId);
  }

  async deleteExpiredHydeDocuments(): Promise<number> {
    return this.hydeAdapter.deleteExpiredHydeDocuments();
  }

  async getStaleHydeDocuments(threshold: Date): Promise<HydeDocumentRow[]> {
    return this.hydeAdapter.getStaleHydeDocuments(threshold);
  }

  async getOwnedIndexes(userId: string) {
    const ownerRows = await db
      .select({
        indexId: indexMembers.indexId,
        title: indexes.title,
        prompt: indexes.prompt,
        permissions: indexes.permissions,
        createdAt: indexes.createdAt,
      })
      .from(indexMembers)
      .innerJoin(indexes, eq(indexMembers.indexId, indexes.id))
      .where(
        and(
          eq(indexMembers.userId, userId),
          sql`'owner' = ANY(${indexMembers.permissions})`,
          isNull(indexes.deletedAt)
        )
      );

    const result = await Promise.all(
      ownerRows.map(async (row) => {
        const [memberCountResult, intentCountResult] = await Promise.all([
          db.select({ count: count() }).from(indexMembers).where(eq(indexMembers.indexId, row.indexId)),
          db.select({ count: count() }).from(intentIndexes).where(eq(intentIndexes.indexId, row.indexId)),
        ]);
        const perms = row.permissions as { joinPolicy: string; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean } | null;
        return {
          id: row.indexId,
          title: row.title,
          prompt: row.prompt,
          permissions: {
            joinPolicy: (perms?.joinPolicy ?? 'invite_only') as 'anyone' | 'invite_only',
            allowGuestVibeCheck: perms?.allowGuestVibeCheck ?? false,
            invitationLink: perms?.invitationLink ?? null,
          },
          createdAt: row.createdAt,
          memberCount: Number(memberCountResult[0]?.count ?? 0),
          intentCount: Number(intentCountResult[0]?.count ?? 0),
        };
      })
    );
    return result;
  }

  async getIndexMembersForMember(indexId: string, requestingUserId: string) {
    const isMember = await this.isIndexMember(indexId, requestingUserId);
    if (!isMember) {
      throw new Error('Access denied: Not a member of this index');
    }

    const members = await db
      .select({
        userId: indexMembers.userId,
        name: users.name,
        avatar: users.avatar,
        permissions: indexMembers.permissions,
        memberPrompt: indexMembers.prompt,
        autoAssign: indexMembers.autoAssign,
        joinedAt: indexMembers.createdAt,
      })
      .from(indexMembers)
      .innerJoin(users, eq(indexMembers.userId, users.id))
      .where(eq(indexMembers.indexId, indexId));

    const [requestingUserEmailRow] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, requestingUserId))
      .limit(1);

    const result = await Promise.all(
      members.map(async (m) => {
        const [intentCountRow] = await db
          .select({ count: count() })
          .from(intentIndexes)
          .innerJoin(intents, eq(intentIndexes.intentId, intents.id))
          .where(and(eq(intentIndexes.indexId, indexId), eq(intents.userId, m.userId), isNull(intents.archivedAt)));
        const email = m.userId === requestingUserId ? (requestingUserEmailRow?.email ?? undefined) : undefined;
        return {
          userId: m.userId,
          name: m.name,
          avatar: m.avatar,
          email,
          permissions: m.permissions ?? [],
          memberPrompt: m.memberPrompt,
          autoAssign: m.autoAssign,
          joinedAt: m.joinedAt,
          intentCount: Number(intentCountRow?.count ?? 0),
        };
      })
    );
    return result;
  }

  async isIndexOwner(indexId: string, userId: string): Promise<boolean> {
    const rows = await db
      .select({ userId: indexMembers.userId })
      .from(indexMembers)
      .where(
        and(
          eq(indexMembers.indexId, indexId),
          eq(indexMembers.userId, userId),
          sql`'owner' = ANY(${indexMembers.permissions})`
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async getIndexMembersForOwner(indexId: string, requestingUserId: string) {
    const isOwner = await this.isIndexOwner(indexId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this index');
    }

    const members = await db
      .select({
        userId: indexMembers.userId,
        name: users.name,
        avatar: users.avatar,
        email: users.email,
        permissions: indexMembers.permissions,
        memberPrompt: indexMembers.prompt,
        autoAssign: indexMembers.autoAssign,
        joinedAt: indexMembers.createdAt,
      })
      .from(indexMembers)
      .innerJoin(users, eq(indexMembers.userId, users.id))
      .where(eq(indexMembers.indexId, indexId));

    const result = await Promise.all(
      members.map(async (m) => {
        const [intentCountRow] = await db
          .select({ count: count() })
          .from(intentIndexes)
          .innerJoin(intents, eq(intentIndexes.intentId, intents.id))
          .where(and(eq(intentIndexes.indexId, indexId), eq(intents.userId, m.userId), isNull(intents.archivedAt)));
        return {
          userId: m.userId,
          name: m.name,
          avatar: m.avatar,
          email: m.email,
          permissions: m.permissions ?? [],
          memberPrompt: m.memberPrompt,
          autoAssign: m.autoAssign,
          joinedAt: m.joinedAt,
          intentCount: Number(intentCountRow?.count ?? 0),
        };
      })
    );
    return result;
  }

  async getMembersFromUserIndexes(userId: Id<'users'>): Promise<{ userId: Id<'users'>; name: string; avatar: string | null }[]> {
    // Indexes the user is a member of (non-deleted)
    const myIndexRows = await db
      .select({ indexId: indexMembers.indexId })
      .from(indexMembers)
      .innerJoin(indexes, eq(indexMembers.indexId, indexes.id))
      .where(
        and(eq(indexMembers.userId, userId), isNull(indexes.deletedAt))
      );
    const myIndexIds = myIndexRows.map((r) => r.indexId);
    if (myIndexIds.length === 0) return [];

    // All members from those indexes, joined with users; dedupe by userId
    const rows = await db
      .select({
        userId: indexMembers.userId,
        name: users.name,
        avatar: users.avatar,
      })
      .from(indexMembers)
      .innerJoin(users, eq(indexMembers.userId, users.id))
      .innerJoin(indexes, eq(indexMembers.indexId, indexes.id))
      .where(
        and(inArray(indexMembers.indexId, myIndexIds), isNull(indexes.deletedAt))
      );

    const byId = new Map<Id<'users'>, { userId: Id<'users'>; name: string; avatar: string | null }>();
    for (const r of rows) {
      if (!byId.has(r.userId)) byId.set(r.userId, { userId: r.userId, name: r.name, avatar: r.avatar });
    }
    return Array.from(byId.values());
  }

  async getIndexIntentsForOwner(
    indexId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const isOwner = await this.isIndexOwner(indexId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this index');
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        userId: intents.userId,
        userName: users.name,
        createdAt: intents.createdAt,
      })
      .from(intentIndexes)
      .innerJoin(intents, eq(intentIndexes.intentId, intents.id))
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(eq(intentIndexes.indexId, indexId), isNull(intents.archivedAt)))
      .orderBy(desc(intents.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => ({
      id: r.id,
      payload: r.payload,
      summary: r.summary,
      userId: r.userId,
      userName: r.userName,
      createdAt: r.createdAt,
    }));
  }

  async isIndexMember(indexId: string, userId: string): Promise<boolean> {
    const rows = await db
      .select({ userId: indexMembers.userId })
      .from(indexMembers)
      .innerJoin(indexes, eq(indexMembers.indexId, indexes.id))
      .where(
        and(
          eq(indexMembers.indexId, indexId),
          eq(indexMembers.userId, userId),
          isNull(indexes.deletedAt)
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async getMemberSettings(indexId: string, userId: string): Promise<{ permissions: string[]; isOwner: boolean } | null> {
    const rows = await db
      .select({ permissions: indexMembers.permissions })
      .from(indexMembers)
      .innerJoin(indexes, eq(indexMembers.indexId, indexes.id))
      .where(
        and(
          eq(indexMembers.indexId, indexId),
          eq(indexMembers.userId, userId),
          isNull(indexes.deletedAt)
        )
      )
      .limit(1);
    
    if (rows.length === 0) return null;
    
    const permissions = rows[0]?.permissions || [];
    const isOwner = permissions.includes('owner');
    
    return { permissions, isOwner };
  }

  async getIndexIntentsForMember(
    indexId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const isMember = await this.isIndexMember(indexId, requestingUserId);
    if (!isMember) {
      throw new Error('Access denied: Not a member of this index');
    }

    const limit = options?.limit ?? 50;
    const offset = options?.offset ?? 0;

    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        userId: intents.userId,
        userName: users.name,
        createdAt: intents.createdAt,
      })
      .from(intentIndexes)
      .innerJoin(intents, eq(intentIndexes.intentId, intents.id))
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(eq(intentIndexes.indexId, indexId), isNull(intents.archivedAt)))
      .orderBy(desc(intents.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => ({
      id: r.id,
      payload: r.payload,
      summary: r.summary,
      userId: r.userId,
      userName: r.userName,
      createdAt: r.createdAt,
    }));
  }

  async updateIndexSettings(
    indexId: string,
    requestingUserId: string,
    data: { title?: string; prompt?: string | null; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean }
  ) {
    const isOwner = await this.isIndexOwner(indexId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this index');
    }

    const [existing] = await db.select().from(indexes).where(eq(indexes.id, indexId)).limit(1);
    if (!existing) {
      throw new Error('Index not found');
    }

    const updateData: Record<string, unknown> = { updatedAt: new Date() };
    if (data.title !== undefined) updateData.title = data.title;
    if (data.prompt !== undefined) updateData.prompt = data.prompt;
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
    if (data.joinPolicy !== undefined || data.allowGuestVibeCheck !== undefined) {
      const currentPerms = (existing.permissions as { joinPolicy: string; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean }) ?? {};
      updateData.permissions = {
        joinPolicy: data.joinPolicy ?? currentPerms.joinPolicy ?? 'invite_only',
        invitationLink: currentPerms.invitationLink ?? { code: crypto.randomUUID() },
        allowGuestVibeCheck: data.allowGuestVibeCheck ?? currentPerms.allowGuestVibeCheck ?? false,
      };
    }

    await db.update(indexes).set(updateData).where(eq(indexes.id, indexId));

    const [updatedRow] = await db
      .select({
        id: indexes.id,
        title: indexes.title,
        prompt: indexes.prompt,
        imageUrl: indexes.imageUrl,
        permissions: indexes.permissions,
        createdAt: indexes.createdAt,
        updatedAt: indexes.updatedAt,
        ownerId: indexMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
      })
      .from(indexes)
      .innerJoin(
        indexMembers,
        and(
          eq(indexes.id, indexMembers.indexId),
          sql`'owner' = ANY(${indexMembers.permissions})`
        )
      )
      .innerJoin(users, eq(indexMembers.userId, users.id))
      .where(eq(indexes.id, indexId))
      .limit(1);

    if (!updatedRow) {
      throw new Error('Index not found after update');
    }
    const [memberCountResult, intentCountResult] = await Promise.all([
      db.select({ count: count() }).from(indexMembers).where(eq(indexMembers.indexId, indexId)),
      db.select({ count: count() }).from(intentIndexes).where(eq(intentIndexes.indexId, indexId)),
    ]);
    const perms = (updatedRow.permissions as { joinPolicy: string; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean }) ?? {};
    return {
      id: updatedRow.id,
      title: updatedRow.title,
      prompt: updatedRow.prompt,
      imageUrl: updatedRow.imageUrl,
      permissions: {
        joinPolicy: (perms.joinPolicy ?? 'invite_only') as 'anyone' | 'invite_only',
        allowGuestVibeCheck: perms.allowGuestVibeCheck ?? false,
        invitationLink: perms.invitationLink ?? null,
      },
      createdAt: updatedRow.createdAt,
      memberCount: Number(memberCountResult[0]?.count ?? 0),
      intentCount: Number(intentCountResult[0]?.count ?? 0),
    };
  }

  async softDeleteIndex(indexId: string): Promise<void> {
    await db.update(indexes).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(indexes.id, indexId));
  }

  async getProfileByUserId(userId: string): Promise<(ProfileRow & { id: string }) | null> {
    const result = await db.select().from(schema.userProfiles).where(eq(schema.userProfiles.userId, userId)).limit(1);
    const profile = result[0];
    if (!profile) return null;
    return {
      id: profile.id,
      userId: profile.userId,
      identity: profile.identity as ProfileIdentity,
      narrative: profile.narrative as ProfileNarrative,
      attributes: profile.attributes as ProfileAttributes,
      embedding: profile.embedding,
    };
  }

  async createIndex(data: {
    title: string;
    prompt?: string | null;
    imageUrl?: string | null;
    joinPolicy?: 'anyone' | 'invite_only';
  }): Promise<{
    id: string;
    title: string;
    prompt: string | null;
    imageUrl: string | null;
    permissions: { joinPolicy: 'anyone' | 'invite_only'; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean };
  }> {
    const finalJoinPolicy = data.joinPolicy ?? 'invite_only';
    const permissions = {
      joinPolicy: finalJoinPolicy,
      invitationLink: { code: crypto.randomUUID() },
      allowGuestVibeCheck: false,
    };
    const [row] = await db
      .insert(indexes)
      .values({
        title: data.title,
        prompt: data.prompt ?? null,
        imageUrl: data.imageUrl ?? null,
        permissions,
      })
      .returning({
        id: indexes.id,
        title: indexes.title,
        prompt: indexes.prompt,
        imageUrl: indexes.imageUrl,
        permissions: indexes.permissions,
      });
    if (!row) throw new Error('Failed to create index');
    const perms = (row.permissions as { joinPolicy: string; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean }) ?? {};
    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      imageUrl: row.imageUrl,
      permissions: {
        joinPolicy: (perms.joinPolicy ?? 'invite_only') as 'anyone' | 'invite_only',
        invitationLink: perms.invitationLink ?? null,
        allowGuestVibeCheck: perms.allowGuestVibeCheck ?? false,
      },
    };
  }

  async getIndexMemberCount(indexId: string): Promise<number> {
    const [r] = await db.select({ count: count() }).from(indexMembers).where(eq(indexMembers.indexId, indexId));
    return Number(r?.count ?? 0);
  }

  async addMemberToIndex(
    indexId: string,
    userId: string,
    role: 'owner' | 'admin' | 'member'
  ): Promise<{ success: boolean; alreadyMember?: boolean }> {
    let memberPrompt: string | null = null;
    const [indexRow] = await db.select({ prompt: indexes.prompt }).from(indexes).where(eq(indexes.id, indexId)).limit(1);
    if (indexRow) memberPrompt = indexRow.prompt;

    const finalPermissions = role === 'owner' ? ['owner'] : role === 'admin' ? ['admin', 'member'] : ['member'];
    const result = await db.insert(indexMembers).values({
      indexId,
      userId,
      permissions: finalPermissions,
      prompt: memberPrompt,
      autoAssign: true,
    }).onConflictDoNothing({ target: [indexMembers.indexId, indexMembers.userId] }).returning();

    if (result.length > 0) {
      try {
        IndexMembershipEvents.onMemberAdded(userId, indexId);
      } catch (err) {
        logger.warn('addMemberToIndex event hook failed (non-fatal)', { indexId, userId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { success: true, alreadyMember: result.length === 0 };
  }

  async removeMemberFromIndex(
    indexId: string,
    userId: string
  ): Promise<{ success: boolean; wasOwner?: boolean; notMember?: boolean }> {
    // Check if user is the owner - owners cannot be removed
    const isOwner = await this.isIndexOwner(indexId, userId);
    if (isOwner) {
      return { success: false, wasOwner: true };
    }

    // Check if user is actually a member
    const existing = await db
      .select()
      .from(indexMembers)
      .where(and(eq(indexMembers.indexId, indexId), eq(indexMembers.userId, userId)))
      .limit(1);

    if (existing.length === 0) {
      return { success: false, notMember: true };
    }

    // Delete the membership
    await db
      .delete(indexMembers)
      .where(and(eq(indexMembers.indexId, indexId), eq(indexMembers.userId, userId)));

    return { success: true };
  }

  async deleteProfile(userId: string): Promise<void> {
    await db.delete(schema.userProfiles).where(eq(schema.userProfiles.userId, userId));
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Detail & Member Management (with access control)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a single index with owner info and member count.
   * Checks that the requesting user is a member; throws "Access denied" if not.
   */
  async getPublicIndexDetail(indexId: string) {
    const rows = await db
      .select({
        id: indexes.id,
        title: indexes.title,
        prompt: indexes.prompt,
        imageUrl: indexes.imageUrl,
        permissions: indexes.permissions,
        createdAt: indexes.createdAt,
        updatedAt: indexes.updatedAt,
        ownerId: indexMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
      })
      .from(indexes)
      .innerJoin(
        indexMembers,
        and(
          eq(indexes.id, indexMembers.indexId),
          sql`'owner' = ANY(${indexMembers.permissions})`
        )
      )
      .innerJoin(users, eq(indexMembers.userId, users.id))
      .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const perms = row.permissions as { joinPolicy?: string } | null;
    if (perms?.joinPolicy !== 'anyone') return null;

    const memberCount = await this.getIndexMemberCount(indexId);

    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      imageUrl: row.imageUrl,
      permissions: row.permissions,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user: { id: row.ownerId, name: row.userName, avatar: row.userAvatar },
      _count: { members: memberCount },
    };
  }

  async getIndexDetail(indexId: string, requestingUserId: string) {
    const rows = await db
      .select({
        id: indexes.id,
        title: indexes.title,
        prompt: indexes.prompt,
        imageUrl: indexes.imageUrl,
        permissions: indexes.permissions,
        createdAt: indexes.createdAt,
        updatedAt: indexes.updatedAt,
        ownerId: indexMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
      })
      .from(indexes)
      .innerJoin(
        indexMembers,
        and(
          eq(indexes.id, indexMembers.indexId),
          sql`'owner' = ANY(${indexMembers.permissions})`
        )
      )
      .innerJoin(users, eq(indexMembers.userId, users.id))
      .where(and(eq(indexes.id, indexId), isNull(indexes.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const isMember = await this.isIndexMember(indexId, requestingUserId);
    if (!isMember) {
      throw new Error('Access denied: Not a member of this index');
    }

    const memberCount = await this.getIndexMemberCount(indexId);

    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      imageUrl: row.imageUrl,
      permissions: row.permissions,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user: { id: row.ownerId, name: row.userName, avatar: row.userAvatar },
      _count: { members: memberCount },
    };
  }

  /**
   * Search users within the caller's personal index members by name or email,
   * optionally excluding existing members of a target index.
   */
  async searchPersonalIndexMembers(userId: string, query: string, excludeIndexId?: string) {
    if (!query || query.trim().length === 0) return [];

    // Find user's contacts from user_contacts table
    const contactUserIds = db
      .select({ userId: schema.userContacts.userId })
      .from(schema.userContacts)
      .where(
        and(
          eq(schema.userContacts.ownerId, userId),
          isNull(schema.userContacts.deletedAt)
        )
      );

    const pattern = `%${query.trim()}%`;
    const conditions = [
      isNull(users.deletedAt),
      inArray(users.id, contactUserIds),
      or(ilike(users.name, pattern), ilike(users.email, pattern)),
    ];

    if (excludeIndexId) {
      const existingMembers = db
        .select({ userId: indexMembers.userId })
        .from(indexMembers)
        .where(eq(indexMembers.indexId, excludeIndexId));
      conditions.push(notInArray(users.id, existingMembers));
    }

    return db
      .select({ id: users.id, name: users.name, email: users.email, avatar: users.avatar })
      .from(users)
      .where(and(...conditions))
      .limit(20);
  }

  /**
   * Add a member to an index. Checks that the requesting user has owner or admin permissions.
   * Throws "Access denied" if not authorized.
   */
  async addMemberForOwnerOrAdmin(
    indexId: string,
    userId: string,
    requestingUserId: string,
    role: 'admin' | 'member' = 'member'
  ) {
    const [membership] = await db
      .select({ permissions: indexMembers.permissions })
      .from(indexMembers)
      .where(and(eq(indexMembers.indexId, indexId), eq(indexMembers.userId, requestingUserId)))
      .limit(1);

    if (!membership || (!membership.permissions?.includes('owner') && !membership.permissions?.includes('admin'))) {
      throw new Error('Access denied: Only owners or admins can add members');
    }

    const result = await this.addMemberToIndex(indexId, userId, role);
    const user = await this.getUser(userId);

    return {
      member: user
        ? { id: user.id, name: user.name, email: user.email, avatar: user.avatar, permissions: role === 'admin' ? ['admin', 'member'] : ['member'] }
        : null,
      alreadyMember: result.alreadyMember,
    };
  }

  /**
   * Remove a member from an index. Owner-only.
   * Checks isIndexOwner internally; throws "Access denied" if not owner.
   * Prevents self-removal. Throws "Member not found" if member doesn't exist.
   */
  async removeMemberForOwner(indexId: string, memberUserId: string, requestingUserId: string) {
    const isOwner = await this.isIndexOwner(indexId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this index');
    }

    if (memberUserId === requestingUserId) {
      throw new Error('Cannot remove yourself from the index');
    }

    const deleted = await db
      .delete(indexMembers)
      .where(and(eq(indexMembers.indexId, indexId), eq(indexMembers.userId, memberUserId)))
      .returning({ userId: indexMembers.userId });

    if (deleted.length === 0) {
      throw new Error('Member not found');
    }
  }

  /**
   * Join a public index (anyone can join if joinPolicy is 'anyone').
   */
  async joinPublicIndex(indexId: string, userId: string) {
    const [index] = await db
      .select({ permissions: indexes.permissions, deletedAt: indexes.deletedAt })
      .from(indexes)
      .where(eq(indexes.id, indexId))
      .limit(1);

    if (!index || index.deletedAt) {
      throw new Error('Index not found');
    }

    const perms = (index.permissions as { joinPolicy?: string } | null);
    if (perms?.joinPolicy !== 'anyone') {
      throw new Error('This index is not public');
    }

    return await this.addMemberToIndex(indexId, userId, 'member');
  }

  /**
   * Leave an index. Members (non-owners) can leave an index.
   * Owners cannot leave their own index.
   */
  async leaveIndex(indexId: string, userId: string) {
    const isOwner = await this.isIndexOwner(indexId, userId);
    if (isOwner) {
      throw new Error('Cannot leave an index you own. Delete the index instead.');
    }

    const deleted = await db
      .delete(indexMembers)
      .where(and(eq(indexMembers.indexId, indexId), eq(indexMembers.userId, userId)))
      .returning({ userId: indexMembers.userId });

    if (deleted.length === 0) {
      throw new Error('You are not a member of this index');
    }
  }

  /**
   * Soft-delete an index. Owner-only.
   * Checks isIndexOwner internally; throws "Access denied" if not owner.
   */
  async deleteIndexForOwner(indexId: string, requestingUserId: string) {
    const isOwner = await this.isIndexOwner(indexId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this index');
    }

    await this.softDeleteIndex(indexId);
  }

  // Opportunity operations (delegate to OpportunityDatabaseAdapter)
  async createOpportunity(data: CreateOpportunityInput): Promise<OpportunityRow> {
    return this.opportunityAdapter.createOpportunity(data);
  }
  async createOpportunityAndExpireIds(
    data: CreateOpportunityInput,
    expireIds: string[]
  ): Promise<{ created: OpportunityRow; expired: OpportunityRow[] }> {
    return this.opportunityAdapter.createOpportunityAndExpireIds(data, expireIds);
  }
  async getOpportunity(id: string): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.getOpportunity(id);
  }
  async getOpportunitiesForUser(
    userId: string,
    options?: { status?: string; indexId?: string; role?: string; limit?: number; offset?: number; conversationId?: string }
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getOpportunitiesForUser(userId, options);
  }
  async getOpportunitiesForIndex(
    indexId: string,
    options?: { status?: string; limit?: number; offset?: number }
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getOpportunitiesForIndex(indexId, options);
  }
  async updateOpportunityStatus(
    id: string,
    status: 'latent' | 'draft' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired'
  ): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.updateOpportunityStatus(id, status);
  }
  async opportunityExistsBetweenActors(actorIds: string[], indexId: string): Promise<boolean> {
    return this.opportunityAdapter.opportunityExistsBetweenActors(actorIds, indexId);
  }
  async getOpportunityBetweenActors(
    actorIds: string[],
    indexId: string
  ): Promise<{ id: Id<'opportunities'>; status: 'latent' | 'draft' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired' } | null> {
    return this.opportunityAdapter.getOpportunityBetweenActors(actorIds, indexId);
  }
  async findOverlappingOpportunities(
    actorUserIds: Id<'users'>[],
    options?: { excludeStatuses?: ('latent' | 'draft' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired')[] }
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.findOverlappingOpportunities(actorUserIds, options);
  }
  async expireOpportunitiesByIntent(intentId: string): Promise<number> {
    return this.opportunityAdapter.expireOpportunitiesByIntent(intentId);
  }
  async expireOpportunitiesForRemovedMember(indexId: string, userId: string): Promise<number> {
    return this.opportunityAdapter.expireOpportunitiesForRemovedMember(indexId, userId);
  }
  async expireStaleOpportunities(): Promise<number> {
    return this.opportunityAdapter.expireStaleOpportunities();
  }
  async getAcceptedOpportunitiesBetweenActors(
    userId: string,
    counterpartUserId: string
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getAcceptedOpportunitiesBetweenActors(userId, counterpartUserId);
  }
  async acceptSiblingOpportunities(
    userId: string,
    counterpartUserId: string,
    excludeOpportunityId: string
  ): Promise<string[]> {
    return this.opportunityAdapter.acceptSiblingOpportunities(
      userId,
      counterpartUserId,
      excludeOpportunityId
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Contact / My Network Operations
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get user IDs of all contacts owned by the given user.
   * @param ownerId - The owner's user ID
   * @returns Array of contact user IDs
   */
  async getContactUserIds(ownerId: string): Promise<string[]> {
    const rows = await db
      .select({ userId: schema.userContacts.userId })
      .from(schema.userContacts)
      .where(
        and(
          eq(schema.userContacts.ownerId, ownerId),
          isNull(schema.userContacts.deletedAt)
        )
      );
    return rows.map((r) => r.userId);
  }

  /**
   * Create a ghost user (unregistered contact) with empty profile and Index Global membership.
   * @param data - Name and email for the ghost user
   * @returns The created ghost user's ID
   */
  async createGhostUser(data: { name: string; email: string }): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    await db.insert(schema.users).values({
      id,
      name: data.name,
      email: data.email,
      isGhost: true,
    });

    // Create empty profile (embedding will be added by enrichment job)
    await db.insert(schema.userProfiles).values({
      userId: id,
    });

    // Ghost users have no index membership - they are discovered via user_contacts table
    return { id };
  }

  /**
   * Upsert a contact record (idempotent via unique constraint).
   * @param data - Contact data with ownerId, userId, and source
   */
  async upsertContact(data: { ownerId: string; userId: string; source: 'gmail' | 'google_calendar' | 'manual' }): Promise<void> {
    await db
      .insert(schema.userContacts)
      .values({
        ownerId: data.ownerId,
        userId: data.userId,
        source: data.source,
      })
      .onConflictDoUpdate({
        target: [schema.userContacts.ownerId, schema.userContacts.userId],
        set: {
          source: data.source,
          importedAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null, // reactivate if previously soft-deleted
        },
      });
  }

  /**
   * Get all contacts for a user with their user details.
   * @param ownerId - The owner's user ID
   * @returns Array of contacts with user details
   */
  async getContacts(ownerId: string): Promise<Array<{
    id: string;
    userId: string;
    source: string;
    importedAt: Date;
    user: { id: string; name: string; email: string; avatar: string | null; isGhost: boolean };
  }>> {
    const rows = await db
      .select({
        id: schema.userContacts.id,
        userId: schema.userContacts.userId,
        source: schema.userContacts.source,
        importedAt: schema.userContacts.importedAt,
        userName: schema.users.name,
        userEmail: schema.users.email,
        userAvatar: schema.users.avatar,
        userIsGhost: schema.users.isGhost,
      })
      .from(schema.userContacts)
      .innerJoin(schema.users, eq(schema.userContacts.userId, schema.users.id))
      .where(
        and(
          eq(schema.userContacts.ownerId, ownerId),
          isNull(schema.userContacts.deletedAt)
        )
      )
      .orderBy(desc(schema.userContacts.importedAt));

    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      source: row.source,
      importedAt: row.importedAt,
      user: {
        id: row.userId,
        name: row.userName,
        email: row.userEmail,
        avatar: row.userAvatar,
        isGhost: row.userIsGhost,
      },
    }));
  }

  /**
   * Soft-delete a contact.
   * @param ownerId - The owner's user ID
   * @param contactId - The contact record ID
   */
  async removeContact(ownerId: string, contactId: string): Promise<void> {
    await db
      .update(schema.userContacts)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(schema.userContacts.id, contactId),
          eq(schema.userContacts.ownerId, ownerId)
        )
      );
  }

  /**
   * Find a user by email.
   * @param email - The email to search for
   * @returns User record or null
   */
  async getUserByEmail(email: string): Promise<{ id: string; name: string; email: string; isGhost: boolean } | null> {
    const [row] = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        isGhost: schema.users.isGhost,
      })
      .from(schema.users)
      .where(eq(schema.users.email, email))
      .limit(1);
    return row ?? null;
  }

  /**
   * Bulk lookup users by email.
   * @param emails - Array of emails to search for
   * @returns Array of user records (only those that exist)
   */
  async getUsersByEmails(emails: string[]): Promise<Array<{ id: string; name: string; email: string; isGhost: boolean }>> {
    if (emails.length === 0) return [];
    const rows = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        isGhost: schema.users.isGhost,
      })
      .from(schema.users)
      .where(and(inArray(schema.users.email, emails), isNull(schema.users.deletedAt)));
    return rows;
  }

  /**
   * Returns the subset of user IDs that have no enriched profile (identity IS NULL).
   * @param userIds - User IDs to check
   * @returns Set of user IDs lacking a profile
   */
  async getUserIdsWithoutProfile(userIds: string[]): Promise<Set<string>> {
    if (userIds.length === 0) return new Set();
    const rows = await db
      .select({ userId: schema.userProfiles.userId })
      .from(schema.userProfiles)
      .where(and(
        inArray(schema.userProfiles.userId, userIds),
        isNull(schema.userProfiles.identity),
      ));
    return new Set(rows.map(r => r.userId));
  }

  /**
   * Bulk create ghost users with empty profiles.
   * Ghost users have no index membership - they are discovered via user_contacts table.
   * @param data - Array of {name, email} for ghost users
   * @returns Array of created ghost users with their IDs
   */
  async createGhostUsersBulk(data: Array<{ name: string; email: string }>): Promise<Array<{ id: string; name: string; email: string }>> {
    if (data.length === 0) return [];

    const results: Array<{ id: string; name: string; email: string }> = [];

    // Create users
    const usersToInsert = data.map(d => ({
      id: crypto.randomUUID(),
      name: d.name,
      email: d.email,
      isGhost: true,
    }));

    await db.insert(schema.users).values(usersToInsert).onConflictDoNothing();

    // Re-query to find which users actually exist (created now vs already existed)
    const insertedEmails = new Set(usersToInsert.map(u => u.email));
    const existingAfterInsert = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(inArray(schema.users.email, [...insertedEmails]));

    // Map back to our generated IDs vs actual IDs
    const emailToId = new Map(existingAfterInsert.map(u => [u.email, u.id]));
    const actuallyCreatedIds = new Set(
      usersToInsert
        .filter(u => emailToId.get(u.email) === u.id)
        .map(u => u.id)
    );

    // Create empty profiles only for newly created users (embedding added by enrichment job)
    if (actuallyCreatedIds.size > 0) {
      const profilesToInsert = usersToInsert
        .filter(u => actuallyCreatedIds.has(u.id))
        .map(u => ({ userId: u.id }));
      await db.insert(schema.userProfiles).values(profilesToInsert);
    }

    // Return results with correct IDs (actual DB IDs, not our generated ones)
    for (const u of usersToInsert) {
      const actualId = emailToId.get(u.email);
      if (actualId) {
        results.push({ id: actualId, name: u.name, email: u.email });
      }
    }

    return results;
  }

  /**
   * Bulk upsert contact records.
   * @param data - Array of contact records
   */
  async upsertContactsBulk(data: Array<{ ownerId: string; userId: string; source: 'gmail' | 'google_calendar' | 'manual' }>): Promise<void> {
    if (data.length === 0) return;

    const values = data.map(d => ({
      ownerId: d.ownerId,
      userId: d.userId,
      source: d.source,
    }));

    await db
      .insert(schema.userContacts)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.userContacts.ownerId, schema.userContacts.userId],
        set: {
          source: sql`excluded.source`,
          importedAt: new Date(),
          updatedAt: new Date(),
          deletedAt: null,
        },
      });
  }

  /**
   * Atomically create ghost users and upsert all contacts in a single transaction.
   * Ghost users are created first, then all contacts (both existing-user and ghost-user)
   * are upserted together, ensuring the write path is atomic.
   *
   * Ghost users have no index membership - they are discovered via user_contacts table.
   *
   * @param ownerId - The user importing contacts
   * @param ghosts - Array of ghost user data to create
   * @param validContacts - All validated contacts with resolved emails
   * @param existingByEmail - Map of already-existing users by email
   * @param source - Contact source type
   * @returns Object containing the newly created ghost users
   */
  async importContactsBulk(
    ownerId: string,
    ghosts: Array<{ name: string; email: string }>,
    validContacts: Array<{ name: string; email: string }>,
    existingByEmail: Map<string, { id: string; email: string; name: string; isGhost: boolean }>,
    source: 'gmail' | 'google_calendar' | 'manual'
  ): Promise<{ newGhosts: Array<{ id: string; name: string; email: string }>; newContacts: number }> {
    return await db.transaction(async (tx) => {
      // Create ghost users (no index membership - discovered via user_contacts)
      const newGhosts: Array<{ id: string; name: string; email: string }> = [];
      if (ghosts.length > 0) {
        const usersToInsert = ghosts.map(d => ({
          id: crypto.randomUUID(),
          name: d.name,
          email: d.email,
          isGhost: true,
        }));

        await tx.insert(schema.users).values(usersToInsert).onConflictDoNothing();

        const insertedEmails = new Set(usersToInsert.map(u => u.email));
        const existingAfterInsert = await tx
          .select({ id: schema.users.id, email: schema.users.email })
          .from(schema.users)
          .where(inArray(schema.users.email, [...insertedEmails]));

        const emailToId = new Map(existingAfterInsert.map(u => [u.email, u.id]));
        const actuallyCreatedIds = new Set(
          usersToInsert
            .filter(u => emailToId.get(u.email) === u.id)
            .map(u => u.id)
        );

        // Create empty profiles (embedding added by enrichment job)
        if (actuallyCreatedIds.size > 0) {
          const profilesToInsert = usersToInsert
            .filter(u => actuallyCreatedIds.has(u.id))
            .map(u => ({ userId: u.id }));
          await tx.insert(schema.userProfiles).values(profilesToInsert);
        }

        for (const u of usersToInsert) {
          const actualId = emailToId.get(u.email);
          if (actualId) {
            newGhosts.push({ id: actualId, name: u.name, email: u.email });
            // Add ghosts to the lookup map so contacts can be resolved below
            existingByEmail.set(u.email.toLowerCase(), { id: actualId, email: u.email, name: u.name, isGhost: true });
          }
        }
      }

      // Upsert all contacts (existing users + newly created ghosts)
      const contactsToUpsert: Array<{ ownerId: string; userId: string; source: typeof source }> = [];
      for (const contact of validContacts) {
        const user = existingByEmail.get(contact.email.toLowerCase());
        if (user) {
          contactsToUpsert.push({ ownerId, userId: user.id, source });
        }
      }

      let newContacts = 0;
      if (contactsToUpsert.length > 0) {
        // Check which contacts already exist in the network
        const userIds = contactsToUpsert.map(c => c.userId);
        const existingContacts = await tx
          .select({ userId: schema.userContacts.userId })
          .from(schema.userContacts)
          .where(
            and(
              eq(schema.userContacts.ownerId, ownerId),
              isNull(schema.userContacts.deletedAt),
              inArray(schema.userContacts.userId, userIds)
            )
          );
        const existingUserIds = new Set(existingContacts.map(c => c.userId));
        newContacts = contactsToUpsert.filter(c => !existingUserIds.has(c.userId)).length;

        await tx
          .insert(schema.userContacts)
          .values(contactsToUpsert)
          .onConflictDoUpdate({
            target: [schema.userContacts.ownerId, schema.userContacts.userId],
            set: {
              source: sql`excluded.source`,
              importedAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
            },
          });
      }

      return { newGhosts, newContacts };
    });
  }

}

// ═══════════════════════════════════════════════════════════════════════════════
// Profile Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database adapter for Profile Graph.
 */
export class ProfileDatabaseAdapter {
  async getProfile(userId: string): Promise<ProfileRow | null> {
    const result = await db.select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1);
    const profile = result[0];
    if (!profile) return null;
    return {
      userId: profile.userId,
      identity: profile.identity as ProfileIdentity,
      narrative: profile.narrative as ProfileNarrative,
      attributes: profile.attributes as ProfileAttributes,
      embedding: profile.embedding,
    };
  }

  async saveProfile(userId: string, profile: ProfileRow): Promise<void> {
    const data = {
      userId,
      identity: profile.identity,
      narrative: profile.narrative,
      attributes: profile.attributes,
      embedding: profile.embedding === null 
        ? null 
        : (Array.isArray(profile.embedding[0])
          ? (profile.embedding as number[][])[0]
          : (profile.embedding as number[])),
      updatedAt: new Date(),
    };
    await db.insert(schema.userProfiles)
      .values(data)
      .onConflictDoUpdate({
        target: schema.userProfiles.userId,
        set: data,
      });
  }

  async getUser(userId: string): Promise<User | null> {
    const result = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Update user account fields (name, location, socials).
   * Merges socials with existing values so callers can set individual social
   * fields (e.g. only linkedin) without overwriting the rest.
   */
  async updateUser(
    userId: string,
    data: { name?: string; location?: string; socials?: { x?: string; linkedin?: string; github?: string; websites?: string[] }; onboarding?: OnboardingState }
  ): Promise<{ id: string; name: string; email: string; intro?: string | null; avatar?: string | null; location?: string | null; socials?: { x?: string; linkedin?: string; github?: string; websites?: string[] } | null; onboarding?: OnboardingState | null } | null> {
    // Load current user to merge socials
    const current = await this.getUser(userId);
    if (!current) return null;

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };

    if (data.name !== undefined) updateFields.name = data.name;
    if (data.location !== undefined) updateFields.location = data.location;
    if (data.onboarding !== undefined) updateFields.onboarding = data.onboarding;

    if (data.socials) {
      // Merge with existing socials instead of overwriting
      const existingSocials = current.socials ?? {};
      const merged = { ...existingSocials };
      if (data.socials.x !== undefined) merged.x = data.socials.x;
      if (data.socials.linkedin !== undefined) merged.linkedin = data.socials.linkedin;
      if (data.socials.github !== undefined) merged.github = data.socials.github;
      if (data.socials.websites !== undefined) merged.websites = data.socials.websites;
      updateFields.socials = merged;
    }

    if (data.onboarding !== undefined) {
      const existingOnboarding = current.onboarding ?? {};
      updateFields.onboarding = { ...existingOnboarding, ...data.onboarding };
    }

    const result = await db.update(schema.users)
      .set(updateFields)
      .where(eq(schema.users.id, userId))
      .returning();

    const updated = result[0];
    if (!updated) return null;
    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      intro: updated.intro,
      avatar: updated.avatar,
      location: updated.location,
      socials: updated.socials as { x?: string; linkedin?: string; github?: string; websites?: string[] } | null,
      onboarding: (updated as { onboarding?: unknown }).onboarding as OnboardingState | null,
    };
  }

  /**
   * Delete profile by userId (for test teardown).
   */
  async deleteProfile(userId: string): Promise<void> {
    await db.delete(schema.userProfiles).where(eq(schema.userProfiles.userId, userId));
  }

  /**
   * Get full profile row by userId (for test assertions).
   */
  async getProfileRow(userId: string): Promise<{
    identity: ProfileIdentity;
    narrative: ProfileNarrative;
    attributes: ProfileAttributes;
    embedding: number[] | number[][] | null;
  } | null> {
    const result = await db.select({
      identity: schema.userProfiles.identity,
      narrative: schema.userProfiles.narrative,
      attributes: schema.userProfiles.attributes,
      embedding: schema.userProfiles.embedding,
    })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1);
    const row = result[0];
    if (!row) return null;
    return {
      identity: row.identity as ProfileIdentity,
      narrative: row.narrative as ProfileNarrative,
      attributes: row.attributes as ProfileAttributes,
      embedding: row.embedding,
    };
  }

  async getProfileByUserId(userId: string): Promise<(ProfileRow & { id: string }) | null> {
    const result = await db.select({
      id: schema.userProfiles.id,
      userId: schema.userProfiles.userId,
      identity: schema.userProfiles.identity,
      narrative: schema.userProfiles.narrative,
      attributes: schema.userProfiles.attributes,
      embedding: schema.userProfiles.embedding,
    })
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1);
    const profile = result[0];
    if (!profile) return null;
    return {
      id: profile.id,
      userId: profile.userId,
      identity: profile.identity as ProfileIdentity,
      narrative: profile.narrative as ProfileNarrative,
      attributes: profile.attributes as ProfileAttributes,
      embedding: profile.embedding,
    };
  }

  private hydeAdapter = new HydeDatabaseAdapter();

  async getHydeDocument(
    sourceType: 'intent' | 'profile' | 'query',
    sourceId: string,
    strategy: string
  ) {
    return this.hydeAdapter.getHydeDocument(sourceType, sourceId, strategy);
  }

  async saveHydeDocument(data: {
    sourceType: 'intent' | 'profile' | 'query';
    sourceId?: string | null;
    sourceText?: string | null;
    strategy: string;
    targetCorpus: string;
    hydeText: string;
    hydeEmbedding: number[];
    context?: Record<string, unknown> | null;
    expiresAt?: Date | null;
  }) {
    return this.hydeAdapter.saveHydeDocument(data);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Opportunity Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/** Opportunity row shape (matches protocol Opportunity; confidence as string from numeric). */
interface OpportunityRow {
  id: string;
  detection: schema.OpportunityDetection;
  actors: schema.OpportunityActor[];
  interpretation: schema.OpportunityInterpretation;
  context: schema.OpportunityContext;
  confidence: string;
  status: 'latent' | 'draft' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
}

/** Create opportunity input (matches protocol CreateOpportunityData). */
interface CreateOpportunityInput {
  detection: schema.OpportunityDetection;
  actors: schema.OpportunityActor[];
  interpretation: schema.OpportunityInterpretation;
  context: schema.OpportunityContext;
  confidence: string;
  status?: 'latent' | 'draft' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
  expiresAt?: Date;
}

function toOpportunityRow(row: typeof opportunities.$inferSelect): OpportunityRow {
  const confidence = row.confidence;
  return {
    id: row.id,
    detection: row.detection as schema.OpportunityDetection,
    actors: row.actors as schema.OpportunityActor[],
    interpretation: row.interpretation as schema.OpportunityInterpretation,
    context: row.context as schema.OpportunityContext,
    confidence: typeof confidence === 'string' ? confidence : String(confidence),
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    expiresAt: row.expiresAt,
  };
}

/**
 * Database adapter for Opportunity Graph and opportunity controller.
 */
export class OpportunityDatabaseAdapter {
  async getProfile(userId: string): Promise<ProfileRow | null> {
    const result = await db.select()
      .from(schema.userProfiles)
      .where(eq(schema.userProfiles.userId, userId))
      .limit(1);
    const profile = result[0];
    if (!profile) return null;
    return {
      userId: profile.userId,
      identity: profile.identity as ProfileIdentity,
      narrative: profile.narrative as ProfileNarrative,
      attributes: profile.attributes as ProfileAttributes,
      embedding: profile.embedding,
    };
  }

  async createOpportunity(data: CreateOpportunityInput): Promise<OpportunityRow> {
    const [row] = await db
      .insert(opportunities)
      .values({
        detection: data.detection,
        actors: data.actors,
        interpretation: data.interpretation,
        context: data.context,
        confidence: data.confidence,
        status: data.status ?? 'pending',
        expiresAt: data.expiresAt ?? null,
      })
      .returning();
    if (!row) throw new Error('OpportunityDatabaseAdapter.createOpportunity: no row returned');
    return toOpportunityRow(row);
  }

  async getOpportunity(id: string): Promise<OpportunityRow | null> {
    const rows = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
    const row = rows[0];
    return row ? toOpportunityRow(row) : null;
  }

  async getOpportunitiesForUser(
    userId: string,
    options?: { status?: string; indexId?: string; role?: string; limit?: number; offset?: number; conversationId?: string }
  ): Promise<OpportunityRow[]> {
    // Role-based visibility: who can see depends on actor role and status (and whether introducer exists)
    const visibilityGuard = sql`(
      ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'introducer' }])}::jsonb
      OR ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'peer' }])}::jsonb
      OR (
        ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'patient' }])}::jsonb
        AND (${opportunities.status} NOT IN ('latent', 'draft') OR NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
      )
      OR (
        ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'agent' }])}::jsonb
        AND (
          ${opportunities.status} IN ('accepted', 'rejected', 'expired')
          OR (${opportunities.status} NOT IN ('latent', 'draft') AND NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
        )
      )
      OR (
        ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'party' }])}::jsonb
        AND (${opportunities.status} NOT IN ('latent', 'draft') OR NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
      )
    )`;
    const conditions = [visibilityGuard];
    // Draft visibility: without conversationId exclude all draft; with conversationId include draft only for that session
    if (options?.conversationId == null) {
      conditions.push(sql`${opportunities.status} != 'draft'`);
    } else {
      conditions.push(
        sql`(${opportunities.status} != 'draft' OR (${opportunities.context}->>'conversationId') = ${options.conversationId})`
      );
    }
    if (options?.status) conditions.push(eq(opportunities.status, options.status as typeof opportunities.$inferSelect.status));
    if (options?.indexId) conditions.push(sql`${opportunities.context}->>'indexId' = ${options.indexId}`);
    let q = db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.createdAt));
    if (options?.limit != null) q = q.limit(options.limit) as typeof q;
    if (options?.offset != null) q = q.offset(options.offset) as typeof q;
    const rows = await q;
    return rows.map(toOpportunityRow);
  }

  async getOpportunitiesForIndex(
    indexId: string,
    options?: { status?: string; limit?: number; offset?: number }
  ): Promise<OpportunityRow[]> {
    const conditions = [sql`${opportunities.context}->>'indexId' = ${indexId}`];
    if (options?.status) conditions.push(eq(opportunities.status, options.status as typeof opportunities.$inferSelect.status));
    let q = db
      .select()
      .from(opportunities)
      .where(and(...conditions))
      .orderBy(desc(opportunities.createdAt));
    if (options?.limit != null) q = q.limit(options.limit) as typeof q;
    if (options?.offset != null) q = q.offset(options.offset) as typeof q;
    const rows = await q;
    return rows.map(toOpportunityRow);
  }

  async updateOpportunityStatus(
    id: string,
    status: 'latent' | 'draft' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired'
  ): Promise<OpportunityRow | null> {
    const [row] = await db
      .update(opportunities)
      .set({ status, updatedAt: new Date() })
      .where(eq(opportunities.id, id))
      .returning();
    return row ? toOpportunityRow(row) : null;
  }

  async createOpportunityAndExpireIds(
    data: CreateOpportunityInput,
    expireIds: string[]
  ): Promise<{ created: OpportunityRow; expired: OpportunityRow[] }> {
    return db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(opportunities)
        .values({
          detection: data.detection,
          actors: data.actors,
          interpretation: data.interpretation,
          context: data.context,
          confidence: data.confidence,
          status: data.status ?? 'pending',
          expiresAt: data.expiresAt ?? null,
        })
        .returning();
      if (!inserted) throw new Error('OpportunityDatabaseAdapter.createOpportunityAndExpireIds: no row returned');
      const created = toOpportunityRow(inserted);
      const expired: OpportunityRow[] = [];
      const now = new Date();
      for (const id of expireIds) {
        const [row] = await tx
          .update(opportunities)
          .set({ status: 'expired', updatedAt: now })
          .where(eq(opportunities.id, id))
          .returning();
        if (row) expired.push(toOpportunityRow(row));
      }
      return { created, expired };
    });
  }

  /** Condition: opportunity actors contain both userId and counterpartUserId. */
  private static actorPairCondition(userId: string, counterpartUserId: string) {
    return and(
      sql`${opportunities.actors} @> ${JSON.stringify([{ userId }])}::jsonb`,
      sql`${opportunities.actors} @> ${JSON.stringify([{ userId: counterpartUserId }])}::jsonb`
    );
  }

  async getAcceptedOpportunitiesBetweenActors(
    userId: string,
    counterpartUserId: string
  ): Promise<OpportunityRow[]> {
    const rows = await db
      .select()
      .from(opportunities)
      .where(
        and(
          OpportunityDatabaseAdapter.actorPairCondition(userId, counterpartUserId),
          eq(opportunities.status, 'accepted')
        )
      )
      .orderBy(desc(opportunities.updatedAt));
    return rows.map(toOpportunityRow);
  }

  async acceptSiblingOpportunities(
    userId: string,
    counterpartUserId: string,
    excludeOpportunityId: string
  ): Promise<string[]> {
    return db.transaction(async (tx) => {
      const siblingRows = await tx
        .select({ id: opportunities.id })
        .from(opportunities)
        .where(
          and(
            OpportunityDatabaseAdapter.actorPairCondition(userId, counterpartUserId),
            notInArray(opportunities.status, ['accepted', 'expired', 'rejected']),
            ne(opportunities.id, excludeOpportunityId)
          )
        );
      const ids = siblingRows.map((r) => r.id);
      if (ids.length === 0) return [];
      const now = new Date();
      await tx
        .update(opportunities)
        .set({ status: 'accepted', updatedAt: now })
        .where(inArray(opportunities.id, ids));
      return ids;
    });
  }

  async opportunityExistsBetweenActors(actorIds: string[], indexId: string): Promise<boolean> {
    if (actorIds.length === 0) return false;
    const expired = 'expired';
    const conditions = [
      sql`${opportunities.context}->>'indexId' = ${indexId}`,
      ne(opportunities.status, expired),
    ];
    // Require that all given actorIds appear in actors (opportunity may have extra actors, e.g. introducer)
    for (const actorId of actorIds) {
      conditions.push(
        sql`${opportunities.actors} @> ${JSON.stringify([{ userId: actorId }])}::jsonb`
      );
    }
    const rows = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(and(...conditions))
      .limit(1);
    return rows.length > 0;
  }

  async getOpportunityBetweenActors(
    actorIds: string[],
    indexId: string
  ): Promise<{ id: Id<'opportunities'>; status: (typeof opportunities.$inferSelect)['status'] } | null> {
    if (actorIds.length === 0) return null;
    const expired = 'expired';
    const conditions = [
      sql`${opportunities.context}->>'indexId' = ${indexId}`,
      ne(opportunities.status, expired),
    ];
    for (const actorId of actorIds) {
      conditions.push(
        sql`${opportunities.actors} @> ${JSON.stringify([{ userId: actorId }])}::jsonb`
      );
    }
    const rows = await db
      .select({ id: opportunities.id, status: opportunities.status })
      .from(opportunities)
      .where(and(...conditions))
      .limit(1);
    const row = rows[0];
    return row ? { id: row.id as Id<'opportunities'>, status: row.status } : null;
  }

  async findOverlappingOpportunities(
    actorUserIds: Id<'users'>[],
    options?: { excludeStatuses?: ('latent' | 'draft' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired')[] }
  ): Promise<OpportunityRow[]> {
    if (actorUserIds.length === 0) return [];
    const mergedExcludeStatuses = [
      ...new Set([...(options?.excludeStatuses ?? [])]),
    ] as ('latent' | 'draft' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired')[];
    const statusCondition =
      mergedExcludeStatuses.length > 0
        ? notInArray(opportunities.status, mergedExcludeStatuses)
        : undefined;
    const containmentConditions = actorUserIds.map(
      (uid) => sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) elem
        WHERE elem->>'userId' = ${uid}
          AND elem->>'role' IS DISTINCT FROM 'introducer'
      )`
    );
    const overlapCondition = and(...containmentConditions)!;
    const rows = await db
      .select()
      .from(opportunities)
      .where(statusCondition ? and(statusCondition, overlapCondition) : overlapCondition)
      .orderBy(desc(opportunities.updatedAt));
    return rows.map(toOpportunityRow);
  }

  async expireOpportunitiesByIntent(intentId: string): Promise<number> {
    const rows = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        sql`${opportunities.actors} @> ${JSON.stringify([{ intent: intentId }])}::jsonb`
      );
    if (rows.length === 0) return 0;
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          sql`${opportunities.actors} @> ${JSON.stringify([{ intent: intentId }])}::jsonb`
        )
      )
      .returning({ id: opportunities.id });
    return updated.length;
  }

  async expireOpportunitiesForRemovedMember(indexId: string, userId: string): Promise<number> {
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          sql`${opportunities.context}->>'indexId' = ${indexId}`,
          sql`${opportunities.actors} @> ${JSON.stringify([{ userId }])}::jsonb`
        )
      )
      .returning({ id: opportunities.id });
    return updated.length;
  }

  /** Set status to expired for opportunities with expires_at <= now. Used by cron. */
  async expireStaleOpportunities(): Promise<number> {
    const now = new Date();
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          isNotNull(opportunities.expiresAt),
          lte(opportunities.expiresAt, now),
          ne(opportunities.status, 'expired')
        )
      )
      .returning({ id: opportunities.id });
    return updated.length;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Index Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database adapter for Index Graph (intent/index context and assignment).
 */
export class IndexGraphDatabaseAdapter {
  async getIntentForIndexing(intentId: string) {
    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        userId: intents.userId,
        sourceType: intents.sourceType,
        sourceId: intents.sourceId,
      })
      .from(intents)
      .where(eq(intents.id, intentId))
      .limit(1);
    return rows[0] ?? null;
  }

  async getIndexMemberContext(indexId: string, userId: string) {
    const rows = await db
      .select({
        indexId: indexes.id,
        indexPrompt: indexes.prompt,
        memberPrompt: indexMembers.prompt,
      })
      .from(indexes)
      .innerJoin(indexMembers, eq(indexes.id, indexMembers.indexId))
      .where(
        and(
          eq(indexes.id, indexId),
          eq(indexMembers.userId, userId),
          eq(indexMembers.autoAssign, true),
          isNull(indexes.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async isIntentAssignedToIndex(intentId: string, indexId: string): Promise<boolean> {
    const rows = await db
      .select({ indexId: intentIndexes.indexId })
      .from(intentIndexes)
      .where(
        and(
          eq(intentIndexes.intentId, intentId),
          eq(intentIndexes.indexId, indexId)
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async assignIntentToIndex(intentId: string, indexId: string): Promise<void> {
    await db.insert(intentIndexes).values({ intentId, indexId });
  }

  async unassignIntentFromIndex(intentId: string, indexId: string): Promise<void> {
    await db
      .delete(intentIndexes)
      .where(
        and(
          eq(intentIndexes.intentId, intentId),
          eq(intentIndexes.indexId, indexId)
        )
      );
  }

  async getIndexIdsForIntent(intentId: string): Promise<string[]> {
    const rows = await db
      .select({ indexId: intentIndexes.indexId })
      .from(intentIndexes)
      .where(eq(intentIndexes.intentId, intentId));
    return rows.map((r) => r.indexId);
  }

  /**
   * Delete only index_members for an index (releases user FK for teardown).
   */
  async deleteMembersForIndex(indexId: string): Promise<void> {
    await db.delete(indexMembers).where(eq(indexMembers.indexId, indexId));
  }

  /**
   * Delete an index and its members/intent-index links (for test teardown).
   */
  async deleteIndexAndMembers(indexId: string): Promise<void> {
    await db.delete(intentIndexes).where(eq(intentIndexes.indexId, indexId));
    await db.delete(indexMembers).where(eq(indexMembers.indexId, indexId));
    await db.delete(indexes).where(eq(indexes.id, indexId));
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// HyDE Document Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/** Input shape for saving a HyDE document (matches CreateHydeDocumentData). */
interface SaveHydeDocumentInput {
  sourceType: HydeSourceTypeLocal;
  sourceId?: string | null;
  sourceText?: string | null;
  strategy: string;
  targetCorpus: string;
  hydeText: string;
  hydeEmbedding: number[];
  context?: Record<string, unknown> | null;
  expiresAt?: Date | null;
}

/**
 * Database adapter for HyDE document persistence (HyDE Graph, maintenance jobs).
 */
export class HydeDatabaseAdapter {
  async getHydeDocument(
    sourceType: HydeSourceTypeLocal,
    sourceId: string,
    strategy: string
  ): Promise<HydeDocumentRow | null> {
    const rows = await db
      .select()
      .from(hydeDocuments)
      .where(
        and(
          eq(hydeDocuments.sourceType, sourceType),
          eq(hydeDocuments.sourceId, sourceId),
          eq(hydeDocuments.strategy, strategy)
        )
      )
      .limit(1);
    const row = rows[0];
    return row ? toHydeDocument(row) : null;
  }

  async getHydeDocumentsForSource(
    sourceType: HydeSourceTypeLocal,
    sourceId: string
  ): Promise<HydeDocumentRow[]> {
    const rows = await db
      .select()
      .from(hydeDocuments)
      .where(
        and(
          eq(hydeDocuments.sourceType, sourceType),
          eq(hydeDocuments.sourceId, sourceId)
        )
      );
    return rows.map(toHydeDocument);
  }

  async saveHydeDocument(data: SaveHydeDocumentInput): Promise<HydeDocumentRow> {
    const value = {
      sourceType: data.sourceType,
      sourceId: data.sourceId ?? null,
      sourceText: data.sourceText ?? null,
      strategy: data.strategy,
      targetCorpus: data.targetCorpus,
      context: data.context ?? null,
      hydeText: data.hydeText,
      hydeEmbedding: data.hydeEmbedding,
      expiresAt: data.expiresAt ?? null,
    };
    const inserted = await db
      .insert(hydeDocuments)
      .values(value)
      .onConflictDoUpdate({
        target: [
          hydeDocuments.sourceType,
          hydeDocuments.sourceId,
          hydeDocuments.strategy,
          hydeDocuments.targetCorpus,
        ],
        set: {
          sourceText: value.sourceText,
          context: value.context,
          hydeText: value.hydeText,
          hydeEmbedding: value.hydeEmbedding,
          expiresAt: value.expiresAt,
        },
      })
      .returning();
    const row = inserted[0];
    if (!row) throw new Error('HydeDatabaseAdapter.saveHydeDocument: no row returned');
    return toHydeDocument(row);
  }

  async deleteHydeDocumentsForSource(
    sourceType: HydeSourceTypeLocal,
    sourceId: string
  ): Promise<number> {
    const deleted = await db
      .delete(hydeDocuments)
      .where(
        and(
          eq(hydeDocuments.sourceType, sourceType),
          eq(hydeDocuments.sourceId, sourceId)
        )
      )
      .returning({ id: hydeDocuments.id });
    return deleted.length;
  }

  async deleteExpiredHydeDocuments(): Promise<number> {
    const now = new Date();
    const deleted = await db
      .delete(hydeDocuments)
      .where(
        and(
          isNotNull(hydeDocuments.expiresAt),
          lte(hydeDocuments.expiresAt, now)
        )
      )
      .returning({ id: hydeDocuments.id });
    return deleted.length;
  }

  async getStaleHydeDocuments(threshold: Date): Promise<HydeDocumentRow[]> {
    const rows = await db
      .select()
      .from(hydeDocuments)
      .where(lt(hydeDocuments.createdAt, threshold));
    return rows.map(toHydeDocument);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// User Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

interface UserWithGraph {
  id: string;
  email: string | null;
  name: string | null;
  intro: string | null;
  location: string | null;
  socials: unknown;
  onboarding: unknown;
  avatar: string | null;
  timezone: string | null;
  lastWeeklyEmailSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  profile: typeof userProfiles.$inferSelect | null;
  notificationPreferences: {
    connectionUpdates: boolean;
    weeklyNewsletter: boolean;
  };
}

interface NewsletterUserData {
  id: string;
  email: string | null;
  name: string | null;
  intro: string | null;
  timezone: string | null;
  lastSent: Date | null;
  prefs: {
    connectionUpdates?: boolean;
    weeklyNewsletter?: boolean;
  } | null;
  unsubscribeToken: string | null;
  onboarding: {
    completedAt?: string;
    flow?: 1 | 2 | 3;
    currentStep?: string;
  } | null;
}

interface BasicUserInfo {
  id: string;
  name: string | null;
  intro: string | null;
}

/**
 * UserDatabaseAdapter
 * 
 * Wraps all database operations for users table and related tables.
 */
export class UserDatabaseAdapter {
  /**
   * Find user by ID
   */
  async findById(userId: string): Promise<typeof users.$inferSelect | null> {
    const result = await db.select()
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    return result[0] || null;
  }

  /**
   * Find multiple users by IDs. Returns public profile fields only (same shape as single-user API).
   */
  async findByIds(userIds: string[]): Promise<Array<Pick<typeof users.$inferSelect, 'id' | 'name' | 'intro' | 'avatar' | 'location' | 'socials' | 'createdAt' | 'updatedAt'>>> {
    if (userIds.length === 0) return [];
    const result = await db.select({
      id: users.id,
      name: users.name,
      intro: users.intro,
      avatar: users.avatar,
      location: users.location,
      socials: users.socials,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
      .from(users)
      .where(inArray(users.id, userIds));
    return result;
  }

  /**
   * Find user by email.
   */
  async findByEmail(email: string): Promise<typeof users.$inferSelect | null> {
    const result = await db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Create a domain user.
   */
  async create(data: {
    email: string;
    name?: string;
    intro?: string;
    location?: string;
    socials?: Record<string, string>;
  }): Promise<typeof users.$inferSelect> {
    const [row] = await db.insert(users)
      .values({
        email: data.email,
        name: data.name ?? data.email.split('@')[0],
        intro: data.intro ?? null,
        location: data.location ?? null,
        socials: data.socials ?? null,
      })
      .returning();
    if (!row) throw new Error('User insert did not return a row');
    return row;
  }

  /**
   * Delete user by ID (for test teardown). Does not delete related rows; call other adapters first if needed.
   */
  async deleteById(userId: string): Promise<void> {
    await db.delete(users).where(eq(users.id, userId));
  }

  /**
   * Delete user by email (for test teardown). Finds by email then deletes.
   */
  async deleteByEmail(email: string): Promise<void> {
    const u = await this.findByEmail(email);
    if (u) await this.deleteById(u.id);
  }

  /**
   * Find user with joined profile and notification settings
   */
  async findWithGraph(userId: string): Promise<UserWithGraph | null> {
    const userResult = await db.select({
      user: users,
      settings: userNotificationSettings,
      profile: userProfiles
    })
      .from(users)
      .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
      .leftJoin(userProfiles, eq(users.id, userProfiles.userId))
      .where(eq(users.id, userId))
      .limit(1);

    if (userResult.length === 0) {
      return null;
    }

    const { user, settings, profile } = userResult[0];

    return {
      ...user,
      profile,
      notificationPreferences: settings?.preferences as {
        connectionUpdates: boolean;
        weeklyNewsletter: boolean;
      } || {
        connectionUpdates: true,
        weeklyNewsletter: true,
      }
    };
  }

  /**
   * Update user
   */
  async update(userId: string, data: Partial<User>): Promise<typeof users.$inferSelect | null> {
    const result = await db.update(users)
      .set({
        ...data,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();

    return result[0] || null;
  }

  /**
   * Soft delete user
   */
  async softDelete(userId: string): Promise<void> {
    await db.update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, userId));
  }

  /**
   * Get user details for newsletter
   */
  async getUserForNewsletter(userId: string): Promise<NewsletterUserData | null> {
    const userRes = await db.select({
      id: users.id,
      email: users.email,
      name: users.name,
      intro: users.intro,
      timezone: users.timezone,
      lastSent: users.lastWeeklyEmailSentAt,
      prefs: userNotificationSettings.preferences,
      unsubscribeToken: userNotificationSettings.unsubscribeToken,
      onboarding: users.onboarding
    })
      .from(users)
      .leftJoin(userNotificationSettings, eq(users.id, userNotificationSettings.userId))
      .where(eq(users.id, userId))
      .limit(1);

    return userRes[0] || null;
  }

  /**
   * Get basic info for multiple users
   */
  async getUsersBasicInfo(userIds: string[]): Promise<BasicUserInfo[]> {
    if (userIds.length === 0) return [];
    
    return db.select({
      id: users.id,
      name: users.name,
      intro: users.intro
    })
      .from(users)
      .where(inArray(users.id, userIds));
  }

  /**
   * Update last weekly email sent timestamp
   */
  async updateLastWeeklyEmailSent(userId: string): Promise<void> {
    await db.update(users)
      .set({ lastWeeklyEmailSentAt: new Date() })
      .where(eq(users.id, userId));
  }

  /**
   * Initialize default notification settings for a new user.
   * Idempotent - safe to call multiple times (does nothing if settings exist).
   */
  async setupDefaultNotificationSettings(userId: string): Promise<void> {
    await db.insert(userNotificationSettings)
      .values({
        userId,
        preferences: {
          connectionUpdates: true,
          weeklyNewsletter: true,
        }
      })
      .onConflictDoNothing();
  }

  /**
   * Ensure notification settings exist for a user
   */
  async ensureNotificationSettings(userId: string): Promise<{ unsubscribeToken: string | null }> {
    const [upsertedSettings] = await db.insert(userNotificationSettings)
      .values({
        userId,
        preferences: {
          connectionUpdates: true,
          weeklyNewsletter: true,
        }
      })
      .onConflictDoUpdate({
        target: userNotificationSettings.userId,
        set: {
          updatedAt: new Date()
        }
      })
      .returning({
        unsubscribeToken: userNotificationSettings.unsubscribeToken
      });

    return upsertedSettings;
  }

  /**
   * Upsert notification preferences for a user
   */
  async updateNotificationPreferences(userId: string, preferences: NotificationPreferences): Promise<void> {
    const existing = await db.select().from(userNotificationSettings).where(eq(userNotificationSettings.userId, userId)).limit(1);
    if (existing.length > 0) {
      await db.update(userNotificationSettings)
        .set({ preferences, updatedAt: new Date() })
        .where(eq(userNotificationSettings.userId, userId));
    } else {
      await db.insert(userNotificationSettings)
        .values({ userId, preferences });
    }
  }

}

// ═══════════════════════════════════════════════════════════════════════════════
// File Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

interface FileRow {
  id: string;
  name: string;
  type: string;
  size: bigint;
  createdAt: Date;
  userId: string | null;
}

interface FileMetadata {
  id: string;
  name: string;
  type: string;
  size: bigint;
}

export interface CreateFileInput {
  id: string;
  name: string;
  size: bigint;
  type: string;
  userId: string;
}

interface FileListResult {
  files: FileRow[];
  total: number;
}

/**
 * FileDatabaseAdapter
 * 
 * Wraps all database operations for files table.
 */
export class FileDatabaseAdapter {
  /**
   * Get files by IDs for a specific user
   */
  async getFilesByIds(userId: string, fileIds: string[]): Promise<FileMetadata[]> {
    if (!fileIds?.length) return [];
    
    return db.select({
      id: files.id,
      name: files.name,
      type: files.type,
      size: files.size,
    })
      .from(files)
      .where(
        and(
          eq(files.userId, userId),
          inArray(files.id, fileIds),
          isNull(files.deletedAt)
        )
      );
  }

  /**
   * Get a single file by ID
   */
  async getById(fileId: string, userId: string): Promise<FileRow | null> {
    const result = await db.select()
      .from(files)
      .where(
        and(
          eq(files.id, fileId),
          eq(files.userId, userId),
          isNull(files.deletedAt)
        )
      )
      .limit(1);
    
    return result[0] || null;
  }

  /**
   * List files for a user with pagination
   */
  async listFiles(
    userId: string, 
    options: { skip: number; limit: number }
  ): Promise<FileListResult> {
    const where = and(isNull(files.deletedAt), eq(files.userId, userId));
    
    const [rows, totalResult] = await Promise.all([
      db.select({
        id: files.id,
        name: files.name,
        size: files.size,
        type: files.type,
        createdAt: files.createdAt,
        userId: files.userId,
      })
        .from(files)
        .where(where)
        .orderBy(desc(files.createdAt))
        .offset(options.skip)
        .limit(options.limit),
      db.select({ count: count() }).from(files).where(where),
    ]);
    
    return {
      files: rows,
      total: Number(totalResult[0]?.count ?? 0),
    };
  }

  /**
   * Create a new file record
   */
  async createFile(data: CreateFileInput): Promise<FileRow> {
    const [inserted] = await db.insert(files)
      .values(data)
      .returning({
        id: files.id,
        name: files.name,
        size: files.size,
        type: files.type,
        createdAt: files.createdAt,
        userId: files.userId,
      });
    
    return inserted;
  }

  /**
   * Soft delete a file
   */
  async softDelete(fileId: string, userId: string): Promise<boolean> {
    const result = await db.update(files)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(files.id, fileId),
          eq(files.userId, userId),
          isNull(files.deletedAt)
        )
      )
      .returning({ id: files.id });

    return result.length > 0;
  }

  /**
   * Delete all file records for a user (for test teardown). Does not remove files from disk.
   */
  async deleteByUserId(userId: string): Promise<void> {
    await db.delete(files).where(eq(files.userId, userId));
  }

  /**
   * Get a file by ID only (for test assertions when userId is known in test).
   */
  async getByIdUnscoped(fileId: string): Promise<FileRow | null> {
    const result = await db.select({
      id: files.id,
      name: files.name,
      type: files.type,
      size: files.size,
      createdAt: files.createdAt,
      userId: files.userId,
    })
      .from(files)
      .where(eq(files.id, fileId))
      .limit(1);
    return result[0] ?? null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Link Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

export interface LinkRow {
  id: string;
  url: string;
  createdAt: Date;
  lastSyncAt: Date | null;
  lastStatus: string | null;
  lastError: string | null;
}

/**
 * LinkDatabaseAdapter
 *
 * Wraps all database operations for the links table.
 */
export class LinkDatabaseAdapter {
  async listLinks(userId: string): Promise<LinkRow[]> {
    return db.select({
      id: links.id,
      url: links.url,
      createdAt: links.createdAt,
      lastSyncAt: links.lastSyncAt,
      lastStatus: links.lastStatus,
      lastError: links.lastError,
    })
      .from(links)
      .where(eq(links.userId, userId));
  }

  async createLink(userId: string, url: string): Promise<LinkRow> {
    const [inserted] = await db.insert(links)
      .values({ userId, url })
      .returning({
        id: links.id,
        url: links.url,
        createdAt: links.createdAt,
        lastSyncAt: links.lastSyncAt,
        lastStatus: links.lastStatus,
        lastError: links.lastError,
      });
    return inserted;
  }

  async deleteLink(linkId: string, userId: string): Promise<boolean> {
    const result = await db.delete(links)
      .where(and(eq(links.id, linkId), eq(links.userId, userId)))
      .returning({ id: links.id });
    return result.length > 0;
  }

  async getLinkContent(linkId: string, userId: string): Promise<{ id: string; url: string; lastSyncAt: Date | null; lastStatus: string | null } | null> {
    const rows = await db.select({
      id: links.id,
      url: links.url,
      lastSyncAt: links.lastSyncAt,
      lastStatus: links.lastStatus,
    })
      .from(links)
      .where(and(eq(links.id, linkId), eq(links.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Singleton Exports
// ═══════════════════════════════════════════════════════════════════════════════

export const chatDatabaseAdapter = new ChatDatabaseAdapter();
export const userDatabaseAdapter = new UserDatabaseAdapter();
export const fileDatabaseAdapter = new FileDatabaseAdapter();
export const linkDatabaseAdapter = new LinkDatabaseAdapter();
export const intentDatabaseAdapter = new IntentDatabaseAdapter();

// ═══════════════════════════════════════════════════════════════════════════════
// Context-Bound Database Factories
// ═══════════════════════════════════════════════════════════════════════════════

import type { VectorStore } from '../lib/protocol/interfaces/embedder.interface';
import type {
  UserDatabase,
  SystemDatabase,
  SimilarIntent,
} from '../lib/protocol/interfaces/database.interface';

const messagingLogger = log.lib.from('messaging.db');

/**
 * Drizzle-backed implementation of the MessagingStore interface.
 * Provides wallet management, conversation visibility, and user resolution for XMTP.
 */
export class MessagingDatabaseAdapter implements MessagingStore {
  constructor(private readonly masterKey: Buffer) {}

  async getWalletKey(userId: string) {
    const [user] = await db.select({
      walletEncryptedKey: schema.users.walletEncryptedKey,
      walletAddress: schema.users.walletAddress,
    }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);

    if (!user?.walletEncryptedKey || !user.walletAddress) return null;
    return {
      privateKey: decryptKey(user.walletEncryptedKey, this.masterKey),
      walletAddress: user.walletAddress,
    };
  }

  async ensureWallet(userId: string) {
    const [user] = await db.select({ walletAddress: schema.users.walletAddress })
      .from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    if (!user) { messagingLogger.warn('[ensureWallet] User not found', { userId }); return; }
    if (user.walletAddress) return;

    const w = generateWallet(this.masterKey);
    await db.update(schema.users).set({
      walletAddress: w.address,
      walletEncryptedKey: w.encryptedKey,
    }).where(eq(schema.users.id, userId));
    messagingLogger.info('[ensureWallet] Wallet generated', { userId });
  }

  async setInboxId(userId: string, inboxId: string) {
    await db.update(schema.users).set({ xmtpInboxId: inboxId }).where(eq(schema.users.id, userId));
  }

  async getPublicInfo(userId: string) {
    const [user] = await db.select({
      walletAddress: schema.users.walletAddress,
      xmtpInboxId: schema.users.xmtpInboxId,
    }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
    return user ?? null;
  }

  async getHiddenConversations(userId: string) {
    return db.select({
      conversationId: schema.hiddenConversations.conversationId,
      hiddenAt: schema.hiddenConversations.hiddenAt,
    }).from(schema.hiddenConversations).where(eq(schema.hiddenConversations.userId, userId));
  }

  async getHiddenAt(userId: string, conversationId: string) {
    const [row] = await db.select({ hiddenAt: schema.hiddenConversations.hiddenAt })
      .from(schema.hiddenConversations)
      .where(and(
        eq(schema.hiddenConversations.userId, userId),
        eq(schema.hiddenConversations.conversationId, conversationId),
      ))
      .limit(1);
    return row?.hiddenAt ?? null;
  }

  async hideConversation(userId: string, conversationId: string) {
    await db.insert(schema.hiddenConversations)
      .values({ userId, conversationId })
      .onConflictDoUpdate({
        target: [schema.hiddenConversations.userId, schema.hiddenConversations.conversationId],
        set: { hiddenAt: new Date() },
      });
  }

  async resolveUsersByInboxIds(inboxIds: string[]) {
    const matched = await db.select({
      id: schema.users.id,
      name: schema.users.name,
      avatar: schema.users.avatar,
      xmtpInboxId: schema.users.xmtpInboxId,
    }).from(schema.users).where(inArray(schema.users.xmtpInboxId, inboxIds));

    const map = new Map<string, { id: string; name: string; avatar: string | null }>();
    for (const u of matched) {
      if (u.xmtpInboxId) map.set(u.xmtpInboxId, { id: u.id, name: u.name, avatar: u.avatar });
    }
    return map;
  }
}

/**
 * Creates a UserDatabase bound to the authenticated user.
 * All operations are scoped to the user's own resources (no userId param needed).
 *
 * @param db - The raw ChatDatabaseAdapter
 * @param authUserId - The authenticated user's ID
 * @returns A UserDatabase bound to authUserId
 */
export function createUserDatabase(db: ChatDatabaseAdapter, authUserId: string): UserDatabase {
  return {
    authUserId,

    // ─────────────────────────────────────────────────────────────────────────────
    // Profile Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getProfile: () => db.getProfile(authUserId),
    getProfileByUserId: () => db.getProfileByUserId(authUserId),
    saveProfile: (profile) => db.saveProfile(authUserId, profile),
    deleteProfile: () => db.deleteProfile(authUserId),
    getUser: () => db.getUser(authUserId),
    updateUser: (data) => db.updateUser(authUserId, data),

    // ─────────────────────────────────────────────────────────────────────────────
    // Intent Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getActiveIntents: () => db.getActiveIntents(authUserId),
    getIntent: async (intentId) => {
      // Enforce ownership by checking userId on returned intent
      const intent = await db.getIntent(intentId);
      if (!intent) return null;
      if (intent.userId !== authUserId) {
        throw new Error('Access denied: intent not owned by user');
      }
      return intent;
    },
    createIntent: (data) => db.createIntent({ ...data, userId: authUserId }),
    updateIntent: async (intentId, data) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.updateIntent(intentId, data);
    },
    archiveIntent: async (intentId) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.archiveIntent(intentId);
    },
    findSimilarIntents: async (_embedding, _options) => {
      // findSimilarIntents is not yet implemented on ChatDatabaseAdapter
      // This is a placeholder - would need vector search implementation
      log.warn('UserDatabase.findSimilarIntents called but not fully implemented');
      return [];
    },
    getIntentForIndexing: (intentId) => db.getIntentForIndexing(intentId),
    associateIntentWithIndexes: async (intentId, indexIds) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      for (const indexId of indexIds) {
        await db.assignIntentToIndex(intentId, indexId);
      }
    },
    assignIntentToIndex: async (intentId, indexId) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.assignIntentToIndex(intentId, indexId);
    },
    unassignIntentFromIndex: async (intentId, indexId) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.unassignIntentFromIndex(intentId, indexId);
    },
    getIndexIdsForIntent: (intentId) => db.getIndexIdsForIntent(intentId),
    isIntentAssignedToIndex: (intentId, indexId) => db.isIntentAssignedToIndex(intentId, indexId),

    // ─────────────────────────────────────────────────────────────────────────────
    // Index Membership Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getIndexMemberships: () => db.getIndexMemberships(authUserId),
    getUserIndexIds: () => db.getUserIndexIds(authUserId),
    getOwnedIndexes: () => db.getOwnedIndexes(authUserId),
    getIndexMembership: (indexId) => db.getIndexMembership(indexId, authUserId),
    getIndexMemberContext: (indexId) => db.getIndexMemberContext(indexId, authUserId),

    // ─────────────────────────────────────────────────────────────────────────────
    // Index CRUD Operations
    // ─────────────────────────────────────────────────────────────────────────────
    createIndex: (data) => db.createIndex(data),
    updateIndexSettings: (indexId, data) => db.updateIndexSettings(indexId, authUserId, data),
    softDeleteIndex: (indexId) => db.softDeleteIndex(indexId),

    // ─────────────────────────────────────────────────────────────────────────────
    // Public Index Discovery
    // ─────────────────────────────────────────────────────────────────────────────
    getPublicIndexesNotJoined: () => db.getPublicIndexesNotJoined(authUserId),
    joinPublicIndex: (indexId) => db.joinPublicIndex(indexId, authUserId),

    // ─────────────────────────────────────────────────────────────────────────────
    // Opportunity Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getOpportunitiesForUser: (options) => db.getOpportunitiesForUser(authUserId, options),
    getOpportunity: (id) => db.getOpportunity(id),
    updateOpportunityStatus: (id, status) => db.updateOpportunityStatus(id, status),
    getAcceptedOpportunitiesBetweenActors: (counterpartUserId) =>
      db.getAcceptedOpportunitiesBetweenActors(authUserId, counterpartUserId),
    acceptSiblingOpportunities: (counterpartUserId, excludeOpportunityId) =>
      db.acceptSiblingOpportunities(authUserId, counterpartUserId, excludeOpportunityId),

    // ─────────────────────────────────────────────────────────────────────────────
    // HyDE Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getHydeDocument: (sourceType, sourceId, strategy) => db.getHydeDocument(sourceType, sourceId, strategy),
    getHydeDocumentsForSource: (sourceType, sourceId) => db.getHydeDocumentsForSource(sourceType, sourceId),
    saveHydeDocument: (data) => db.saveHydeDocument(data),
    deleteHydeDocumentsForSource: (sourceType, sourceId) => db.deleteHydeDocumentsForSource(sourceType, sourceId),
  };
}

/**
 * Creates a SystemDatabase bound to the authenticated user and index scope.
 * Cross-user operations are restricted to users within the shared indexes.
 *
 * @param db - The raw ChatDatabaseAdapter
 * @param authUserId - The authenticated user's ID
 * @param indexScope - Array of index IDs the user has access to
 * @param embedder - Optional vector store for findSimilarIntentsInScope (pgvector search). When omitted, findSimilarIntentsInScope returns [].
 * @returns A SystemDatabase bound to authUserId and indexScope
 */
export function createSystemDatabase(
  db: ChatDatabaseAdapter,
  authUserId: string,
  indexScope: string[],
  embedder?: VectorStore
): SystemDatabase {
  /**
   * Verify that an indexId is within the allowed scope.
   * Throws if the index is not in scope.
   */
  const verifyScope = (indexId: string): void => {
    if (!indexScope.includes(indexId)) {
      throw new Error(`Access denied: index ${indexId} not in scope`);
    }
  };

  /**
   * Verify that a user shares at least one index with the auth user,
   * or is a contact of the auth user (for ghost users who have no index membership).
   * Returns true if access is allowed, false otherwise.
   */
  const verifySharedIndex = async (userId: string): Promise<boolean> => {
    if (userId === authUserId) return true;
    // Check if they share any index
    const theirMemberships = await db.getIndexMemberships(userId);
    if (theirMemberships.some((m) => indexScope.includes(m.indexId))) return true;
    // Check if the user is a contact of the auth user (covers ghost users with no index membership)
    const contactUserIds = await db.getContactUserIds(authUserId);
    return contactUserIds.includes(userId);
  };

  return {
    authUserId,
    indexScope,

    // ─────────────────────────────────────────────────────────────────────────────
    // Profile Operations (cross-user within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    getProfile: async (userId) => {
      if (!(await verifySharedIndex(userId))) {
        throw new Error('Access denied: no shared index with user');
      }
      return db.getProfile(userId);
    },
    getUser: async (userId) => {
      if (!(await verifySharedIndex(userId))) {
        throw new Error('Access denied: no shared index with user');
      }
      return db.getUser(userId);
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Intent Operations (cross-user within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    getIntentsInIndex: async (indexId, options) => {
      verifyScope(indexId);
      return db.getIndexIntentsForMember(indexId, authUserId, options);
    },
    getUserIntentsInIndex: async (userId, indexId) => {
      verifyScope(indexId);
      return db.getIntentsInIndexForMember(userId, indexId);
    },
    getIntent: (intentId) => db.getIntent(intentId),
    findSimilarIntentsInScope: async (embedding, options) => {
      if (!embedder || indexScope.length === 0) {
        return [];
      }
      const limit = options?.limit ?? 10;
      const threshold = options?.threshold ?? 0.7;
      const results = await embedder.search<{ id: string; payload: string; summary: string | null; userId: string }>(
        embedding,
        'intents',
        { limit, minScore: threshold, filter: { indexScope } }
      );
      const intents = await Promise.all(results.map((r) => db.getIntent(r.item.id)));
      return results
        .map((r, i) => ({ r, intent: intents[i] }))
        .filter((pair): pair is { r: (typeof results)[0]; intent: NonNullable<(typeof intents)[0]> } => pair.intent != null)
        .map(({ r, intent }): SimilarIntent => ({
          id: intent.id,
          payload: intent.payload,
          summary: intent.summary ?? null,
          userId: intent.userId,
          isIncognito: intent.isIncognito ?? false,
          createdAt: intent.createdAt,
          updatedAt: intent.updatedAt,
          archivedAt: intent.archivedAt ?? null,
          similarity: r.score,
        }));
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Index Membership Operations (cross-user within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    isIndexMember: (indexId, userId) => db.isIndexMember(indexId, userId),
    isIndexOwner: (indexId, userId) => db.isIndexOwner(indexId, userId),
    getIndexMembers: async (indexId) => {
      verifyScope(indexId);
      return db.getIndexMembersForMember(indexId, authUserId);
    },
    getMembersFromScope: () => db.getMembersFromUserIndexes(authUserId as Id<'users'>),
    addMemberToIndex: (indexId, userId, role) => db.addMemberToIndex(indexId, userId, role),
    removeMemberFromIndex: (indexId, userId) => db.removeMemberFromIndex(indexId, userId),

    // ─────────────────────────────────────────────────────────────────────────────
    // Index Operations (within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    getIndex: async (indexId) => {
      verifyScope(indexId);
      return db.getIndex(indexId);
    },
    getIndexWithPermissions: async (indexId) => {
      verifyScope(indexId);
      return db.getIndexWithPermissions(indexId);
    },
    getIndexMemberCount: async (indexId) => {
      verifyScope(indexId);
      return db.getIndexMemberCount(indexId);
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Opportunity Operations (cross-user within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    createOpportunity: (data) => {
      const indexId = data.context?.indexId;
      if (indexId) verifyScope(indexId);
      return db.createOpportunity(data);
    },
    createOpportunityAndExpireIds: (data, expireIds) => db.createOpportunityAndExpireIds(data, expireIds),
    getOpportunity: (id) => db.getOpportunity(id),
    getOpportunitiesForIndex: async (indexId, options) => {
      verifyScope(indexId);
      return db.getOpportunitiesForIndex(indexId, options);
    },
    updateOpportunityStatus: async (id, status) => {
      const opportunity = await db.getOpportunity(id);
      if (!opportunity) throw new Error('Opportunity not found');
      const opportunityIndexId = opportunity.context?.indexId;
      if (!opportunityIndexId) throw new Error('Opportunity not found');
      verifyScope(opportunityIndexId);
      return db.updateOpportunityStatus(id, status);
    },
    opportunityExistsBetweenActors: (actorIds, indexId) => {
      verifyScope(indexId);
      return db.opportunityExistsBetweenActors(actorIds, indexId);
    },
    getOpportunityBetweenActors: (actorIds, indexId) => {
      verifyScope(indexId);
      return db.getOpportunityBetweenActors(actorIds, indexId);
    },
    findOverlappingOpportunities: (actorUserIds, options) => db.findOverlappingOpportunities(actorUserIds, options),
    expireOpportunitiesByIntent: (intentId) => db.expireOpportunitiesByIntent(intentId),
    expireOpportunitiesForRemovedMember: (indexId, userId) => db.expireOpportunitiesForRemovedMember(indexId, userId),
    expireStaleOpportunities: () => db.expireStaleOpportunities(),

    // ─────────────────────────────────────────────────────────────────────────────
    // HyDE Operations (cross-user for opportunity matching)
    // ─────────────────────────────────────────────────────────────────────────────
    getHydeDocument: (sourceType, sourceId, strategy) => db.getHydeDocument(sourceType, sourceId, strategy),
    getHydeDocumentsForSource: (sourceType, sourceId) => db.getHydeDocumentsForSource(sourceType, sourceId),
    saveHydeDocument: (data) => db.saveHydeDocument(data),
    deleteExpiredHydeDocuments: () => db.deleteExpiredHydeDocuments(),
    getStaleHydeDocuments: (threshold) => db.getStaleHydeDocuments(threshold),
  };
}
