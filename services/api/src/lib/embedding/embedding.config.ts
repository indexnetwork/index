/**
 * Shared config for embeddings: all embedding generation uses OpenRouter API
 * with the OpenAI embedding model (text-embedding-3-large) for consistency.
 *
 * Used by: EmbedderAdapter (adapters/embedder.adapter.ts).
 */

/**
 * OpenRouter model id for embeddings (OpenAI model via OpenRouter).
 * Not configurable: it must match the vectors already stored in the database.
 */
export const OPENROUTER_EMBEDDING_MODEL = 'openai/text-embedding-3-large';

/** Embedding vector size; must match DB schema (e.g. intents, hyde_documents, user_contexts). */
export const OPENROUTER_EMBEDDING_DIMENSIONS = 2000;

/** Base URL for OpenRouter (embeddings are OpenAI-compatible). */
export const OPENROUTER_EMBEDDING_BASE_URL = 'https://openrouter.ai/api/v1';
