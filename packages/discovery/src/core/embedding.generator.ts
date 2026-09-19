import type { EmbeddingGenerator } from './types.js';

/** Shared vector space for intent lifecycle artifacts; pairing does not use embeddings. */
export const OPENROUTER_EMBEDDING_MODEL = 'openai/text-embedding-3-large';
export const OPENROUTER_EMBEDDING_DIMENSIONS = 2000;
export const OPENROUTER_EMBEDDING_BASE_URL = 'https://openrouter.ai/api/v1';

/** The host supplies its OpenAI-compatible transport; discovery has no SDK dependency. */
export interface EmbeddingClient {
  embeddings: {
    create(input: { model: string; input: string[]; dimensions: number; encoding_format: 'float' }, options?: { signal: AbortSignal }): Promise<{ data: { embedding: number[] }[] }>;
  };
}

/**
 * Generate intent lifecycle vectors with the same normalization and model in every host.
 * @param client - Host-owned OpenRouter transport.
 * @param text - One intent or a batch of intents.
 * @param dimensions - Vector size, defaulting to the production schema's size.
 * @param options - Cancellation propagated to the transport.
 * @returns One vector or the corresponding batch.
 * @throws When input is empty, the provider fails or returns no embeddings.
 */
export async function generateEmbeddings(
  client: EmbeddingClient,
  text: Parameters<EmbeddingGenerator['generate']>[0],
  dimensions = OPENROUTER_EMBEDDING_DIMENSIONS,
  options?: { signal?: AbortSignal },
): Promise<number[] | number[][]> {
  const texts = Array.isArray(text) ? text : [text];
  const cleanTexts = texts.map((value) => value.replace(/\n/g, ' ').trim()).filter(Boolean);
  if (!cleanTexts.length) throw new Error('Text cannot be empty');
  const response = await client.embeddings.create({
    model: OPENROUTER_EMBEDDING_MODEL,
    input: cleanTexts,
    dimensions,
    encoding_format: 'float',
  }, options?.signal ? { signal: options.signal } : undefined);
  if (!response.data?.length) throw new Error('No embedding data returned');
  const embeddings = response.data.map((entry) => entry.embedding);
  return Array.isArray(text) ? embeddings : embeddings[0]!;
}
