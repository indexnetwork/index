/**
 * Database adapters used by controllers and queues.
 * Postgres implementations; no dependency on lib/protocol.
 */

import { eq, and, or, isNull, isNotNull, sql, count, desc, gt, lt, lte, ne, inArray, ilike, notInArray, asc, not } from 'drizzle-orm';


import * as schema from '../schemas/database.schema';
import db from '../lib/drizzle/drizzle';
import type { User, NotificationPreferences, OnboardingState, TelegramPrefs } from '../schemas/database.schema';
import type {
  Conversation,
  ConversationParticipant,
  Message,
  Task,
  Artifact,
} from '../schemas/conversation.schema';
import type { Id } from '../types/common.types';
import { log } from '../lib/log';
import { NetworkMembershipEvents } from '../events/network_membership.event';
const logger = log.lib.from('database.adapter');

function detectSocialLabel(value: string): string {
  const lower = value.toLowerCase();
  if (lower.includes('linkedin.com')) return 'linkedin';
  if (lower.includes('x.com') || lower.includes('twitter.com')) return 'twitter';
  if (lower.includes('github.com')) return 'github';
  if (lower.includes('t.me') || lower.includes('telegram.me')) return 'telegram';
  return 'custom';
}

/** Sentinel participant ID for the built-in chat agent. */
export const SYSTEM_AGENT_ID = 'system-agent';

/**
 * Creates a personal index for the user if one doesn't exist.
 * Adds the user as the owner member.
 * @param userId - The user to create a personal index for
 * @returns The personal index ID
 */
export async function ensurePersonalNetwork(userId: string): Promise<string> {
  // Fast path: check mapping table
  const existing = await db
    .select({ networkId: schema.personalNetworks.networkId })
    .from(schema.personalNetworks)
    .where(eq(schema.personalNetworks.userId, userId))
    .limit(1);

  if (existing.length > 0) return existing[0].networkId;

  const networkId = crypto.randomUUID();

  await db.insert(schema.networks).values({
    id: networkId,
    title: 'My Network',
    prompt: 'Personal index containing the owner\'s imported contacts for network-scoped discovery.',
    isPersonal: true,
  }).onConflictDoNothing();

  await db.insert(schema.personalNetworks).values({
    userId,
    networkId,
  }).onConflictDoNothing();

  await db.insert(schema.networkMembers).values({
    networkId,
    userId,
    permissions: ['owner'],
    autoAssign: true,
  }).onConflictDoNothing();

  // Re-query to return the actual persisted ID (handles race with concurrent calls)
  const persisted = await db
    .select({ networkId: schema.personalNetworks.networkId })
    .from(schema.personalNetworks)
    .where(eq(schema.personalNetworks.userId, userId))
    .limit(1);

  return persisted[0]?.networkId ?? networkId;
}

/**
 * Returns the personal index ID for a user.
 * @param userId - The user to look up
 * @returns The personal index ID, or null if not found
 */
export async function getPersonalIndexId(userId: string): Promise<string | null> {
  const result = await db
    .select({ networkId: schema.personalNetworks.networkId })
    .from(schema.personalNetworks)
    .where(eq(schema.personalNetworks.userId, userId))
    .limit(1);

  return result[0]?.networkId ?? null;
}

// Local types used by adapters (shapes only; protocol layer defines the contracts)
interface ActiveIntentRow {
  id: string;
  payload: string;
  summary: string | null;
  createdAt: Date;
  relevancyScore?: number | null;
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
  felicityClarity?: number | null;
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
  felicityClarity?: number | null;
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
  status: string | null;
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

interface NetworkMembershipRow {
  networkId: string;
  networkTitle: string;
  indexPrompt: string | null;
  permissions: string[];
  memberPrompt: string | null;
  autoAssign: boolean;
  isPersonal: boolean;
  joinedAt: Date;
}

const { intents, networks, networkMembers, intentNetworks, users, hydeDocuments, opportunities, userNotificationSettings, userProfiles, files, links, sessions, userSocials } = schema;

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
          felicityClarity: data.felicityClarity ?? undefined,
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
      if (data.felicityClarity !== undefined) updateData.felicityClarity = data.felicityClarity;
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
    await db.delete(schema.intentNetworks)
      .where(eq(schema.intentNetworks.intentId, intentId));
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
    let networkId: string | null;

    if (uuidRegex.test(indexNameOrId.trim())) {
      const membership = await db
        .select({ networkId: schema.networkMembers.networkId })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            eq(schema.networkMembers.networkId, indexNameOrId.trim()),
            isNull(schema.networks.deletedAt)
          )
        )
        .limit(1);
      networkId = membership[0]?.networkId ?? null;
    } else {
      const memberships = await db
        .select({
          networkId: schema.networkMembers.networkId,
          networkTitle: schema.networks.title,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            isNull(schema.networks.deletedAt)
          )
        );
      const needle = indexNameOrId.trim().toLowerCase();
      const match = memberships.find(
        (m) => (m.networkTitle ?? '').toLowerCase() === needle || (m.networkTitle ?? '').toLowerCase().includes(needle)
      );
      networkId = match?.networkId ?? null;
    }

    if (!networkId) {
      return [];
    }

    try {
      const result = await db
        .select({
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          createdAt: schema.intents.createdAt,
          relevancyScore: schema.intentNetworks.relevancyScore,
        })
        .from(schema.intents)
        .innerJoin(schema.intentNetworks, eq(schema.intents.id, schema.intentNetworks.intentId))
        .where(
          and(
            eq(schema.intentNetworks.networkId, networkId),
            eq(schema.intents.userId, userId),
            isNull(schema.intents.archivedAt)
          )
        );
      return result.map((r) => ({
        id: r.id,
        payload: r.payload,
        summary: r.summary,
        createdAt: r.createdAt,
        relevancyScore: r.relevancyScore != null ? Number(r.relevancyScore) : null,
      }));
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
        status: schema.intents.status,
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
      status: schema.intents.status,
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

  /**
   * Resolve an intent ID from a full UUID or short prefix.
   * @param idOrPrefix - Full UUID or prefix (e.g. first 8 chars)
   * @param userId - The owning user's ID (for ownership scoping)
   * @returns Object with resolved id, or null/ambiguous status
   */
  async resolveIntentId(idOrPrefix: string, userId: string): Promise<{ id: string } | { ambiguous: true } | null> {
    const normalized = idOrPrefix.trim().toLowerCase();
    const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized);
    if (isFullUuid) {
      return { id: normalized };
    }
    const rows = await db.select({ id: schema.intents.id })
      .from(schema.intents)
      .where(and(
        sql`${schema.intents.id} LIKE ${normalized + '%'}`,
        eq(schema.intents.userId, userId),
      ))
      .limit(2);
    if (rows.length === 0) return null;
    if (rows.length > 1) return { ambiguous: true };
    return { id: rows[0].id };
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
   * @param networkId - The index identifier.
   * @returns Promise that resolves when the row is inserted.
   * @throws May throw on database insertion errors (db.insert/schema.intentNetworks).
   */
  async assignIntentToNetwork(intentId: string, networkId: string, relevancyScore?: number): Promise<void> {
    await db.insert(schema.intentNetworks)
      .values({ intentId, networkId, relevancyScore: relevancyScore != null ? String(relevancyScore) : null })
      .onConflictDoUpdate({
        target: [schema.intentNetworks.intentId, schema.intentNetworks.networkId],
        set: { relevancyScore: relevancyScore != null ? String(relevancyScore) : null },
      });
  }

  /**
   * Returns personal index IDs where the given user is a contact member.
   * @param userId - The user whose contact memberships to look up
   * @returns Array of personal index IDs
   */
  async getPersonalIndexesForContact(userId: string): Promise<{ networkId: string }[]> {
    return db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .innerJoin(schema.networks, eq(schema.networks.id, schema.networkMembers.networkId))
      .where(
        and(
          eq(schema.networkMembers.userId, userId),
          eq(schema.networks.isPersonal, true),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        )
      );
  }

  /**
   * Delete all intents for a user (for test teardown).
   */
  async deleteByUserId(userId: string): Promise<void> {
    const userIntentIds = db
      .select({ id: schema.intents.id })
      .from(schema.intents)
      .where(eq(schema.intents.userId, userId));
    await db.delete(schema.intentNetworks).where(inArray(schema.intentNetworks.intentId, userIntentIds));
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
    const socialRows = await db.select()
      .from(schema.userSocials)
      .where(eq(schema.userSocials.userId, userId));
    return {
      id: user.id,
      name: user.name ?? '',
      email: user.email ?? '',
      intro: user.intro ?? null,
      avatar: user.avatar ?? null,
      location: user.location ?? null,
      socials: socialRows.map(s => ({ id: s.id, userId: s.userId, label: s.label, value: s.value })),
      onboarding: user.onboarding ?? null,
      isGhost: user.isGhost ?? false,
      deletedAt: user.deletedAt ?? null,
    };
  }

  async isNetworkMember(networkId: string, userId: string): Promise<boolean> {
    const result = await db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
      .where(
        and(
          eq(schema.networkMembers.networkId, networkId),
          eq(schema.networkMembers.userId, userId),
          isNull(schema.networks.deletedAt),
          sql`${schema.networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`
        )
      )
      .limit(1);
    return result.length > 0;
  }

  async getNetworkIntentsForMember(
    networkId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const isMember = await this.isNetworkMember(networkId, requestingUserId);
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
        relevancyScore: schema.intentNetworks.relevancyScore,
      })
      .from(schema.intents)
      .innerJoin(schema.intentNetworks, eq(schema.intents.id, schema.intentNetworks.intentId))
      .leftJoin(schema.users, eq(schema.intents.userId, schema.users.id))
      .where(
        and(
          eq(schema.intentNetworks.networkId, networkId),
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
      relevancyScore: r.relevancyScore != null ? Number(r.relevancyScore) : null,
    }));
  }

  async getActiveIntentsAcrossIndexes(userId: string, indexIds: string[]) {
    try {
      if (indexIds.length === 0) return [];

      const rows = await db
        .selectDistinctOn([schema.intents.id], {
          id: schema.intents.id,
          payload: schema.intents.payload,
          summary: schema.intents.summary,
          createdAt: schema.intents.createdAt,
        })
        .from(schema.intents)
        .innerJoin(schema.intentNetworks, eq(schema.intentNetworks.intentId, schema.intents.id))
        .where(
          and(
            eq(schema.intents.userId, userId),
            isNull(schema.intents.archivedAt),
            inArray(schema.intentNetworks.networkId, indexIds),
          ),
        )
        .orderBy(schema.intents.id, desc(schema.intents.createdAt));

      return rows;
    } catch (error: unknown) {
      logger.error('IntentDatabaseAdapter.getActiveIntentsAcrossIndexes error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Chat Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

// Chat Session and Message interfaces — exported so the unified ConversationService can use them.
export interface ChatSession {
  id: string;
  userId: string;
  title: string | null;
  networkId: string | null;
  shareToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  routingDecision: Record<string, unknown> | null;
  subgraphResults: Record<string, unknown> | null;
  tokenCount: number | null;
  createdAt: Date;
}

/** Shape stored inside conversation_metadata.metadata for agent-chat sessions. */
export interface ChatConversationMeta {
  title?: string | null;
  networkId?: string | null;
  shareToken?: string | null;
  ghostInviteSent?: boolean;
  [key: string]: unknown;
}

/** Shape stored inside messages.metadata for agent-chat messages. */
export interface ChatMessageMeta {
  routingDecision?: Record<string, unknown> | null;
  subgraphResults?: Record<string, unknown> | null;
  tokenCount?: number | null;
  traceEvents?: unknown;
  debugMeta?: unknown;
  /**
   * Orchestrator-driven draft opportunities streamed back via
   * `opportunity_draft_ready` events during the response. Persisted so the
   * rendered chat cards survive session reload — the frontend rehydrates
   * these into message.streamingDrafts on loadSession.
   */
  streamingDrafts?: unknown;
  [key: string]: unknown;
}

export interface CreateSessionInput {
  id: string;
  userId: string;
  title?: string;
  networkId?: string;
}

export interface CreateMessageInput {
  id: string;
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  routingDecision?: Record<string, unknown>;
  subgraphResults?: Record<string, unknown>;
  tokenCount?: number;
}

/**
 * Lazy getter for the ConversationDatabaseAdapter singleton.
 * Avoids circular reference since conversationDatabaseAdapter is instantiated after chatDatabaseAdapter.
 */
let _convDbInstance: ConversationDatabaseAdapter | null = null;
function _convDb(): ConversationDatabaseAdapter {
  if (!_convDbInstance) _convDbInstance = new ConversationDatabaseAdapter();
  return _convDbInstance;
}

/**
 * Database adapter for Chat Graph and its subgraphs.
 * Session/message methods delegate to ConversationDatabaseAdapter (unified adapter).
 */
export class ChatDatabaseAdapter {
  private readonly hydeAdapter = new HydeDatabaseAdapter();
  private _opportunityAdapter: OpportunityDatabaseAdapter | null = null;
  private get opportunityAdapter(): OpportunityDatabaseAdapter {
    if (!this._opportunityAdapter) this._opportunityAdapter = new OpportunityDatabaseAdapter();
    return this._opportunityAdapter;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Chat Session Methods — delegated to ConversationDatabaseAdapter
  // (kept for backward compatibility; new code should use conversationDatabaseAdapter directly)
  // ─────────────────────────────────────────────────────────────────────────────

  /** @deprecated Use conversationDatabaseAdapter.createChatSession */
  async createSession(data: CreateSessionInput): Promise<void> { return _convDb().createChatSession(data); }
  /** @deprecated Use conversationDatabaseAdapter.getChatSession */
  async getSession(sessionId: string): Promise<ChatSession | null> { return _convDb().getChatSession(sessionId); }
  /** @deprecated Use conversationDatabaseAdapter.getUserChatSessions */
  async getUserSessions(userId: string, limit: number): Promise<ChatSession[]> { return _convDb().getUserChatSessions(userId, limit); }
  /** @deprecated Use conversationDatabaseAdapter.updateChatSessionIndex */
  async updateSessionIndex(sessionId: string, networkId: string | null): Promise<void> { return _convDb().updateChatSessionIndex(sessionId, networkId); }
  /** @deprecated Use conversationDatabaseAdapter.updateChatSessionTitle */
  async updateSessionTitle(sessionId: string, title: string): Promise<void> { return _convDb().updateChatSessionTitle(sessionId, title); }
  /** @deprecated Use conversationDatabaseAdapter.updateChatSessionTimestamp */
  async updateSessionTimestamp(sessionId: string): Promise<void> { return _convDb().updateChatSessionTimestamp(sessionId); }
  /** @deprecated Use conversationDatabaseAdapter.deleteChatSession */
  async deleteSession(sessionId: string): Promise<void> { return _convDb().deleteChatSession(sessionId); }
  /** @deprecated Use conversationDatabaseAdapter.setChatShareToken */
  async setShareToken(sessionId: string, token: string | null): Promise<void> { return _convDb().setChatShareToken(sessionId, token); }
  /** @deprecated Use conversationDatabaseAdapter.getChatSessionByShareToken */
  async getSessionByShareToken(token: string): Promise<ChatSession | null> { return _convDb().getChatSessionByShareToken(token); }
  /** @deprecated Use conversationDatabaseAdapter.createChatMessage */
  async createMessage(data: CreateMessageInput): Promise<void> { return _convDb().createChatMessage(data); }
  /** @deprecated Use conversationDatabaseAdapter.getChatSessionMessages */
  async getSessionMessages(sessionId: string, limit?: number): Promise<ChatMessage[]> { return _convDb().getChatSessionMessages(sessionId, limit); }
  /** @deprecated Use conversationDatabaseAdapter.verifyChatMessageOwnership */
  async verifyMessageOwnership(messageId: string, userId: string): Promise<boolean> { return _convDb().verifyChatMessageOwnership(messageId, userId); }
  /** @deprecated Use conversationDatabaseAdapter.upsertChatMessageMetadata */
  async upsertMessageMetadata(params: { id: string; messageId: string; traceEvents?: unknown; debugMeta?: unknown; streamingDrafts?: unknown }): Promise<void> { return _convDb().upsertChatMessageMetadata(params); }
  /** @deprecated Use conversationDatabaseAdapter.getChatMessageMetadataByIds */
  async getMessageMetadataByMessageIds(messageIds: string[]): Promise<Array<{ id: string; messageId: string; traceEvents: unknown; debugMeta: unknown; streamingDrafts: unknown; createdAt: Date }>> { return _convDb().getChatMessageMetadataByIds(messageIds); }
  /** @deprecated Use conversationDatabaseAdapter.upsertChatSessionMetadata */
  async upsertSessionMetadata(params: { id: string; sessionId: string; metadata: unknown }): Promise<void> { return _convDb().upsertChatSessionMetadata(params); }
  /** @deprecated Use conversationDatabaseAdapter.getChatSessionMetadata */
  async getSessionMetadata(sessionId: string): Promise<{ id: string; sessionId: string; metadata: unknown; createdAt: Date; updatedAt: Date } | undefined> { return _convDb().getChatSessionMetadata(sessionId); }

  // Negotiation context methods — required by HomeGraphDatabase
  async getNegotiationTaskForOpportunity(opportunityId: string) { return _convDb().getNegotiationTaskForOpportunity(opportunityId); }
  async getMessagesForConversation(conversationId: string) { return _convDb().getMessagesForConversation(conversationId); }
  async getArtifactsForTask(taskId: string) { return _convDb().getArtifactsForTask(taskId); }

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

  async searchOwnIntents(
    userId: string,
    q: string,
    limit: number,
  ): Promise<Array<{ id: string; payload: string; summary: string | null; createdAt: Date }>> {
    const pattern = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    return db
      .select({
        id: schema.intents.id,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        createdAt: schema.intents.createdAt,
      })
      .from(schema.intents)
      .where(
        and(
          eq(schema.intents.userId, userId),
          isNull(schema.intents.archivedAt),
          or(ilike(schema.intents.payload, pattern), ilike(schema.intents.summary, pattern)),
        ),
      )
      .orderBy(desc(schema.intents.createdAt))
      .limit(limit);
  }

  async getIntentsInIndexForMember(userId: string, indexNameOrId: string): Promise<ActiveIntentRow[]> {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    let networkId: string | null;

    if (uuidRegex.test(indexNameOrId.trim())) {
      const membership = await db
        .select({ networkId: schema.networkMembers.networkId })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            eq(schema.networkMembers.networkId, indexNameOrId.trim()),
            isNull(schema.networks.deletedAt)
          )
        )
        .limit(1);
      networkId = membership[0]?.networkId ?? null;
    } else {
      const memberships = await db
        .select({
          networkId: schema.networkMembers.networkId,
          networkTitle: schema.networks.title,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            isNull(schema.networks.deletedAt)
          )
        );
      const needle = indexNameOrId.trim().toLowerCase();
      const match = memberships.find(
        (m) => (m.networkTitle ?? '').toLowerCase() === needle || (m.networkTitle ?? '').toLowerCase().includes(needle)
      );
      networkId = match?.networkId ?? null;
    }

    if (!networkId) {
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
        .innerJoin(schema.intentNetworks, eq(schema.intents.id, schema.intentNetworks.intentId))
        .where(
          and(
            eq(schema.intentNetworks.networkId, networkId),
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

  async getUser(userId: string) {
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.getUser(userId);
  }

  async updateUser(
    userId: string,
    data: { name?: string; intro?: string; location?: string; onboarding?: OnboardingState }
  ) {
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.updateUser(userId, data);
  }

  async getUserSocials(userId: string) {
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.getUserSocials(userId);
  }

  async setUserSocials(userId: string, socials: { label: string; value: string }[]) {
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.setUserSocials(userId, socials);
  }

  async saveProfile(userId: string, profile: ProfileRow): Promise<void> {
    const emb = profile.embedding ?? null;
    const data = {
      userId,
      identity: profile.identity,
      narrative: profile.narrative,
      attributes: profile.attributes,
      embedding: emb === null
        ? null
        : (Array.isArray(emb[0])
          ? (emb as number[][])[0]
          : (emb as number[])),
      updatedAt: new Date(),
    };
    await db.insert(schema.userProfiles)
      .values(data)
      .onConflictDoUpdate({
        target: schema.userProfiles.userId,
        set: data,
      });
  }

  /**
   * Soft-delete a ghost user and all their contact memberships.
   * Delegates to ProfileDatabaseAdapter.
   * @param userId - The ghost user to soft-delete
   * @returns true if the user was soft-deleted
   */
  async softDeleteGhost(userId: string): Promise<boolean> {
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.softDeleteGhost(userId);
  }

  /**
   * Find an existing user that shares any of the given social handles with the specified ghost.
   * Delegates to ProfileDatabaseAdapter.
   * @param userId - The ghost user ID to exclude from results
   * @param socials - Social handles to match against
   * @returns The matching user's ID, or null if no match found
   */
  async findDuplicateUser(
    userId: string,
    socials: Array<{ id: string; userId: string; label: string; value: string }>,
  ): Promise<{ id: string } | null> {
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.findDuplicateUser(userId, socials);
  }

  /**
   * Merge a ghost user (source) into a target user.
   * Re-points all data from source to target, cleans up ghost-only records, and soft-deletes source.
   * Delegates to ProfileDatabaseAdapter.
   * @param sourceId - The ghost user to merge away (must be an active ghost)
   * @param targetId - The user to merge into
   */
  async mergeGhostUser(sourceId: string, targetId: string): Promise<void> {
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.mergeGhostUser(sourceId, targetId);
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
          felicityClarity: data.felicityClarity ?? undefined,
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
      if (data.felicityClarity !== undefined) updateData.felicityClarity = data.felicityClarity;
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

  async getNetworkMemberships(userId: string): Promise<NetworkMembershipRow[]> {
    try {
      const result = await db
        .select({
          networkId: schema.networkMembers.networkId,
          networkTitle: schema.networks.title,
          indexPrompt: schema.networks.prompt,
          permissions: schema.networkMembers.permissions,
          memberPrompt: schema.networkMembers.prompt,
          autoAssign: schema.networkMembers.autoAssign,
          isPersonal: schema.networks.isPersonal,
          joinedAt: schema.networkMembers.createdAt,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .leftJoin(schema.personalNetworks, eq(schema.networks.id, schema.personalNetworks.networkId))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            isNull(schema.networks.deletedAt),
            or(
              eq(schema.networks.isPersonal, false),
              and(
                eq(schema.networks.isPersonal, true),
                eq(schema.personalNetworks.userId, userId),
              )
            ),
          )
        );
      return result;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getNetworkMemberships error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async getNetworkMembership(networkId: string, userId: string): Promise<NetworkMembershipRow | null> {
    try {
      const result = await db
        .select({
          networkId: schema.networkMembers.networkId,
          networkTitle: schema.networks.title,
          indexPrompt: schema.networks.prompt,
          permissions: schema.networkMembers.permissions,
          memberPrompt: schema.networkMembers.prompt,
          autoAssign: schema.networkMembers.autoAssign,
          isPersonal: schema.networks.isPersonal,
          joinedAt: schema.networkMembers.createdAt,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.networkMembers.networkId, networkId),
            eq(schema.networkMembers.userId, userId),
            isNull(schema.networks.deletedAt)
          )
        )
        .limit(1);
      return result[0] ?? null;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getNetworkMembership error', { error: error instanceof Error ? error.message : String(error) });
      return null;
    }
  }

  async getNetwork(networkId: string): Promise<{
    id: string;
    title: string;
    prompt?: string | null;
    type?: string;
    metadata?: Record<string, unknown> | null;
    permissions?: Record<string, unknown> | null;
  } | null> {
    const rows = await db
      .select({
        id: schema.networks.id,
        title: schema.networks.title,
        prompt: schema.networks.prompt,
        type: schema.networks.type,
        metadata: schema.networks.metadata,
        permissions: schema.networks.permissions,
      })
      .from(schema.networks)
      .where(and(eq(schema.networks.id, networkId), isNull(schema.networks.deletedAt)))
      .limit(1);
    const row = rows[0];
    return row ?? null;
  }

  /**
   * Check whether an index is a personal index.
   * @param networkId - The index to check
   * @returns true if the index has isPersonal = true
   */
  async isPersonalNetwork(networkId: string): Promise<boolean> {
    const rows = await db
      .select({ isPersonal: schema.networks.isPersonal })
      .from(schema.networks)
      .where(and(eq(schema.networks.id, networkId), isNull(schema.networks.deletedAt)))
      .limit(1);
    return rows[0]?.isPersonal === true;
  }

  async getNetworkWithPermissions(networkId: string): Promise<{ id: string; title: string; permissions: { joinPolicy: 'anyone' | 'invite_only' } } | null> {
    const rows = await db
      .select({ id: networks.id, title: networks.title, permissions: networks.permissions })
      .from(networks)
      .where(and(eq(networks.id, networkId), isNull(networks.deletedAt)))
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

  async getNetworksForUser(userId: string) {
    const memberIndexIds = await db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
      .where(
        and(
          eq(schema.networkMembers.userId, userId),
          isNull(schema.networks.deletedAt),
          sql`${schema.networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`
        )
      );

    const ids = [...new Set(memberIndexIds.map((r) => r.networkId))];
    if (ids.length === 0) {
      return {
        networks: [],
        pagination: { current: 1, total: 0, count: 0, totalCount: 0 },
      };
    }

    const ownerMembers = db
      .select({
        networkId: schema.networkMembers.networkId,
        userId: schema.networkMembers.userId,
      })
      .from(schema.networkMembers)
      .where(sql`'owner' = ANY(${schema.networkMembers.permissions})`)
      .as('owner_members');

    const rows = await db
      .select({
        id: schema.networks.id,
        title: schema.networks.title,
        key: schema.networks.key,
        prompt: schema.networks.prompt,
        imageUrl: schema.networks.imageUrl,
        permissions: schema.networks.permissions,
        isPersonal: schema.networks.isPersonal,
        isExperiment: schema.networks.isExperiment,
        ownerId: ownerMembers.userId,
        createdAt: schema.networks.createdAt,
        updatedAt: schema.networks.updatedAt,
        ownerName: schema.users.name,
        ownerAvatar: schema.users.avatar,
        type: schema.networks.type,
        metadata: schema.networks.metadata,
      })
      .from(schema.networks)
      .leftJoin(ownerMembers, eq(schema.networks.id, ownerMembers.networkId))
      .leftJoin(schema.users, eq(ownerMembers.userId, schema.users.id))
      .where(
        and(
          isNull(schema.networks.deletedAt),
          inArray(schema.networks.id, ids),
          // Only include personal indexes owned by the requesting user;
          // contacts in someone else's personal index must not see it.
          or(
            eq(schema.networks.isPersonal, false),
            eq(ownerMembers.userId, userId)
          ),
        )
      )
      .orderBy(desc(schema.networks.isPersonal), desc(schema.networks.createdAt));

    const indexesWithCounts = await Promise.all(
      rows.map(async (row) => {
        const [memberCount] = await db
          .select({ count: count() })
          .from(schema.networkMembers)
          .where(and(eq(schema.networkMembers.networkId, row.id), isNull(schema.networkMembers.deletedAt)));
        return {
          id: row.id,
          title: row.title,
          key: row.key,
          prompt: row.prompt,
          imageUrl: row.imageUrl,
          type: row.type ?? 'community',
          metadata: (row.metadata ?? {}) as Record<string, unknown>,
          permissions: row.permissions,
          isPersonal: row.isPersonal,
          isExperiment: row.isExperiment,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          user: {
            id: row.ownerId ?? '',
            name: row.ownerName ?? 'System',
            avatar: row.ownerAvatar ?? null,
          },
          _count: {
            members: Number(memberCount?.count ?? 0),
          },
        };
      })
    );

    const totalCount = indexesWithCounts.length;
    return {
      networks: indexesWithCounts,
      pagination: {
        current: 1,
        total: totalCount > 0 ? 1 : 0,
        count: totalCount,
        totalCount,
      },
    };
  }

  /**
   * Get non-personal indexes that both users share membership in.
   * Returns id, title, and member count for each shared index.
   */
  async getSharedNetworks(currentUserId: string, targetUserId: string): Promise<{ id: string; title: string; _count: { members: number } }[]> {
    const currentUserIndexIds = db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .where(eq(schema.networkMembers.userId, currentUserId));

    const targetUserIndexIds = db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .where(eq(schema.networkMembers.userId, targetUserId));

    const rows = await db
      .select({
        id: schema.networks.id,
        title: schema.networks.title,
        memberCount: count(schema.networkMembers.networkId),
      })
      .from(schema.networks)
      .innerJoin(schema.networkMembers, and(eq(schema.networks.id, schema.networkMembers.networkId), isNull(schema.networkMembers.deletedAt)))
      .where(
        and(
          isNull(schema.networks.deletedAt),
          eq(schema.networks.isPersonal, false),
          or(eq(schema.networks.isExperiment, false), isNull(schema.networks.isExperiment)),
          inArray(schema.networks.id, currentUserIndexIds),
          inArray(schema.networks.id, targetUserIndexIds),
        )
      )
      .groupBy(schema.networks.id, schema.networks.title);

    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      _count: { members: Number(row.memberCount) },
    }));
  }

  /**
   * Get public indexes that the user has not joined (for discovery).
   */
  async getPublicIndexesNotJoined(userId: string) {
    const userIndexIds = await db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .where(eq(schema.networkMembers.userId, userId));
    
    const excludeIds = userIndexIds.map(r => r.networkId);
    
    const whereConditions = [
      isNull(schema.networks.deletedAt),
      eq(schema.networks.isPersonal, false),
      or(eq(schema.networks.isExperiment, false), isNull(schema.networks.isExperiment)),
    ];

    if (excludeIds.length > 0) {
      whereConditions.push(notInArray(schema.networks.id, excludeIds));
    }

    const publicIndexes = await db
      .select({
        id: schema.networks.id,
        title: schema.networks.title,
        prompt: schema.networks.prompt,
        imageUrl: schema.networks.imageUrl,
        createdAt: schema.networks.createdAt,
        permissions: schema.networks.permissions,
      })
      .from(schema.networks)
      .where(and(...whereConditions))
      .orderBy(desc(schema.networks.createdAt));

    const result = [];
    for (const row of publicIndexes) {
      const perms = (row.permissions as { joinPolicy?: string } | null);
      if (perms?.joinPolicy !== 'anyone') continue;

      const [ownerMember] = await db
        .select({
          userId: schema.networkMembers.userId,
          userName: schema.users.name,
          userAvatar: schema.users.avatar,
        })
        .from(schema.networkMembers)
        .innerJoin(schema.users, eq(schema.networkMembers.userId, schema.users.id))
        .where(
          and(
            eq(schema.networkMembers.networkId, row.id),
            sql`'owner' = ANY(${schema.networkMembers.permissions})`
          )
        )
        .limit(1);

      const [countResult] = await db
        .select({ count: count() })
        .from(schema.networkMembers)
        .where(and(eq(schema.networkMembers.networkId, row.id), isNull(schema.networkMembers.deletedAt)));

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
      networks: result,
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
        .select({ networkId: schema.networkMembers.networkId })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, eq(schema.networkMembers.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.networkMembers.userId, userId),
            eq(schema.networkMembers.autoAssign, true),
            isNull(schema.networks.deletedAt)
          )
        );
      return result.map((r) => r.networkId);
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getUserIndexIds error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  /**
   * Returns the user's own personal network ID(s). Sourced from `personal_networks`
   * (PK on userId) rather than joining `network_members` × `isPersonal=true`, so
   * contact memberships on other users' personal indexes are excluded by
   * construction. Fail-soft (returns []) to match {@link getUserIndexIds} since
   * this runs in the HyDE worker path.
   */
  async getUserPersonalNetworkIds(userId: string): Promise<string[]> {
    try {
      const result = await db
        .select({ networkId: schema.personalNetworks.networkId })
        .from(schema.personalNetworks)
        .innerJoin(schema.networks, eq(schema.personalNetworks.networkId, schema.networks.id))
        .where(
          and(
            eq(schema.personalNetworks.userId, userId),
            isNull(schema.networks.deletedAt)
          )
        );
      return result.map((r) => r.networkId);
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getUserPersonalNetworkIds error', { error: error instanceof Error ? error.message : String(error) });
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
        status: intents.status,
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
      status: row.status,
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

  async getNetworkMemberContext(networkId: string, userId: string) {
    const rows = await db
      .select({
        networkId: networks.id,
        indexPrompt: networks.prompt,
        memberPrompt: networkMembers.prompt,
      })
      .from(networks)
      .innerJoin(networkMembers, eq(networks.id, networkMembers.networkId))
      .where(
        and(
          eq(networks.id, networkId),
          eq(networkMembers.userId, userId),
          eq(networkMembers.autoAssign, true),
          isNull(networks.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async isIntentAssignedToIndex(intentId: string, networkId: string): Promise<boolean> {
    const rows = await db
      .select({ networkId: intentNetworks.networkId })
      .from(intentNetworks)
      .where(
        and(
          eq(intentNetworks.intentId, intentId),
          eq(intentNetworks.networkId, networkId)
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async assignIntentToNetwork(intentId: string, networkId: string, relevancyScore?: number): Promise<void> {
    await db.insert(intentNetworks)
      .values({ intentId, networkId, relevancyScore: relevancyScore != null ? String(relevancyScore) : null })
      .onConflictDoUpdate({
        target: [intentNetworks.intentId, intentNetworks.networkId],
        set: { relevancyScore: relevancyScore != null ? String(relevancyScore) : null },
      });
  }

  async getIntentIndexScores(intentId: string): Promise<Array<{ networkId: string; relevancyScore: number | null }>> {
    const rows = await db
      .select({
        networkId: intentNetworks.networkId,
        relevancyScore: intentNetworks.relevancyScore,
      })
      .from(intentNetworks)
      .where(eq(intentNetworks.intentId, intentId));
    return rows.map(r => ({
      networkId: r.networkId,
      relevancyScore: r.relevancyScore != null ? Number(r.relevancyScore) : null,
    }));
  }

  async unassignIntentFromIndex(intentId: string, networkId: string): Promise<void> {
    await db
      .delete(intentNetworks)
      .where(
        and(
          eq(intentNetworks.intentId, intentId),
          eq(intentNetworks.networkId, networkId)
        )
      );
  }

  async getNetworkIdsForIntent(intentId: string): Promise<string[]> {
    const rows = await db
      .select({ networkId: intentNetworks.networkId })
      .from(intentNetworks)
      .where(eq(intentNetworks.intentId, intentId));
    return rows.map((r) => r.networkId);
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
        networkId: networkMembers.networkId,
        title: networks.title,
        prompt: networks.prompt,
        imageUrl: networks.imageUrl,
        permissions: networks.permissions,
        isPersonal: networks.isPersonal,
        createdAt: networks.createdAt,
        updatedAt: networks.updatedAt,
        ownerId: networkMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
      })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(
        and(
          eq(networkMembers.userId, userId),
          sql`'owner' = ANY(${networkMembers.permissions})`,
          isNull(networks.deletedAt)
        )
      );

    const result = await Promise.all(
      ownerRows.map(async (row) => {
        const [memberCountResult, intentCountResult] = await Promise.all([
          db.select({ count: count() }).from(networkMembers).where(and(eq(networkMembers.networkId, row.networkId), isNull(networkMembers.deletedAt))),
          db.select({ count: count() }).from(intentNetworks).where(eq(intentNetworks.networkId, row.networkId)),
        ]);
        const perms = row.permissions as { joinPolicy: string; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean } | null;
        const memberCount = Number(memberCountResult[0]?.count ?? 0);
        return {
          id: row.networkId,
          title: row.title,
          prompt: row.prompt,
          imageUrl: row.imageUrl,
          permissions: {
            joinPolicy: (perms?.joinPolicy ?? 'invite_only') as 'anyone' | 'invite_only',
            allowGuestVibeCheck: perms?.allowGuestVibeCheck ?? false,
            invitationLink: perms?.invitationLink ?? null,
          },
          isPersonal: row.isPersonal,
          createdAt: row.createdAt,
          updatedAt: row.updatedAt,
          memberCount,
          intentCount: Number(intentCountResult[0]?.count ?? 0),
          user: { id: row.ownerId, name: row.userName, avatar: row.userAvatar },
          _count: { members: memberCount },
        };
      })
    );
    return result;
  }

  async getNetworkMembersForMember(networkId: string, requestingUserId: string) {
    const isMember = await this.isNetworkMember(networkId, requestingUserId);
    if (!isMember) {
      throw new Error('Access denied: Not a member of this index');
    }

    const members = await db
      .select({
        userId: networkMembers.userId,
        name: users.name,
        avatar: users.avatar,
        permissions: networkMembers.permissions,
        memberPrompt: networkMembers.prompt,
        autoAssign: networkMembers.autoAssign,
        joinedAt: networkMembers.createdAt,
      })
      .from(networkMembers)
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(and(eq(networkMembers.networkId, networkId), isNull(networkMembers.deletedAt), isNull(users.deletedAt)));

    const [requestingUserEmailRow] = await db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, requestingUserId))
      .limit(1);

    const result = await Promise.all(
      members.map(async (m) => {
        const [intentCountRow] = await db
          .select({ count: count() })
          .from(intentNetworks)
          .innerJoin(intents, eq(intentNetworks.intentId, intents.id))
          .where(and(eq(intentNetworks.networkId, networkId), eq(intents.userId, m.userId), isNull(intents.archivedAt)));
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

  async isIndexOwner(networkId: string, userId: string): Promise<boolean> {
    const rows = await db
      .select({ userId: networkMembers.userId })
      .from(networkMembers)
      .where(
        and(
          eq(networkMembers.networkId, networkId),
          eq(networkMembers.userId, userId),
          sql`'owner' = ANY(${networkMembers.permissions})`
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async getNetworkMembersForOwner(networkId: string, requestingUserId: string) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this index');
    }

    const members = await db
      .select({
        userId: networkMembers.userId,
        name: users.name,
        avatar: users.avatar,
        intro: users.intro,
        email: users.email,
        isGhost: users.isGhost,
        permissions: networkMembers.permissions,
        memberPrompt: networkMembers.prompt,
        autoAssign: networkMembers.autoAssign,
        joinedAt: networkMembers.createdAt,
      })
      .from(networkMembers)
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(and(eq(networkMembers.networkId, networkId), isNull(networkMembers.deletedAt), isNull(users.deletedAt)));

    const memberUserIds = members.map((m) => m.userId);
    const intentCountRows = memberUserIds.length > 0
      ? await db
          .select({ userId: intents.userId, count: count() })
          .from(intentNetworks)
          .innerJoin(intents, eq(intentNetworks.intentId, intents.id))
          .where(and(eq(intentNetworks.networkId, networkId), inArray(intents.userId, memberUserIds), isNull(intents.archivedAt)))
          .groupBy(intents.userId)
      : [];
    const intentCountMap = new Map(intentCountRows.map((r) => [r.userId, Number(r.count)]));

    return members.map((m) => ({
      userId: m.userId,
      name: m.name,
      avatar: m.avatar,
      intro: m.intro ?? null,
      email: m.email,
      isGhost: m.isGhost ?? false,
      permissions: m.permissions ?? [],
      memberPrompt: m.memberPrompt,
      autoAssign: m.autoAssign,
      joinedAt: m.joinedAt,
      intentCount: intentCountMap.get(m.userId) ?? 0,
    }));
  }

  async getMembersFromUserIndexes(userId: Id<'users'>): Promise<{ userId: Id<'users'>; name: string; avatar: string | null }[]> {
    // Indexes the user is a member of (non-deleted)
    const myIndexRows = await db
      .select({ networkId: networkMembers.networkId })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(
        and(eq(networkMembers.userId, userId), isNull(networks.deletedAt))
      );
    const myIndexIds = myIndexRows.map((r) => r.networkId);
    if (myIndexIds.length === 0) return [];

    // All members from those indexes, joined with users; dedupe by userId
    const rows = await db
      .select({
        userId: networkMembers.userId,
        name: users.name,
        avatar: users.avatar,
      })
      .from(networkMembers)
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(
        and(
          inArray(networkMembers.networkId, myIndexIds),
          isNull(networks.deletedAt),
          isNull(users.deletedAt),
          isNull(networkMembers.deletedAt),
        )
      );

    const byId = new Map<Id<'users'>, { userId: Id<'users'>; name: string; avatar: string | null }>();
    for (const r of rows) {
      if (!byId.has(r.userId)) byId.set(r.userId, { userId: r.userId, name: r.name, avatar: r.avatar });
    }
    return Array.from(byId.values());
  }

  async getNetworkIntentsForOwner(
    networkId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
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
      .from(intentNetworks)
      .innerJoin(intents, eq(intentNetworks.intentId, intents.id))
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(eq(intentNetworks.networkId, networkId), isNull(intents.archivedAt)))
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

  async isNetworkMember(networkId: string, userId: string): Promise<boolean> {
    const rows = await db
      .select({ userId: networkMembers.userId })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(
        and(
          eq(networkMembers.networkId, networkId),
          eq(networkMembers.userId, userId),
          isNull(networks.deletedAt),
          sql`${networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async getMemberSettings(networkId: string, userId: string): Promise<{ permissions: string[]; isOwner: boolean } | null> {
    const rows = await db
      .select({ permissions: networkMembers.permissions })
      .from(networkMembers)
      .innerJoin(networks, eq(networkMembers.networkId, networks.id))
      .where(
        and(
          eq(networkMembers.networkId, networkId),
          eq(networkMembers.userId, userId),
          isNull(networks.deletedAt),
          sql`${networkMembers.permissions} && ARRAY['owner', 'member', 'admin']::text[]`
        )
      )
      .limit(1);

    if (rows.length === 0) return null;

    const permissions = rows[0]?.permissions || [];
    const isOwner = permissions.includes('owner');

    return { permissions, isOwner };
  }

  async getNetworkIntentsForMember(
    networkId: string,
    requestingUserId: string,
    options?: { limit?: number; offset?: number }
  ) {
    const isMember = await this.isNetworkMember(networkId, requestingUserId);
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
      .from(intentNetworks)
      .innerJoin(intents, eq(intentNetworks.intentId, intents.id))
      .innerJoin(users, eq(intents.userId, users.id))
      .where(and(eq(intentNetworks.networkId, networkId), isNull(intents.archivedAt)))
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

  async getActiveIntentsAcrossIndexes(userId: string, indexIds: string[]) {
    try {
      if (indexIds.length === 0) return [];

      const rows = await db
        .selectDistinctOn([intents.id], {
          id: intents.id,
          payload: intents.payload,
          summary: intents.summary,
          createdAt: intents.createdAt,
        })
        .from(intents)
        .innerJoin(intentNetworks, eq(intentNetworks.intentId, intents.id))
        .where(
          and(
            eq(intents.userId, userId),
            isNull(intents.archivedAt),
            inArray(intentNetworks.networkId, indexIds),
          ),
        )
        .orderBy(intents.id, desc(intents.createdAt));

      return rows;
    } catch (error: unknown) {
      logger.error('ChatDatabaseAdapter.getActiveIntentsAcrossIndexes error', { error: error instanceof Error ? error.message : String(error) });
      return [];
    }
  }

  async updateIndexSettings(
    networkId: string,
    requestingUserId: string,
    data: { title?: string; prompt?: string | null; imageUrl?: string | null; joinPolicy?: 'anyone' | 'invite_only'; allowGuestVibeCheck?: boolean; type?: 'community' | 'event'; metadata?: Record<string, unknown>; contextInjection?: { discovery: boolean } }
  ) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this index');
    }

    const [existing] = await db.select().from(networks).where(eq(networks.id, networkId)).limit(1);
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
    if (data.type !== undefined) updateData.type = data.type;
    if (data.metadata !== undefined) updateData.metadata = data.metadata;
    if (data.contextInjection !== undefined) {
      const currentPerms = (existing.permissions as Record<string, unknown>) ?? {};
      updateData.permissions = {
        ...((updateData.permissions as Record<string, unknown>) ?? currentPerms),
        contextInjection: data.contextInjection,
      };
    }

    await db.update(networks).set(updateData).where(eq(networks.id, networkId));

    const [updatedRow] = await db
      .select({
        id: networks.id,
        title: networks.title,
        prompt: networks.prompt,
        imageUrl: networks.imageUrl,
        permissions: networks.permissions,
        isPersonal: networks.isPersonal,
        createdAt: networks.createdAt,
        updatedAt: networks.updatedAt,
        ownerId: networkMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
        type: networks.type,
        metadata: networks.metadata,
      })
      .from(networks)
      .innerJoin(
        networkMembers,
        and(
          eq(networks.id, networkMembers.networkId),
          sql`'owner' = ANY(${networkMembers.permissions})`
        )
      )
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(eq(networks.id, networkId))
      .limit(1);

    if (!updatedRow) {
      throw new Error('Index not found after update');
    }
    const [memberCountResult, intentCountResult] = await Promise.all([
      db.select({ count: count() }).from(networkMembers).where(and(eq(networkMembers.networkId, networkId), isNull(networkMembers.deletedAt))),
      db.select({ count: count() }).from(intentNetworks).where(eq(intentNetworks.networkId, networkId)),
    ]);
    const perms = (updatedRow.permissions as { joinPolicy: string; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean; contextInjection?: { discovery: boolean } }) ?? {};
    const memberCount = Number(memberCountResult[0]?.count ?? 0);
    return {
      id: updatedRow.id,
      title: updatedRow.title,
      prompt: updatedRow.prompt,
      imageUrl: updatedRow.imageUrl,
      type: updatedRow.type ?? 'community',
      metadata: (updatedRow.metadata ?? {}) as Record<string, unknown>,
      permissions: {
        joinPolicy: (perms.joinPolicy ?? 'invite_only') as 'anyone' | 'invite_only',
        allowGuestVibeCheck: perms.allowGuestVibeCheck ?? false,
        invitationLink: perms.invitationLink ?? null,
        ...(perms.contextInjection !== undefined && { contextInjection: perms.contextInjection }),
      },
      isPersonal: updatedRow.isPersonal,
      createdAt: updatedRow.createdAt,
      updatedAt: updatedRow.updatedAt,
      memberCount,
      intentCount: Number(intentCountResult[0]?.count ?? 0),
      user: { id: updatedRow.ownerId, name: updatedRow.userName, avatar: updatedRow.userAvatar },
      _count: { members: memberCount },
    };
  }

  async softDeleteNetwork(networkId: string): Promise<void> {
    await db.delete(intentNetworks).where(eq(intentNetworks.networkId, networkId));
    await db.delete(networkMembers).where(eq(networkMembers.networkId, networkId));
    await db.update(networks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(networks.id, networkId));
  }

  /**
   * Cascading soft delete for an experiment network.
   *
   * Soft-deletes users who were *invited into* this experiment (i.e. have a
   * network-scoped personal agent permissioned on this network) along with
   * their data (intents, agents, API keys, personal networks, network
   * memberships). Organic users who happen to be members but were not
   * provisioned through the invitation flow are NOT cascaded — they keep their
   * accounts.
   *
   * @param networkId - The experiment network to delete
   */
  async softDeleteExperimentNetwork(networkId: string): Promise<void> {
    const now = new Date();

    // Identify experimentally-onboarded users: those who own at least one
    // agent with a network-scoped permission on this network. These are the
    // users provisioned by networkInvitationService.invite() (headless/CSV).
    const experimentUsers = await db
      .selectDistinct({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.agents, eq(schema.agents.ownerId, schema.users.id))
      .innerJoin(
        schema.agentPermissions,
        eq(schema.agentPermissions.agentId, schema.agents.id),
      )
      .where(and(
        eq(schema.agentPermissions.scope, 'network'),
        eq(schema.agentPermissions.scopeId, networkId),
        isNull(schema.users.deletedAt),
        isNull(schema.agents.deletedAt),
      ));

    const userIds = experimentUsers.map(u => u.id);

    if (userIds.length > 0) {
      // Soft-delete users
      await db
        .update(schema.users)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(schema.users.id, userIds));

      // Archive their intents (intents use archivedAt, not deletedAt)
      await db
        .update(schema.intents)
        .set({ archivedAt: now, updatedAt: now })
        .where(inArray(schema.intents.userId, userIds));

      // Delete their intent_networks (hard delete, same as existing softDeleteNetwork)
      await db
        .delete(schema.intentNetworks)
        .where(inArray(schema.intentNetworks.intentId,
          db.select({ id: schema.intents.id }).from(schema.intents).where(inArray(schema.intents.userId, userIds))
        ));

      // Soft-delete their network memberships
      await db
        .update(schema.networkMembers)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(schema.networkMembers.userId, userIds));

      // Soft-delete their personal networks
      const personalNetworkIds = await db
        .select({ networkId: schema.personalNetworks.networkId })
        .from(schema.personalNetworks)
        .where(inArray(schema.personalNetworks.userId, userIds));

      if (personalNetworkIds.length > 0) {
        await db
          .update(schema.networks)
          .set({ deletedAt: now, updatedAt: now })
          .where(inArray(schema.networks.id, personalNetworkIds.map(p => p.networkId)));
      }

      // Soft-delete their agents
      await db
        .update(schema.agents)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(schema.agents.ownerId, userIds));

      // Disable their API keys
      await db
        .update(schema.apikeys)
        .set({ enabled: false, updatedAt: now })
        .where(inArray(schema.apikeys.userId, userIds));
    }

    // Delete experiment network memberships (hard delete, same pattern as existing)
    await db.delete(schema.networkMembers).where(eq(schema.networkMembers.networkId, networkId));

    // Delete intent_networks for the experiment network
    await db.delete(schema.intentNetworks).where(eq(schema.intentNetworks.networkId, networkId));

    // Soft-delete the experiment network itself
    await db
      .update(schema.networks)
      .set({ deletedAt: now, updatedAt: now })
      .where(eq(schema.networks.id, networkId));
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

  /**
   * Find an index by its key (human-readable identifier).
   * @param key - The index's key
   * @returns Index record or null
   */
  async getNetworkByKey(key: string) {
    const rows = await db.select()
      .from(networks)
      .where(and(eq(networks.key, key), isNull(networks.deletedAt)))
      .limit(1);
    return rows[0] ?? null;
  }

  /**
   * Check if a network key already exists.
   * @param key - The key to check
   * @returns True if the key is taken
   */
  async networkKeyExists(key: string): Promise<boolean> {
    const result = await db.select({ id: networks.id })
      .from(networks)
      .where(eq(networks.key, key))
      .limit(1);
    return result.length > 0;
  }

  /**
   * Update a network's key. Owner-only check should be done at the service level.
   * @param indexId - The network ID
   * @param key - The new key value
   * @returns Updated network or null
   */
  async updateIndexKey(indexId: string, key: string) {
    const result = await db.update(networks)
      .set({ key, updatedAt: new Date() })
      .where(and(eq(networks.id, indexId), isNull(networks.deletedAt)))
      .returning();
    return result[0] ?? null;
  }

  async createNetwork(data: {
    title: string;
    prompt?: string | null;
    imageUrl?: string | null;
    joinPolicy?: 'anyone' | 'invite_only';
    type?: 'community' | 'event';
    metadata?: Record<string, unknown>;
  }): Promise<{
    id: string;
    title: string;
    prompt: string | null;
    imageUrl: string | null;
    permissions: { joinPolicy: 'anyone' | 'invite_only'; invitationLink: { code: string } | null; allowGuestVibeCheck: boolean };
    type: 'community' | 'event';
    metadata: Record<string, unknown>;
  }> {
    const finalJoinPolicy = data.joinPolicy ?? 'invite_only';
    const permissions = {
      joinPolicy: finalJoinPolicy,
      invitationLink: { code: crypto.randomUUID() },
      allowGuestVibeCheck: false,
    };
    const [row] = await db
      .insert(networks)
      .values({
        title: data.title,
        prompt: data.prompt ?? null,
        imageUrl: data.imageUrl ?? null,
        permissions,
        type: data.type ?? 'community',
        metadata: data.metadata ?? {},
      })
      .returning({
        id: networks.id,
        title: networks.title,
        prompt: networks.prompt,
        imageUrl: networks.imageUrl,
        permissions: networks.permissions,
        type: networks.type,
        metadata: networks.metadata,
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
      type: row.type ?? 'community',
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    };
  }

  async getNetworkMemberCount(networkId: string): Promise<number> {
    const [r] = await db.select({ count: count() }).from(networkMembers).where(and(eq(networkMembers.networkId, networkId), isNull(networkMembers.deletedAt)));
    return Number(r?.count ?? 0);
  }

  async addMemberToNetwork(
    networkId: string,
    userId: string,
    role: 'owner' | 'member'
  ): Promise<{ success: boolean; alreadyMember?: boolean }> {
    let memberPrompt: string | null = null;
    const [indexRow] = await db.select({ prompt: networks.prompt }).from(networks).where(eq(networks.id, networkId)).limit(1);
    if (indexRow) memberPrompt = indexRow.prompt;

    const finalPermissions = role === 'owner' ? ['owner'] : ['member'];
    const result = await db.insert(networkMembers).values({
      networkId,
      userId,
      permissions: finalPermissions,
      prompt: memberPrompt,
      autoAssign: true,
    }).onConflictDoNothing({ target: [networkMembers.networkId, networkMembers.userId] }).returning();

    if (result.length > 0) {
      try {
        NetworkMembershipEvents.onMemberAdded(userId, networkId);
      } catch (err) {
        logger.warn('addMemberToNetwork event hook failed (non-fatal)', { networkId, userId, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { success: true, alreadyMember: result.length === 0 };
  }

  async removeMemberFromIndex(
    networkId: string,
    userId: string
  ): Promise<{ success: boolean; wasOwner?: boolean; notMember?: boolean }> {
    // Check if user is the owner - owners cannot be removed
    const isOwner = await this.isIndexOwner(networkId, userId);
    if (isOwner) {
      return { success: false, wasOwner: true };
    }

    // Check if user is actually a member
    const existing = await db
      .select()
      .from(networkMembers)
      .where(and(eq(networkMembers.networkId, networkId), eq(networkMembers.userId, userId)))
      .limit(1);

    if (existing.length === 0) {
      return { success: false, notMember: true };
    }

    // Delete the membership
    await db
      .delete(networkMembers)
      .where(and(eq(networkMembers.networkId, networkId), eq(networkMembers.userId, userId)));

    return { success: true };
  }

  async deleteProfile(userId: string): Promise<void> {
    await db.delete(schema.userProfiles).where(eq(schema.userProfiles.userId, userId));
  }

  /**
   * Resolve an index identifier (UUID or key) to a UUID.
   * @param idOrKey - UUID or human-readable key
   * @returns The index UUID, or null if not found
   */
  async resolveIndexId(idOrKey: string): Promise<string | null> {
    const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrKey);
    if (isFullUuid) {
      return idOrKey;
    }
    // Try key lookup first
    const row = await this.getNetworkByKey(idOrKey);
    if (row) return row.id;
    // Fall back to hex prefix matching
    const isHexPrefix = /^[0-9a-f]+$/i.test(idOrKey);
    if (isHexPrefix) {
      const rows = await db.select({ id: networks.id })
        .from(networks)
        .where(and(sql`${networks.id} LIKE ${idOrKey + '%'}`, isNull(networks.deletedAt)))
        .limit(2);
      if (rows.length === 1) return rows[0].id;
    }
    return null;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Index Detail & Member Management (with access control)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get a single index with owner info and member count.
   * Checks that the requesting user is a member; throws "Access denied" if not.
   */
  async getPublicIndexDetail(networkId: string) {
    const rows = await db
      .select({
        id: networks.id,
        title: networks.title,
        prompt: networks.prompt,
        imageUrl: networks.imageUrl,
        permissions: networks.permissions,
        createdAt: networks.createdAt,
        updatedAt: networks.updatedAt,
        ownerId: networkMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
      })
      .from(networks)
      .innerJoin(
        networkMembers,
        and(
          eq(networks.id, networkMembers.networkId),
          sql`'owner' = ANY(${networkMembers.permissions})`
        )
      )
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(and(eq(networks.id, networkId), isNull(networks.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const perms = row.permissions as { joinPolicy?: string } | null;
    if (perms?.joinPolicy !== 'anyone') return null;

    const memberCount = await this.getNetworkMemberCount(networkId);

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
   * Get an index by its invitation link code (public access, no auth required).
   * @param code - The invitation link code from the URL
   * @returns The index with owner info, member count, and joinPolicy, or null if not found
   */
  async getNetworkByShareCode(code: string) {
    const rows = await db
      .select({
        id: networks.id,
        title: networks.title,
        prompt: networks.prompt,
        imageUrl: networks.imageUrl,
        permissions: networks.permissions,
        createdAt: networks.createdAt,
        updatedAt: networks.updatedAt,
        ownerId: networkMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
      })
      .from(networks)
      .innerJoin(
        networkMembers,
        and(
          eq(networks.id, networkMembers.networkId),
          sql`'owner' = ANY(${networkMembers.permissions})`
        )
      )
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(
        and(
          sql`${networks.permissions}->'invitationLink'->>'code' = ${code}`,
          isNull(networks.deletedAt),
          eq(networks.isPersonal, false)
        )
      )
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const memberCount = await this.getNetworkMemberCount(row.id);

    const perms = row.permissions as { joinPolicy?: string } | null;

    return {
      id: row.id,
      title: row.title,
      prompt: row.prompt,
      imageUrl: row.imageUrl,
      joinPolicy: (perms?.joinPolicy ?? 'invite_only') as 'anyone' | 'invite_only',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      user: { id: row.ownerId, name: row.userName, avatar: row.userAvatar },
      _count: { members: memberCount },
    };
  }

  /**
   * Accept an invitation to join an index using the invitation code.
   * @param code - The invitation link code
   * @param userId - The authenticated user accepting the invitation
   * @returns The index, membership details, and alreadyMember flag
   * @throws Error if the code is invalid or the index is not found
   */
  async acceptIndexInvitation(code: string, userId: string) {
    const index = await this.getNetworkByShareCode(code);
    if (!index) {
      throw new Error('Invalid or expired invitation link');
    }

    const result = await this.addMemberToNetwork(index.id, userId, 'member');

    const [memberRow] = await db
      .select({
        userId: networkMembers.userId,
        name: users.name,
        email: users.email,
        avatar: users.avatar,
        permissions: networkMembers.permissions,
        createdAt: networkMembers.createdAt,
      })
      .from(networkMembers)
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(and(eq(networkMembers.networkId, index.id), eq(networkMembers.userId, userId)))
      .limit(1);

    return {
      index,
      membership: memberRow
        ? {
            id: memberRow.userId,
            name: memberRow.name,
            email: memberRow.email,
            avatar: memberRow.avatar,
            permissions: memberRow.permissions,
            createdAt: memberRow.createdAt,
          }
        : null,
      alreadyMember: result.alreadyMember,
    };
  }

  async getNetworkDetail(networkId: string, requestingUserId: string) {
    const rows = await db
      .select({
        id: networks.id,
        title: networks.title,
        key: networks.key,
        prompt: networks.prompt,
        imageUrl: networks.imageUrl,
        permissions: networks.permissions,
        isPersonal: networks.isPersonal,
        isExperiment: networks.isExperiment,
        createdAt: networks.createdAt,
        updatedAt: networks.updatedAt,
        ownerId: networkMembers.userId,
        userName: users.name,
        userAvatar: users.avatar,
        type: networks.type,
        metadata: networks.metadata,
      })
      .from(networks)
      .innerJoin(
        networkMembers,
        and(
          eq(networks.id, networkMembers.networkId),
          sql`'owner' = ANY(${networkMembers.permissions})`
        )
      )
      .innerJoin(users, eq(networkMembers.userId, users.id))
      .where(and(eq(networks.id, networkId), isNull(networks.deletedAt)))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    const isMember = await this.isNetworkMember(networkId, requestingUserId);
    if (!isMember) {
      throw new Error('Access denied: Not a member of this index');
    }

    const memberCount = await this.getNetworkMemberCount(networkId);

    return {
      id: row.id,
      title: row.title,
      key: row.key,
      prompt: row.prompt,
      imageUrl: row.imageUrl,
      type: row.type ?? 'community',
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      permissions: row.permissions,
      isPersonal: row.isPersonal,
      isExperiment: row.isExperiment,
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
  async searchPersonalNetworkMembers(userId: string, query: string, excludeIndexId?: string) {
    if (!query || query.trim().length === 0) return [];

    // Find user's contacts from personal index (index_members with permissions=['contact'])
    const personalIndexId = await getPersonalIndexId(userId);
    if (!personalIndexId) return [];

    const contactUserIds = db
      .select({ userId: schema.networkMembers.userId })
      .from(schema.networkMembers)
      .where(
        and(
          eq(schema.networkMembers.networkId, personalIndexId),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
          isNull(schema.networkMembers.deletedAt)
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
        .select({ userId: networkMembers.userId })
        .from(networkMembers)
        .where(eq(networkMembers.networkId, excludeIndexId));
      conditions.push(notInArray(users.id, existingMembers));
    }

    return db
      .select({ id: users.id, name: users.name, email: users.email, avatar: users.avatar })
      .from(users)
      .where(and(...conditions))
      .limit(20);
  }

  /**
   * Add a member to an index. Owner-only.
   * Throws "Access denied" if the requesting user is not an owner.
   */
  async addMemberForOwner(
    networkId: string,
    userId: string,
    requestingUserId: string,
    role: 'owner' | 'member' = 'member'
  ) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Only owners can add members');
    }

    const result = await this.addMemberToNetwork(networkId, userId, role);
    const user = await this.getUser(userId);

    return {
      member: user
        ? { id: user.id, name: user.name, email: user.email, avatar: user.avatar, permissions: role === 'owner' ? ['owner'] : ['member'] }
        : null,
      alreadyMember: result.alreadyMember,
    };
  }

  /**
   * Update an existing member's role. Owner-only.
   * Cannot demote the last owner. Cannot change contacts.
   * @param networkId - The network ID
   * @param targetUserId - The member whose role is being changed
   * @param requestingUserId - The user making the change (must be owner)
   * @param role - The new role ('owner' | 'member')
   * @returns The updated member with new permissions
   * @throws Error if not authorized, last owner, or member not found
   */
  async updateMemberRole(
    networkId: string,
    targetUserId: string,
    requestingUserId: string,
    role: 'owner' | 'member'
  ) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Only owners can change member roles');
    }

    // Cannot change your own role
    if (targetUserId === requestingUserId) {
      throw new Error('Cannot change your own role');
    }

    // Get existing membership (exclude soft-deleted)
    const [existing] = await db
      .select({ permissions: networkMembers.permissions })
      .from(networkMembers)
      .where(and(
        eq(networkMembers.networkId, networkId),
        eq(networkMembers.userId, targetUserId),
        isNull(networkMembers.deletedAt)
      ))
      .limit(1);

    if (!existing) {
      throw new Error('Member not found');
    }

    // Don't allow changing contacts
    if (existing.permissions?.includes('contact')) {
      throw new Error('Cannot change role of a contact');
    }

    const newPermissions = role === 'owner' ? ['owner'] : ['member'];

    // Demotion guard: prevent demoting the last owner.
    // Uses a transaction with SELECT ... FOR UPDATE to lock all owner rows,
    // preventing concurrent write-skew under READ COMMITTED.
    if (role === 'member' && existing.permissions?.includes('owner')) {
      await db.transaction(async (tx) => {
        const owners = await tx
          .select({ userId: networkMembers.userId })
          .from(networkMembers)
          .where(and(
            eq(networkMembers.networkId, networkId),
            sql`'owner' = ANY(${networkMembers.permissions})`,
            isNull(networkMembers.deletedAt)
          ))
          .for('update');

        if (owners.length <= 1) {
          throw new Error('Cannot demote the last owner');
        }

        await tx
          .update(networkMembers)
          .set({ permissions: newPermissions, updatedAt: new Date() })
          .where(and(
            eq(networkMembers.networkId, networkId),
            eq(networkMembers.userId, targetUserId),
            isNull(networkMembers.deletedAt)
          ));
      });
    } else {
      await db
        .update(networkMembers)
        .set({ permissions: newPermissions, updatedAt: new Date() })
        .where(and(
          eq(networkMembers.networkId, networkId),
          eq(networkMembers.userId, targetUserId),
          isNull(networkMembers.deletedAt)
        ));
    }

    const user = await this.getUser(targetUserId);
    return {
      member: user
        ? { id: user.id, name: user.name, email: user.email, avatar: user.avatar, permissions: newPermissions }
        : null,
    };
  }

  /**
   * Remove a member from an index. Owner-only.
   * Checks isIndexOwner internally; throws "Access denied" if not owner.
   * Prevents self-removal. Throws "Member not found" if member doesn't exist.
   */
  async removeMemberForOwner(networkId: string, memberUserId: string, requestingUserId: string) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this index');
    }

    if (memberUserId === requestingUserId) {
      throw new Error('Cannot remove yourself from the index');
    }

    const deleted = await db
      .delete(networkMembers)
      .where(and(eq(networkMembers.networkId, networkId), eq(networkMembers.userId, memberUserId)))
      .returning({ userId: networkMembers.userId });

    if (deleted.length === 0) {
      throw new Error('Member not found');
    }
  }

  /**
   * Join a public index (anyone can join if joinPolicy is 'anyone').
   */
  async joinPublicNetwork(networkId: string, userId: string) {
    const [index] = await db
      .select({ permissions: networks.permissions, deletedAt: networks.deletedAt })
      .from(networks)
      .where(eq(networks.id, networkId))
      .limit(1);

    if (!index || index.deletedAt) {
      throw new Error('Index not found');
    }

    const perms = (index.permissions as { joinPolicy?: string } | null);
    if (perms?.joinPolicy !== 'anyone') {
      throw new Error('This index is not public');
    }

    return await this.addMemberToNetwork(networkId, userId, 'member');
  }

  /**
   * Leave an index. Members (non-owners) can leave an index.
   * Owners cannot leave their own index.
   */
  async leaveNetwork(networkId: string, userId: string) {
    const isOwner = await this.isIndexOwner(networkId, userId);
    if (isOwner) {
      throw new Error('Cannot leave an index you own. Delete the index instead.');
    }

    const deleted = await db
      .delete(networkMembers)
      .where(and(eq(networkMembers.networkId, networkId), eq(networkMembers.userId, userId)))
      .returning({ userId: networkMembers.userId });

    if (deleted.length === 0) {
      throw new Error('You are not a member of this index');
    }
  }

  /**
   * Soft-delete an index. Owner-only.
   * Checks isIndexOwner internally; throws "Access denied" if not owner.
   */
  async deleteIndexForOwner(networkId: string, requestingUserId: string) {
    const isOwner = await this.isIndexOwner(networkId, requestingUserId);
    if (!isOwner) {
      throw new Error('Access denied: Not an owner of this index');
    }

    await this.softDeleteNetwork(networkId);
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
  async getOpportunitiesByIds(ids: string[]): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getOpportunitiesByIds(ids);
  }
  /**
   * Resolve an opportunity ID from a full UUID or short prefix.
   * Delegates to OpportunityDatabaseAdapter.
   * @param idOrPrefix - Full UUID or prefix (e.g. first 8 chars)
   * @param userId - The user ID (for visibility scoping)
   * @returns Object with resolved id, or null/ambiguous status
   */
  async resolveOpportunityId(idOrPrefix: string, userId: string): Promise<{ id: string } | { ambiguous: true } | null> {
    return this.opportunityAdapter.resolveOpportunityId(idOrPrefix, userId);
  }
  async getOpportunitiesForUser(
    userId: string,
    options?: { status?: string; statuses?: string[]; networkId?: string; role?: string; limit?: number; offset?: number; conversationId?: string }
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getOpportunitiesForUser(userId, options);
  }
  async getOpportunitiesForNetwork(
    networkId: string,
    options?: { status?: string; limit?: number; offset?: number }
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.getOpportunitiesForNetwork(networkId, options);
  }
  async updateOpportunityStatus(
    id: string,
    status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
  ): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.updateOpportunityStatus(id, status, acceptedBy);
  }
  async updateOpportunityActorApproval(
    id: string,
    introducerUserId: string,
    approved: boolean,
  ): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.updateOpportunityActorApproval(id, introducerUserId, approved);
  }
  async updateOpportunityMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    await this.opportunityAdapter.updateOpportunityMetadata(id, metadata);
  }
  async stampOpportunityActorAction(
    id: string,
    actorUserId: string,
    status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
  ): Promise<OpportunityRow | null> {
    return this.opportunityAdapter.stampOpportunityActorAction(id, actorUserId, status, acceptedBy);
  }
  async opportunityExistsBetweenActors(actorIds: string[], networkId: string): Promise<boolean> {
    return this.opportunityAdapter.opportunityExistsBetweenActors(actorIds, networkId);
  }
  async findOpportunitiesByActors(
    actorIds: string[],
    options?: Parameters<OpportunityDatabaseAdapter['findOpportunitiesByActors']>[1]
  ): Promise<OpportunityRow[]> {
    return this.opportunityAdapter.findOpportunitiesByActors(actorIds, options);
  }
  async expireOpportunitiesByIntent(intentId: string): Promise<number> {
    return this.opportunityAdapter.expireOpportunitiesByIntent(intentId);
  }
  async expireOpportunitiesForRemovedMember(networkId: string, userId: string): Promise<number> {
    return this.opportunityAdapter.expireOpportunitiesForRemovedMember(networkId, userId);
  }
  async expireStaleOpportunities(): Promise<number> {
    return this.opportunityAdapter.expireStaleOpportunities();
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
   * Create a ghost user (unregistered contact) with empty profile.
   * Uses the same ON CONFLICT DO UPDATE pattern as the auth adapter:
   * - New email → inserts ghost row
   * - Existing ghost → updates name, returns existing ghost ID
   * - Existing real user → setWhere doesn't match, returns existing real user ID
   *
   * This ensures one consistent user-upsert mechanism across the codebase
   * (auth adapter for real-user signup/ghost-claim, this method for ghost creation).
   *
   * @param data - Name and email for the ghost user
   * @returns The created ghost user's ID (or existing user's ID if email taken)
   */
  async createGhostUser(data: { name: string; email: string }): Promise<{ id: string }> {
    const id = crypto.randomUUID();
    const email = data.email.toLowerCase().trim();

    // Same onConflictDoUpdate + setWhere pattern as AuthDatabaseAdapter.createDrizzleAdapter().
    // If a ghost already exists with this email, update its name.
    // If a real user exists, setWhere won't match → RETURNING is empty.
    const result = await db
      .insert(schema.users)
      .values({
        id,
        name: data.name,
        email,
        isGhost: true,
      })
      .onConflictDoUpdate({
        target: [schema.users.email],
        set: {
          name: sql`EXCLUDED."name"`,
          updatedAt: sql`now()`,
        },
        setWhere: sql`${schema.users.isGhost} = true`,
      })
      .returning({ id: schema.users.id });

    if (result[0]) {
      // New ghost created or existing ghost updated
      if (result[0].id === id) {
        // Truly new ghost — create empty profile
        await db.insert(schema.userProfiles).values({
          userId: id,
        }).onConflictDoNothing();
      }
      return { id: result[0].id };
    }

    // Real user already exists with this email — return their ID (exclude soft-deleted)
    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
      .limit(1);

    if (!existing) {
      throw new Error(`Cannot create ghost: email belongs to a deleted user (${email})`);
    }

    return { id: existing.id };
  }

  /**
   * Soft-delete a ghost user by unsubscribe token.
   * Looks up the user via userNotificationSettings.unsubscribeToken,
   * then soft-deletes if the user is a ghost and not already deleted.
   * @param token - The unsubscribe token from the email link
   * @returns true if user was soft-deleted, false if not found or not eligible
   */
  async softDeleteGhostByUnsubscribeToken(token: string): Promise<boolean> {
    const [settings] = await db.select({ userId: schema.userNotificationSettings.userId })
      .from(schema.userNotificationSettings)
      .where(eq(schema.userNotificationSettings.unsubscribeToken, token))
      .limit(1);
    if (!settings) return false;

    // Verify user is a ghost
    const [user] = await db.select({ id: schema.users.id, isGhost: schema.users.isGhost })
      .from(schema.users)
      .where(eq(schema.users.id, settings.userId))
      .limit(1);
    if (!user || !user.isGhost) return false;

    // Soft-delete all index_members rows where this ghost is a contact
    const result = await db.update(schema.networkMembers)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(schema.networkMembers.userId, settings.userId),
        sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        isNull(schema.networkMembers.deletedAt),
      ))
      .returning({ networkId: schema.networkMembers.networkId });

    return result.length > 0;
  }

  /**
   * Get or create notification settings for a user.
   * If no row exists, creates one with default preferences.
   * @param userId - The user's ID
   * @returns The notification settings row (includes unsubscribeToken)
   */
  async getOrCreateNotificationSettings(userId: string): Promise<{ id: string; userId: string; unsubscribeToken: string }> {
    const projection = {
      id: schema.userNotificationSettings.id,
      userId: schema.userNotificationSettings.userId,
      unsubscribeToken: schema.userNotificationSettings.unsubscribeToken,
    };

    // Atomic upsert: insert with onConflictDoNothing, then select
    await db.insert(schema.userNotificationSettings)
      .values({ userId })
      .onConflictDoNothing({ target: schema.userNotificationSettings.userId });

    const [row] = await db.select(projection)
      .from(schema.userNotificationSettings)
      .where(eq(schema.userNotificationSettings.userId, userId))
      .limit(1);
    if (!row) {
      throw new Error(`Failed to get or create notification settings for user ${userId}`);
    }
    return row;
  }

  /**
   * Get emails of soft-deleted ghost users from a list of emails.
   * Used to prevent re-importing opted-out ghost contacts.
   * @param emails - List of emails to check
   * @returns Emails belonging to soft-deleted ghost users
   */
  async getSoftDeletedGhostEmails(emails: string[]): Promise<string[]> {
    if (emails.length === 0) return [];
    const results = await db.select({ email: schema.users.email })
      .from(schema.users)
      .where(and(
        inArray(schema.users.email, emails),
        eq(schema.users.isGhost, true),
        isNotNull(schema.users.deletedAt),
      ));
    return results.map(r => r.email);
  }


  /**
   * Returns personal index IDs where the given user is a contact member.
   * @param userId - The user whose contact memberships to look up
   * @returns Array of personal index IDs
   */
  async getPersonalIndexesForContact(userId: string): Promise<{ networkId: string }[]> {
    return db
      .select({ networkId: schema.networkMembers.networkId })
      .from(schema.networkMembers)
      .innerJoin(schema.networks, eq(schema.networks.id, schema.networkMembers.networkId))
      .where(
        and(
          eq(schema.networkMembers.userId, userId),
          eq(schema.networks.isPersonal, true),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        )
      );
  }

  /**
   * Find a user by email (case-insensitive).
   * @param email - The email to search for
   * @returns User record or null
   */
  async getUserByEmail(email: string): Promise<{ id: string; name: string; email: string; isGhost: boolean } | null> {
    const normalized = email.toLowerCase().trim();
    const [row] = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        isGhost: schema.users.isGhost,
      })
      .from(schema.users)
      .where(and(
        sql`lower(${schema.users.email}) = ${normalized}`,
        isNull(schema.users.deletedAt),
      ))
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
      email: d.email.toLowerCase().trim(),
      isGhost: true,
    }));

    await db.insert(schema.users).values(usersToInsert).onConflictDoNothing();

    // Re-query to find which live users actually exist (created now vs already existed)
    // Excludes soft-deleted users so they don't flow into membership upserts or enrichment
    const insertedEmails = new Set(usersToInsert.map(u => u.email));
    const existingAfterInsert = await db
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(and(
        inArray(schema.users.email, [...insertedEmails]),
        isNull(schema.users.deletedAt),
      ));

    // Map back to our generated IDs vs actual IDs
    const emailToId = new Map(existingAfterInsert.map(u => [u.email, u.id]));
    const actuallyCreatedIds = new Set(
      usersToInsert
        .filter(u => emailToId.get(u.email) === u.id)
        .map(u => u.id)
    );

    // Create empty profiles only for newly created users
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
   * Upsert a contact membership in the owner's personal index.
   * Inserts an index_members row with permissions=['contact'].
   * @param ownerId - The owner of the personal index
   * @param contactUserId - The user to add as a contact member
   * @param options - If restore=true, reactivates soft-deleted rows via onConflictDoUpdate(deletedAt=null).
   *                  If restore=false (default), skips soft-deleted rows and uses onConflictDoNothing for active ones.
   */
  async upsertContactMembership(
    ownerId: string,
    contactUserId: string,
    options: { restore?: boolean } = {}
  ): Promise<void> {
    const personalIndexId = await ensurePersonalNetwork(ownerId);

    if (options.restore) {
      await db
        .insert(schema.networkMembers)
        .values({
          networkId: personalIndexId,
          userId: contactUserId,
          permissions: ['contact'],
          autoAssign: false,
        })
        .onConflictDoUpdate({
          target: [schema.networkMembers.networkId, schema.networkMembers.userId],
          set: { deletedAt: null, updatedAt: new Date() },
        });
    } else {
      // Check for soft-deleted row first — skip if found (opt-out respected)
      const [existing] = await db
        .select({ deletedAt: schema.networkMembers.deletedAt })
        .from(schema.networkMembers)
        .where(
          and(
            eq(schema.networkMembers.networkId, personalIndexId),
            eq(schema.networkMembers.userId, contactUserId),
            sql`'contact' = ANY(${schema.networkMembers.permissions})`,
          )
        )
        .limit(1);

      if (existing?.deletedAt) return; // soft-deleted — do not restore

      await db
        .insert(schema.networkMembers)
        .values({
          networkId: personalIndexId,
          userId: contactUserId,
          permissions: ['contact'],
          autoAssign: false,
        })
        .onConflictDoNothing();
    }
  }

  /**
   * Bulk upsert contact memberships in the owner's personal index.
   * Respects opt-outs: skips contacts that have a soft-deleted membership row.
   * @param ownerId - The owner of the personal index
   * @param contactUserIds - User IDs to add as contacts
   * @returns Resolves when all non-opted-out memberships are upserted
   */
  async upsertContactMembershipBulk(ownerId: string, contactUserIds: string[]): Promise<void> {
    if (contactUserIds.length === 0) return;
    const personalIndexId = await ensurePersonalNetwork(ownerId);

    const softDeleted = new Set(
      (await db
        .select({ userId: schema.networkMembers.userId })
        .from(schema.networkMembers)
        .where(
          and(
            eq(schema.networkMembers.networkId, personalIndexId),
            inArray(schema.networkMembers.userId, contactUserIds),
            sql`'contact' = ANY(${schema.networkMembers.permissions})`,
            isNotNull(schema.networkMembers.deletedAt),
          )
        )
      ).map(r => r.userId)
    );

    const idsToInsert = contactUserIds.filter(id => !softDeleted.has(id));
    if (idsToInsert.length === 0) return;

    const values = idsToInsert.map(userId => ({
      networkId: personalIndexId,
      userId,
      permissions: ['contact'],
      autoAssign: false,
    }));
    await db.insert(schema.networkMembers).values(values).onConflictDoNothing();
  }

  /**
   * Bulk-add users as members to a specific index.
   * Skips users that are already members (onConflictDoNothing).
   * @param networkId - The target index
   * @param userIds - User IDs to add as members
   */
  async addMembersBulkToIndex(networkId: string, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;

    let memberPrompt: string | null = null;
    const [indexRow] = await db.select({ prompt: schema.networks.prompt }).from(schema.networks).where(eq(schema.networks.id, networkId)).limit(1);
    if (indexRow) memberPrompt = indexRow.prompt;

    const values = userIds.map(userId => ({
      networkId,
      userId,
      permissions: ['member'],
      prompt: memberPrompt,
      autoAssign: false,
    }));
    await db.insert(schema.networkMembers).values(values).onConflictDoNothing();
  }

  // ─── Index Integrations ───────────────────────────────────────────────────────

  /**
   * Link a Composio connected account to an index.
   * @param networkId - Target index
   * @param toolkit - Toolkit slug (e.g. 'gmail', 'slack')
   * @param connectedAccountId - Composio connected account ID
   */
  async insertIndexIntegration(networkId: string, toolkit: string, connectedAccountId: string): Promise<void> {
    await db.insert(schema.networkIntegrations)
      .values({ networkId, toolkit, connectedAccountId })
      .onConflictDoNothing();
  }

  /**
   * Unlink a toolkit from an index.
   * @param networkId - Target index
   * @param toolkit - Toolkit slug
   */
  async deleteIndexIntegration(networkId: string, toolkit: string): Promise<void> {
    await db.delete(schema.networkIntegrations)
      .where(and(
        eq(schema.networkIntegrations.networkId, networkId),
        eq(schema.networkIntegrations.toolkit, toolkit),
      ));
  }

  /**
   * Remove all index links for a specific Composio connected account.
   * Called when a user fully disconnects their Composio connection.
   * @param connectedAccountId - Composio connected account ID
   */
  async deleteIndexIntegrationsByConnectedAccount(connectedAccountId: string): Promise<void> {
    await db.delete(schema.networkIntegrations)
      .where(eq(schema.networkIntegrations.connectedAccountId, connectedAccountId));
  }

  /**
   * List all linked integrations for an index.
   * @param networkId - The index to query
   * @returns Array of linked integration records
   */
  async getNetworkIntegrations(networkId: string): Promise<Array<{ toolkit: string; connectedAccountId: string; createdAt: Date }>> {
    return db.select({
      toolkit: schema.networkIntegrations.toolkit,
      connectedAccountId: schema.networkIntegrations.connectedAccountId,
      createdAt: schema.networkIntegrations.createdAt,
    })
      .from(schema.networkIntegrations)
      .where(eq(schema.networkIntegrations.networkId, networkId));
  }

  /**
   * Read the current syncConfig for a specific integration row.
   * @param networkId - Target index
   * @param toolkit - Toolkit slug
   * @returns The syncConfig object or null if no row exists
   */
  async getIntegrationSyncConfig(
    networkId: string,
    toolkit: string,
  ): Promise<Record<string, unknown> | null> {
    const [row] = await db
      .select({ syncConfig: schema.networkIntegrations.syncConfig })
      .from(schema.networkIntegrations)
      .where(
        and(
          eq(schema.networkIntegrations.networkId, networkId),
          eq(schema.networkIntegrations.toolkit, toolkit),
        ),
      )
      .limit(1);
    return row?.syncConfig ?? null;
  }

  /**
   * Read the metadata JSONB for a network.
   * @param networkId - Target network
   * @returns The metadata object or null if not found
   */
  async getNetworkMetadata(networkId: string): Promise<Record<string, unknown> | null> {
    const [row] = await db
      .select({ metadata: schema.networks.metadata })
      .from(schema.networks)
      .where(eq(schema.networks.id, networkId))
      .limit(1);
    return (row?.metadata as Record<string, unknown>) ?? null;
  }

  /**
   * Replace the metadata JSONB for a network.
   * @param networkId - Target network
   * @param metadata - New metadata object
   */
  async updateNetworkMetadata(networkId: string, metadata: Record<string, unknown>): Promise<void> {
    await db
      .update(schema.networks)
      .set({ metadata, updatedAt: new Date() })
      .where(eq(schema.networks.id, networkId));
  }

  /**
   * Update the syncConfig JSONB column on a network_integrations row.
   * @param networkId - Target index
   * @param toolkit - Toolkit slug (e.g. 'google_calendar')
   * @param syncConfig - New sync configuration to store
   */
  async updateIntegrationSyncConfig(
    networkId: string,
    toolkit: string,
    syncConfig: Record<string, unknown>,
  ): Promise<void> {
    await db
      .update(schema.networkIntegrations)
      .set({ syncConfig })
      .where(
        and(
          eq(schema.networkIntegrations.networkId, networkId),
          eq(schema.networkIntegrations.toolkit, toolkit),
        ),
      );
  }

  /**
   * Return all network_integrations rows whose syncConfig.status is 'active',
   * joined with network_members to include the network owner's userId.
   * Used by the integration sync worker to find integrations due for a tick.
   */
  async getActiveIntegrationSyncs(): Promise<Array<{
    networkId: string;
    toolkit: string;
    connectedAccountId: string;
    syncConfig: Record<string, unknown>;
    ownerUserId: string;
  }>> {
    // Use a lateral subquery to pick exactly one owner per network,
    // avoiding duplicate rows when a network has multiple owners.
    const rows = await db.execute<{
      network_id: string;
      toolkit: string;
      connected_account_id: string;
      sync_config: Record<string, unknown>;
      owner_user_id: string;
    }>(sql`
      SELECT
        ni.network_id,
        ni.toolkit,
        ni.connected_account_id,
        ni.sync_config,
        owner.user_id AS owner_user_id
      FROM network_integrations ni
      JOIN networks n ON n.id = ni.network_id AND n.deleted_at IS NULL
      CROSS JOIN LATERAL (
        SELECT nm.user_id
        FROM network_members nm
        WHERE nm.network_id = ni.network_id
          AND 'owner' = ANY(nm.permissions)
          AND nm.deleted_at IS NULL
        ORDER BY nm.created_at ASC
        LIMIT 1
      ) owner
      WHERE ni.sync_config->>'status' = 'active'
    `);

    return rows.map((r) => ({
      networkId: r.network_id,
      toolkit: r.toolkit,
      connectedAccountId: r.connected_account_id,
      syncConfig: r.sync_config as Record<string, unknown>,
      ownerUserId: r.owner_user_id,
    }));
  }

  /**
   * Hard-delete a contact membership from the owner's personal index.
   * @param ownerId - The owner of the personal index
   * @param contactUserId - The contact user to remove
   */
  async hardDeleteContactMembership(ownerId: string, contactUserId: string): Promise<void> {
    const personalIndexId = await getPersonalIndexId(ownerId);
    if (!personalIndexId) return;

    await db.delete(schema.networkMembers)
      .where(
        and(
          eq(schema.networkMembers.networkId, personalIndexId),
          eq(schema.networkMembers.userId, contactUserId),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        )
      );
  }

  /**
   * Clear a soft-deleted contact membership that the other user has for this owner.
   * This removes the "reverse opt-out" so the other user's personal index no longer blocks the owner.
   * @param ownerId - The user being added as a contact
   * @param otherUserId - The other user whose personal index may have a soft-deleted row for ownerId
   */
  async clearReverseOptOut(ownerId: string, otherUserId: string): Promise<void> {
    const otherPersonalIndexId = await getPersonalIndexId(otherUserId);
    if (!otherPersonalIndexId) return;

    await db.delete(schema.networkMembers)
      .where(
        and(
          eq(schema.networkMembers.networkId, otherPersonalIndexId),
          eq(schema.networkMembers.userId, ownerId),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
          isNotNull(schema.networkMembers.deletedAt),
        )
      );
  }

  /**
   * Bulk clear soft-deleted contact memberships (reverse opt-outs) for multiple users.
   * Removes rows where `ownerId` appears as a soft-deleted contact in each user's personal index.
   * @param ownerId - The user being added as a contact
   * @param otherUserIds - The users whose personal indexes may have soft-deleted rows for ownerId
   */
  async clearReverseOptOutBulk(ownerId: string, otherUserIds: string[]): Promise<void> {
    if (otherUserIds.length === 0) return;

    // Batch lookup personal indexes for all other users
    const personalIndexRows = await db
      .select({ userId: schema.personalNetworks.userId, networkId: schema.personalNetworks.networkId })
      .from(schema.personalNetworks)
      .where(inArray(schema.personalNetworks.userId, otherUserIds));

    const personalIndexIds = personalIndexRows.map(r => r.networkId);
    if (personalIndexIds.length === 0) return;

    // Single DELETE across all matching personal indexes
    await db.delete(schema.networkMembers)
      .where(
        and(
          inArray(schema.networkMembers.networkId, personalIndexIds),
          eq(schema.networkMembers.userId, ownerId),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
          isNotNull(schema.networkMembers.deletedAt),
        )
      );
  }

  /**
   * Get all contact members from the owner's personal index.
   * @param ownerId - The owner of the personal index
   * @returns Array of contact members with user details
   */
  async getContactMembers(ownerId: string): Promise<Array<{
    userId: string;
    user: { id: string; name: string; email: string; avatar: string | null; isGhost: boolean };
  }>> {
    const personalIndexId = await getPersonalIndexId(ownerId);
    if (!personalIndexId) return [];

    const rows = await db
      .select({
        userId: schema.networkMembers.userId,
        userName: schema.users.name,
        userEmail: schema.users.email,
        userAvatar: schema.users.avatar,
        userIsGhost: schema.users.isGhost,
      })
      .from(schema.networkMembers)
      .innerJoin(schema.users, eq(schema.networkMembers.userId, schema.users.id))
      .where(
        and(
          eq(schema.networkMembers.networkId, personalIndexId),
          sql`'contact' = ANY(${schema.networkMembers.permissions})`,
          isNull(schema.networkMembers.deletedAt),
          isNull(schema.users.deletedAt),
        )
      );

    return rows.map((row) => ({
      userId: row.userId,
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
   * Get the user's personal index ID.
   * @param userId - The user whose personal index to find
   * @returns The personal index ID, or null if none exists
   */
  async getPersonalIndexId(userId: string): Promise<string | null> {
    return getPersonalIndexId(userId);
  }

  /**
   * Get contacts from a personal index with their latest intent timestamp and intent count.
   * Contacts are sorted by most recent intent (freshest first) for introducer discovery.
   *
   * @param personalIndexId - The personal index to query
   * @param ownerId - The index owner (excluded from results)
   * @param limit - Maximum contacts to return
   * @returns Contacts with intent freshness data
   */
  async getContactsWithIntentFreshness(
    personalIndexId: string,
    ownerId: string,
    limit: number,
  ): Promise<Array<{ userId: string; latestIntentAt: string | null; intentCount: number }>> {
    try {
      const rows = await db
        .select({
          userId: schema.networkMembers.userId,
          latestIntentAt: sql<string | null>`MAX(${schema.intents.updatedAt})`.as('latest_intent_at'),
          intentCount: sql<number>`COUNT(${schema.intents.id})::int`.as('intent_count'),
        })
        .from(schema.networkMembers)
        .innerJoin(
          schema.users,
          eq(schema.networkMembers.userId, schema.users.id),
        )
        .leftJoin(
          schema.intents,
          and(
            eq(schema.intents.userId, schema.networkMembers.userId),
            isNull(schema.intents.archivedAt),
          ),
        )
        .where(
          and(
            eq(schema.networkMembers.networkId, personalIndexId),
            sql`'contact' = ANY(${schema.networkMembers.permissions})`,
            isNull(schema.networkMembers.deletedAt),
            isNull(schema.users.deletedAt),
            sql`${schema.networkMembers.userId} != ${ownerId}`,
          ),
        )
        .groupBy(schema.networkMembers.userId)
        .orderBy(sql`MAX(${schema.intents.updatedAt}) DESC NULLS LAST`)
        .limit(limit);

      return rows.map((row) => ({
        userId: row.userId,
        latestIntentAt: row.latestIntentAt ? new Date(row.latestIntentAt).toISOString() : null,
        intentCount: Number(row.intentCount) || 0,
      }));
    } catch (error) {
      logger.error('ChatDatabaseAdapter.getContactsWithIntentFreshness error', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Finds an existing DM conversation between two users, or creates one.
   * Thin delegator to {@link ConversationDatabaseAdapter.getOrCreateDM} so
   * OpportunityService can satisfy the OpportunityControllerDatabase
   * interface without importing another service (per the services-must-not-
   * import-services rule). Used by the Start Chat endpoint (Plan B Task 8).
   *
   * @param userA - First participant user ID.
   * @param userB - Second participant user ID.
   * @returns The existing or newly-created DM conversation (only the id).
   * @throws Error when both IDs match (self-DMs are rejected) or when the
   *   insert fails and no pre-existing row can be found after a unique
   *   constraint collision (surfaced by the underlying ConversationDatabaseAdapter).
   */
  async getOrCreateDM(userA: string, userB: string, participantType?: 'user' | 'agent'): Promise<{ id: string }> {
    const conversationAdapter = new ConversationDatabaseAdapter();
    return conversationAdapter.getOrCreateDM(userA, userB, participantType);
  }

  /**
   * Clears hiddenAt for a user on a conversation, making it visible again.
   * Thin delegator to {@link ConversationDatabaseAdapter.unhideConversation}
   * so OpportunityService can call it after reusing an existing DM that the
   * user had previously hidden.
   */
  async unhideConversation(userId: string, conversationId: string): Promise<void> {
    const conversationAdapter = new ConversationDatabaseAdapter();
    return conversationAdapter.unhideConversation(userId, conversationId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Premises Methods (premise CRUD and network assignment)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a new premise record for a user.
   * @param input - The premise fields to persist
   * @returns The created premise record
   */
  async createPremise(input: {
    userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis?: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number };
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding?: number[];
  }): Promise<{
    id: string; userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null;
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding: number[] | null;
    status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    createdAt: Date; updatedAt: Date; retractedAt: Date | null;
  }> {
    const [row] = await db
      .insert(schema.premises)
      .values({
        userId: input.userId,
        assertion: input.assertion,
        provenance: input.provenance,
        analysis: input.analysis ?? null,
        validity: input.validity,
        embedding: input.embedding ?? null,
        status: 'ACTIVE',
      })
      .returning();
    if (!row) throw new Error('createPremise: no row returned');
    return {
      id: row.id,
      userId: row.userId,
      assertion: row.assertion as { text: string; tier: 'assertive' | 'contextual'; summary?: string },
      provenance: row.provenance as { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string },
      analysis: row.analysis as { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null,
      validity: row.validity as { validFrom?: string; validUntil?: string; volatile: boolean },
      embedding: row.embedding,
      status: row.status as 'ACTIVE' | 'RETRACTED' | 'EXPIRED',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      retractedAt: row.retractedAt ?? null,
    };
  }

  async getPremise(premiseId: string): Promise<{
    id: string; userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null;
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding: number[] | null;
    status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    createdAt: Date; updatedAt: Date; retractedAt: Date | null;
  } | null> {
    const [row] = await db
      .select()
      .from(schema.premises)
      .where(and(eq(schema.premises.id, premiseId), isNull(schema.premises.deletedAt)))
      .limit(1);
    if (!row) return null;
    return {
      id: row.id,
      userId: row.userId,
      assertion: row.assertion as { text: string; tier: 'assertive' | 'contextual'; summary?: string },
      provenance: row.provenance as { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string },
      analysis: row.analysis as { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null,
      validity: row.validity as { validFrom?: string; validUntil?: string; volatile: boolean },
      embedding: row.embedding,
      status: row.status as 'ACTIVE' | 'RETRACTED' | 'EXPIRED',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      retractedAt: row.retractedAt ?? null,
    };
  }

  async getPremisesForUser(userId: string, status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED'): Promise<Array<{
    id: string; userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null;
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding: number[] | null;
    status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    createdAt: Date; updatedAt: Date; retractedAt: Date | null;
  }>> {
    const conditions: ReturnType<typeof eq>[] = [
      eq(schema.premises.userId, userId),
      isNull(schema.premises.deletedAt),
    ];
    if (status) {
      conditions.push(eq(schema.premises.status, status));
    }
    const rows = await db
      .select()
      .from(schema.premises)
      .where(and(...conditions))
      .orderBy(desc(schema.premises.createdAt));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      assertion: row.assertion as { text: string; tier: 'assertive' | 'contextual'; summary?: string },
      provenance: row.provenance as { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string },
      analysis: row.analysis as { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null,
      validity: row.validity as { validFrom?: string; validUntil?: string; volatile: boolean },
      embedding: row.embedding,
      status: row.status as 'ACTIVE' | 'RETRACTED' | 'EXPIRED',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      retractedAt: row.retractedAt ?? null,
    }));
  }

  /**
   * Cosine similarity search against premise embeddings, scoped to shared networks.
   * Delegates to OpportunityDatabaseAdapter (which hosts the raw SQL query).
   */
  async searchPremisesBySimilarity(params: {
    embedding: number[];
    networkIds: string[];
    excludeUserId: string;
    limit: number;
  }) {
    return this.opportunityAdapter.searchPremisesBySimilarity(params);
  }

  async updatePremise(premiseId: string, updates: {
    assertion?: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    analysis?: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number };
    validity?: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding?: number[];
    status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    retractedAt?: Date;
  }): Promise<{
    id: string; userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null;
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding: number[] | null;
    status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    createdAt: Date; updatedAt: Date; retractedAt: Date | null;
  }> {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (updates.assertion !== undefined) patch.assertion = updates.assertion;
    if (updates.analysis !== undefined) patch.analysis = updates.analysis;
    if (updates.validity !== undefined) patch.validity = updates.validity;
    if (updates.embedding !== undefined) patch.embedding = updates.embedding;
    if (updates.status !== undefined) patch.status = updates.status;
    if (updates.retractedAt !== undefined) patch.retractedAt = updates.retractedAt;

    const [row] = await db
      .update(schema.premises)
      .set(patch)
      .where(and(eq(schema.premises.id, premiseId), isNull(schema.premises.deletedAt)))
      .returning();
    if (!row) throw new Error(`updatePremise: premise ${premiseId} not found or soft-deleted`);
    return {
      id: row.id,
      userId: row.userId,
      assertion: row.assertion as { text: string; tier: 'assertive' | 'contextual'; summary?: string },
      provenance: row.provenance as { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string },
      analysis: row.analysis as { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null,
      validity: row.validity as { validFrom?: string; validUntil?: string; volatile: boolean },
      embedding: row.embedding,
      status: row.status as 'ACTIVE' | 'RETRACTED' | 'EXPIRED',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      retractedAt: row.retractedAt ?? null,
    };
  }

  async assignPremiseToNetwork(premiseId: string, networkId: string, relevancyScore: number): Promise<void> {
    await db
      .insert(schema.premiseNetworks)
      .values({
        premiseId,
        networkId,
        relevancyScore: String(relevancyScore),
      })
      .onConflictDoUpdate({
        target: [schema.premiseNetworks.premiseId, schema.premiseNetworks.networkId],
        set: { relevancyScore: String(relevancyScore) },
      });
  }

  async getPremiseNetworks(premiseId: string): Promise<Array<{ networkId: string; relevancyScore: number | null }>> {
    const rows = await db
      .select({
        networkId: schema.premiseNetworks.networkId,
        relevancyScore: schema.premiseNetworks.relevancyScore,
      })
      .from(schema.premiseNetworks)
      .where(eq(schema.premiseNetworks.premiseId, premiseId));
    return rows.map((r) => ({
      networkId: r.networkId,
      relevancyScore: r.relevancyScore !== null ? Number(r.relevancyScore) : null,
    }));
  }

  /**
   * Find ACTIVE premises whose validity.validUntil has passed.
   * Uses a JSONB text extraction cast to timestamptz for the comparison.
   * @returns Minimal rows: id and userId for each expired premise
   */
  async getExpiredPremises(): Promise<Array<{ id: string; userId: string }>> {
    const rows = await db
      .select({ id: schema.premises.id, userId: schema.premises.userId })
      .from(schema.premises)
      .where(
        and(
          eq(schema.premises.status, 'ACTIVE'),
          isNull(schema.premises.deletedAt),
          sql`(${schema.premises.validity}->>'validUntil') IS NOT NULL`,
          sql`(${schema.premises.validity}->>'validUntil')::timestamptz < NOW()`,
        )
      );
    return rows.map((r) => ({ id: r.id, userId: r.userId }));
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
    const emb = profile.embedding ?? null;
    const data = {
      userId,
      identity: profile.identity,
      narrative: profile.narrative,
      attributes: profile.attributes,
      embedding: emb === null
        ? null
        : (Array.isArray(emb[0])
          ? (emb as number[][])[0]
          : (emb as number[])),
      updatedAt: new Date(),
    };
    await db.insert(schema.userProfiles)
      .values(data)
      .onConflictDoUpdate({
        target: schema.userProfiles.userId,
        set: data,
      });
  }

  async getUser(userId: string) {
    const result = await db.select()
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    const user = result[0];
    if (!user) return null;
    const socials = await this.getUserSocials(userId);
    return { ...user, socials };
  }

  /**
   * Update user account fields (name, intro, location).
   */
  async updateUser(
    userId: string,
    data: { name?: string; intro?: string; location?: string; onboarding?: OnboardingState }
  ): Promise<{ id: string; name: string; email: string; intro?: string | null; avatar?: string | null; location?: string | null; socials: Array<{ id: string; userId: string; label: string; value: string }>; onboarding?: OnboardingState | null } | null> {
    const current = await this.getUser(userId);
    if (!current) return null;

    const updateFields: Record<string, unknown> = { updatedAt: new Date() };

    if (data.name !== undefined) updateFields.name = data.name;
    if (data.intro !== undefined) updateFields.intro = data.intro;
    if (data.location !== undefined) updateFields.location = data.location;

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
    const socials = await this.getUserSocials(userId);
    return {
      id: updated.id,
      name: updated.name,
      email: updated.email,
      intro: updated.intro,
      avatar: updated.avatar,
      location: updated.location,
      socials,
      onboarding: (updated as { onboarding?: unknown }).onboarding as OnboardingState | null,
    };
  }

  async getUserSocials(userId: string): Promise<Array<{ id: string; userId: string; label: string; value: string }>> {
    const rows = await db.select()
      .from(schema.userSocials)
      .where(eq(schema.userSocials.userId, userId))
      .orderBy(asc(schema.userSocials.createdAt), asc(schema.userSocials.id));
    return rows.map(r => ({ id: r.id, userId: r.userId, label: r.label, value: r.value }));
  }

  async setUserSocials(userId: string, socials: { label: string; value: string }[]): Promise<void> {
    await db.transaction(async (tx) => {
      await tx.delete(schema.userSocials).where(eq(schema.userSocials.userId, userId));
      if (socials.length > 0) {
        const classified = socials
          .filter(s => s.value.trim() !== '')
          .map(s => {
            const value = s.value.trim();
            const detected = detectSocialLabel(value);
            return {
              userId,
              label: detected === 'custom' ? s.label : detected,
              value,
            };
          });

        // Dedup: for non-custom labels the unique index allows only one row per label.
        // Keep the first occurrence (explicit field) and drop later duplicates.
        const seen = new Set<string>();
        const deduped = classified.filter(s => {
          if (s.label === 'custom') return true;
          if (seen.has(s.label)) return false;
          seen.add(s.label);
          return true;
        });

        if (deduped.length > 0) {
          await tx.insert(schema.userSocials).values(deduped);
        }
      }
    });
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

  /**
   * Soft-delete a ghost user and all their contact memberships.
   * Used when enrichment detects the entity is not human.
   * @param userId - The ghost user to soft-delete
   * @returns true if the user was soft-deleted
   */
  async softDeleteGhost(userId: string): Promise<boolean> {
    const [user] = await db.select({ id: schema.users.id, isGhost: schema.users.isGhost })
      .from(schema.users)
      .where(and(eq(schema.users.id, userId), isNull(schema.users.deletedAt)))
      .limit(1);
    if (!user || !user.isGhost) return false;

    await db.update(schema.networkMembers)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(schema.networkMembers.userId, userId),
        sql`'contact' = ANY(${schema.networkMembers.permissions})`,
        isNull(schema.networkMembers.deletedAt),
      ));

    await db.update(schema.users)
      .set({ deletedAt: new Date() })
      .where(eq(schema.users.id, userId));

    return true;
  }

  /**
   * Find an existing user that shares any of the given social handles with the specified ghost.
   * Case-insensitive exact match on linkedin, github, and x handles.
   * Excludes the ghost itself and soft-deleted users.
   * Prefers real users over ghosts; among ghosts, picks the oldest by created_at.
   * @param userId - The ghost user ID to exclude from results
   * @param socials - Social handles to match against
   * @returns The matching user's ID, or null if no match found
   */
  async findDuplicateUser(
    userId: string,
    socials: Array<{ id: string; userId: string; label: string; value: string }>,
  ): Promise<{ id: string } | null> {
    const handles = socials
      .filter(s => ['linkedin', 'github', 'twitter', 'telegram'].includes(s.label))
      .map(s => ({ label: s.label, value: s.value.toLowerCase() }));

    if (handles.length === 0) return null;

    const conditions = handles.map(
      (h) => sql`(LOWER(${schema.userSocials.value}) = ${h.value} AND ${schema.userSocials.label} = ${h.label})`,
    );

    const results = await db
      .selectDistinct({ id: schema.userSocials.userId, isGhost: schema.users.isGhost, createdAt: schema.users.createdAt })
      .from(schema.userSocials)
      .innerJoin(schema.users, eq(schema.userSocials.userId, schema.users.id))
      .where(
        and(
          sql`(${sql.join(conditions, sql` OR `)})`,
          not(eq(schema.userSocials.userId, userId)),
          isNull(schema.users.deletedAt),
        ),
      )
      .orderBy(asc(schema.users.isGhost), asc(schema.users.createdAt))
      .limit(1);

    return results[0] ? { id: results[0].id } : null;
  }

  /**
   * Merge a ghost user (source) into a target user.
   * Re-points all FK references, deletes ghost-only records, and soft-deletes the source.
   * Runs entirely within a single database transaction.
   * @param sourceId - The ghost user to merge away
   * @param targetId - The target user to absorb the ghost's data
   */
  async mergeGhostUser(sourceId: string, targetId: string): Promise<void> {
    await db.transaction(async (tx) => {
      // Guard: only active ghost users may be merged away
      const [source] = await tx
        .select({ isGhost: schema.users.isGhost })
        .from(schema.users)
        .where(and(eq(schema.users.id, sourceId), isNull(schema.users.deletedAt)))
        .limit(1);
      if (!source?.isGhost) {
        throw new Error(`mergeGhostUser: sourceId ${sourceId} is not an active ghost user`);
      }

      // ── 1. Delete ghost-only records (unique constraints prevent re-pointing) ──

      await tx.delete(schema.userProfiles).where(eq(schema.userProfiles.userId, sourceId));
      await tx.delete(schema.userNotificationSettings).where(eq(schema.userNotificationSettings.userId, sourceId));
      await tx.delete(schema.sessions).where(eq(schema.sessions.userId, sourceId));
      await tx.delete(schema.accounts).where(eq(schema.accounts.userId, sourceId));
      await tx.delete(schema.apikeys).where(eq(schema.apikeys.userId, sourceId));
      await tx.delete(schema.agentPermissions).where(eq(schema.agentPermissions.userId, sourceId));
      await tx.delete(schema.agents).where(eq(schema.agents.ownerId, sourceId));

      // Delete ghost's HyDE profile documents
      await tx.delete(schema.hydeDocuments).where(
        and(
          eq(schema.hydeDocuments.sourceType, 'profile'),
          eq(schema.hydeDocuments.sourceId, sourceId),
        ),
      );

      // ── 2. Re-point simple FK references ──

      await tx.update(schema.intents)
        .set({ userId: targetId })
        .where(eq(schema.intents.userId, sourceId));

      await tx.update(schema.files)
        .set({ userId: targetId })
        .where(eq(schema.files.userId, sourceId));

      await tx.update(schema.links)
        .set({ userId: targetId })
        .where(eq(schema.links.userId, sourceId));

      // ── 3. Re-point network_members (composite PK: skip if target already member) ──

      const ghostMemberships = await tx.select({ networkId: schema.networkMembers.networkId })
        .from(schema.networkMembers)
        .where(and(eq(schema.networkMembers.userId, sourceId), isNull(schema.networkMembers.deletedAt)));

      const targetMemberships = await tx.select({ networkId: schema.networkMembers.networkId })
        .from(schema.networkMembers)
        .where(and(eq(schema.networkMembers.userId, targetId), isNull(schema.networkMembers.deletedAt)));
      const targetNetworkIds = new Set(targetMemberships.map(m => m.networkId));

      for (const gm of ghostMemberships) {
        if (targetNetworkIds.has(gm.networkId)) {
          // Target already in this network — soft-delete ghost's membership
          await tx.update(schema.networkMembers)
            .set({ deletedAt: new Date() })
            .where(and(
              eq(schema.networkMembers.networkId, gm.networkId),
              eq(schema.networkMembers.userId, sourceId),
            ));
        } else {
          // Re-point ghost's membership to target
          await tx.update(schema.networkMembers)
            .set({ userId: targetId })
            .where(and(
              eq(schema.networkMembers.networkId, gm.networkId),
              eq(schema.networkMembers.userId, sourceId),
            ));
        }
      }

      // ── 4. Re-point opportunity_deliveries (conditional unique: skip conflicts) ──

      const ghostDeliveries = await tx.select({
        id: schema.opportunityDeliveries.id,
        opportunityId: schema.opportunityDeliveries.opportunityId,
        channel: schema.opportunityDeliveries.channel,
        deliveredAtStatus: schema.opportunityDeliveries.deliveredAtStatus,
        deliveredAt: schema.opportunityDeliveries.deliveredAt,
      })
        .from(schema.opportunityDeliveries)
        .where(eq(schema.opportunityDeliveries.userId, sourceId));

      const targetDeliveries = await tx.select({
        opportunityId: schema.opportunityDeliveries.opportunityId,
        channel: schema.opportunityDeliveries.channel,
        deliveredAtStatus: schema.opportunityDeliveries.deliveredAtStatus,
      })
        .from(schema.opportunityDeliveries)
        .where(and(
          eq(schema.opportunityDeliveries.userId, targetId),
          sql`${schema.opportunityDeliveries.deliveredAt} IS NOT NULL`,
        ));

      const targetDeliveryKeys = new Set(
        targetDeliveries.map(d => `${d.opportunityId}:${d.channel}:${d.deliveredAtStatus}`),
      );

      for (const gd of ghostDeliveries) {
        const wouldConflict = gd.deliveredAt !== null &&
          targetDeliveryKeys.has(`${gd.opportunityId}:${gd.channel}:${gd.deliveredAtStatus}`);
        if (wouldConflict) {
          await tx.delete(schema.opportunityDeliveries).where(eq(schema.opportunityDeliveries.id, gd.id));
        } else {
          await tx.update(schema.opportunityDeliveries)
            .set({ userId: targetId })
            .where(eq(schema.opportunityDeliveries.id, gd.id));
        }
      }

      // ── 5. Re-point conversation_participants (composite PK: skip if target already in conversation) ──

      await tx.execute(sql`
        UPDATE conversation_participants
        SET participant_id = ${targetId}
        WHERE participant_id = ${sourceId}
          AND participant_type = 'user'
          AND conversation_id NOT IN (
            SELECT conversation_id FROM conversation_participants WHERE participant_id = ${targetId}
          )
      `);
      // Delete remaining ghost participants (where target already in conversation)
      await tx.execute(sql`
        DELETE FROM conversation_participants
        WHERE participant_id = ${sourceId} AND participant_type = 'user'
      `);

      // ── 6. Re-point messages ──

      await tx.execute(sql`
        UPDATE messages SET sender_id = ${targetId}
        WHERE sender_id = ${sourceId} AND role = 'user'
      `);

      // ── 7. Re-point opportunity actors JSONB ──

      const affectedOpps = await tx.execute(sql`
        SELECT id, actors, detection FROM opportunities
        WHERE actors::text LIKE ${'%' + sourceId + '%'}
           OR detection::text LIKE ${'%' + sourceId + '%'}
      `) as unknown as { id: string; actors: unknown; detection: unknown }[];

      for (const row of affectedOpps) {
        const actors = (Array.isArray(row.actors) ? row.actors : []) as { userId: string; [k: string]: unknown }[];
        const updatedActors = actors.map(a =>
          a.userId === sourceId ? { ...a, userId: targetId } : a,
        );

        const detection = (row.detection ?? {}) as { createdBy?: string; [k: string]: unknown };
        const updatedDetection = detection.createdBy === sourceId
          ? { ...detection, createdBy: targetId }
          : detection;

        await tx.execute(sql`
          UPDATE opportunities
          SET actors = ${JSON.stringify(updatedActors)}::jsonb,
              detection = ${JSON.stringify(updatedDetection)}::jsonb
          WHERE id = ${row.id}
        `);
      }

      // ── 8. Soft-delete the ghost user ──

      await tx.update(schema.users)
        .set({ deletedAt: new Date() })
        .where(eq(schema.users.id, sourceId));
    });
  }

  /**
   * Retrieve premises for a user, optionally filtered by status.
   * Used by the profile graph in `aggregate` mode to synthesize profile from active premises.
   * @param userId - The user whose premises to retrieve
   * @param status - Optional status filter (`ACTIVE`, `RETRACTED`, or `EXPIRED`)
   * @returns Array of premise records
   */
  async getPremisesForUser(userId: string, status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED'): Promise<Array<{
    id: string; userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null;
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding: number[] | null;
    status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    createdAt: Date; updatedAt: Date; retractedAt: Date | null;
  }>> {
    const conditions: ReturnType<typeof eq>[] = [
      eq(schema.premises.userId, userId),
      isNull(schema.premises.deletedAt),
    ];
    if (status) {
      conditions.push(eq(schema.premises.status, status));
    }
    const rows = await db
      .select()
      .from(schema.premises)
      .where(and(...conditions))
      .orderBy(desc(schema.premises.createdAt));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      assertion: row.assertion as { text: string; tier: 'assertive' | 'contextual'; summary?: string },
      provenance: row.provenance as { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string },
      analysis: row.analysis as { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null,
      validity: row.validity as { validFrom?: string; validUntil?: string; volatile: boolean },
      embedding: row.embedding,
      status: row.status as 'ACTIVE' | 'RETRACTED' | 'EXPIRED',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      retractedAt: row.retractedAt ?? null,
    }));
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
  status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired';
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date | null;
  metadata: Record<string, unknown>;
}

/** Create opportunity input (matches protocol CreateOpportunityData). */
interface CreateOpportunityInput {
  detection: schema.OpportunityDetection;
  actors: schema.OpportunityActor[];
  interpretation: schema.OpportunityInterpretation;
  context: schema.OpportunityContext;
  confidence: string;
  status?: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired';
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
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
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

  async getOpportunitiesByIds(ids: string[]): Promise<OpportunityRow[]> {
    if (ids.length === 0) return [];
    const rows = await db.select().from(opportunities).where(inArray(opportunities.id, ids));
    return rows.map(toOpportunityRow);
  }

  /**
   * Resolve an opportunity ID from a full UUID or short prefix.
   * @param idOrPrefix - Full UUID or prefix (e.g. first 8 chars)
   * @param userId - The user ID (for visibility scoping via actors jsonb)
   * @returns Object with resolved id, or null/ambiguous status
   */
  async resolveOpportunityId(idOrPrefix: string, userId: string): Promise<{ id: string } | { ambiguous: true } | null> {
    const normalized = idOrPrefix.trim().toLowerCase();
    const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized);
    if (isFullUuid) {
      return { id: normalized };
    }
    const rows = await db.select({ id: opportunities.id })
      .from(opportunities)
      .where(and(
        sql`${opportunities.id} LIKE ${normalized + '%'}`,
        sql`${opportunities.actors}::jsonb @> ${JSON.stringify([{ userId }])}::jsonb`,
      ))
      .limit(2);
    if (rows.length === 0) return null;
    if (rows.length > 1) return { ambiguous: true };
    return { id: rows[0].id };
  }

  async getOpportunitiesForUser(
    userId: string,
    options?: { status?: string; statuses?: string[]; networkId?: string; role?: string; limit?: number; offset?: number; conversationId?: string }
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
    // Draft visibility: when explicit statuses are requested, the caller decides;
    // otherwise exclude drafts unless a conversationId scopes them to one session.
    const hasExplicitStatuses = (options?.statuses?.length ?? 0) > 0 || !!options?.status;
    if (!hasExplicitStatuses) {
      if (options?.conversationId == null) {
        conditions.push(sql`${opportunities.status} != 'draft'`);
      } else {
        conditions.push(
          sql`(${opportunities.status} != 'draft' OR (${opportunities.context}->>'conversationId') = ${options.conversationId})`
        );
      }
    }
    if (options?.status) conditions.push(eq(opportunities.status, options.status as typeof opportunities.$inferSelect.status));
    if (options?.networkId) {
      // Strict per-actor scope: the requesting user's own actor entry must be
      // anchored on the bound network. The looser pre-fix check (any actor or
      // context.networkId matching) leaked cross-network opps to scoped readers
      // when a counterpart was on the bound network but the viewer wasn't.
      conditions.push(sql`EXISTS (
        SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS actor
        WHERE actor->>'userId' = ${userId}
          AND actor->>'networkId' = ${options.networkId}
      )`);
    }
    if (options?.statuses?.length) {
      conditions.push(inArray(opportunities.status, options.statuses as Array<typeof opportunities.$inferSelect.status>));
    }
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

  async getOpportunitiesForNetwork(
    networkId: string,
    options?: { status?: string; limit?: number; offset?: number }
  ): Promise<OpportunityRow[]> {
    // Actor-anchored scope: an opportunity belongs to the network when at
    // least one actor was matched there. Replaces an earlier `context.networkId`
    // tag check — that field is a denormalization, not the source of truth, and
    // can drift from `actors[].networkId` in mixed-network introducer flows.
    const conditions = [sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) AS actor
      WHERE actor->>'networkId' = ${networkId}
    )`];
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
    status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
  ): Promise<OpportunityRow | null> {
    if (status === 'accepted' && !acceptedBy) {
      throw new Error('acceptedBy is required when status is accepted');
    }
    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === 'accepted') {
      updates.acceptedBy = acceptedBy;
    } else {
      updates.acceptedBy = null;
    }
    const [row] = await db
      .update(opportunities)
      .set(updates)
      .where(eq(opportunities.id, id))
      .returning();
    return row ? toOpportunityRow(row) : null;
  }

  async updateOpportunityActorApproval(
    id: string,
    introducerUserId: string,
    approved: boolean,
  ): Promise<OpportunityRow | null> {
    return db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ actors: opportunities.actors })
        .from(opportunities)
        .where(eq(opportunities.id, id))
        .for('update');
      if (!locked) return null;
      const updatedActors = (locked.actors as schema.OpportunityActor[]).map((actor) =>
        actor.role === 'introducer' && actor.userId === introducerUserId
          ? { ...actor, approved }
          : actor,
      );
      const [row] = await tx
        .update(opportunities)
        .set({ actors: updatedActors, updatedAt: new Date() })
        .where(eq(opportunities.id, id))
        .returning();
      return row ? toOpportunityRow(row) : null;
    });
  }

  async updateOpportunityMetadata(id: string, metadata: Record<string, unknown>): Promise<void> {
    await db.update(opportunities).set({ metadata, updatedAt: new Date() }).where(eq(opportunities.id, id));
  }

  async stampOpportunityActorAction(
    id: string,
    actorUserId: string,
    status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
  ): Promise<OpportunityRow | null> {
    if (status === 'accepted' && !acceptedBy) {
      throw new Error('acceptedBy is required when status is accepted');
    }
    return db.transaction(async (tx) => {
      const [locked] = await tx
        .select({ actors: opportunities.actors })
        .from(opportunities)
        .where(eq(opportunities.id, id))
        .for('update');
      if (!locked) return null;
      const nowIso = new Date().toISOString();
      const updatedActors = (locked.actors as schema.OpportunityActor[]).map((actor) =>
        actor.userId === actorUserId
          ? { ...actor, actedAt: actor.actedAt ?? nowIso }
          : actor,
      );
      const updates: Record<string, unknown> = {
        actors: updatedActors,
        status,
        updatedAt: new Date(),
      };
      if (status === 'accepted') {
        updates.acceptedBy = acceptedBy;
      } else {
        updates.acceptedBy = null;
      }
      const [row] = await tx
        .update(opportunities)
        .set(updates)
        .where(eq(opportunities.id, id))
        .returning();
      return row ? toOpportunityRow(row) : null;
    });
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

  async opportunityExistsBetweenActors(actorIds: string[], networkId: string): Promise<boolean> {
    if (actorIds.length === 0) return false;
    const expired = 'expired';
    const conditions = [
      sql`${opportunities.context}->>'networkId' = ${networkId}`,
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

  async findOpportunitiesByActors(
    actorIds: string[],
    options?: {
      includeIntroducers?: boolean;
      statuses?: ('latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired')[];
      excludeStatuses?: ('latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired')[];
    }
  ): Promise<OpportunityRow[]> {
    if (actorIds.length === 0) return [];
    const includeIntroducers = options?.includeIntroducers ?? false;

    const containmentConditions = includeIntroducers
      ? actorIds.map(
          (uid) => sql`${opportunities.actors} @> ${JSON.stringify([{ userId: uid }])}::jsonb`
        )
      : actorIds.map(
          (uid) => sql`EXISTS (
            SELECT 1 FROM jsonb_array_elements(${opportunities.actors}) elem
            WHERE elem->>'userId' = ${uid}
              AND elem->>'role' IS DISTINCT FROM 'introducer'
          )`
        );

    const conditions = [and(...containmentConditions)!];
    if (options?.statuses && options.statuses.length > 0) {
      conditions.push(inArray(opportunities.status, options.statuses));
    }
    if (options?.excludeStatuses && options.excludeStatuses.length > 0) {
      conditions.push(notInArray(opportunities.status, options.excludeStatuses));
    }

    const rows = await db
      .select()
      .from(opportunities)
      .where(and(...conditions))
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

  async expireOpportunitiesForRemovedMember(networkId: string, userId: string): Promise<number> {
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: new Date() })
      .where(
        and(
          sql`${opportunities.context}->>'networkId' = ${networkId}`,
          sql`${opportunities.actors} @> ${JSON.stringify([{ userId }])}::jsonb`
        )
      )
      .returning({ id: opportunities.id });
    return updated.length;
  }

  /** Set status to expired for opportunities with expires_at <= now. Skips terminal statuses (accepted, rejected, expired). */
  async expireStaleOpportunities(): Promise<number> {
    const now = new Date();
    const updated = await db
      .update(opportunities)
      .set({ status: 'expired', updatedAt: now })
      .where(
        and(
          isNotNull(opportunities.expiresAt),
          lte(opportunities.expiresAt, now),
          notInArray(opportunities.status, ['accepted', 'rejected', 'expired'])
        )
      )
      .returning({ id: opportunities.id });
    return updated.length;
  }

  /**
   * Retrieve premises for a user, optionally filtered by status.
   * Used by the opportunity graph prep node for premise-to-premise discovery.
   * @param userId - The user whose premises to retrieve
   * @param status - Optional status filter
   * @returns Array of premise records
   */
  async getPremisesForUser(userId: string, status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED'): Promise<Array<{
    id: string; userId: string;
    assertion: { text: string; tier: 'assertive' | 'contextual'; summary?: string };
    provenance: { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string };
    analysis: { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null;
    validity: { validFrom?: string; validUntil?: string; volatile: boolean };
    embedding: number[] | null;
    status: 'ACTIVE' | 'RETRACTED' | 'EXPIRED';
    createdAt: Date; updatedAt: Date; retractedAt: Date | null;
  }>> {
    const conditions: ReturnType<typeof eq>[] = [
      eq(schema.premises.userId, userId),
      isNull(schema.premises.deletedAt),
    ];
    if (status) {
      conditions.push(eq(schema.premises.status, status));
    }
    const rows = await db
      .select()
      .from(schema.premises)
      .where(and(...conditions))
      .orderBy(desc(schema.premises.createdAt));
    return rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      assertion: row.assertion as { text: string; tier: 'assertive' | 'contextual'; summary?: string },
      provenance: row.provenance as { source: 'explicit' | 'enrichment' | 'integration' | 'onboarding'; sourceId?: string; confidence: number; timestamp: string },
      analysis: row.analysis as { speechActType: 'DECLARATIVE' | 'ASSERTIVE'; felicityAuthority: number; felicitySincerity: number; felicityClarity: number; semanticEntropy: number } | null,
      validity: row.validity as { validFrom?: string; validUntil?: string; volatile: boolean },
      embedding: row.embedding,
      status: row.status as 'ACTIVE' | 'RETRACTED' | 'EXPIRED',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      retractedAt: row.retractedAt,
    }));
  }

  /**
   * Cosine similarity search against premise embeddings, scoped to shared networks.
   * Used by the opportunity graph's premise discovery path (path D).
   * @param params - Search parameters including embedding vector, network scope, and exclusions
   * @returns Matching premises ranked by cosine similarity
   */
  async searchPremisesBySimilarity(params: {
    embedding: number[];
    networkIds: string[];
    excludeUserId: string;
    limit: number;
  }) {
    const { embedding, networkIds, excludeUserId, limit } = params;
    const vectorStr = `[${embedding.join(',')}]`;

    const rows = await db.execute<{
      premiseId: string;
      userId: string;
      networkId: string;
      assertionText: string;
      similarity: number;
    }>(sql`
      SELECT
        p.id AS "premiseId",
        p.user_id AS "userId",
        pn.network_id AS "networkId",
        p.assertion->>'text' AS "assertionText",
        1 - (p.embedding <=> ${vectorStr}::vector) AS similarity
      FROM ${schema.premises} p
      JOIN ${schema.premiseNetworks} pn ON p.id = pn.premise_id
      WHERE pn.network_id = ANY(${networkIds})
        AND p.user_id != ${excludeUserId}
        AND p.status = 'ACTIVE'
        AND p.embedding IS NOT NULL
        AND p.deleted_at IS NULL
      ORDER BY p.embedding <=> ${vectorStr}::vector
      LIMIT ${limit}
    `);

    return rows as Array<{
      premiseId: string;
      userId: string;
      networkId: string;
      assertionText: string;
      similarity: number;
    }>;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Index Graph Database Adapter
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Database adapter for Index Graph (intent/index context and assignment).
 */
export class NetworkGraphDatabaseAdapter {
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

  async getNetworkMemberContext(networkId: string, userId: string) {
    const rows = await db
      .select({
        networkId: networks.id,
        indexPrompt: networks.prompt,
        memberPrompt: networkMembers.prompt,
      })
      .from(networks)
      .innerJoin(networkMembers, eq(networks.id, networkMembers.networkId))
      .where(
        and(
          eq(networks.id, networkId),
          eq(networkMembers.userId, userId),
          eq(networkMembers.autoAssign, true),
          isNull(networks.deletedAt)
        )
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async isIntentAssignedToIndex(intentId: string, networkId: string): Promise<boolean> {
    const rows = await db
      .select({ networkId: intentNetworks.networkId })
      .from(intentNetworks)
      .where(
        and(
          eq(intentNetworks.intentId, intentId),
          eq(intentNetworks.networkId, networkId)
        )
      )
      .limit(1);
    return rows.length > 0;
  }

  async assignIntentToNetwork(intentId: string, networkId: string, relevancyScore?: number): Promise<void> {
    await db.insert(intentNetworks)
      .values({ intentId, networkId, relevancyScore: relevancyScore != null ? String(relevancyScore) : null })
      .onConflictDoUpdate({
        target: [intentNetworks.intentId, intentNetworks.networkId],
        set: { relevancyScore: relevancyScore != null ? String(relevancyScore) : null },
      });
  }

  async unassignIntentFromIndex(intentId: string, networkId: string): Promise<void> {
    await db
      .delete(intentNetworks)
      .where(
        and(
          eq(intentNetworks.intentId, intentId),
          eq(intentNetworks.networkId, networkId)
        )
      );
  }

  async getNetworkIdsForIntent(intentId: string): Promise<string[]> {
    const rows = await db
      .select({ networkId: intentNetworks.networkId })
      .from(intentNetworks)
      .where(eq(intentNetworks.intentId, intentId));
    return rows.map((r) => r.networkId);
  }

  /**
   * Delete only index_members for an index (releases user FK for teardown).
   */
  async deleteMembersForNetwork(networkId: string): Promise<void> {
    await db.delete(networkMembers).where(eq(networkMembers.networkId, networkId));
  }

  /**
   * Delete an index and its members/intent-index links (for test teardown).
   */
  async deleteNetworkAndMembers(networkId: string): Promise<void> {
    await db.delete(intentNetworks).where(eq(intentNetworks.networkId, networkId));
    await db.delete(networkMembers).where(eq(networkMembers.networkId, networkId));
    await db.delete(networks).where(eq(networks.id, networkId));
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
  socials: Array<{ id: string; userId: string; label: string; value: string }>;
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

    return result[0] ?? null;
  }

  /**
   * Find multiple users by IDs. Returns public profile fields only (same shape as single-user API).
   */
  async findByIds(userIds: string[]): Promise<Array<{ id: string; name: string; intro: string | null; avatar: string | null; location: string | null; socials: Array<{ id: string; userId: string; label: string; value: string }>; isGhost: boolean; createdAt: Date; updatedAt: Date }>> {
    if (userIds.length === 0) return [];
    const userRows = await db.select({
      id: users.id,
      name: users.name,
      intro: users.intro,
      avatar: users.avatar,
      location: users.location,
      isGhost: users.isGhost,
      createdAt: users.createdAt,
      updatedAt: users.updatedAt,
    })
      .from(users)
      .where(inArray(users.id, userIds));

    const socialRows = await db.select()
      .from(userSocials)
      .where(inArray(userSocials.userId, userIds));

    const socialsByUser = new Map<string, Array<{ id: string; userId: string; label: string; value: string }>>();
    for (const s of socialRows) {
      const arr = socialsByUser.get(s.userId) ?? [];
      arr.push({ id: s.id, userId: s.userId, label: s.label, value: s.value });
      socialsByUser.set(s.userId, arr);
    }

    return userRows.map(u => ({
      ...u,
      socials: socialsByUser.get(u.id) ?? [],
    }));
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
  }): Promise<typeof users.$inferSelect> {
    const [row] = await db.insert(users)
      .values({
        email: data.email,
        name: data.name ?? data.email.split('@')[0],
        intro: data.intro ?? null,
        location: data.location ?? null,
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
   * Find user by key (human-readable identifier).
   * @param key - The user's key
   * @returns User record or null
   */
  async findByKey(key: string): Promise<typeof users.$inferSelect | null> {
    const result = await db.select()
      .from(users)
      .where(eq(users.key, key))
      .limit(1);
    return result[0] ?? null;
  }

  /**
   * Find user by ID or key. Detects UUID format to decide which column to query.
   * @param idOrKey - UUID or human-readable key
   * @returns User record or null
   */
  async findByIdOrKey(idOrKey: string): Promise<typeof users.$inferSelect | null> {
    const isUuidFormat = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(idOrKey);
    if (isUuidFormat) {
      return this.findById(idOrKey);
    }
    return this.findByKey(idOrKey);
  }

  /**
   * Check if a key already exists for any user.
   * @param key - The key to check
   * @returns True if the key is taken
   */
  async keyExists(key: string): Promise<boolean> {
    const result = await db.select({ id: users.id })
      .from(users)
      .where(eq(users.key, key))
      .limit(1);
    return result.length > 0;
  }

  /**
   * Update a user's key.
   * @param userId - The user ID
   * @param key - The new key value
   * @returns Updated user or null
   */
  async updateKey(userId: string, key: string): Promise<typeof users.$inferSelect | null> {
    const result = await db.update(users)
      .set({ key, updatedAt: new Date() })
      .where(eq(users.id, userId))
      .returning();
    return result[0] ?? null;
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

    const socialRows = await db.select()
      .from(userSocials)
      .where(eq(userSocials.userId, userId));

    return {
      ...user,
      socials: socialRows.map(s => ({ id: s.id, userId: s.userId, label: s.label, value: s.value })),
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

  async getSocials(userId: string): Promise<Array<{ id: string; userId: string; label: string; value: string }>> {
    const rows = await db.select()
      .from(userSocials)
      .where(eq(userSocials.userId, userId));
    return rows.map(s => ({ id: s.id, userId: s.userId, label: s.label, value: s.value }));
  }

  async setSocials(userId: string, socials: { label: string; value: string }[]): Promise<void> {
    const profileAdapter = new ProfileDatabaseAdapter();
    return profileAdapter.setUserSocials(userId, socials);
  }

  /**
   * Update user
   */
  async update(userId: string, data: Partial<User>): Promise<typeof users.$inferSelect | null> {
    const { socials: _socials, ...rest } = data as Partial<User> & { socials?: unknown };
    const result = await db.update(users)
      .set({
        ...rest,
        updatedAt: new Date()
      })
      .where(eq(users.id, userId))
      .returning();

    return result[0] || null;
  }

  /**
   * Deletes all sessions for a user (used before soft-delete to invalidate auth).
   * @param userId - The user whose sessions should be removed
   */
  async deleteUserSessions(userId: string): Promise<void> {
    await db.delete(sessions).where(eq(sessions.userId, userId));
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

  /**
   * Get the stored Telegram connection prefs for a user.
   * Returns null when the user has no Telegram connection.
   * @param userId - The user whose Telegram prefs to retrieve
   * @returns The TelegramPrefs or null if not connected
   */
  async getTelegramPrefs(userId: string): Promise<TelegramPrefs | null> {
    const result = await db
      .select({ preferences: userNotificationSettings.preferences })
      .from(userNotificationSettings)
      .where(eq(userNotificationSettings.userId, userId))
      .limit(1);
    return (result[0]?.preferences as NotificationPreferences | undefined)?.telegram ?? null;
  }

  /**
   * Upsert the telegram key inside user_notification_settings.preferences,
   * preserving existing connectionUpdates / weeklyNewsletter values.
   * @param userId - The user whose Telegram prefs to update
   * @param telegramPrefs - The new Telegram prefs to store
   */
  async updateTelegramPrefs(userId: string, telegramPrefs: TelegramPrefs): Promise<void> {
    const existing = await db
      .select({ preferences: userNotificationSettings.preferences })
      .from(userNotificationSettings)
      .where(eq(userNotificationSettings.userId, userId))
      .limit(1);
    const current = (existing[0]?.preferences as NotificationPreferences | undefined) ?? {
      connectionUpdates: true,
      weeklyNewsletter: true,
    };
    const updated: NotificationPreferences = { ...current, telegram: telegramPrefs };
    await db
      .insert(userNotificationSettings)
      .values({ userId, preferences: updated })
      .onConflictDoUpdate({
        target: userNotificationSettings.userId,
        set: { preferences: updated, updatedAt: new Date() },
      });
  }

  /**
   * Remove the telegram key from user_notification_settings.preferences.
   * No-op if the user has no notification settings row.
   * @param userId - The user whose Telegram prefs to clear
   */
  async clearTelegramPrefs(userId: string): Promise<void> {
    const existing = await db
      .select({ preferences: userNotificationSettings.preferences })
      .from(userNotificationSettings)
      .where(eq(userNotificationSettings.userId, userId))
      .limit(1);
    if (!existing[0]) return;
    const { telegram: _removed, ...rest } = (existing[0].preferences as NotificationPreferences | null) ?? {};
    await db
      .update(userNotificationSettings)
      .set({ preferences: rest as NotificationPreferences, updatedAt: new Date() })
      .where(eq(userNotificationSettings.userId, userId));
  }

  /**
   * Find a user by their stored Telegram chatId.
   * Used by the gateway to route inbound messages.
   * @param chatId - The Telegram chat ID to look up
   * @returns The userId and optional sessionId, or null if not found
   */
  async findByTelegramChatId(chatId: string): Promise<{ userId: string; sessionId?: string } | null> {
    const result = await db
      .select({
        userId: userNotificationSettings.userId,
        preferences: userNotificationSettings.preferences,
      })
      .from(userNotificationSettings)
      .where(sql`${userNotificationSettings.preferences}->'telegram'->>'chatId' = ${chatId}`)
      .limit(1);
    if (!result[0]) return null;
    const telegram = (result[0].preferences as NotificationPreferences | undefined)?.telegram;
    return { userId: result[0].userId, sessionId: telegram?.sessionId };
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

// ─────────────────────────────────────────────────────────────────────────────
// Local types for context-bound database factories
// (structurally aligned with lib/protocol/interfaces — no import coupling)
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal vector store contract used by createSystemDatabase for findSimilarIntentsInScope. */
interface VectorStore {
  search<T>(
    queryVector: number[],
    collection: string,
    options?: { limit?: number; filter?: Record<string, unknown>; minScore?: number },
  ): Promise<{ item: T; score: number }[]>;
}

/** Intent record with similarity score, returned by findSimilarIntentsInScope. */
interface SimilarIntent {
  id: string;
  payload: string;
  summary: string | null;
  isIncognito: boolean;
  createdAt: Date;
  updatedAt: Date;
  userId: string;
  archivedAt: Date | null;
  similarity: number;
}

/**
 * Creates a UserDatabase bound to the authenticated user.
 * All operations are scoped to the user's own resources (no userId param needed).
 *
 * @param db - The raw ChatDatabaseAdapter
 * @param authUserId - The authenticated user's ID
 * @returns A UserDatabase bound to authUserId
 */
/**
 * Role-based opportunity visibility check.
 * Mirrors the Latent Opportunity Lifecycle visibility matrix:
 * - Introducer/peer: always visible.
 * - Patient/party: visible unless status is latent AND an introducer exists.
 * - Agent: visible only for terminal statuses, or non-latent when no introducer.
 */
function canActorSeeOpportunity(
  actors: Array<{ userId: string; role: string }>,
  status: string,
  userId: string,
): boolean {
  const hasIntroducer = actors.some((a) => a.role === 'introducer');
  const userRoles = actors.filter((a) => a.userId === userId).map((a) => a.role);
  if (userRoles.length === 0) return false;

  return userRoles.some((role) => {
    if (role === 'introducer' || role === 'peer') return true;
    if (role === 'patient' || role === 'party')
      return status !== 'latent' || !hasIntroducer;
    if (role === 'agent')
      return (
        ['accepted', 'rejected', 'expired'].includes(status) ||
        (status !== 'latent' && !hasIntroducer)
      );
    return false;
  });
}

export function createUserDatabase(db: ChatDatabaseAdapter, authUserId: string) {
  return {
    authUserId,

    // ─────────────────────────────────────────────────────────────────────────────
    // Profile Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getProfile: () => db.getProfile(authUserId),
    getProfileByUserId: () => db.getProfileByUserId(authUserId),
    saveProfile: (profile: Parameters<ChatDatabaseAdapter['saveProfile']>[1]) => db.saveProfile(authUserId, profile),
    deleteProfile: () => db.deleteProfile(authUserId),
    getUser: () => db.getUser(authUserId),
    updateUser: (data: Parameters<ChatDatabaseAdapter['updateUser']>[1]) => db.updateUser(authUserId, data),
    getUserSocials: () => db.getUserSocials(authUserId),
    setUserSocials: (socials: { label: string; value: string }[]) => db.setUserSocials(authUserId, socials),

    // ─────────────────────────────────────────────────────────────────────────────
    // Intent Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getActiveIntents: () => db.getActiveIntents(authUserId),
    searchOwnIntents: (q: string, limit: number) => db.searchOwnIntents(authUserId, q, limit),
    getIntent: async (intentId: string) => {
      // Enforce ownership by checking userId on returned intent
      const intent = await db.getIntent(intentId);
      if (!intent) return null;
      if (intent.userId !== authUserId) {
        throw new Error('Access denied: intent not owned by user');
      }
      return intent;
    },
    createIntent: (data: Omit<Parameters<ChatDatabaseAdapter['createIntent']>[0], 'userId'>) => db.createIntent({ ...data, userId: authUserId }),
    updateIntent: async (intentId: string, data: Parameters<ChatDatabaseAdapter['updateIntent']>[1]) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.updateIntent(intentId, data);
    },
    archiveIntent: async (intentId: string) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.archiveIntent(intentId);
    },
    findSimilarIntents: async (_embedding: number[], _options?: { limit?: number; threshold?: number }) => {
      // findSimilarIntents is not yet implemented on ChatDatabaseAdapter
      // This is a placeholder - would need vector search implementation
      log.warn('UserDatabase.findSimilarIntents called but not fully implemented');
      return [] as SimilarIntent[];
    },
    getIntentForIndexing: async (intentId: string) => {
      const intent = await db.getIntentForIndexing(intentId);
      if (!intent) return null;
      if (intent.userId !== authUserId) {
        throw new Error('Access denied: intent not owned by user');
      }
      return intent;
    },
    associateIntentWithNetworks: async (intentId: string, indexIds: string[]) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      for (const networkId of indexIds) {
        await db.assignIntentToNetwork(intentId, networkId);
      }
    },
    assignIntentToNetwork: async (intentId: string, networkId: string, relevancyScore?: number) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.assignIntentToNetwork(intentId, networkId, relevancyScore);
    },
    unassignIntentFromIndex: async (intentId: string, networkId: string) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.unassignIntentFromIndex(intentId, networkId);
    },
    getNetworkIdsForIntent: async (intentId: string) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.getNetworkIdsForIntent(intentId);
    },
    isIntentAssignedToIndex: async (intentId: string, networkId: string) => {
      const intent = await db.getIntent(intentId);
      if (!intent) throw new Error('Intent not found');
      if (intent.userId !== authUserId) throw new Error('Access denied: intent not owned by user');
      return db.isIntentAssignedToIndex(intentId, networkId);
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Index Membership Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getNetworkMemberships: () => db.getNetworkMemberships(authUserId),
    getUserIndexIds: () => db.getUserIndexIds(authUserId),
    getOwnedIndexes: () => db.getOwnedIndexes(authUserId),
    getNetworkMembership: (networkId: string) => db.getNetworkMembership(networkId, authUserId),
    getNetworkMemberContext: (networkId: string) => db.getNetworkMemberContext(networkId, authUserId),

    // ─────────────────────────────────────────────────────────────────────────────
    // Index CRUD Operations
    // ─────────────────────────────────────────────────────────────────────────────
    createNetwork: (data: Parameters<ChatDatabaseAdapter['createNetwork']>[0]) => db.createNetwork(data),
    updateIndexSettings: (networkId: string, data: Parameters<ChatDatabaseAdapter['updateIndexSettings']>[2]) => db.updateIndexSettings(networkId, authUserId, data),
    softDeleteNetwork: async (networkId: string) => {
      const isOwner = await db.isIndexOwner(networkId, authUserId);
      if (!isOwner) throw new Error('Access denied: not index owner');
      const isPersonal = await db.isPersonalNetwork(networkId);
      if (isPersonal) throw new Error('Cannot delete personal index');
      return db.softDeleteNetwork(networkId);
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Public Index Discovery
    // ─────────────────────────────────────────────────────────────────────────────
    getPublicIndexesNotJoined: () => db.getPublicIndexesNotJoined(authUserId),
    joinPublicNetwork: (networkId: string) => db.joinPublicNetwork(networkId, authUserId),

    // ─────────────────────────────────────────────────────────────────────────────
    // Opportunity Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getOpportunitiesForUser: (options?: Parameters<ChatDatabaseAdapter['getOpportunitiesForUser']>[1]) => db.getOpportunitiesForUser(authUserId, options),
    getOpportunity: async (id: string) => {
      const opportunity = await db.getOpportunity(id);
      if (!opportunity) return null;
      if (!canActorSeeOpportunity(opportunity.actors, opportunity.status, authUserId))
        throw new Error('Access denied: opportunity not visible to user');
      return opportunity;
    },
    updateOpportunityStatus: async (id: string, status: Parameters<ChatDatabaseAdapter['updateOpportunityStatus']>[1]) => {
      const opportunity = await db.getOpportunity(id);
      if (!opportunity) throw new Error('Opportunity not found');
      if (!canActorSeeOpportunity(opportunity.actors, opportunity.status, authUserId))
        throw new Error('Access denied: opportunity not visible to user');
      return db.updateOpportunityStatus(id, status, status === 'accepted' ? authUserId : undefined);
    },
    acceptSiblingOpportunities: (counterpartUserId: string, excludeOpportunityId: string) =>
      db.acceptSiblingOpportunities(authUserId, counterpartUserId, excludeOpportunityId),

    // ─────────────────────────────────────────────────────────────────────────────
    // HyDE Operations
    // ─────────────────────────────────────────────────────────────────────────────
    getHydeDocument: (sourceType: Parameters<ChatDatabaseAdapter['getHydeDocument']>[0], sourceId: string, strategy: string) => db.getHydeDocument(sourceType, sourceId, strategy),
    getHydeDocumentsForSource: (sourceType: Parameters<ChatDatabaseAdapter['getHydeDocumentsForSource']>[0], sourceId: string) => db.getHydeDocumentsForSource(sourceType, sourceId),
    saveHydeDocument: (data: Parameters<ChatDatabaseAdapter['saveHydeDocument']>[0]) => db.saveHydeDocument(data),
    deleteHydeDocumentsForSource: (sourceType: Parameters<ChatDatabaseAdapter['deleteHydeDocumentsForSource']>[0], sourceId: string) => db.deleteHydeDocumentsForSource(sourceType, sourceId),
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
) {
  /**
   * Verify that a networkId is within the allowed scope.
   * Throws if the network is not in scope.
   */
  const verifyScope = (networkId: string): void => {
    if (!indexScope.includes(networkId)) {
      throw new Error(`Access denied: index ${networkId} not in scope`);
    }
  };

  /**
   * Verify that a user shares at least one index with the auth user.
   * Returns true if they share an index, false otherwise.
   */
  const verifySharedIndex = async (userId: string): Promise<boolean> => {
    if (userId === authUserId) return true;
    const theirMemberships = await db.getNetworkMemberships(userId);
    if (theirMemberships.some((m) => indexScope.includes(m.networkId))) return true;

    // Check if either user's personal index contains the other as a contact
    const myPersonalId = await getPersonalIndexId(authUserId);
    const theirPersonalId = await getPersonalIndexId(userId);

    if (myPersonalId) {
      const theirMembership = await db.getNetworkMembership(myPersonalId, userId);
      if (theirMembership) return true;
    }
    if (theirPersonalId) {
      const myMembership = await db.getNetworkMembership(theirPersonalId, authUserId);
      if (myMembership) return true;
    }
    return false;
  };

  return {
    authUserId,
    indexScope,

    // ─────────────────────────────────────────────────────────────────────────────
    // Profile Operations (cross-user within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    getProfile: async (userId: string) => {
      if (!(await verifySharedIndex(userId))) {
        throw new Error('Access denied: no shared index with user');
      }
      return db.getProfile(userId);
    },
    getUser: async (userId: string) => {
      if (!(await verifySharedIndex(userId))) {
        throw new Error('Access denied: no shared index with user');
      }
      return db.getUser(userId);
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Intent Operations (cross-user within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    getIntentsInIndex: async (networkId: string, options?: { limit?: number; offset?: number }) => {
      verifyScope(networkId);
      return db.getNetworkIntentsForMember(networkId, authUserId, options);
    },
    getUserIntentsInIndex: async (userId: string, networkId: string) => {
      verifyScope(networkId);
      return db.getIntentsInIndexForMember(userId, networkId);
    },
    getActiveIntentsAcrossIndexes: async (userId: string, indexIds: string[]) => {
      // Caller-only semantic: the method returns the *caller's own* intents.
      // Reject cross-user lookups at the systemDb boundary as defense-in-depth,
      // even though the tool layer always passes context.userId today.
      if (userId !== authUserId) {
        throw new Error('Access denied: getActiveIntentsAcrossIndexes is caller-only');
      }
      // Filter to only IDs within scope before delegating.
      const scopedIds = indexIds.filter((id) => indexScope.includes(id));
      return db.getActiveIntentsAcrossIndexes(userId, scopedIds);
    },
    /**
     * Retrieves an intent by ID without scope check.
     * @remarks Intentionally unscoped -- used by agent graphs (e.g. opportunity evaluator,
     * negotiation) that need cross-user intent access within the discovery pipeline.
     */
    getIntent: (intentId: string) => db.getIntent(intentId),
    findSimilarIntentsInScope: async (embedding: number[], options?: { limit?: number; threshold?: number }) => {
      if (!embedder || indexScope.length === 0) {
        return [] as SimilarIntent[];
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
    /**
     * Checks network membership without scope check.
     * @remarks Intentionally unscoped -- used by agent graphs and tools that need to verify
     * membership for any user (e.g. join flows, invitation acceptance).
     */
    isNetworkMember: (networkId: string, userId: string) => db.isNetworkMember(networkId, userId),
    /**
     * Checks index ownership without scope check.
     * @remarks Intentionally unscoped -- used by agent graphs and tools that need to verify
     * ownership for any user (e.g. permission checks during graph execution).
     */
    isIndexOwner: (networkId: string, userId: string) => db.isIndexOwner(networkId, userId),
    getNetworkMembers: async (networkId: string) => {
      verifyScope(networkId);
      return db.getNetworkMembersForMember(networkId, authUserId);
    },
    getMembersFromScope: () => db.getMembersFromUserIndexes(authUserId as Id<'users'>),
    /**
     * Adds a member to an index without scope check.
     * @remarks Intentionally unscoped -- used by join flows, invitation acceptance, and
     * contact addition that operate outside the caller's current index scope.
     */
    addMemberToNetwork: (networkId: string, userId: string, role: 'owner' | 'member') => db.addMemberToNetwork(networkId, userId, role),
    /**
     * Removes a member from an index without scope check.
     * @remarks Intentionally unscoped -- used by leave/kick flows and member removal
     * handlers that operate across user boundaries.
     */
    removeMemberFromIndex: (networkId: string, userId: string) => db.removeMemberFromIndex(networkId, userId),

    // ─────────────────────────────────────────────────────────────────────────────
    // Index Operations (within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    getNetwork: async (networkId: string) => {
      verifyScope(networkId);
      return db.getNetwork(networkId);
    },
    getNetworkWithPermissions: async (networkId: string) => {
      verifyScope(networkId);
      return db.getNetworkWithPermissions(networkId);
    },
    getNetworkMemberCount: async (networkId: string) => {
      verifyScope(networkId);
      return db.getNetworkMemberCount(networkId);
    },

    // ─────────────────────────────────────────────────────────────────────────────
    // Opportunity Operations (cross-user within scope)
    // ─────────────────────────────────────────────────────────────────────────────
    createOpportunity: (data: Parameters<ChatDatabaseAdapter['createOpportunity']>[0]) => {
      const networkId = data.context?.networkId;
      if (networkId) verifyScope(networkId);
      return db.createOpportunity(data);
    },
    /**
     * Creates an opportunity and expires previous ones atomically without scope check.
     * @remarks Intentionally unscoped -- called by the discovery pipeline (negotiation
     * finalization) which creates opportunities across user boundaries.
     */
    createOpportunityAndExpireIds: (data: Parameters<ChatDatabaseAdapter['createOpportunityAndExpireIds']>[0], expireIds: string[]) => db.createOpportunityAndExpireIds(data, expireIds),
    /**
     * Retrieves an opportunity by ID without scope check.
     * @remarks Intentionally unscoped -- used by the negotiation graph and opportunity
     * tools that need cross-actor access during the discovery pipeline.
     */
    getOpportunity: (id: string) => db.getOpportunity(id),
    getOpportunitiesForNetwork: async (networkId: string, options?: Parameters<ChatDatabaseAdapter['getOpportunitiesForNetwork']>[1]) => {
      verifyScope(networkId);
      return db.getOpportunitiesForNetwork(networkId, options);
    },
    updateOpportunityStatus: async (id: string, status: Parameters<ChatDatabaseAdapter['updateOpportunityStatus']>[1], acceptedBy?: string) => {
      const opportunity = await db.getOpportunity(id);
      if (!opportunity) throw new Error('Opportunity not found');
      const opportunityIndexId = opportunity.context?.networkId;
      if (!opportunityIndexId) throw new Error('Opportunity not found');
      verifyScope(opportunityIndexId);
      return acceptedBy ? db.updateOpportunityStatus(id, status, acceptedBy) : db.updateOpportunityStatus(id, status);
    },
    stampOpportunityActorAction: async (id: string, actorUserId: string, status: Parameters<ChatDatabaseAdapter['stampOpportunityActorAction']>[2], acceptedBy?: string) => {
      const opportunity = await db.getOpportunity(id);
      if (!opportunity) throw new Error('Opportunity not found');
      const opportunityIndexId = opportunity.context?.networkId;
      if (!opportunityIndexId) throw new Error('Opportunity not found');
      verifyScope(opportunityIndexId);
      return db.stampOpportunityActorAction(id, actorUserId, status, acceptedBy);
    },
    opportunityExistsBetweenActors: (actorIds: string[], networkId: string) => {
      verifyScope(networkId);
      return db.opportunityExistsBetweenActors(actorIds, networkId);
    },
    findOpportunitiesByActors: (actorIds: string[], options?: Parameters<ChatDatabaseAdapter['findOpportunitiesByActors']>[1]) =>
      db.findOpportunitiesByActors(actorIds, options),
    /**
     * Expires all opportunities linked to an intent without scope check.
     * @remarks Intentionally unscoped -- called by intent archival event handlers
     * that clean up opportunities when an intent is expired or archived.
     */
    expireOpportunitiesByIntent: (intentId: string) => db.expireOpportunitiesByIntent(intentId),
    /**
     * Expires opportunities for a removed member without scope check.
     * @remarks Intentionally unscoped -- called by index membership removal event handlers
     * that clean up opportunities when a member leaves or is kicked from an index.
     */
    expireOpportunitiesForRemovedMember: (networkId: string, userId: string) => db.expireOpportunitiesForRemovedMember(networkId, userId),
    /**
     * Expires stale opportunities without scope check.
     * @remarks Intentionally unscoped -- called by scheduled cleanup jobs (cron)
     * that operate system-wide, not scoped to any particular user.
     */
    expireStaleOpportunities: () => db.expireStaleOpportunities(),

    // ─────────────────────────────────────────────────────────────────────────────
    // HyDE Operations (cross-user for opportunity matching)
    // ─────────────────────────────────────────────────────────────────────────────
    getHydeDocument: (sourceType: Parameters<ChatDatabaseAdapter['getHydeDocument']>[0], sourceId: string, strategy: string) => db.getHydeDocument(sourceType, sourceId, strategy),
    getHydeDocumentsForSource: (sourceType: Parameters<ChatDatabaseAdapter['getHydeDocumentsForSource']>[0], sourceId: string) => db.getHydeDocumentsForSource(sourceType, sourceId),
    saveHydeDocument: (data: Parameters<ChatDatabaseAdapter['saveHydeDocument']>[0]) => db.saveHydeDocument(data),
    deleteExpiredHydeDocuments: () => db.deleteExpiredHydeDocuments(),
    getStaleHydeDocuments: (threshold: Date) => db.getStaleHydeDocuments(threshold),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Conversation Database Adapter
// ─────────────────────────────────────────────────────────────────────────────

/** Participant with resolved user info. */
export interface ResolvedParticipant {
  participantId: string;
  participantType: 'user' | 'agent';
  name: string | null;
  avatar: string | null;
  /** For agent participants, the display name of the user the agent acts on behalf of. */
  ownerName?: string | null;
}

/** Summary returned by getConversationsForUser. */
export interface ConversationSummary {
  id: string;
  lastMessageAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  participants: ResolvedParticipant[];
  lastMessage: { parts: unknown[]; senderId: string; createdAt: Date } | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Database adapter for the A2A-aligned conversation tables.
 *
 * @remarks
 * Covers conversations, participants, messages, tasks, artifacts, and metadata.
 * Uses Drizzle ORM against the `conversations` family of tables.
 */
export class ConversationDatabaseAdapter {
  // ─────────────────────────────────────────────────────────────────────────
  // Conversations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Creates a conversation and inserts participants in a single transaction.
   * @param participants - List of participant descriptors
   * @returns The newly created conversation row
   */
  async createConversation(
    participants: { participantId: string; participantType: 'user' | 'agent' }[],
  ): Promise<Conversation> {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(schema.conversations).values({ id, createdAt: now, updatedAt: now });
      if (participants.length > 0) {
        await tx.insert(schema.conversationParticipants).values(
          participants.map((p) => ({
            conversationId: id,
            participantId: p.participantId,
            participantType: p.participantType,
          })),
        );
      }
    });

    return { id, dmPair: null, lastMessageAt: null, createdAt: now, updatedAt: now };
  }

  /**
   * Resolve a conversation ID from a full UUID or short prefix.
   * @param idOrPrefix - Full UUID or prefix (e.g. first 8 chars)
   * @param userId - The user ID (for participant scoping)
   * @returns Object with resolved id, or null/ambiguous status
   */
  async resolveConversationId(idOrPrefix: string, userId: string): Promise<{ id: string } | { ambiguous: true } | null> {
    const normalized = idOrPrefix.trim().toLowerCase();
    const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized);
    if (isFullUuid) {
      return { id: normalized };
    }
    const rows = await db.select({ id: schema.conversationParticipants.conversationId })
      .from(schema.conversationParticipants)
      .where(and(
        sql`${schema.conversationParticipants.conversationId} LIKE ${normalized + '%'}`,
        eq(schema.conversationParticipants.participantId, userId),
      ))
      .limit(2);
    if (rows.length === 0) return null;
    if (rows.length > 1) return { ambiguous: true };
    return { id: rows[0].id };
  }

  /**
   * Retrieves a conversation by ID with its participants.
   * @param id - Conversation ID
   * @returns Conversation with participants, or null if not found
   */
  async getConversation(
    id: string,
  ): Promise<(Conversation & { participants: ConversationParticipant[] }) | null> {
    const [conv] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id))
      .limit(1);

    if (!conv) return null;

    const participants = await db
      .select()
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.conversationId, id));

    return { ...conv, participants };
  }

  /**
   * Lists conversations for a user, ordered by most recent message.
   * @param userId - The user whose conversations to list
   * @returns Summaries with participant lists
   */
  async getConversationsForUser(userId: string): Promise<ConversationSummary[]> {
    // Include conversations that are not hidden OR have new messages since hiding
    const rows = await db
      .select({
        conversationId: schema.conversationParticipants.conversationId,
        hiddenAt: schema.conversationParticipants.hiddenAt,
      })
      .from(schema.conversationParticipants)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationParticipants.conversationId, schema.conversations.id),
      )
      .where(
        and(
          eq(schema.conversationParticipants.participantId, userId),
          or(
            isNull(schema.conversationParticipants.hiddenAt),
            gt(schema.conversations.lastMessageAt, schema.conversationParticipants.hiddenAt),
          ),
        ),
      );

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.conversationId);
    const hiddenAtByConv = new Map<string, Date | null>();
    for (const r of rows) {
      hiddenAtByConv.set(r.conversationId, r.hiddenAt);
    }

    const convs = await db
      .select()
      .from(schema.conversations)
      .where(inArray(schema.conversations.id, ids))
      .orderBy(sql`${schema.conversations.lastMessageAt} DESC NULLS LAST`);

    const allParticipants = await db
      .select()
      .from(schema.conversationParticipants)
      .where(inArray(schema.conversationParticipants.conversationId, ids));

    // Resolve user names/avatars for participants
    const userIds = [...new Set(allParticipants.filter(p => p.participantType === 'user').map(p => p.participantId))];
    // Also resolve owner users behind agent: participants
    const agentOwnerIds = [...new Set(
      allParticipants
        .filter(p => p.participantType === 'agent' && p.participantId.startsWith('agent:'))
        .map(p => p.participantId.slice('agent:'.length)),
    )];
    const allUserIds = [...new Set([...userIds, ...agentOwnerIds])];
    const userMap = new Map<string, { name: string; avatar: string | null }>();
    if (allUserIds.length > 0) {
      const users = await db
        .select({ id: schema.users.id, name: schema.users.name, avatar: schema.users.avatar })
        .from(schema.users)
        .where(inArray(schema.users.id, allUserIds));
      for (const u of users) {
        userMap.set(u.id, { name: u.name, avatar: u.avatar });
      }
    }

    // Resolve the system negotiator agent name (used as the fallback label when no
    // personal agent drove any turn on a user's side). Well-known UUID from
    // agent.database.adapter.ts SYSTEM_AGENT_IDS.negotiator.
    let systemNegotiatorName = 'Index Negotiator';
    const negotiatorRow = await db
      .select({ name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.id, '00000000-0000-0000-0000-000000000002'))
      .limit(1);
    if (negotiatorRow.length > 0) {
      systemNegotiatorName = negotiatorRow[0].name;
    }

    // Resolve the *actual* agent that drove each user's side. For polling-backed turns,
    // tasks.claimed_by_agent_id is set to the personal agent that picked the turn up.
    // Fall back to the system negotiator when no claim exists (sync system-driven turns).
    // Map: conversationId → (ownerUserId → agent { id, name, avatar })
    const claimedAgentByConv = new Map<string, Map<string, { name: string; avatar: string | null }>>();
    if (ids.length > 0) {
      const claimRows = await db
        .select({
          conversationId: schema.tasks.conversationId,
          agentId: schema.tasks.claimedByAgentId,
          agentName: schema.agents.name,
          agentType: schema.agents.type,
          ownerId: schema.agents.ownerId,
          avatar: schema.users.avatar,
        })
        .from(schema.tasks)
        .innerJoin(schema.agents, eq(schema.agents.id, schema.tasks.claimedByAgentId))
        .leftJoin(schema.users, eq(schema.users.id, schema.agents.ownerId))
        .where(
          and(
            inArray(schema.tasks.conversationId, ids),
            eq(schema.agents.type, 'personal'),
          ),
        )
        // Deterministic ordering so that if a conversation ever has claims
        // from multiple personal agents for the same owner, the displayed
        // agent name is stable across requests. Most recent claim wins.
        .orderBy(desc(schema.tasks.claimedAt), asc(schema.agents.id));
      for (const r of claimRows) {
        if (!r.ownerId) continue;
        const convMap = claimedAgentByConv.get(r.conversationId) ?? new Map();
        // First row wins after deterministic ordering — most recent claim per owner.
        if (!convMap.has(r.ownerId)) {
          convMap.set(r.ownerId, { name: r.agentName, avatar: r.avatar });
        }
        claimedAgentByConv.set(r.conversationId, convMap);
      }
    }

    const participantsByConv = new Map<string, ResolvedParticipant[]>();
    for (const p of allParticipants) {
      const list = participantsByConv.get(p.conversationId) ?? [];
      if (p.participantType === 'agent' && p.participantId.startsWith('agent:')) {
        const ownerId = p.participantId.slice('agent:'.length);
        const ownerInfo = userMap.get(ownerId);
        const claimedAgent = claimedAgentByConv.get(p.conversationId)?.get(ownerId);
        list.push({
          participantId: p.participantId,
          participantType: p.participantType,
          name: claimedAgent?.name ?? systemNegotiatorName,
          avatar: ownerInfo?.avatar ?? null,
          ownerName: ownerInfo?.name ?? null,
        });
      } else {
        const userInfo = userMap.get(p.participantId);
        list.push({
          participantId: p.participantId,
          participantType: p.participantType,
          name: userInfo?.name ?? null,
          avatar: userInfo?.avatar ?? null,
        });
      }
      participantsByConv.set(p.conversationId, list);
    }

    // Fetch last message per conversation efficiently using DISTINCT ON
    const lastMessageByConv = new Map<string, { parts: unknown[]; senderId: string; createdAt: Date }>();
    if (ids.length > 0) {
      const lastMessages = await db
        .selectDistinctOn([schema.messages.conversationId], {
          conversationId: schema.messages.conversationId,
          parts: schema.messages.parts,
          senderId: schema.messages.senderId,
          createdAt: schema.messages.createdAt,
        })
        .from(schema.messages)
        .where(inArray(schema.messages.conversationId, ids))
        .orderBy(schema.messages.conversationId, desc(schema.messages.createdAt));

      for (const r of lastMessages) {
        const hiddenAt = hiddenAtByConv.get(r.conversationId);
        if (hiddenAt && r.createdAt <= hiddenAt) continue;
        lastMessageByConv.set(r.conversationId, {
          parts: r.parts as unknown[],
          senderId: r.senderId,
          createdAt: r.createdAt,
        });
      }
    }

    // Fetch metadata per conversation
    const allMeta = ids.length > 0
      ? await db
          .select()
          .from(schema.conversationMetadata)
          .where(inArray(schema.conversationMetadata.conversationId, ids))
      : [];

    const metaByConv = new Map<string, Record<string, unknown>>();
    for (const m of allMeta) {
      metaByConv.set(m.conversationId, m.metadata as Record<string, unknown>);
    }

    return convs.map((c) => ({
      ...c,
      participants: participantsByConv.get(c.id) ?? [],
      lastMessage: lastMessageByConv.get(c.id) ?? null,
      metadata: metaByConv.get(c.id) ?? null,
    }));
  }

  /**
   * Finds an existing DM between exactly two users, or creates one.
   * Uses a unique `dmPair` column to prevent duplicate DMs under concurrency.
   * @param userA - First user ID
   * @param userB - Second user ID
   * @returns The existing or newly created conversation
   */
  async getOrCreateDM(userA: string, userB: string, participantType: 'user' | 'agent' = 'user'): Promise<Conversation> {
    if (userA === userB) {
      throw new Error('Cannot create a DM with yourself');
    }

    const dmPair = [userA, userB].sort().join(':');

    // Try to find existing DM by the unique pair key
    const [existing] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.dmPair, dmPair))
      .limit(1);

    if (existing) return existing;

    // Try to create — unique constraint prevents duplicates
    try {
      return await this.createConversationWithDmPair(
        [
          { participantId: userA, participantType },
          { participantId: userB, participantType },
        ],
        dmPair,
      );
    } catch (err: unknown) {
      // Unique constraint violation — concurrent create won
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unique') || msg.includes('duplicate')) {
        const [conv] = await db
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.dmPair, dmPair))
          .limit(1);
        if (conv) return conv;
      }
      throw err;
    }
  }

  /**
   * Creates a conversation with a dmPair key for DM deduplication.
   * @param participants - List of participant descriptors
   * @param dmPair - Normalized pair key (sorted user IDs joined by ':')
   * @returns The newly created conversation row
   */
  private async createConversationWithDmPair(
    participants: { participantId: string; participantType: 'user' | 'agent' }[],
    dmPair: string,
  ): Promise<Conversation> {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(schema.conversations).values({ id, dmPair, createdAt: now, updatedAt: now });
      if (participants.length > 0) {
        await tx.insert(schema.conversationParticipants).values(
          participants.map((p) => ({
            conversationId: id,
            participantId: p.participantId,
            participantType: p.participantType,
          })),
        );
      }
    });

    return { id, dmPair, lastMessageAt: null, createdAt: now, updatedAt: now };
  }

  /**
   * Deletes a conversation (cascades to participants, messages, tasks, artifacts).
   * @param id - Conversation ID
   */
  async deleteConversation(id: string): Promise<void> {
    await db.delete(schema.conversations).where(eq(schema.conversations.id, id));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Messages
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Creates a message and updates the conversation's lastMessageAt.
   * @param data - Message payload
   * @returns The inserted message row
   */
  async createMessage(data: {
    conversationId: string;
    senderId: string;
    role: 'user' | 'agent';
    parts: unknown[];
    taskId?: string;
    metadata?: Record<string, unknown> | null;
    extensions?: string[];
    referenceTaskIds?: string[];
  }): Promise<Message> {
    const id = crypto.randomUUID();

    const [msg] = await db
      .insert(schema.messages)
      .values({
        id,
        conversationId: data.conversationId,
        senderId: data.senderId,
        role: data.role,
        parts: data.parts,
        taskId: data.taskId ?? null,
        metadata: data.metadata ?? null,
        extensions: data.extensions ?? null,
        referenceTaskIds: data.referenceTaskIds ?? null,
      })
      .returning();

    await this.updateLastMessageAt(data.conversationId);

    // Clear hiddenAt for the sender so conversation reappears in their list
    await db
      .update(schema.conversationParticipants)
      .set({ hiddenAt: null })
      .where(and(
        eq(schema.conversationParticipants.conversationId, data.conversationId),
        eq(schema.conversationParticipants.participantId, data.senderId),
      ));

    return msg;
  }

  /**
   * Retrieves messages for a conversation, ordered by creation time ascending.
   * @param conversationId - Conversation ID
   * @param opts - Optional limit, cursor (before), or taskId filter
   * @returns Ordered list of messages
   */
  async getMessages(
    conversationId: string,
    opts?: { limit?: number; before?: string; taskId?: string; userId?: string },
  ): Promise<Message[]> {
    const conditions = [eq(schema.messages.conversationId, conversationId)];

    // Filter out messages before hiddenAt for this user
    if (opts?.userId) {
      const [participant] = await db
        .select({ hiddenAt: schema.conversationParticipants.hiddenAt })
        .from(schema.conversationParticipants)
        .where(and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.participantId, opts.userId),
        ))
        .limit(1);
      if (participant?.hiddenAt) {
        conditions.push(gt(schema.messages.createdAt, participant.hiddenAt));
      }
    }

    if (opts?.taskId) {
      conditions.push(eq(schema.messages.taskId, opts.taskId));
    }

    if (opts?.before) {
      // Cursor-based: get messages created before the given message
      const [ref] = await db
        .select({ createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(and(
          eq(schema.messages.id, opts.before),
          eq(schema.messages.conversationId, conversationId),
        ))
        .limit(1);

      if (ref) {
        conditions.push(lt(schema.messages.createdAt, ref.createdAt));
      }
    }

    // Query newest messages first (DESC), then reverse for chronological order.
    // This ensures limit returns the LATEST N messages, not the oldest.
    let query = db
      .select()
      .from(schema.messages)
      .where(and(...conditions))
      .orderBy(desc(schema.messages.createdAt));

    if (opts?.limit) {
      query = query.limit(opts.limit) as typeof query;
    }

    const rows = await query;
    return rows.reverse();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Conversation State
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Bumps the lastMessageAt timestamp on a conversation to now.
   * @param conversationId - Conversation ID
   */
  async updateLastMessageAt(conversationId: string): Promise<void> {
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.conversations.id, conversationId));
  }

  /**
   * Retrieves participant info for a conversation.
   * @param conversationId - Conversation ID
   * @returns Array of participant records
   */
  async getParticipants(conversationId: string) {
    return db
      .select({
        participantId: schema.conversationParticipants.participantId,
        participantType: schema.conversationParticipants.participantType,
      })
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.conversationId, conversationId));
  }

  /**
   * Checks whether a user is a participant in a conversation.
   * @param conversationId - Conversation ID
   * @param userId - User ID to check
   * @returns True if the user is a participant
   */
  async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ participantId: schema.conversationParticipants.participantId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.participantId, userId),
        ),
      )
      .limit(1);
    return !!row;
  }

  /**
   * Hides a conversation for a specific user by setting hiddenAt.
   * @param userId - The user hiding the conversation
   * @param conversationId - Conversation ID
   */
  async hideConversation(userId: string, conversationId: string): Promise<void> {
    await db
      .update(schema.conversationParticipants)
      .set({ hiddenAt: new Date() })
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.participantId, userId),
        ),
      );
  }

  /**
   * Unhides a conversation for a specific user by clearing hiddenAt.
   * @param userId - The user unhiding the conversation
   * @param conversationId - Conversation ID
   */
  async unhideConversation(userId: string, conversationId: string): Promise<void> {
    await db
      .update(schema.conversationParticipants)
      .set({ hiddenAt: null })
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.participantId, userId),
        ),
      );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Metadata
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Upserts metadata for a conversation.
   * @param conversationId - Conversation ID
   * @param metadata - Arbitrary JSON metadata
   */
  async upsertMetadata(conversationId: string, metadata: Record<string, unknown>): Promise<void> {
    await db
      .insert(schema.conversationMetadata)
      .values({ conversationId, metadata })
      .onConflictDoUpdate({
        target: schema.conversationMetadata.conversationId,
        set: { metadata, updatedAt: new Date() },
      });
  }

  /**
   * Retrieves metadata for a conversation.
   * @param conversationId - Conversation ID
   * @returns The metadata object, or null if none exists
   */
  async getMetadata(conversationId: string): Promise<Record<string, unknown> | null> {
    const [row] = await db
      .select({ metadata: schema.conversationMetadata.metadata })
      .from(schema.conversationMetadata)
      .where(eq(schema.conversationMetadata.conversationId, conversationId))
      .limit(1);

    return (row?.metadata as Record<string, unknown>) ?? null;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Users (for ghost invite emails)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Looks up a user by ID.
   * @param userId - User ID
   * @returns Core user fields, or null if not found
   */
  async getUser(userId: string): Promise<{ id: string; name: string | null; email: string | null; isGhost: boolean; deletedAt: Date | null } | null> {
    const [row] = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        isGhost: schema.users.isGhost,
        deletedAt: schema.users.deletedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Returns notification settings for a user, creating a default row if none exists.
   * @param userId - The user's ID
   * @returns The notification settings row (includes unsubscribeToken)
   */
  async getOrCreateNotificationSettings(userId: string): Promise<{ id: string; userId: string; unsubscribeToken: string }> {
    const projection = {
      id: schema.userNotificationSettings.id,
      userId: schema.userNotificationSettings.userId,
      unsubscribeToken: schema.userNotificationSettings.unsubscribeToken,
    };

    await db.insert(schema.userNotificationSettings)
      .values({ userId })
      .onConflictDoNothing({ target: schema.userNotificationSettings.userId });

    const [row] = await db.select(projection)
      .from(schema.userNotificationSettings)
      .where(eq(schema.userNotificationSettings.userId, userId))
      .limit(1);
    if (!row) {
      throw new Error(`Failed to get or create notification settings for user ${userId}`);
    }
    return row;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tasks
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Creates a task in the submitted state.
   * @param conversationId - Conversation the task belongs to
   * @param metadata - Optional task metadata
   * @returns The newly created task
   */
  async createTask(conversationId: string, metadata?: Record<string, unknown>): Promise<Task> {
    const [task] = await db
      .insert(schema.tasks)
      .values({
        conversationId,
        metadata: metadata ?? null,
      })
      .returning();

    return task;
  }

  /**
   * Transitions a task to a new state.
   * @param taskId - Task ID
   * @param state - New task state
   * @param statusMessage - Optional status message payload
   * @returns The updated task
   * @throws If the task is not found
   */
  async updateTaskState(taskId: string, state: string, statusMessage?: unknown): Promise<Task> {
    const [task] = await db
      .update(schema.tasks)
      .set({
        state: state as typeof schema.taskStateEnum.enumValues[number],
        statusMessage: statusMessage ?? null,
        statusTimestamp: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, taskId))
      .returning();

    if (!task) throw new Error(`Task ${taskId} not found`);
    return task;
  }

  /**
   * Merges a `turnContext` object into the task's metadata JSONB under the
   * `turnContext` key, preserving other metadata keys. Used when a negotiation
   * turn is parked for polling so the claiming agent sees the same context the
   * system agent would have run with.
   *
   * @param taskId - Task to update
   * @param turnContext - Absolute source/candidate view of negotiation context
   */
  async setTaskTurnContext(taskId: string, turnContext: Record<string, unknown>): Promise<void> {
    await db
      .update(schema.tasks)
      .set({
        metadata: sql`COALESCE(${schema.tasks.metadata}, '{}'::jsonb) || jsonb_build_object('turnContext', ${JSON.stringify(turnContext)}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, taskId));
  }

  /**
   * Retrieves a task by ID.
   * @param taskId - Task ID
   * @returns The task, or null if not found
   */
  async getTask(taskId: string): Promise<(Omit<Task, 'metadata'> & { metadata: Record<string, unknown> | null }) | null> {
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .limit(1);

    if (!task) return null;
    return { ...task, metadata: (task.metadata as Record<string, unknown> | null) ?? null };
  }

  /**
   * Lists all tasks for a conversation.
   * @param conversationId - Conversation ID
   * @returns Ordered list of tasks
   */
  async getTasksByConversation(conversationId: string): Promise<Task[]> {
    return db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.conversationId, conversationId))
      .orderBy(schema.tasks.createdAt);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Artifacts
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Creates an artifact linked to a task.
   * @param data - Artifact payload
   * @returns The newly created artifact
   */
  async createArtifact(data: {
    taskId: string;
    name?: string;
    description?: string;
    parts: unknown[];
    metadata?: Record<string, unknown> | null;
  }): Promise<Artifact> {
    const [artifact] = await db
      .insert(schema.artifacts)
      .values({
        taskId: data.taskId,
        name: data.name ?? null,
        description: data.description ?? null,
        parts: data.parts,
        metadata: data.metadata ?? null,
      })
      .returning();

    return artifact;
  }

  /**
   * Lists all artifacts for a task.
   * @param taskId - Task ID
   * @returns Ordered list of artifacts
   */
  async getArtifacts(taskId: string): Promise<Artifact[]> {
    return db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.taskId, taskId))
      .orderBy(schema.artifacts.createdAt);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NegotiationGraphDatabase query methods (used by negotiation MCP tools)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Lists negotiation tasks where the given user is source or candidate.
   * Matches sourceUserId or candidateUserId in task metadata JSON.
   * @param userId - The user ID to filter by
   * @param options - Optional state filter
   * @returns Array of task records with metadata
   */
  async getTasksForUser(userId: string, options?: { state?: string }): Promise<Array<{
    id: string;
    conversationId: string;
    state: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  }>> {
    const conditions = [
      sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
      or(
        sql`${schema.tasks.metadata}->>'sourceUserId' = ${userId}`,
        sql`${schema.tasks.metadata}->>'candidateUserId' = ${userId}`,
      ),
    ];

    if (options?.state) {
      conditions.push(eq(schema.tasks.state, options.state as typeof schema.taskStateEnum.enumValues[number]));
    }

    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(...conditions))
      .orderBy(desc(schema.tasks.createdAt));

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      state: r.state as string,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Looks up the negotiation task attached to an opportunity, preferring the
   * most-recently-created row if multiple exist (shouldn't, but defensive).
   *
   * @param opportunityId - Opportunity id stored on task metadata
   * @returns The task record or null
   */
  async getNegotiationTaskForOpportunity(opportunityId: string): Promise<{
    id: string;
    conversationId: string;
    state: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`${schema.tasks.metadata}->>'opportunityId' = ${opportunityId}`,
        ),
      )
      .orderBy(desc(schema.tasks.createdAt))
      .limit(1);

    const [row] = rows;
    if (!row) return null;

    return {
      id: row.id,
      conversationId: row.conversationId,
      state: row.state as string,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Returns user answers collected by the questioner for a given opportunity.
   * Reads `metadata.userAnswers` from the opportunities table.
   */
  async getOpportunityUserAnswers(opportunityId: string): Promise<Array<{
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
    answeredAt: string;
  }>> {
    const [row] = await db
      .select({ metadata: opportunities.metadata })
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .limit(1);
    if (!row?.metadata) return [];
    const meta = row.metadata as Record<string, unknown>;
    if (!Array.isArray(meta.userAnswers)) return [];
    return (meta.userAnswers as Record<string, unknown>[])
      .filter((a): a is Record<string, unknown> & { questionId: string; answeredAt: string } =>
        typeof a?.questionId === 'string' && typeof a?.answeredAt === 'string')
      .map((a) => ({
        questionId: a.questionId,
        selectedOptions: Array.isArray(a.selectedOptions) ? (a.selectedOptions as unknown[]).filter((o): o is string => typeof o === 'string') : [],
        ...(typeof a.freeText === 'string' && { freeText: a.freeText }),
        answeredAt: a.answeredAt,
      }));
  }

  /**
   * Gets all messages for a conversation, ordered by creation time (ascending).
   * Used by negotiation tools to reconstruct turn history.
   * @param conversationId - The conversation to fetch messages for
   * @returns Array of message records
   */
  async getMessagesForConversation(conversationId: string): Promise<Array<{
    id: string;
    senderId: string;
    role: 'user' | 'agent';
    parts: unknown[];
    createdAt: Date;
  }>> {
    const rows = await db
      .select({
        id: schema.messages.id,
        senderId: schema.messages.senderId,
        role: schema.messages.role,
        parts: schema.messages.parts,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(asc(schema.messages.createdAt));

    return rows.map((r) => ({
      ...r,
      parts: (r.parts as unknown[]) ?? [],
    }));
  }

  /**
   * Gets artifacts for a task (e.g. negotiation outcome).
   * Alias for getArtifacts with the interface name expected by NegotiationGraphDatabase.
   * @param taskId - The task to fetch artifacts for
   * @returns Array of artifact records
   */
  async getArtifactsForTask(taskId: string): Promise<Array<{
    id: string;
    name: string | null;
    parts: unknown[];
    metadata: Record<string, unknown> | null;
  }>> {
    const rows = await db
      .select({
        id: schema.artifacts.id,
        name: schema.artifacts.name,
        parts: schema.artifacts.parts,
        metadata: schema.artifacts.metadata,
      })
      .from(schema.artifacts)
      .where(eq(schema.artifacts.taskId, taskId))
      .orderBy(schema.artifacts.createdAt);

    return rows.map((r) => ({
      ...r,
      parts: (r.parts as unknown[]) ?? [],
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    }));
  }

  /**
   * Retrieves messages for multiple tasks in a single query.
   * @param taskIds - Task IDs to fetch messages for
   * @returns Map of taskId to ordered messages
   */
  async getMessagesByTaskIds(taskIds: string[]): Promise<Map<string, Message[]>> {
    if (taskIds.length === 0) return new Map();

    const rows = await db
      .select()
      .from(schema.messages)
      .where(inArray(schema.messages.taskId, taskIds))
      .orderBy(asc(schema.messages.createdAt));

    const map = new Map<string, Message[]>();
    for (const row of rows) {
      if (!row.taskId) continue;
      const list = map.get(row.taskId) ?? [];
      list.push(row);
      map.set(row.taskId, list);
    }
    return map;
  }

  /**
   * Retrieves negotiation tasks for a user, with their outcome artifacts.
   * @param userId - User to find negotiations for (as source or candidate)
   * @param opts - Optional pagination and mutual-only filtering
   * @returns Tasks with joined outcome artifacts, ordered by most recent first
   */
  async getNegotiationsByUser(
    userId: string,
    opts?: { limit?: number; offset?: number; mutualWithUserId?: string; result?: 'has_opportunity' | 'no_opportunity' | 'in_progress'; since?: Date },
  ): Promise<Array<Task & { artifact: Artifact | null }>> {
    const limit = opts?.limit ?? 10;
    const offset = opts?.offset ?? 0;

    const userFilter = opts?.mutualWithUserId
      ? and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          or(
            and(
              sql`${schema.tasks.metadata}->>'sourceUserId' = ${userId}`,
              sql`${schema.tasks.metadata}->>'candidateUserId' = ${opts.mutualWithUserId}`,
            ),
            and(
              sql`${schema.tasks.metadata}->>'sourceUserId' = ${opts.mutualWithUserId}`,
              sql`${schema.tasks.metadata}->>'candidateUserId' = ${userId}`,
            ),
          ),
        )
      : and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          or(
            sql`${schema.tasks.metadata}->>'sourceUserId' = ${userId}`,
            sql`${schema.tasks.metadata}->>'candidateUserId' = ${userId}`,
          ),
        );

    const resultFilter = opts?.result === 'has_opportunity'
      ? sql`(${schema.artifacts.parts}->0->>'kind' = 'data' AND ((${schema.artifacts.parts}->0->'data'->>'hasOpportunity')::boolean = true OR (${schema.artifacts.parts}->0->'data'->>'consensus')::boolean = true))`
      : opts?.result === 'no_opportunity'
        ? sql`(${schema.artifacts.parts}->0->>'kind' = 'data' AND ((${schema.artifacts.parts}->0->'data'->>'hasOpportunity')::boolean = false OR (${schema.artifacts.parts}->0->'data'->>'consensus')::boolean = false))`
        : opts?.result === 'in_progress'
          ? and(isNull(schema.artifacts.id), inArray(schema.tasks.state, ['submitted', 'working', 'input_required']))
          : undefined;

    const sinceFilter = opts?.since
      ? sql`${schema.tasks.createdAt} >= ${opts.since.toISOString()}`
      : undefined;

    const allFilters = [userFilter, resultFilter, sinceFilter].filter(Boolean);
    const combinedFilter = allFilters.length > 1 ? and(...allFilters) : allFilters[0];

    const rows = await db
      .select({
        task: schema.tasks,
        artifact: schema.artifacts,
      })
      .from(schema.tasks)
      .leftJoin(
        schema.artifacts,
        and(
          eq(schema.artifacts.taskId, schema.tasks.id),
          eq(schema.artifacts.name, 'negotiation-outcome'),
        ),
      )
      .where(combinedFilter)
      .orderBy(desc(schema.tasks.createdAt))
      .limit(limit)
      .offset(offset);

    return rows.map((r) => ({ ...r.task, artifact: r.artifact }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Chat Session Methods (H2A conversations with system-agent participant)
  // Unified from former ChatDatabaseAdapter session/message/metadata methods.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Helper: read ChatConversationMeta from conversation_metadata for a conversation.
   */
  private async _getConvMeta(conversationId: string): Promise<ChatConversationMeta | null> {
    const [row] = await db
      .select({ metadata: schema.conversationMetadata.metadata })
      .from(schema.conversationMetadata)
      .where(eq(schema.conversationMetadata.conversationId, conversationId))
      .limit(1);
    return (row?.metadata as ChatConversationMeta) ?? null;
  }

  /**
   * Helper: upsert ChatConversationMeta into conversation_metadata.
   */
  private async _upsertConvMeta(conversationId: string, patch: Partial<ChatConversationMeta>): Promise<void> {
    const existing = await this._getConvMeta(conversationId);
    const merged: ChatConversationMeta = { ...(existing ?? {}), ...patch };
    await db
      .insert(schema.conversationMetadata)
      .values({ conversationId, metadata: merged })
      .onConflictDoUpdate({
        target: schema.conversationMetadata.conversationId,
        set: { metadata: merged, updatedAt: new Date() },
      });
  }

  /**
   * Helper: convert a conversations row + metadata into a backward-compatible ChatSession.
   */
  private _toChatSession(
    conv: { id: string; createdAt: Date; updatedAt: Date },
    userId: string,
    meta: ChatConversationMeta | null,
  ): ChatSession {
    return {
      id: conv.id,
      userId,
      title: meta?.title ?? null,
      networkId: meta?.networkId ?? null,
      shareToken: meta?.shareToken ?? null,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  }

  /**
   * Create a new chat session (H2A conversation with system-agent participant).
   * Creates a conversation, adds user + system-agent as participants,
   * and stores title/indexId in conversation_metadata.
   */
  async createChatSession(data: CreateSessionInput): Promise<void> {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(schema.conversations).values({
        id: data.id,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(schema.conversationParticipants).values([
        { conversationId: data.id, participantId: data.userId, participantType: 'user' as const },
        { conversationId: data.id, participantId: SYSTEM_AGENT_ID, participantType: 'agent' as const },
      ]);

      // Store title and networkId in conversation_metadata
      const meta: ChatConversationMeta = {};
      if (data.title) meta.title = data.title;
      if (data.networkId?.trim()) meta.networkId = data.networkId.trim();
      if (Object.keys(meta).length > 0) {
        await tx.insert(schema.conversationMetadata).values({
          conversationId: data.id,
          metadata: meta,
        });
      }
    });
  }

  /**
   * Get chat session by ID.
   * Queries conversations + conversation_metadata and returns backward-compatible ChatSession.
   */
  async getChatSession(sessionId: string): Promise<ChatSession | null> {
    const [conv] = await db.select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, sessionId))
      .limit(1);

    if (!conv) return null;

    // Find the user participant (not the agent)
    const [userParticipant] = await db
      .select({ participantId: schema.conversationParticipants.participantId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, sessionId),
          eq(schema.conversationParticipants.participantType, 'user'),
        ),
      )
      .limit(1);

    const userId = userParticipant?.participantId ?? '';
    const meta = await this._getConvMeta(sessionId);
    return this._toChatSession(conv, userId, meta);
  }

  /**
   * Get all chat sessions for a user, ordered by most recent.
   * Queries conversation_participants to find conversations with system-agent.
   */
  async getUserChatSessions(userId: string, limit: number): Promise<ChatSession[]> {
    // Subquery: conversation IDs that include the system agent (i.e. chat sessions, not DMs)
    const chatSessionIds = db
      .select({ conversationId: schema.conversationParticipants.conversationId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.participantId, SYSTEM_AGENT_ID),
          eq(schema.conversationParticipants.participantType, 'agent'),
        ),
      );

    const rows = await db
      .select({
        id: schema.conversations.id,
        createdAt: schema.conversations.createdAt,
        updatedAt: schema.conversations.updatedAt,
      })
      .from(schema.conversationParticipants)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationParticipants.conversationId, schema.conversations.id),
      )
      .where(
        and(
          eq(schema.conversationParticipants.participantId, userId),
          eq(schema.conversationParticipants.participantType, 'user'),
          isNull(schema.conversationParticipants.hiddenAt),
          inArray(schema.conversations.id, chatSessionIds),
        ),
      )
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(limit);

    if (rows.length === 0) return [];

    // Batch-fetch metadata for chat conversations
    const chatConvIdList = rows.map((r) => r.id);
    const metaRows = await db
      .select()
      .from(schema.conversationMetadata)
      .where(inArray(schema.conversationMetadata.conversationId, chatConvIdList));
    const metaMap = new Map<string, ChatConversationMeta>(metaRows.map((m) => [m.conversationId, m.metadata as ChatConversationMeta]));

    return rows.map((conv) => this._toChatSession(conv, userId, metaMap.get(conv.id) ?? null));
  }

  /**
   * List chat session summaries for a user, ordered by most recent activity.
   * Mirrors `getUserChatSessions` but returns the `ChatSessionSummary` shape
   * expected by `ChatSessionReader`.
   *
   * @param userId - The user whose sessions to list
   * @param limit - Maximum number of sessions to return (default 25)
   * @returns Array of chat session summaries
   */
  async listChatSessionSummaries(
    userId: string,
    limit = 25,
  ): Promise<Array<{ sessionId: string; title: string | null; messageCount: number; lastMessageAt: Date | null; createdAt: Date }>> {
    // Subquery: conversation IDs that include the system agent
    const chatSessionIds = db
      .select({ conversationId: schema.conversationParticipants.conversationId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.participantId, SYSTEM_AGENT_ID),
          eq(schema.conversationParticipants.participantType, 'agent'),
        ),
      );

    const rows = await db
      .select({
        id: schema.conversations.id,
        lastMessageAt: schema.conversations.lastMessageAt,
        createdAt: schema.conversations.createdAt,
        updatedAt: schema.conversations.updatedAt,
      })
      .from(schema.conversationParticipants)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationParticipants.conversationId, schema.conversations.id),
      )
      .where(
        and(
          eq(schema.conversationParticipants.participantId, userId),
          eq(schema.conversationParticipants.participantType, 'user'),
          or(
            isNull(schema.conversationParticipants.hiddenAt),
            gt(schema.conversations.lastMessageAt, schema.conversationParticipants.hiddenAt),
          ),
          inArray(schema.conversations.id, chatSessionIds),
        ),
      )
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(limit);

    if (rows.length === 0) return [];

    const convIds = rows.map((r) => r.id);

    // Batch-fetch metadata (titles)
    const metaRows = await db
      .select()
      .from(schema.conversationMetadata)
      .where(inArray(schema.conversationMetadata.conversationId, convIds));
    const metaMap = new Map<string, ChatConversationMeta>(
      metaRows.map((m) => [m.conversationId, m.metadata as ChatConversationMeta]),
    );

    // Batch-fetch message counts
    const countRows = await db
      .select({
        conversationId: schema.messages.conversationId,
        cnt: count(schema.messages.id),
      })
      .from(schema.messages)
      .where(inArray(schema.messages.conversationId, convIds))
      .groupBy(schema.messages.conversationId);
    const countMap = new Map<string, number>(countRows.map((r) => [r.conversationId, Number(r.cnt)]));

    return rows.map((conv) => ({
      sessionId: conv.id,
      title: (metaMap.get(conv.id)?.title) ?? null,
      messageCount: countMap.get(conv.id) ?? 0,
      lastMessageAt: conv.lastMessageAt ?? conv.updatedAt,
      createdAt: conv.createdAt,
    }));
  }

  /**
   * Get full detail for a single chat session, including messages.
   * Returns null if the user does not participate or it is not a chat session.
   *
   * @param userId - The requesting user
   * @param sessionId - The conversation ID
   * @param messageLimit - Maximum messages to return (default 50)
   * @returns Session detail or null
   */
  async getChatSessionDetail(
    userId: string,
    sessionId: string,
    messageLimit = 50,
  ): Promise<{
    sessionId: string;
    title: string | null;
    messageCount: number;
    lastMessageAt: Date | null;
    createdAt: Date;
    messages: Array<{ role: string; content: string; createdAt: Date }>;
  } | null> {
    // Verify user participation
    const [userParticipant] = await db
      .select({ participantId: schema.conversationParticipants.participantId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, sessionId),
          eq(schema.conversationParticipants.participantId, userId),
          eq(schema.conversationParticipants.participantType, 'user'),
        ),
      )
      .limit(1);

    if (!userParticipant) return null;

    // Verify system agent participation (i.e. it's a chat session, not a DM)
    const [agentParticipant] = await db
      .select({ participantId: schema.conversationParticipants.participantId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, sessionId),
          eq(schema.conversationParticipants.participantId, SYSTEM_AGENT_ID),
          eq(schema.conversationParticipants.participantType, 'agent'),
        ),
      )
      .limit(1);

    if (!agentParticipant) return null;

    // Fetch conversation row
    const [conv] = await db
      .select({
        id: schema.conversations.id,
        lastMessageAt: schema.conversations.lastMessageAt,
        createdAt: schema.conversations.createdAt,
        updatedAt: schema.conversations.updatedAt,
      })
      .from(schema.conversations)
      .where(eq(schema.conversations.id, sessionId))
      .limit(1);

    if (!conv) return null;

    // Fetch metadata
    const meta = await this._getConvMeta(sessionId);

    // Fetch messages (limited)
    const msgRows = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, sessionId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(messageLimit);

    const messages = msgRows.reverse().map((msg) => {
      const parts = msg.parts as Array<{ type?: string; text?: string }>;
      const content =
        parts?.find((p) => p?.type === 'text' && typeof p.text === 'string')?.text
        ?? parts?.find((p) => typeof p?.text === 'string')?.text
        ?? '';
      const role = msg.role === 'agent' ? 'assistant' : msg.role;
      return { role, content, createdAt: msg.createdAt };
    });

    // Count all messages (not limited)
    const [{ totalCount }] = await db
      .select({ totalCount: count(schema.messages.id) })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, sessionId));

    return {
      sessionId: conv.id,
      title: meta?.title ?? null,
      messageCount: Number(totalCount),
      lastMessageAt: conv.lastMessageAt ?? conv.updatedAt,
      createdAt: conv.createdAt,
      messages,
    };
  }

  /**
   * Update chat session index scope.
   */
  async updateChatSessionIndex(sessionId: string, networkId: string | null): Promise<void> {
    await this._upsertConvMeta(sessionId, { networkId });
    await db
      .update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, sessionId));
  }

  /**
   * Update chat session title.
   */
  async updateChatSessionTitle(sessionId: string, title: string): Promise<void> {
    await this._upsertConvMeta(sessionId, { title });
    await db
      .update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, sessionId));
  }

  /**
   * Update chat session timestamp.
   */
  async updateChatSessionTimestamp(sessionId: string): Promise<void> {
    await db.update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, sessionId));
  }

  /**
   * Delete a chat session (FK cascades delete participants, messages, metadata).
   */
  async deleteChatSession(sessionId: string): Promise<void> {
    await db.delete(schema.conversations)
      .where(eq(schema.conversations.id, sessionId));
  }

  /**
   * Set or clear the share token for a chat session.
   */
  async setChatShareToken(sessionId: string, token: string | null): Promise<void> {
    await this._upsertConvMeta(sessionId, { shareToken: token });
    await db
      .update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, sessionId));
  }

  /**
   * Find a chat session by its share token.
   */
  async getChatSessionByShareToken(token: string): Promise<ChatSession | null> {
    const metaRows = await db
      .select()
      .from(schema.conversationMetadata)
      .where(sql`${schema.conversationMetadata.metadata}->>'shareToken' = ${token}`)
      .limit(1);

    if (metaRows.length === 0) return null;

    const convId = metaRows[0].conversationId;
    return this.getChatSession(convId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Chat Message Methods (H2A message CRUD with role mapping)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a chat message in the messages table.
   * Maps role: 'assistant'|'system' -> role: 'agent', senderId: SYSTEM_AGENT_ID.
   * Maps role: 'user' -> role: 'user', senderId looked up from conversation_participants.
   * Stores routingDecision/subgraphResults/tokenCount in messages.metadata.
   */
  async createChatMessage(data: CreateMessageInput): Promise<void> {
    const isAgent = data.role === 'assistant' || data.role === 'system';
    let senderId: string;

    if (isAgent) {
      senderId = SYSTEM_AGENT_ID;
    } else {
      // Look up the user participant for this conversation
      const [participant] = await db
        .select({ participantId: schema.conversationParticipants.participantId })
        .from(schema.conversationParticipants)
        .where(
          and(
            eq(schema.conversationParticipants.conversationId, data.sessionId),
            eq(schema.conversationParticipants.participantType, 'user'),
          ),
        )
        .limit(1);
      if (!participant?.participantId) {
        throw new Error(`Conversation participant not found for session ${data.sessionId}`);
      }
      senderId = participant.participantId;
    }

    // Build metadata from non-null optional fields
    const msgMeta: ChatMessageMeta = {};
    if (data.routingDecision) msgMeta.routingDecision = data.routingDecision;
    if (data.subgraphResults) msgMeta.subgraphResults = data.subgraphResults;
    if (data.tokenCount !== undefined) msgMeta.tokenCount = data.tokenCount;

    await db.insert(schema.messages).values({
      id: data.id,
      conversationId: data.sessionId,
      senderId,
      role: isAgent ? 'agent' : 'user',
      parts: [{ type: 'text', text: data.content }],
      metadata: Object.keys(msgMeta).length > 0 ? msgMeta : null,
      createdAt: new Date(),
    });

    // Update conversation.lastMessageAt
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(schema.conversations.id, data.sessionId));
  }

  /**
   * Get chat messages for a session, reconstructing the backward-compatible ChatMessage shape.
   */
  async getChatSessionMessages(sessionId: string, limit?: number): Promise<ChatMessage[]> {
    const query = db.select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, sessionId))
      .orderBy(asc(schema.messages.createdAt));

    const rows = limit ? await query.limit(limit) : await query;

    return rows.map((msg) => {
      const parts = msg.parts as Array<{ type?: string; text?: string }>;
      const content =
        parts?.find((p) => p?.type === 'text' && typeof p.text === 'string')?.text
        ?? parts?.find((p) => typeof p?.text === 'string')?.text
        ?? '';
      const meta = (msg.metadata ?? {}) as ChatMessageMeta;

      // Map role back: 'agent' -> 'assistant'
      const role: 'user' | 'assistant' | 'system' = msg.role === 'agent' ? 'assistant' : 'user';

      return {
        id: msg.id,
        sessionId,
        role,
        content,
        routingDecision: (meta.routingDecision as Record<string, unknown>) ?? null,
        subgraphResults: (meta.subgraphResults as Record<string, unknown>) ?? null,
        tokenCount: typeof meta.tokenCount === 'number' ? meta.tokenCount : null,
        createdAt: msg.createdAt,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Chat Metadata Methods (trace events, debug meta, session metadata)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Verify that a message belongs to a conversation the user participates in.
   */
  async verifyChatMessageOwnership(messageId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ conversationId: schema.messages.conversationId })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);

    if (!row) return false;

    const [participant] = await db
      .select({ participantId: schema.conversationParticipants.participantId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, row.conversationId),
          eq(schema.conversationParticipants.participantId, userId),
        ),
      )
      .limit(1);

    return !!participant;
  }

  /**
   * Upsert message metadata (traceEvents, debugMeta) into the message's metadata JSONB column.
   */
  async upsertChatMessageMetadata(params: {
    id: string;
    messageId: string;
    traceEvents?: unknown;
    debugMeta?: unknown;
    streamingDrafts?: unknown;
  }): Promise<void> {
    if (
      params.traceEvents === undefined &&
      params.debugMeta === undefined &&
      params.streamingDrafts === undefined
    ) return;

    const [msg] = await db
      .select({ metadata: schema.messages.metadata })
      .from(schema.messages)
      .where(eq(schema.messages.id, params.messageId))
      .limit(1);

    if (!msg) return;

    const existing = (msg.metadata ?? {}) as ChatMessageMeta;
    const merged: ChatMessageMeta = { ...existing };
    if (params.traceEvents !== undefined) merged.traceEvents = params.traceEvents;
    if (params.debugMeta !== undefined) merged.debugMeta = params.debugMeta;
    if (params.streamingDrafts !== undefined) merged.streamingDrafts = params.streamingDrafts;

    await db
      .update(schema.messages)
      .set({ metadata: merged })
      .where(eq(schema.messages.id, params.messageId));
  }

  /**
   * Get message metadata (traceEvents, debugMeta) for a list of message IDs.
   */
  async getChatMessageMetadataByIds(messageIds: string[]): Promise<Array<{ id: string; messageId: string; traceEvents: unknown; debugMeta: unknown; streamingDrafts: unknown; createdAt: Date }>> {
    if (messageIds.length === 0) return [];
    const rows = await db
      .select({ id: schema.messages.id, metadata: schema.messages.metadata, createdAt: schema.messages.createdAt })
      .from(schema.messages)
      .where(inArray(schema.messages.id, messageIds));

    return rows.map((r) => {
      const meta = (r.metadata ?? {}) as ChatMessageMeta;
      return {
        id: r.id,
        messageId: r.id,
        traceEvents: meta.traceEvents ?? null,
        debugMeta: meta.debugMeta ?? null,
        streamingDrafts: meta.streamingDrafts ?? null,
        createdAt: r.createdAt,
      };
    });
  }

  /**
   * Upsert session-level metadata into conversation_metadata.
   */
  async upsertChatSessionMetadata(params: {
    id: string;
    sessionId: string;
    metadata: unknown;
  }): Promise<void> {
    const existing = await this._getConvMeta(params.sessionId);
    const merged: ChatConversationMeta = {
      ...(existing ?? {}),
      _sessionMeta: params.metadata,
    };
    await db
      .insert(schema.conversationMetadata)
      .values({ conversationId: params.sessionId, metadata: merged })
      .onConflictDoUpdate({
        target: schema.conversationMetadata.conversationId,
        set: { metadata: merged, updatedAt: new Date() },
      });
  }

  /**
   * Retrieve session metadata by session ID.
   */
  async getChatSessionMetadata(sessionId: string): Promise<{ id: string; sessionId: string; metadata: unknown; createdAt: Date; updatedAt: Date } | undefined> {
    const [row] = await db
      .select()
      .from(schema.conversationMetadata)
      .where(eq(schema.conversationMetadata.conversationId, sessionId))
      .limit(1);

    if (!row) return undefined;

    const meta = (row.metadata ?? {}) as ChatConversationMeta;
    return {
      id: row.conversationId,
      sessionId: row.conversationId,
      metadata: meta._sessionMeta ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Update the status of an opportunity. Used by the negotiation graph/timeout queues
   * to advance the opportunity lifecycle (negotiating → pending/rejected/stalled).
   * @param id - Opportunity ID
   * @param status - New status
   * @returns The updated opportunity id+status, or null if not found
   */
  async updateOpportunityStatus(
    id: string,
    status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
  ): Promise<{ id: string; status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired' } | null> {
    if (status === 'accepted' && !acceptedBy) {
      throw new Error('acceptedBy is required when status is accepted');
    }
    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === 'accepted') {
      updates.acceptedBy = acceptedBy;
    } else {
      updates.acceptedBy = null;
    }
    const [row] = await db
      .update(opportunities)
      .set(updates)
      .where(eq(opportunities.id, id))
      .returning({ id: opportunities.id, status: opportunities.status });
    return row ?? null;
  }

}

/** Singleton instance of the conversation database adapter. */
export const conversationDatabaseAdapter = new ConversationDatabaseAdapter();
