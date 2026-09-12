export interface EmbeddingGenerateOptions {
  signal?: AbortSignal;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Embedding generation + vector / HyDE search
//
// Port contract (host application implements):
//   • `generate` is shape-preserving: a `string` input yields one `number[]`; a
//     `string[]` input yields `number[][]` in the same order. Vectors are
//     `dimensions`-long (default per the adapter; the schema assumes 2000).
//   • `search` returns matches sorted by descending `score` (cosine similarity in
//     [0,1]); it returns an empty array — never null — when nothing clears `minScore`.
//   • Implementations should be deterministic for a fixed input/model and must not
//     throw for an empty corpus (return []). Network/model failures may throw.
// ═══════════════════════════════════════════════════════════════════════════════

export interface EmbeddingGenerator {
  generate(text: string | string[], dimensions?: number, options?: EmbeddingGenerateOptions): Promise<number[] | number[][]>;
}

export interface VectorSearchResult<T> {
  item: T;
  score: number; // similarity (0-1)
}

export type VectorStoreOption<T> = {
  limit?: number;
  // Generic filter object passed to the store implementation
  filter?: Record<string, unknown>;
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

/** Embedding generation and vector search for protocol capabilities. */
export interface Embedder extends EmbeddingGenerator, VectorStore {}
