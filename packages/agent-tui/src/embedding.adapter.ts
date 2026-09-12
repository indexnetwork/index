import type { EmbeddingGenerator } from '@indexnetwork/discovery';

/** Real query embeddings for the synthetic scenario corpus; no API database is involved. */
export class ScenarioEmbedder implements EmbeddingGenerator {
  constructor(private readonly apiKey: string) {}

  /** @param text - Scenario statements or one agent query. @param dimensions - Vector size. @param options - Cancellation. @returns Ordered vectors. @throws On a provider failure or malformed vectors. */
  async generate(text: string | string[], dimensions = 2000, options?: { signal?: AbortSignal }): Promise<number[] | number[][]> {
    const input = Array.isArray(text) ? text : [text];
    const response = await fetch('https://openrouter.ai/api/v1/embeddings', {
      method: 'POST', headers: { Authorization: 'Bearer ' + this.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'openai/text-embedding-3-large', input, dimensions, encoding_format: 'float' }),
      signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(options?.signal ? [options.signal] : [])]),
    });
    if (!response.ok) throw new Error('Scenario embedding failed: HTTP ' + response.status);
    const result = await response.json() as { data: { index: number; embedding: number[] }[] };
    const vectors = result.data?.sort((a, b) => a.index - b.index).map(row => row.embedding);
    if (vectors?.length !== input.length || vectors.some(vector => vector.length !== dimensions || vector.some(value => !Number.isFinite(value)))) throw new Error('Scenario embedding response is invalid.');
    return Array.isArray(text) ? vectors : vectors[0];
  }
}
