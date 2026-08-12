import { afterAll, beforeAll, describe, expect, it, mock } from 'bun:test';

const originalOpenRouterApiKey = process.env.OPENROUTER_API_KEY;
const originalOpenAiApiKey = process.env.OPENAI_API_KEY;
const constructedOptions: Array<{
  apiKey?: string;
  baseURL?: string;
  defaultHeaders?: Record<string, string>;
  maxRetries?: number;
  timeout?: number;
}> = [];
let embeddingRequests = 0;

class ProviderFreeOpenAI {
  readonly embeddings = {
    create: async () => {
      embeddingRequests += 1;
      return { data: [{ embedding: [0.25, 0.75] }] };
    },
  };

  constructor(options: (typeof constructedOptions)[number] = {}) {
    if (!options.apiKey) throw new Error('OPENAI client constructed without a key');
    constructedOptions.push(options);
  }
}

mock.module('openai', () => ({ default: ProviderFreeOpenAI }));

beforeAll(() => {
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.OPENAI_API_KEY;
});

afterAll(() => {
  mock.restore();
  if (originalOpenRouterApiKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalOpenRouterApiKey;
  if (originalOpenAiApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = originalOpenAiApiKey;
});

describe('EmbedderAdapter provider-free lifecycle', () => {
  it('imports and constructs without provider credentials while preserving identity', async () => {
    const { EmbedderAdapter, embedderAdapter } = await import('../embedder.adapter');

    expect(constructedOptions).toHaveLength(0);
    expect(embedderAdapter.identity).toEqual({
      provider: 'openrouter',
      model: 'openai/text-embedding-3-large',
      dimensions: 2000,
      configurationFingerprint: expect.any(String),
    });
    expect(new EmbedderAdapter({ dimensions: 256 }).identity).toEqual({
      provider: 'openrouter',
      model: 'openai/text-embedding-3-large',
      dimensions: 256,
      configurationFingerprint: expect.any(String),
    });
    expect(constructedOptions).toHaveLength(0);
  });

  it('refuses the first valid generate without OPENROUTER_API_KEY before constructing a client', async () => {
    const { EmbedderAdapter } = await import('../embedder.adapter');
    const adapter = new EmbedderAdapter();

    await expect(adapter.generate('provider-free input')).rejects.toThrow(
      'OPENROUTER_API_KEY is required for embedding generation',
    );
    expect(constructedOptions).toHaveLength(0);
    expect(embeddingRequests).toBe(0);
  });

  it('uses supplied credentials and default OpenRouter headers while reusing one lazy client', async () => {
    const { EmbedderAdapter } = await import('../embedder.adapter');
    const adapter = new EmbedderAdapter({ apiKey: 'provider-test-key', dimensions: 2 });

    expect(await adapter.generate('first')).toEqual([0.25, 0.75]);
    expect(await adapter.generate('second')).toEqual([0.25, 0.75]);
    expect(constructedOptions).toEqual([{
      apiKey: 'provider-test-key',
      baseURL: 'https://openrouter.ai/api/v1',
      defaultHeaders: {
        'HTTP-Referer': 'https://index.network',
        'X-Title': 'Index Network',
      },
    }]);
    expect(embeddingRequests).toBe(2);
  });

  it('uses a supplied base URL without OpenRouter default headers', async () => {
    const { EmbedderAdapter } = await import('../embedder.adapter');
    const adapter = new EmbedderAdapter({
      apiKey: 'custom-test-key',
      baseURL: 'https://embedding.test/v1',
      dimensions: 2,
    });

    expect(await adapter.generate('custom endpoint')).toEqual([0.25, 0.75]);
    expect(constructedOptions[1]).toEqual({
      apiKey: 'custom-test-key',
      baseURL: 'https://embedding.test/v1',
      defaultHeaders: undefined,
    });
    expect(constructedOptions[1]).not.toHaveProperty('maxRetries');
    expect(constructedOptions[1]).not.toHaveProperty('timeout');
  });

  it('passes explicit historical-quality retry and timeout policy to OpenAI', async () => {
    const { EmbedderAdapter } = await import('../embedder.adapter');
    const adapter = new EmbedderAdapter({
      apiKey: 'quality-test-key',
      dimensions: 2,
      maxRetries: 0,
      timeout: 60_000,
    });

    expect(await adapter.generate('quality endpoint')).toEqual([0.25, 0.75]);
    expect(constructedOptions[2]).toMatchObject({
      maxRetries: 0,
      timeout: 60_000,
    });
  });
});
