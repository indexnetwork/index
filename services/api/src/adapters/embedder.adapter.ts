/**
 * Embedder adapter: OpenRouter API with OpenAI embedding model + pgvector search.
 * Uses the shared OpenRouter + OpenAI embedding config from lib/embedding.
 */

import OpenAI from 'openai';
import { and, eq, inArray, isNotNull, isNull, ne, or, sql } from 'drizzle-orm/sql';
import { OPENROUTER_EMBEDDING_BASE_URL, OPENROUTER_EMBEDDING_DIMENSIONS, OPENROUTER_EMBEDDING_MODEL } from '../lib/embedding/embedding.config';
import { embeddingConfigurationFingerprint } from '../lib/embedding/embedding.identity';
import { traceAppOperation } from '../lib/sentry-performance';
import * as schema from '../schemas/database.schema';
// ─────────────────────────────────────────────────────────────────────────────
// Local types (structurally aligned with lib/protocol/interfaces/embedder.interface)
// ─────────────────────────────────────────────────────────────────────────────

export interface IntentCandidate {
  type: 'intent'; id: string; userId: string; score: number; networkId: string;
}
export interface IntentSearchOptions {
  networkScope: string[]; excludeUserId?: string; limit: number; minScore: number; signal?: AbortSignal;
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

async function getDb() {
  return (await import('../lib/drizzle/drizzle')).default;
}

export interface EmbedderAdapterIdentity {
  provider: 'openrouter';
  model: string;
  dimensions: number;
  configurationFingerprint: string;
}

export class EmbedderAdapter {
  private openai?: OpenAI;
  private readonly openaiOptions: NonNullable<ConstructorParameters<typeof OpenAI>[0]>;
  private dimensions: number;
  private model: string;
  readonly identity: EmbedderAdapterIdentity;

  constructor(options?: {
    apiKey?: string;
    baseURL?: string;
    dimensions?: number;
    maxRetries?: number;
    timeout?: number;
  }) {
    const baseURL = options?.baseURL ?? OPENROUTER_EMBEDDING_BASE_URL;
    this.dimensions = options?.dimensions ?? OPENROUTER_EMBEDDING_DIMENSIONS;
    this.model = OPENROUTER_EMBEDDING_MODEL;
    this.openaiOptions = {
      apiKey: options?.apiKey ?? process.env.OPENROUTER_API_KEY,
      baseURL,
      defaultHeaders: options?.baseURL
        ? undefined
        : {
            'HTTP-Referer': 'https://index.network',
            'X-Title': 'Index Network',
          },
      ...(options?.maxRetries === undefined ? {} : { maxRetries: options.maxRetries }),
      ...(options?.timeout === undefined ? {} : { timeout: options.timeout }),
    };
    const configuration = {
      provider: 'openrouter' as const,
      model: this.model,
      dimensions: this.dimensions,
    };
    this.identity = Object.freeze({
      ...configuration,
      configurationFingerprint: embeddingConfigurationFingerprint(configuration),
    });
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
          model: this.model,
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
    const response = await this.getOpenAI().embeddings.create({
      model: this.model,
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

  private getOpenAI(): OpenAI {
    if (!this.openaiOptions.apiKey?.trim()) {
      throw new Error('OPENROUTER_API_KEY is required for embedding generation');
    }
    if (!this.openai) this.openai = new OpenAI(this.openaiOptions);
    return this.openai;
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

  /** Search only real intent embeddings, with current lifecycle, broadcast and membership eligibility. */
  async searchIntentCandidates(embedding: number[], options: IntentSearchOptions): Promise<IntentCandidate[]> {
    options.signal?.throwIfAborted();
    return traceAppOperation({
      name: 'vector search intent candidates', op: 'db.vector_search',
      attributes: { subsystem: 'database', 'db.system': 'postgresql', 'search.strategy': 'hyde', 'search.limit': options.limit },
    }, () => this.searchIntentCandidatesInner(embedding, options));
  }

  private async searchIntentCandidatesInner(embedding: number[], options: IntentSearchOptions): Promise<IntentCandidate[]> {
    const { limit, minScore, ...filter } = options;
    if (filter.networkScope?.length === 0) return [];
    const db = await getDb();
    const vectorStr = `[${embedding.join(',')}]`;
    const { intents, intentNetworks } = schema;

    const conditions = [
      inArray(intentNetworks.networkId, filter.networkScope),
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
      networkId: r.networkId,
    }));
  }


  // ─────────────────────────────────────────────────────────────────────────
  // Private: generic search (single-vector)
  // ─────────────────────────────────────────────────────────────────────────

  // NOTE: profile-HyDE discovery (the `searchProfiles` profiles-corpus reader) was
  // retired in WS10 (IND-367). It was the last runtime read of `user_profiles` and was
  // already unreachable. Discovery now runs on HyDE query retrieval over intents.
  // See IND-365 for the table drop.

  private async searchIntents(
    embedding: number[],
    filter: Record<string, unknown> | undefined,
    limit: number,
    minScore: number
  ): Promise<VectorSearchResult<unknown>[]> {
    const db = await getDb();
    const vectorStr = `[${embedding.join(',')}]`;
    const { intents, intentNetworks } = schema;

    const baseConditions = [
      isNull(intents.archivedAt),
      or(isNull(intents.status), eq(intents.status, 'ACTIVE')),
      isNull(schema.users.deletedAt),
      sql`1 - (${intents.embedding} <=> ${vectorStr}::vector) >= ${minScore}`,
    ];

    const scopedNetworks =
      filter?.networkScope && Array.isArray(filter.networkScope) ? (filter.networkScope as string[]) : null;

    const selection = {
      id: intents.id,
      payload: intents.payload,
      summary: intents.summary,
      userId: intents.userId,
      similarity: sql<number>`1 - (${intents.embedding} <=> ${vectorStr}::vector)`,
    };

    const results = scopedNetworks
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
            inArray(intentNetworks.networkId, scopedNetworks),
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
