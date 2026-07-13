/**
 * Negotiator memory adapter (IND-405).
 *
 * Private operational memory store owned by a user's personal negotiator agent
 * row (IND-410): playbooks, disclosure rules, counterparty dossiers, thresholds.
 * Strictly separate from premises — premises are public-ish identity assertions
 * that feed discovery; negotiator memories MUST NOT be exposed to discovery,
 * user contexts, or any counterparty-visible surface.
 *
 * Leak-guard by construction: every read/write on this adapter is scoped to
 * (agentId, userId) — the owner's negotiator — and nothing in production code
 * paths references this adapter yet (explicit no-op release; wiring lands with
 * the memory read/write hooks in later P5 issues).
 *
 * Embeddings live in the same space as premises (text-embedding-3-large @ 2000
 * dims via the shared embedding config); this adapter takes pre-computed query
 * vectors — it never calls the embedding API itself.
 */

import { and, desc, eq, isNotNull, lt, sql } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { log } from '../lib/log';
import type { NegotiatorMemory, NegotiatorMemoryKind, NegotiatorMemorySourceRef } from '../schemas/database.schema';

const logger = log.lib.from('negotiator-memory.database.adapter');

export interface CreateNegotiatorMemoryInput {
  /** The owning negotiator agent row — must be type='personal', owned by userId. */
  agentId: string;
  /** The negotiator's owner. Must match the agent row's ownerId. */
  userId: string;
  kind: NegotiatorMemoryKind;
  content: string;
  /** For counterparty dossiers: who the memory is about. */
  subjectUserId?: string;
  /** Pre-computed embedding (text-embedding-3-large, 2000 dims). */
  embedding?: number[];
  sourceRefs?: NegotiatorMemorySourceRef[];
  /** 0..1; defaults to 0.5 at the DB level. */
  confidence?: number;
}

export interface UpdateNegotiatorMemoryInput {
  content?: string;
  /** New vector, or null to clear a stale vector (e.g. re-embed failed after a content edit). */
  embedding?: number[] | null;
  sourceRefs?: NegotiatorMemorySourceRef[];
  confidence?: number;
  subjectUserId?: string | null;
}

export interface ListNegotiatorMemoriesFilter {
  kind?: NegotiatorMemoryKind;
  subjectUserId?: string;
  limit?: number;
  /**
   * Only memories learned from negotiations that ran for this intent: a
   * source ref of type 'negotiation' whose task's opportunity involves the
   * intent — either as the triggering intent or as the owner's actor intent.
   * Owner-scoped by construction (the actor match keys on the memory's own
   * userId), so it can never widen the row set beyond the (agentId, userId)
   * scope — it only narrows it.
   */
  intentId?: string;
}

export interface SimilarNegotiatorMemoriesQuery {
  agentId: string;
  userId: string;
  /** Pre-computed query embedding (same space as stored rows). */
  embedding: number[];
  kind?: NegotiatorMemoryKind;
  /** Top-k; defaults to 5. */
  limit?: number;
  /** Cosine similarity floor (0..1); rows below are excluded. */
  minScore?: number;
}

export type NegotiatorMemoryWithScore = NegotiatorMemory & { similarity: number };

/**
 * Thrown when the (agentId, userId) pair does not resolve to the caller's own
 * active personal negotiator row. Deliberately indistinguishable between
 * "agent does not exist" and "agent is not yours" — no existence oracle.
 */
export class NegotiatorAgentScopeError extends Error {
  constructor(agentId: string) {
    super(`Agent ${agentId} is not an active personal negotiator owned by the given user`);
    this.name = 'NegotiatorAgentScopeError';
  }
}

export class NegotiatorMemoryDatabaseAdapter {
  /**
   * Asserts the agent row is the caller's own active personal negotiator.
   * All writes go through this; reads are additionally WHERE-scoped so a
   * stale/forged id can never return another owner's rows.
   */
  private async assertOwnedPersonalNegotiator(agentId: string, userId: string): Promise<void> {
    const [agent] = await db
      .select({ id: schema.agents.id })
      .from(schema.agents)
      .where(and(
        eq(schema.agents.id, agentId),
        eq(schema.agents.ownerId, userId),
        eq(schema.agents.type, 'personal'),
        sql`${schema.agents.deletedAt} IS NULL`,
      ))
      .limit(1);
    if (!agent) throw new NegotiatorAgentScopeError(agentId);
  }

  async create(input: CreateNegotiatorMemoryInput): Promise<NegotiatorMemory> {
    await this.assertOwnedPersonalNegotiator(input.agentId, input.userId);

    const [row] = await db.insert(schema.negotiatorMemories).values({
      agentId: input.agentId,
      userId: input.userId,
      kind: input.kind,
      content: input.content,
      subjectUserId: input.subjectUserId ?? null,
      embedding: input.embedding ?? null,
      sourceRefs: input.sourceRefs ?? [],
      ...(input.confidence !== undefined ? { confidence: input.confidence } : {}),
    }).returning();

    logger.debug('Negotiator memory created', { id: row.id, agentId: row.agentId, kind: row.kind });
    return row;
  }

  /** Owner-scoped point read. Returns null for other owners' rows (no oracle). */
  async getById(id: string, userId: string): Promise<NegotiatorMemory | null> {
    const [row] = await db
      .select()
      .from(schema.negotiatorMemories)
      .where(and(
        eq(schema.negotiatorMemories.id, id),
        eq(schema.negotiatorMemories.userId, userId),
      ))
      .limit(1);
    return row ?? null;
  }

  /** Lists an agent's memories, newest first. Scoped to (agentId, userId). */
  async list(
    agentId: string,
    userId: string,
    filter: ListNegotiatorMemoriesFilter = {},
  ): Promise<NegotiatorMemory[]> {
    const conditions = [
      eq(schema.negotiatorMemories.agentId, agentId),
      eq(schema.negotiatorMemories.userId, userId),
      ...(filter.kind ? [eq(schema.negotiatorMemories.kind, filter.kind)] : []),
      ...(filter.subjectUserId ? [eq(schema.negotiatorMemories.subjectUserId, filter.subjectUserId)] : []),
      ...(filter.intentId
        ? [sql`EXISTS (
            SELECT 1
            FROM jsonb_array_elements(${schema.negotiatorMemories.sourceRefs}) AS src_ref
            JOIN ${schema.tasks} ON ${schema.tasks.id} = src_ref->>'id'
            JOIN ${schema.opportunities} ON ${schema.opportunities.id} = ${schema.tasks.metadata}->>'opportunityId'
            WHERE src_ref->>'type' = 'negotiation'
              AND (
                ${schema.opportunities.detection}->>'triggeredBy' = ${filter.intentId}
                OR EXISTS (
                  SELECT 1 FROM jsonb_array_elements(${schema.opportunities.actors}) AS actor
                  WHERE actor->>'userId' = ${schema.negotiatorMemories.userId}
                    AND actor->>'intent' = ${filter.intentId}
                )
              )
          )`]
        : []),
    ];
    return db
      .select()
      .from(schema.negotiatorMemories)
      .where(and(...conditions))
      .orderBy(desc(schema.negotiatorMemories.createdAt))
      .limit(filter.limit ?? 100);
  }

  /**
   * Owner-scoped update. Any content/embedding/sourceRefs/confidence patch
   * bumps updatedAt. Returns null when the row is missing or not owned.
   */
  async update(
    id: string,
    userId: string,
    patch: UpdateNegotiatorMemoryInput,
  ): Promise<NegotiatorMemory | null> {
    const [row] = await db
      .update(schema.negotiatorMemories)
      .set({
        ...(patch.content !== undefined ? { content: patch.content } : {}),
        ...(patch.embedding !== undefined ? { embedding: patch.embedding } : {}),
        ...(patch.sourceRefs !== undefined ? { sourceRefs: patch.sourceRefs } : {}),
        ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
        ...(patch.subjectUserId !== undefined ? { subjectUserId: patch.subjectUserId } : {}),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.negotiatorMemories.id, id),
        eq(schema.negotiatorMemories.userId, userId),
      ))
      .returning();
    return row ?? null;
  }

  /** Owner-scoped delete. Returns true when a row was actually removed. */
  async delete(id: string, userId: string): Promise<boolean> {
    const deleted = await db
      .delete(schema.negotiatorMemories)
      .where(and(
        eq(schema.negotiatorMemories.id, id),
        eq(schema.negotiatorMemories.userId, userId),
      ))
      .returning({ id: schema.negotiatorMemories.id });
    return deleted.length > 0;
  }

  /**
   * Top-k cosine-similarity read over the agent's own memories.
   * Rows without an embedding are excluded; results carry `similarity` (0..1).
   */
  async searchSimilar(query: SimilarNegotiatorMemoriesQuery): Promise<NegotiatorMemoryWithScore[]> {
    const { negotiatorMemories } = schema;
    const vectorStr = `[${query.embedding.join(',')}]`;
    const similarity = sql<number>`1 - (${negotiatorMemories.embedding} <=> ${vectorStr}::vector)`;

    const conditions = [
      eq(negotiatorMemories.agentId, query.agentId),
      eq(negotiatorMemories.userId, query.userId),
      isNotNull(negotiatorMemories.embedding),
      ...(query.kind ? [eq(negotiatorMemories.kind, query.kind)] : []),
      ...(query.minScore !== undefined
        ? [sql`1 - (${negotiatorMemories.embedding} <=> ${vectorStr}::vector) >= ${query.minScore}`]
        : []),
    ];

    const rows = await db
      .select({
        memory: negotiatorMemories,
        similarity,
      })
      .from(negotiatorMemories)
      .where(and(...conditions))
      .orderBy(sql`${negotiatorMemories.embedding} <=> ${vectorStr}::vector`)
      .limit(query.limit ?? 5);

    return rows.map((r) => ({ ...r.memory, similarity: r.similarity }));
  }

  /**
   * Maintenance-only bulk confidence decay (P5.2 anti-poisoning schedule).
   * Multiplies confidence by `factor` for rows whose updatedAt is older than
   * `olderThanMs`, then deletes rows whose confidence fell below
   * `deleteBelow`. Deliberately unscoped — this is the cron maintenance path
   * across all owners, not a user read surface. Decay does NOT bump
   * updatedAt: stale rows keep decaying daily until reinforced (which bumps
   * updatedAt via update) or they fall below the floor and are removed.
   */
  async decayAll(opts: { factor: number; olderThanMs: number; deleteBelow: number }): Promise<{ decayed: number; deleted: number }> {
    const cutoff = new Date(Date.now() - opts.olderThanMs);
    const decayedRows = await db
      .update(schema.negotiatorMemories)
      .set({ confidence: sql`${schema.negotiatorMemories.confidence} * ${opts.factor}` })
      .where(lt(schema.negotiatorMemories.updatedAt, cutoff))
      .returning({ id: schema.negotiatorMemories.id });
    const deletedRows = await db
      .delete(schema.negotiatorMemories)
      .where(lt(schema.negotiatorMemories.confidence, opts.deleteBelow))
      .returning({ id: schema.negotiatorMemories.id });
    if (decayedRows.length > 0 || deletedRows.length > 0) {
      logger.info('Negotiator memory decay pass', { decayed: decayedRows.length, deleted: deletedRows.length });
    }
    return { decayed: decayedRows.length, deleted: deletedRows.length };
  }
}

export const negotiatorMemoryDatabaseAdapter = new NegotiatorMemoryDatabaseAdapter();
