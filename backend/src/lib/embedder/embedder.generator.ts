/**
 * Generates embeddings via OpenRouter API using the OpenAI embedding model.
 * All embedding generation in the app should go through OpenRouter with this model for consistency.
 */
import OpenAI from 'openai';

import { log } from '../log';
import {
  OPENROUTER_EMBEDDING_BASE_URL,
  OPENROUTER_EMBEDDING_DIMENSIONS,
  OPENROUTER_EMBEDDING_MODEL,
} from './embedder.config';
import { EmbeddingGenerator } from './embedder.types';

const logger = log.lib.from('embedder.generator');

export class OpenRouterGenerator implements EmbeddingGenerator {
  private openai: OpenAI;

  constructor() {
    this.openai = new OpenAI({
      apiKey: process.env.OPENROUTER_API_KEY,
      baseURL: OPENROUTER_EMBEDDING_BASE_URL,
      defaultHeaders: {
        'HTTP-Referer': 'https://index.network',
        'X-Title': 'Index Network',
      },
    });
  }

  async generate(
    text: string | string[],
    dimensions: number = OPENROUTER_EMBEDDING_DIMENSIONS
  ): Promise<number[] | number[][]> {
    const texts = Array.isArray(text) ? text : [text];

    // Clean texts
    const cleanTexts = texts.map((t) => t.replace(/\n/g, ' ').trim()).filter(Boolean);

    if (cleanTexts.length === 0) {
      throw new Error('Text cannot be empty');
    }

    try {
      const response = await this.openai.embeddings.create({
        model: OPENROUTER_EMBEDDING_MODEL,
        input: cleanTexts,
        dimensions,
        encoding_format: 'float',
      });

      if (!response.data || response.data.length === 0) {
        throw new Error('No embedding data returned from OpenRouter');
      }

      if (Array.isArray(text)) {
        return response.data.map(d => d.embedding);
      } else {
        return response.data[0].embedding;
      }
    } catch (error) {
      logger.error('Error generating embedding', { error: error instanceof Error ? error.message : String(error) });
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`, { cause: error });
    }
  }
}
