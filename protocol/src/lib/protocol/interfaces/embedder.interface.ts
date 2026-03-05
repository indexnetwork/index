// ═══════════════════════════════════════════════════════════════════════════════
// HyDE (Hypothetical Document Embeddings) search types
// ═══════════════════════════════════════════════════════════════════════════════

export type { Lens, HydeTargetCorpus } from '../agents/lens.inferrer';

/** A single lens embedding ready for search. */
export interface LensEmbedding {
  /** Free-text lens label (e.g. "crypto infrastructure VC"). */
  lens: string;
  /** Which corpus to search. */
  corpus: 'profiles' | 'intents';
  /** 2000-dim embedding vector. */
  embedding: number[];
}

/** Options for searchWithHydeEmbeddings (index scope, limits, min score). */
export interface HydeSearchOptions {
  /** Index IDs to scope the search (members / assigned intents only). */
  indexScope: string[];
  /** Exclude this user ID from results (e.g. source intent owner). */
  excludeUserId?: string;
  /** Max results per lens before merge (default 10). */
  limitPerStrategy?: number;
  /** Max results after merge/rank (default 20). */
  limit?: number;
  /** Minimum cosine similarity for intent searches (default 0.40). */
  minScore?: number;
  /** Minimum cosine similarity for profile searches (default 0.25). Lower because profile embeddings are broader. */
  profileMinScore?: number;
}

/** Options for searchWithProfileEmbedding (no lenses; direct profile similarity). */
export type ProfileEmbeddingSearchOptions = HydeSearchOptions;

/** A single candidate from HyDE search (profile or intent), with score and which lens matched. */
export interface HydeCandidate {
  type: 'profile' | 'intent';
  id: string;
  userId: string;
  score: number;
  /** Free-text lens label that produced this match. */
  matchedVia: string;
  indexId: string;
  /** Set after merge when user matched via multiple lenses. */
  matchedLenses?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// Embedding and vector store
// ═══════════════════════════════════════════════════════════════════════════════

export interface EmbeddingGenerator {
  generate(text: string | string[], dimensions?: number): Promise<number[] | number[][]>;
}

export interface VectorSearchResult<T> {
  item: T;
  score: number; // similarity (0-1)
}

export type VectorStoreOption<T> = {
  limit?: number;
  // Generic filter object passed to the store implementation
  filter?: Record<string, any>;
  // For stateless store: explicitly provide the candidates to search against
  candidates?: (T & { embedding?: number[] | null })[];
  // Minimum similarity score to include in results
  minScore?: number;
};

export interface VectorStore {
  /**
   * Search for similar items in the vector store.
   *
   * @param queryVector - The embedding vector to search for
   * @param collection - The logical name of the collection (e.g., 'profiles', 'intents')
   * @param options - generic options including limit, filter, and candidates
   */
  search<T>(
    queryVector: number[],
    collection: string,
    options?: VectorStoreOption<T>
  ): Promise<VectorSearchResult<T>[]>;
}

/**
 * Embedder: generate embeddings and run vector / HyDE search.
 * Implementations: OpenAI/OpenRouter for generate, pgvector for search.
 */
export interface Embedder extends EmbeddingGenerator, VectorStore {
  /**
   * Multi-lens HyDE search: run one vector search per lens embedding,
   * then merge, deduplicate by userId, and rank (boost for multiple lens matches).
   *
   * @param lensEmbeddings - Array of lens embeddings to search with
   * @param options - indexScope, excludeUserId, limits, minScore
   * @returns Deduplicated, ranked candidates (profile or intent) with scores
   */
  searchWithHydeEmbeddings(
    lensEmbeddings: LensEmbedding[],
    options: HydeSearchOptions
  ): Promise<HydeCandidate[]>;

  /**
   * Profile-as-source search: run vector search with the asker's profile embedding
   * against profiles and intents in the given index scope. Returns same shape as HyDE search.
   */
  searchWithProfileEmbedding(
    profileEmbedding: number[],
    options: ProfileEmbeddingSearchOptions
  ): Promise<HydeCandidate[]>;
}
