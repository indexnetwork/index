
export interface EmbeddingGenerateOptions {
  signal?: AbortSignal;
}

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

export interface Embedder extends EmbeddingGenerator, VectorStore { }
