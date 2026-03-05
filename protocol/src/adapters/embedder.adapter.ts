/**
 * Embedder adapter: OpenRouter API with OpenAI embedding model + pgvector search (HyDE lens-based).
 * Uses the same OpenRouter + OpenAI embedder config as lib/embedder (OpenRouterGenerator).
 */

import OpenAI from 'openai';
import { and, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import {
  OPENROUTER_EMBEDDING_BASE_URL,
  OPENROUTER_EMBEDDING_DIMENSIONS,
  OPENROUTER_EMBEDDING_MODEL,
} from '../lib/embedder/embedder.config';
import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import type { LensEmbedding, ProfileEmbeddingSearchOptions } from '../lib/protocol/interfaces/embedder.interface';

// ─────────────────────────────────────────────────────────────────────────────
// Local types (align with lib/protocol/interfaces/embedder.interface.ts)
// ─────────────────────────────────────────────────────────────────────────────

export type { LensEmbedding } from '../lib/protocol/interfaces/embedder.interface';

export interface HydeSearchOptions {
  indexScope: string[];
  excludeUserId?: string;
  limitPerStrategy?: number;
  limit?: number;
  minScore?: number;
  profileMinScore?: number;
}

export interface HydeCandidate {
  type: 'profile' | 'intent';
  id: string;
  userId: string;
  score: number;
  matchedVia: string;
  indexId: string;
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
    dimensions?: number
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
    });

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

    if (collection === 'profiles') {
      return this.searchProfiles(queryVector, options?.filter, limit, minScore) as Promise<
        VectorSearchResult<T>[]
      >;
    }
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
    const {
      indexScope,
      excludeUserId,
      limitPerStrategy = 40,
      limit = 80,
      minScore = 0.40,
      profileMinScore = 0.25,
    } = options;

    const filter = { indexScope, excludeUserId };

    const searchPromises = lensEmbeddings.map(async (le) => {
      if (!le.embedding?.length) return [];

      if (le.corpus === 'profiles') {
        return this.searchProfilesForHyde(
          le.embedding,
          filter,
          limitPerStrategy,
          profileMinScore,
          le.lens
        );
      }
      return this.searchIntentsForHyde(
        le.embedding,
        filter,
        limitPerStrategy,
        minScore,
        le.lens
      );
    });

    const allResults = await Promise.all(searchPromises);
    const flatResults = allResults.flat();
    return this.mergeAndRankCandidates(flatResults, limit);
  }

  async searchWithProfileEmbedding(
    profileEmbedding: number[],
    options: ProfileEmbeddingSearchOptions
  ): Promise<HydeCandidate[]> {
    const {
      indexScope,
      excludeUserId,
      limitPerStrategy = 40,
      limit = 80,
      minScore = 0.40,
      profileMinScore = 0.25,
    } = options;
    const filter = { indexScope, excludeUserId };
    const [profileResults, intentResults] = await Promise.all([
      this.searchProfilesByProfileEmbedding(profileEmbedding, filter, limitPerStrategy, profileMinScore),
      this.searchIntentsByProfileEmbedding(profileEmbedding, filter, limitPerStrategy, minScore),
    ]);
    const flatResults = [...profileResults, ...intentResults];
    return this.mergeAndRankCandidates(flatResults, limit);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Private: profile/intent search for HyDE
  // ─────────────────────────────────────────────────────────────────────────

  private async searchProfilesForHyde(
    embedding: number[],
    filter: { indexScope: string[]; excludeUserId?: string },
    limit: number,
    minScore: number,
    lens: string
  ): Promise<HydeCandidate[]> {
    if (filter.indexScope?.length === 0) return [];
    const vectorStr = `[${embedding.join(',')}]`;
    const { userProfiles, indexMembers } = schema;

    const conditions = [
      inArray(indexMembers.indexId, filter.indexScope),
      isNotNull(userProfiles.embedding),
      sql`1 - (${userProfiles.embedding} <=> ${vectorStr}::vector) >= ${minScore}`,
      ...(filter.excludeUserId ? [ne(userProfiles.userId, filter.excludeUserId)] : []),
    ];

    const deduped = db
      .selectDistinctOn([userProfiles.userId], {
        userId: userProfiles.userId,
        similarity: sql<number>`1 - (${userProfiles.embedding} <=> ${vectorStr}::vector)`.as('similarity'),
        indexId: indexMembers.indexId,
      })
      .from(userProfiles)
      .innerJoin(indexMembers, eq(userProfiles.userId, indexMembers.userId))
      .where(and(...conditions))
      .orderBy(userProfiles.userId, sql`${userProfiles.embedding} <=> ${vectorStr}::vector`, indexMembers.indexId)
      .as('deduped');

    const results = await db
      .select()
      .from(deduped)
      .orderBy(sql`${deduped.similarity} DESC`)
      .limit(limit);

    return results.map((r) => ({
      type: 'profile' as const,
      id: r.userId,
      userId: r.userId,
      score: r.similarity,
      matchedVia: lens,
      indexId: r.indexId,
    }));
  }

  private async searchIntentsForHyde(
    embedding: number[],
    filter: { indexScope: string[]; excludeUserId?: string },
    limit: number,
    minScore: number,
    lens: string
  ): Promise<HydeCandidate[]> {
    if (filter.indexScope?.length === 0) return [];
    const vectorStr = `[${embedding.join(',')}]`;
    const { intents, intentIndexes } = schema;

    const conditions = [
      inArray(intentIndexes.indexId, filter.indexScope),
      ...(filter.excludeUserId ? [ne(intents.userId, filter.excludeUserId)] : []),
      isNull(intents.archivedAt),
      isNotNull(intents.embedding),
      sql`1 - (${intents.embedding} <=> ${vectorStr}::vector) >= ${minScore}`,
    ];

    const results = await db
      .select({
        id: intents.id,
        userId: intents.userId,
        similarity: sql<number>`1 - (${intents.embedding} <=> ${vectorStr}::vector)`,
        indexId: intentIndexes.indexId,
      })
      .from(intents)
      .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
      .where(and(...conditions))
      .orderBy(sql`${intents.embedding} <=> ${vectorStr}::vector`)
      .limit(limit);

    return results.map((r) => ({
      type: 'intent' as const,
      id: r.id,
      userId: r.userId,
      score: r.similarity,
      matchedVia: lens,
      indexId: r.indexId,
    }));
  }

  private async searchProfilesByProfileEmbedding(
    embedding: number[],
    filter: { indexScope: string[]; excludeUserId?: string },
    limit: number,
    minScore: number
  ): Promise<HydeCandidate[]> {
    if (filter.indexScope?.length === 0) return [];
    const vectorStr = `[${embedding.join(',')}]`;
    const { userProfiles, indexMembers } = schema;
    const conditions = [
      inArray(indexMembers.indexId, filter.indexScope),
      isNotNull(userProfiles.embedding),
      sql`1 - (${userProfiles.embedding} <=> ${vectorStr}::vector) >= ${minScore}`,
      ...(filter.excludeUserId ? [ne(userProfiles.userId, filter.excludeUserId)] : []),
    ];

    const deduped = db
      .selectDistinctOn([userProfiles.userId], {
        userId: userProfiles.userId,
        similarity: sql<number>`1 - (${userProfiles.embedding} <=> ${vectorStr}::vector)`.as('similarity'),
        indexId: indexMembers.indexId,
      })
      .from(userProfiles)
      .innerJoin(indexMembers, eq(userProfiles.userId, indexMembers.userId))
      .where(and(...conditions))
      .orderBy(userProfiles.userId, sql`${userProfiles.embedding} <=> ${vectorStr}::vector`, indexMembers.indexId)
      .as('deduped');

    const results = await db
      .select()
      .from(deduped)
      .orderBy(sql`${deduped.similarity} DESC`)
      .limit(limit);

    return results.map((r) => ({
      type: 'profile' as const,
      id: r.userId,
      userId: r.userId,
      score: r.similarity,
      matchedVia: 'profile-similarity',
      indexId: r.indexId,
    }));
  }

  private async searchIntentsByProfileEmbedding(
    embedding: number[],
    filter: { indexScope: string[]; excludeUserId?: string },
    limit: number,
    minScore: number
  ): Promise<HydeCandidate[]> {
    if (filter.indexScope?.length === 0) return [];
    const vectorStr = `[${embedding.join(',')}]`;
    const { intents, intentIndexes } = schema;
    const conditions = [
      inArray(intentIndexes.indexId, filter.indexScope),
      isNull(intents.archivedAt),
      isNotNull(intents.embedding),
      sql`1 - (${intents.embedding} <=> ${vectorStr}::vector) >= ${minScore}`,
      ...(filter.excludeUserId ? [ne(intents.userId, filter.excludeUserId)] : []),
    ];
    const results = await db
      .select({
        id: intents.id,
        userId: intents.userId,
        similarity: sql<number>`1 - (${intents.embedding} <=> ${vectorStr}::vector)`,
        indexId: intentIndexes.indexId,
      })
      .from(intents)
      .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
      .where(and(...conditions))
      .orderBy(sql`${intents.embedding} <=> ${vectorStr}::vector`)
      .limit(limit);
    return results.map((r) => ({
      type: 'intent' as const,
      id: r.id,
      userId: r.userId,
      score: r.similarity,
      matchedVia: 'profile-similarity',
      indexId: r.indexId,
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

  private async searchProfiles(
    embedding: number[],
    filter: Record<string, unknown> | undefined,
    limit: number,
    minScore: number
  ): Promise<VectorSearchResult<unknown>[]> {
    const vectorStr = `[${embedding.join(',')}]`;
    const { hydeDocuments, indexMembers, userProfiles } = schema;

    const baseConditions = [
      eq(hydeDocuments.sourceType, 'profile'),
      eq(hydeDocuments.targetCorpus, 'profiles'),
      isNotNull(hydeDocuments.hydeEmbedding),
      sql`1 - (${hydeDocuments.hydeEmbedding} <=> ${vectorStr}::vector) >= ${minScore}`,
    ];

    const results =
      filter?.indexScope && Array.isArray(filter.indexScope)
        ? await db
            .select({
              userId: userProfiles.userId,
              identity: userProfiles.identity,
              narrative: userProfiles.narrative,
              attributes: userProfiles.attributes,
              similarity: sql<number>`1 - (${hydeDocuments.hydeEmbedding} <=> ${vectorStr}::vector)`,
            })
            .from(hydeDocuments)
            .innerJoin(indexMembers, eq(hydeDocuments.sourceId, indexMembers.userId))
            .innerJoin(userProfiles, eq(userProfiles.userId, hydeDocuments.sourceId))
            .where(and(...baseConditions, inArray(indexMembers.indexId, filter.indexScope as string[])))
            .orderBy(sql`${hydeDocuments.hydeEmbedding} <=> ${vectorStr}::vector`)
            .limit(limit)
        : await db
            .select({
              userId: userProfiles.userId,
              identity: userProfiles.identity,
              narrative: userProfiles.narrative,
              attributes: userProfiles.attributes,
              similarity: sql<number>`1 - (${hydeDocuments.hydeEmbedding} <=> ${vectorStr}::vector)`,
            })
            .from(hydeDocuments)
            .innerJoin(userProfiles, eq(userProfiles.userId, hydeDocuments.sourceId))
            .where(and(...baseConditions))
            .orderBy(sql`${hydeDocuments.hydeEmbedding} <=> ${vectorStr}::vector`)
            .limit(limit);

    return results.map((r) => ({
      item: {
        userId: r.userId,
        identity: r.identity,
        narrative: r.narrative,
        attributes: r.attributes,
      },
      score: r.similarity,
    }));
  }

  private async searchIntents(
    embedding: number[],
    filter: Record<string, unknown> | undefined,
    limit: number,
    minScore: number
  ): Promise<VectorSearchResult<unknown>[]> {
    const vectorStr = `[${embedding.join(',')}]`;
    const { intents, intentIndexes } = schema;

    const baseConditions = [
      isNull(intents.archivedAt),
      sql`1 - (${intents.embedding} <=> ${vectorStr}::vector) >= ${minScore}`,
    ];

    if (filter?.indexScope && Array.isArray(filter.indexScope)) {
      const results = await db
        .select({
          id: intents.id,
          payload: intents.payload,
          summary: intents.summary,
          userId: intents.userId,
          similarity: sql<number>`1 - (${intents.embedding} <=> ${vectorStr}::vector)`,
        })
        .from(intents)
        .innerJoin(intentIndexes, eq(intents.id, intentIndexes.intentId))
        .where(and(...baseConditions, inArray(intentIndexes.indexId, filter.indexScope as string[])))
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

    const results = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        userId: intents.userId,
        similarity: sql<number>`1 - (${intents.embedding} <=> ${vectorStr}::vector)`,
      })
      .from(intents)
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
