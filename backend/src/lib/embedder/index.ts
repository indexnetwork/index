import { Embedder, EmbeddingGenerator, VectorSearchResult, VectorStoreOption } from './embedder.types';
import { OpenRouterGenerator } from './embedder.generator';

export interface IndexEmbedderOptions {
  // Generator Configuration
  generator?: {
    model?: string;
    dimensions?: number;
  };
  // Injected Search Strategy
  searcher?: (queryVector: number[], collection: string, options?: VectorStoreOption<any>) => Promise<VectorSearchResult<any>[]>;
}

/**
 * Default embedder used across the app: OpenRouter API with OpenAI embedding model
 * (openai/text-embedding-3-large). Generate() uses OpenRouterGenerator; search()
 * requires an injected searcher (e.g. pgvector).
 */
export class IndexEmbedder implements Embedder {
  private generator: EmbeddingGenerator;
  private searcher?: (queryVector: number[], collection: string, options?: VectorStoreOption<any>) => Promise<VectorSearchResult<any>[]>;

  constructor(options?: IndexEmbedderOptions) {
    this.generator = new OpenRouterGenerator();

    // Initialize Searcher
    this.searcher = options?.searcher;
  }

  /**
   * Generates embeddings using the internal generator.
   */
  async generate(text: string | string[], dimensions: number = 2000, options?: { signal?: AbortSignal }): Promise<number[] | number[][]> {
    return this.generator.generate(text, dimensions, options);
  }

  /**
   * Searches using the injected searcher strategy.
   * Throws if no searcher is defined.
   */
  async search<T>(
    queryVector: number[],
    collection: string,
    options?: VectorStoreOption<T>
  ): Promise<VectorSearchResult<T>[]> {
    if (!this.searcher) {
      throw new Error('IndexEmbedder: No search strategy defined. Pass a `searcher` function in the constructor.');
    }
    return this.searcher(queryVector, collection, options);
  }
}

// Export shared types
export * from './embedder.types';
