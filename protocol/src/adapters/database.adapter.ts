/**
 * Database adapters used by controllers and queues.
 * Postgres implementations; no dependency on lib/protocol.
 */

import { eq, and, or, isNull, isNotNull, sql, count, desc, lt, lte, ne, inArray, ilike, notInArray } from 'drizzle-orm';
import * as schema from '../schemas/database.schema';
import db from '../lib/drizzle/drizzle';
import type { User, NotificationPreferences } from '../schemas/database.schema';
import type { Id } from '../types/common.types';
import { log } from '../lib/log';

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
        );
      return result;
    } catch (error: unknown) {
      console.error('IntentDatabaseAdapter.getActiveIntents error:', error);
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
      console.error('IntentDatabaseAdapter.createIntent error:', error);
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
      console.error('IntentDatabaseAdapter.updateIntent error:', error);
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
      console.error('IntentDatabaseAdapter.archiveIntent error:', error);
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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
      console.error('IntentDatabaseAdapter.getIntentsInIndexForMember error:', error);
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
    if (options.sourceType) {
      conditions.push(eq(schema.intents.sourceType, options.sourceType as any));
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
        );
      return result;
    } catch (error: unknown) {
      console.error('ChatDatabaseAdapter.getActiveIntents error:', error);
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
      console.error('ChatDatabaseAdapter.getIntentsInIndexForMember error:', error);
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
    data: { name?: string; location?: string; socials?: { x?: string; linkedin?: string; github?: string; websites?: string[] } }
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
      console.error('ChatDatabaseAdapter.createIntent error:', error);
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
      console.error('ChatDatabaseAdapter.updateIntent error:', error);
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
      console.error('ChatDatabaseAdapter.archiveIntent error:', error);
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
            isNull(schema.indexes.deletedAt)
          )
        );
      return result;
    } catch (error: unknown) {
      console.error('ChatDatabaseAdapter.getIndexMemberships error:', error);
      return [];
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
        permissions: schema.indexes.permissions,
        isPersonal: schema.indexes.isPersonal,
        createdAt: schema.indexes.createdAt,
        updatedAt: schema.indexes.updatedAt,
        ownerId: schema.indexMembers.userId,
        userName: schema.users.name,
        userAvatar: schema.users.avatar,
      })
      .from(schema.indexes)
      .innerJoin(
        schema.indexMembers,
        and(
          eq(schema.indexes.id, schema.indexMembers.indexId),
          sql`'owner' = ANY(${schema.indexMembers.permissions})`
        )
      )
      .innerJoin(schema.users, eq(schema.indexMembers.userId, schema.users.id))
      .where(
        and(
          isNull(schema.indexes.deletedAt),
          inArray(schema.indexes.id, ids)
        )
      )
      .orderBy(desc(schema.indexes.isPersonal), desc(schema.indexes.createdAt));

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
          permissions: row.permissions,
          isPersonal: row.isPersonal,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          user: {
            id: row.ownerId,
            name: row.userName,
            avatar: row.userAvatar,
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
      eq(schema.indexes.isPersonal, false)
    ];
    
    if (excludeIds.length > 0) {
      whereConditions.push(notInArray(schema.indexes.id, excludeIds));
    }

    const publicIndexes = await db
      .select({
        id: schema.indexes.id,
        title: schema.indexes.title,
        prompt: schema.indexes.prompt,
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
        createdAt: row.createdAt,
        permissions: row.permissions,
        memberCount: Number(countResult?.count ?? 0),
        user: ownerMember ? {
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
      console.error('ChatDatabaseAdapter.getUserIndexIds error:', error);
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
    data: { title?: string; prompt?: string | null; joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean }
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
    joinPolicy?: 'anyone' | 'invite_only';
  }): Promise<{
    id: string;
    title: string;
    prompt: string | null;
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
        permissions,
      })
      .returning({
        id: indexes.id,
        title: indexes.title,
        prompt: indexes.prompt,
        permissions: indexes.permissions,
      });
    if (!row) throw new Error('Failed to create index');
    const perms = (row.permissions as { joinPolicy: string; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean }) ?? {};
    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
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
    const logger = log.lib.from('database.adapter');
    const existing = await db
      .select()
      .from(indexMembers)
      .where(and(eq(indexMembers.indexId, indexId), eq(indexMembers.userId, userId)))
      .limit(1);
    if (existing.length > 0) {
      return { success: true, alreadyMember: true };
    }
    let memberPrompt: string | null = null;
    const [indexRow] = await db.select({ prompt: indexes.prompt }).from(indexes).where(eq(indexes.id, indexId)).limit(1);
    if (indexRow) memberPrompt = indexRow.prompt;

    const finalPermissions = role === 'owner' ? ['owner'] : role === 'admin' ? ['admin', 'member'] : ['member'];
    await db.insert(indexMembers).values({
      indexId,
      userId,
      permissions: finalPermissions,
      prompt: memberPrompt,
      autoAssign: true,
    });

    // TODO: Events system removed - need to implement alternative notification mechanism
    // for triggering member indexing when settings are updated

    return { success: true, alreadyMember: false };
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
  async getIndexDetail(indexId: string, requestingUserId: string) {
    const rows = await db
      .select({
        id: indexes.id,
        title: indexes.title,
        prompt: indexes.prompt,
        permissions: indexes.permissions,
        isPersonal: indexes.isPersonal,
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
      permissions: row.permissions,
      isPersonal: row.isPersonal,
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

    // Find the user's personal index
    const [personalIndex] = await db
      .select({ indexId: indexMembers.indexId })
      .from(indexMembers)
      .innerJoin(indexes, eq(indexMembers.indexId, indexes.id))
      .where(
        and(
          eq(indexMembers.userId, userId),
          eq(indexes.isPersonal, true),
          isNull(indexes.deletedAt)
        )
      )
      .limit(1);

    if (!personalIndex) return [];

    // Members of the personal index
    const personalMemberIds = db
      .select({ userId: indexMembers.userId })
      .from(indexMembers)
      .where(eq(indexMembers.indexId, personalIndex.indexId));

    const pattern = `%${query.trim()}%`;
    const conditions = [
      isNull(users.deletedAt),
      inArray(users.id, personalMemberIds),
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
    options?: { status?: string; indexId?: string; role?: string; limit?: number; offset?: number }
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
    status: 'latent' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired'
  ): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.updateOpportunityStatus(id, status);
  }
  async opportunityExistsBetweenActors(actorIds: string[], indexId: string): Promise<boolean> {
    return this.opportunityAdapter.opportunityExistsBetweenActors(actorIds, indexId);
  }
  async findOverlappingOpportunities(
    actorUserIds: Id<'users'>[],
    options?: { excludeStatuses?: ('latent' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired')[] }
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
    data: { name?: string; location?: string; socials?: { x?: string; linkedin?: string; github?: string; websites?: string[] } }
  ): Promise<{ id: string; name: string; email: string; intro?: string | null; avatar?: string | null; location?: string | null; socials?: { x?: string; linkedin?: string; github?: string; websites?: string[] } | null } | null> {
    // Load current user to merge socials
    const current = await this.getUser(userId);
    if (!current) return null;

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };

    if (data.name !== undefined) updateFields.name = data.name;
    if (data.location !== undefined) updateFields.location = data.location;

    if (data.socials) {
      // Merge with existing socials instead of overwriting
      const existingSocials = (current as any).socials ?? {};
      const merged = { ...existingSocials };
      if (data.socials.x !== undefined) merged.x = data.socials.x;
      if (data.socials.linkedin !== undefined) merged.linkedin = data.socials.linkedin;
      if (data.socials.github !== undefined) merged.github = data.socials.github;
      if (data.socials.websites !== undefined) merged.websites = data.socials.websites;
      updateFields.socials = merged;
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
  status: 'latent' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
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
  status?: 'latent' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired';
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
    options?: { status?: string; indexId?: string; role?: string; limit?: number; offset?: number }
  ): Promise<OpportunityRow[]> {
    // Role-based visibility: who can see depends on actor role and status (and whether introducer exists)
    const visibilityGuard = sql`(
      ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'introducer' }])}::jsonb
      OR ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'peer' }])}::jsonb
      OR (
        ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'patient' }])}::jsonb
        AND (${opportunities.status} != 'latent' OR NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
      )
      OR (
        ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'agent' }])}::jsonb
        AND (
          ${opportunities.status} IN ('accepted', 'rejected', 'expired')
          OR (${opportunities.status} != 'latent' AND NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
        )
      )
      OR (
        ${opportunities.actors} @> ${JSON.stringify([{ userId, role: 'party' }])}::jsonb
        AND (${opportunities.status} != 'latent' OR NOT (${opportunities.actors} @> '[{"role":"introducer"}]'::jsonb))
      )
    )`;
    const conditions = [visibilityGuard];
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
    status: 'latent' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired'
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

  async findOverlappingOpportunities(
    actorUserIds: Id<'users'>[],
    options?: { excludeStatuses?: ('latent' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired')[] }
  ): Promise<OpportunityRow[]> {
    if (actorUserIds.length === 0) return [];
    const mergedExcludeStatuses = [
      ...new Set([...(options?.excludeStatuses ?? [])]),
    ] as ('latent' | 'pending' | 'viewed' | 'accepted' | 'rejected' | 'expired')[];
    const statusCondition =
      mergedExcludeStatuses.length > 0
        ? notInArray(opportunities.status, mergedExcludeStatuses)
        : undefined;
    // Exact match: opportunity's set of non-introducer userIds must equal actorUserIds (same people only)
    const sortedActorUserIds = [...actorUserIds].sort();
    const overlapCondition = sql`(
      SELECT array_agg(uid ORDER BY uid)
      FROM (
        SELECT elem->>'userId' AS uid
        FROM jsonb_array_elements(${opportunities.actors}) AS elem
        WHERE elem->>'role' IS DISTINCT FROM 'introducer' AND elem->>'userId' IS NOT NULL AND elem->>'userId' != ''
      ) sub
    ) = ARRAY[${sql.join(sortedActorUserIds.map((uid) => sql`${uid}`), sql`, `)}]::text[]`;
    const rows = await db
      .select()
      .from(opportunities)
      .where(statusCondition ? and(statusCondition, overlapCondition) : overlapCondition)
      .orderBy(desc(opportunities.updatedAt));
    const result = rows.map(toOpportunityRow);
    return result;
  }

  async expireOpportunitiesByIntent(intentId: string): Promise<number> {
    const rows = await db
      .select({ id: opportunities.id })
      .from(opportunities)
      .where(
        sql`${opportunities.actors} @> ${JSON.stringify([{ intent: intentId }])}::jsonb`
      );
    if (rows.length === 0) return 0;
    const ids = rows.map((r) => r.id);
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

export interface UserWithGraph {
  id: string;
  email: string | null;
  name: string | null;
  privyId: string;
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

export interface NewsletterUserData {
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

export interface BasicUserInfo {
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
   * Find user by Privy ID
   */
  async findByPrivyId(privyId: string): Promise<typeof users.$inferSelect | null> {
    const result = await db.select()
      .from(users)
      .where(eq(users.privyId, privyId))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Find user by email (for test setup/teardown).
   */
  async findByEmail(email: string): Promise<typeof users.$inferSelect | null> {
    const result = await db.select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Create a user (for test setup).
   */
  async create(data: {
    email: string;
    name?: string;
    privyId: string;
    intro?: string;
    location?: string;
    socials?: Record<string, string>;
  }): Promise<typeof users.$inferSelect> {
    const [row] = await db.insert(users)
      .values({
        email: data.email,
        name: data.name ?? data.email.split('@')[0],
        privyId: data.privyId,
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

export interface FileRow {
  id: string;
  name: string;
  type: string;
  size: bigint;
  createdAt: Date;
  userId: string | null;
}

export interface FileMetadata {
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

export interface FileListResult {
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
