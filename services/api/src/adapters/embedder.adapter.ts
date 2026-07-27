/**
 * Embedder adapter: OpenRouter API with OpenAI embedding model + pgvector search (HyDE lens-based).
 * Uses the shared OpenRouter + OpenAI embedding config from lib/embedding.
 */

import OpenAI from 'openai';
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm/sql';
import { OPENROUTER_EMBEDDING_BASE_URL, OPENROUTER_EMBEDDING_DIMENSIONS, OPENROUTER_EMBEDDING_MODEL } from '../lib/embedding/embedding.config';
import db from '../lib/drizzle/drizzle';
import { traceAppOperation } from '../lib/sentry-performance';
import * as schema from '../schemas/database.schema';
// ─────────────────────────────────────────────────────────────────────────────
// Local types (structurally aligned with lib/protocol/interfaces/embedder.interface)
// ─────────────────────────────────────────────────────────────────────────────

/** A single lens embedding ready for search. */
export interface LensEmbedding {
  /** Free-text lens label (e.g. "crypto infrastructure VC"). */
  lens: string;
  /** Which corpus to search. */
  corpus: 'profiles' | 'intents' | 'premises';
  /** 2000-dim embedding vector. */
  embedding: number[];
}

export interface HydeSearchOptions {
  indexScope: string[];
  excludeUserId?: string;
  limitPerStrategy?: number;
  limit?: number;
  minScore?: number;
  /**
   * Discovery corpus gating, composed by the caller (defaults preserve legacy behavior).
   * Omitted fields default to: intents true, profile true, profileCorpus 'premises'.
   */
  corpusGating?: {
    /** Search the intents corpus. */
    intents?: boolean;
    /** Search the active profile corpus. */
    profile?: boolean;
    /** Which corpus backs 'profiles' lens hints and profile searches. */
    profileCorpus?: 'premise' | 'user_context';
  };
}

export interface HydeCandidate {
  type: 'intent' | 'premise' | 'user_context';
  id: string;
  userId: string;
  score: number;
  matchedVia: string;
  networkId: string;
  /** Candidate document text (populated for user_context matches; used as candidatePayload). */
  text?: string;
  matchedLenses?: string[];
}

export interface VectorSearchResult<T> {
  item: T;
  score: number;
}

export type VectorStoreOption<T> = {
  limit?: number;
  filter?: Record<string, unknown>;
  candidates?: (T & { embedding?: number[] | null })[];
  minScore?: number;
};

/** Which corpora a HyDE lens search should hit, given caller-composed gating. */
export function planHydeCorpusSearches(
  le: LensEmbedding,
  gating?: HydeSearchOptions['corpusGating'],
): {
  intents: boolean;
  premises: boolean;
  userContexts: boolean;
  preferred: 'intents' | 'premises' | 'user_contexts';
} {
  const intents = gating?.intents ?? true;
  const profile = gating?.profile ?? true;
  const profileCorpus = gating?.profileCorpus ?? 'premise';
  const premises = profile && profileCorpus === 'premise';
  const userContexts = profile && profileCorpus === 'user_context';
  const preferred =
    le.corpus === 'intents' && intents
      ? 'intents'
      : userContexts
        ? 'user_contexts'
        : 'premises';
  return {
    intents,
    premises,
    userContexts,
    preferred,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Adapter implementation
// ─────────────────────────────────────────────────────────────────────────────

export class EmbedderAdapter {
  private openai: OpenAI;
  private dimensions: number;

  constructor(options?: { apiKey?: string; baseURL?: string; dimensions?: number }) {
    this.openai = new OpenAI({
      apiKey: options?.apiKey ?? process.env.OPENROUTER_API_KEY,
      baseURL: options?.baseURL ?? OPENROUTER_EMBEDDING_BASE_URL,
      defaultHeaders: options?.baseURL
        ? undefined
        : {
            'HTTP-Referer': 'https://index.network',
            'X-Title': 'Index Network',
          },
    });
    this.dimensions = options?.dimensions ?? OPENROUTER_EMBEDDING_DIMENSIONS;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // EmbeddingGenerator
  // ─────────────────────────────────────────────────────────────────────────

  async generate(
    text: string | string[],
    dimensions?: number,
    options?: { signal?: AbortSignal }
  ): Promise<number[] | number[][]> {
    return traceAppOperation(
      {
        name: 'embedding generate',
        op: 'ai.embedding',
        attributes: {
          subsystem: 'embedding',
          provider: 'openrouter',
          model: OPENROUTER_EMBEDDING_MODEL,
          'embedding.input_count': Array.isArray(text) ? text.length : 1,
          'embedding.dimensions': dimensions ?? this.dimensions,
        },
      },
      () => this.generateInner(text, dimensions, options),
    );
  }

  private async generateInner(
    text: string | string[],
    dimensions?: number,
    options?: { signal?: AbortSignal }
  ): Promise<number[] | number[][]> {
    const texts = Array.isArray(text) ? text : [text];
    const cleanTexts = texts.map((t) => t.replace(/\n/g, ' ').trim()).filter(Boolean);
    if (cleanTexts.length === 0) {
      throw new Error('Text cannot be empty');
    }

    const dim = dimensions ?? this.dimensions;
    const response = await this.openai.embeddings.create({
      model: OPENROUTER_EMBEDDING_MODEL,
      input: cleanTexts,
      dimensions: dim,
      encoding_format: 'float',
    }, options?.signal ? { signal: options.signal } : undefined);

    if (!response.data?.length) {
      throw new Error('No embedding data returned');
    }

    const embeddings = response.data.map((d) => d.embedding);
    return Array.isArray(text) ? embeddings : embeddings[0];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // VectorStore
  // ─────────────────────────────────────────────────────────────────────────

  async search<T>(
    queryVector: number[],
    collection: string,
    options?: VectorStoreOption<T>
  ): Promise<VectorSearchResult<T>[]> {
    const limit = options?.limit ?? 10;
    const minScore = options?.minScore ?? 0;

    if (collection === 'intents') {
      return this.searchIntents(queryVector, options?.filter, limit, minScore) as Promise<
        VectorSearchResult<T>[]
      >;
    }

    throw new Error(`Unknown collection: ${collection}`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // HyDE lens-based search
  // ─────────────────────────────────────────────────────────────────────────

  async searchWithHydeEmbeddings(
    lensEmbeddings: LensEmbedding[],
    options: HydeSearchOptions
  ): Promise<HydeCandidate[]> {
    return traceAppOperation(
      {
        name: 'vector search HyDE embeddings',
        op: 'db.vector_search',
        attributes: {
          subsystem: 'database',
          'db.system': 'postgresql',
          'db.operation': 'vector_search',
          'search.strategy': 'hyde',
          'search.lens_count': lensEmbeddings.length,
          'search.index_scope_count': options.indexScope.length,
          'search.limit': options.limit ?? 80,
        },
      },
      () => this.searchWithHydeEmbeddingsInner(lensEmbeddings, options),
    );
  }

  private async searchWithHydeEmbeddingsInner(
    lensEmbeddings: LensEmbedding[],
    options: HydeSearchOptions
  ): Promise<HydeCandidate[]> {
    const {
      indexScope,
      excludeUserId,
      limitPerStrategy = 40,
      limit = 80,
      minScore = 0.40,
    } = options;

    const filter = { indexScope, excludeUserId };

    // Corpus selection honors the discovery env gates (DISCOVERY_ALLOWED_TYPES /
    // DISCOVERY_PROFILE_SOURCE). 'profiles' hints remap to the active profile
    // corpus: premises (default) or user_contexts (lightweight mode).
    const halfLimit = Math.ceil(limitPerStrategy / 2);
    const searchPromises = lensEmbeddings.flatMap((le) => {
      if (!le.embedding?.length) return [];
      const plan = planHydeCorpusSearches(le, options.corpusGating);
      return [
        plan.intents
          ? this.searchIntentsForHyde(le.embedding, filter, plan.preferred === 'intents' ? limitPerStrategy : halfLimit, minScore, le.lens)
          : Promise.resolve([]),
        plan.premises
          ? this.searchPremisesForHyde(le.embedding, filter, plan.preferred === 'premises' ? limitPerStrategy : halfLimit, minScore, le.lens)
          : Promise.resolve([]),
        plan.userContexts
          ? this.searchContextsForHyde(le.embedding, filter, plan.preferred === 'user_contexts' ? limitPerStrategy : halfLimit, minScore, le.lens)
          : Promise.resolve([]),
      ];
    });

    const allResults = await Promise.all(searchPromises);
    const flatResults = allResults.flat();
    return this.mergeAndRankCandidates(flatResults, limit);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: intent/premise search for HyDE
  // ─────────────────────────────────────────────────────────────────────────

  private async searchIntentsForHyde(
    embedding: number[],
    filter: { indexScope: string[]; excludeUserId?: string },
    limit: number,
    minScore: number,
    lens: string
  ): Promise<HydeCandidate[]> {
    if (filter.indexScope?.length === 0) return [];
    const vectorStr = `[${embedding.join(',')}]`;
    const { intents, intentNetworks } = schema;

    const conditions = [
      inArray(intentNetworks.networkId, filter.indexScope),
      ...(filter.excludeUserId ? [ne(intents.userId, filter.excludeUserId)] : []),
      isNull(intents.archivedAt),
      or(isNull(intents.status), eq(intents.status, 'ACTIVE')),
      isNull(schema.users.deletedAt),
      isNull(schema.networkMembers.deletedAt),
      isNull(schema.networks.deletedAt),
      isNotNull(intents.embedding),
      sql`1 - (${intents.embedding} <=> ${vectorStr}::vector) >= ${minScore}`,
    ];

    const results = await db
      .select({
        id: intents.id,
        userId: intents.userId,
        similarity: sql<number>`1 - (${intents.embedding} <=> ${vectorStr}::vector)`,
        networkId: intentNetworks.networkId,
      })
      .from(intents)
      .innerJoin(intentNetworks, eq(intents.id, intentNetworks.intentId))
      .innerJoin(schema.networkMembers, and(
        eq(schema.networkMembers.userId, intents.userId),
        eq(schema.networkMembers.networkId, intentNetworks.networkId),
      ))
      .innerJoin(schema.networks, eq(schema.networks.id, intentNetworks.networkId))
      .innerJoin(schema.users, eq(intents.userId, schema.users.id))
      .where(and(...conditions))
      .orderBy(sql`${intents.embedding} <=> ${vectorStr}::vector`)
      .limit(limit);

    return results.map((r) => ({
      type: 'intent' as const,
      id: r.id,
      userId: r.userId,
      score: r.similarity,
      matchedVia: lens,
      networkId: r.networkId,
    }));
  }

  private async searchPremisesForHyde(
    embedding: number[],
    filter: { indexScope: string[]; excludeUserId?: string },
    limit: number,
    minScore: number,
    lens: string
  ): Promise<HydeCandidate[]> {
    if (filter.indexScope?.length === 0) return [];
    const vectorStr = `[${embedding.join(',')}]`;
    const { premises, premiseNetworks } = schema;

    const conditions = [
      inArray(premiseNetworks.networkId, filter.indexScope),
      ...(filter.excludeUserId ? [ne(premises.userId, filter.excludeUserId)] : []),
      eq(premises.status, 'ACTIVE'),
      isNull(premises.deletedAt),
      isNull(schema.users.deletedAt),
      isNull(schema.networkMembers.deletedAt),
      isNull(schema.networks.deletedAt),
      isNotNull(premises.embedding),
      sql`1 - (${premises.embedding} <=> ${vectorStr}::vector) >= ${minScore}`,
    ];

    const results = await db
      .select({
        id: premises.id,
        userId: premises.userId,
        similarity: sql<number>`1 - (${premises.embedding} <=> ${vectorStr}::vector)`,
        networkId: premiseNetworks.networkId,
      })
      .from(premises)
      .innerJoin(premiseNetworks, eq(premises.id, premiseNetworks.premiseId))
      .innerJoin(schema.networkMembers, and(
        eq(schema.networkMembers.userId, premises.userId),
        eq(schema.networkMembers.networkId, premiseNetworks.networkId),
      ))
      .innerJoin(schema.networks, eq(schema.networks.id, premiseNetworks.networkId))
      .innerJoin(schema.users, eq(premises.userId, schema.users.id))
      .where(and(...conditions))
      .orderBy(sql`${premises.embedding} <=> ${vectorStr}::vector`)
      .limit(limit);

    return results.map((r) => ({
      type: 'premise' as const,
      id: r.id,
      userId: r.userId,
      score: r.similarity,
      matchedVia: lens,
      networkId: r.networkId,
    }));
  }

  private async searchContextsForHyde(
    embedding: number[],
    filter: { indexScope: string[]; excludeUserId?: string },
    limit: number,
    minScore: number,
    lens: string
  ): Promise<HydeCandidate[]> {
    if (filter.indexScope?.length === 0) return [];
    const vectorStr = `[${embedding.join(',')}]`;
    const { userContexts } = schema;

    const conditions = [
      inArray(userContexts.networkId, filter.indexScope),
      ...(filter.excludeUserId ? [ne(userContexts.userId, filter.excludeUserId)] : []),
      isNull(schema.users.deletedAt),
      isNull(schema.networkMembers.deletedAt),
      isNull(schema.networks.deletedAt),
      isNotNull(userContexts.embedding),
      sql`1 - (${userContexts.embedding} <=> ${vectorStr}::vector) >= ${minScore}`,
    ];

    const results = await db
      .select({
        id: userContexts.id,
        userId: userContexts.userId,
        text: userContexts.text,
        similarity: sql<number>`1 - (${userContexts.embedding} <=> ${vectorStr}::vector)`,
        networkId: userContexts.networkId,
      })
      .from(userContexts)
      .innerJoin(schema.networkMembers, and(
        eq(schema.networkMembers.userId, userContexts.userId),
        eq(schema.networkMembers.networkId, userContexts.networkId),
      ))
      .innerJoin(schema.networks, eq(schema.networks.id, userContexts.networkId))
      .innerJoin(schema.users, eq(userContexts.userId, schema.users.id))
      .where(and(...conditions))
      .orderBy(sql`${userContexts.embedding} <=> ${vectorStr}::vector`)
      .limit(limit);

    return results.map((r) => ({
      type: 'user_context' as const,
      id: r.id,
      userId: r.userId,
      score: r.similarity,
      matchedVia: lens,
      networkId: r.networkId!,
      text: r.text,
    }));
  }

  private mergeAndRankCandidates(
    candidates: HydeCandidate[],
    limit: number
  ): HydeCandidate[] {
    const byUser = new Map<string, HydeCandidate[]>();
    for (const c of candidates) {
      const existing = byUser.get(c.userId) ?? [];
      existing.push(c);
      byUser.set(c.userId, existing);
    }

    const scored = Array.from(byUser.entries()).map(([, matches]) => {
      const bestMatch = matches.reduce((a, b) => (a.score > b.score ? a : b));
      const lensBonus = (matches.length - 1) * 0.1;
      const lenses = [...new Set(matches.map((m) => m.matchedVia))];
      return {
        ...bestMatch,
        score: Math.min(bestMatch.score + lensBonus, 1),
        matchedLenses: lenses.length > 1 ? lenses : undefined,
      };
    });

    return scored.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: generic search (single-vector)
  // ─────────────────────────────────────────────────────────────────────────

  // NOTE: profile-HyDE discovery (the `searchProfiles` profiles-corpus reader) was
  // retired in WS10 (IND-367). It was the last runtime read of `user_profiles` and was
  // already unreachable: the live HyDE path (`searchWithHydeEmbeddings`) remaps the
  // 'profiles' corpus hint to 'premises', and no caller passed 'profiles' to `search()`.
  // Discovery now runs on context-to-intent + premise similarity. See IND-365 for the
  // table drop.

  private async searchIntents(
    embedding: number[],
    filter: Record<string, unknown> | undefined,
    limit: number,
    minScore: number
  ): Promise<VectorSearchResult<unknown>[]> {
    const vectorStr = `[${embedding.join(',')}]`;
    const { intents, intentNetworks } = schema;

    const baseConditions = [
      isNull(intents.archivedAt),
      or(isNull(intents.status), eq(intents.status, 'ACTIVE')),
      isNull(schema.users.deletedAt),
      sql`1 - (${intents.embedding} <=> ${vectorStr}::vector) >= ${minScore}`,
    ];

    const scopedIndexes =
      filter?.indexScope && Array.isArray(filter.indexScope) ? (filter.indexScope as string[]) : null;

    const selection = {
      id: intents.id,
      payload: intents.payload,
      summary: intents.summary,
      userId: intents.userId,
      similarity: sql<number>`1 - (${intents.embedding} <=> ${vectorStr}::vector)`,
    };

    const results = scopedIndexes
      ? await db
          .select(selection)
          .from(intents)
          .innerJoin(intentNetworks, eq(intents.id, intentNetworks.intentId))
          .innerJoin(schema.networkMembers, and(
            eq(schema.networkMembers.userId, intents.userId),
            eq(schema.networkMembers.networkId, intentNetworks.networkId),
          ))
          .innerJoin(schema.networks, eq(schema.networks.id, intentNetworks.networkId))
          .innerJoin(schema.users, eq(intents.userId, schema.users.id))
          .where(and(
            ...baseConditions,
            inArray(intentNetworks.networkId, scopedIndexes),
            isNull(schema.networkMembers.deletedAt),
            isNull(schema.networks.deletedAt),
          ))
          .orderBy(sql`${intents.embedding} <=> ${vectorStr}::vector`)
          .limit(limit)
      : await db
          .select(selection)
          .from(intents)
          .innerJoin(schema.users, eq(intents.userId, schema.users.id))
          .where(and(...baseConditions))
          .orderBy(sql`${intents.embedding} <=> ${vectorStr}::vector`)
          .limit(limit);

    return results.map((r) => ({
      item: {
        id: r.id,
        payload: r.payload,
        summary: r.summary,
        userId: r.userId,
      },
      score: r.similarity,
    }));
  }
}

/**
 * Singleton instance of EmbedderAdapter used throughout the protocol stack.
 */
export const embedderAdapter = new EmbedderAdapter();
