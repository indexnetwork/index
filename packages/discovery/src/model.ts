import { z } from 'zod/v4';

import type { Model, ModelRequest } from './types.js';

export const DEFAULT_MODEL = 'google/gemini-3.7-flash';

/** Fetch-based structured OpenRouter client with bounded retries and response validation. */
export class ModelClient implements Model {
  constructor(private readonly options: { apiKey: string; model?: string }) {
    if (!options.apiKey.trim()) throw new Error('Discovery requires an OpenRouter API key.');
  }

  /**
   * @param request - Messages and the schema enforced on every response.
   * @param options - Per-call cancellation, including retries.
   * @returns A validated structured response.
   * @throws On cancellation or after bounded model/validation failures.
   */
  async complete<T>(request: ModelRequest<T>, options: { signal?: AbortSignal } = {}): Promise<T> {
    const primary = this.options.model ?? DEFAULT_MODEL;
    const fallback = primary.includes('pro') ? 'google/gemini-2.5-pro' : 'google/gemini-2.5-flash';
    const models = primary === fallback ? [primary, primary] : [primary, primary, fallback];
    let failure: unknown;
    for (const model of models) {
      options.signal?.throwIfAborted();
      try {
        // Existing calls allow one HTTP retry within each structured attempt.
        let response: Response | undefined;
        for (let attempt = 0; attempt < 2; attempt++) {
          const deadline = AbortSignal.timeout(60_000);
          const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
          try {
            response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
              method: 'POST', signal,
              headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                model, messages: request.messages,
                temperature: request.temperature, max_tokens: request.maxTokens,
                ...(model === DEFAULT_MODEL ? { reasoning: { effort: 'low' } } : {}),
                response_format: { type: 'json_schema', json_schema: {
                  name: request.name, strict: true, schema: z.toJSONSchema(request.schema),
                } },
              }),
            });
            const body = await response.text();
            if (!response.ok) throw new Error(`Discovery model HTTP ${response.status}`);
            const data = JSON.parse(body) as { error?: unknown; choices?: Array<{ message?: { content?: string }; error?: unknown }> };
            if (data.error || data.choices?.[0]?.error) throw new Error('Discovery model returned a provider error.');
            const content = data.choices?.[0]?.message?.content;
            if (typeof content !== 'string') throw new Error('Discovery model returned no content.');
            return request.schema.parse(JSON.parse(content));
          } catch (error) {
            options.signal?.throwIfAborted();
            if (attempt > 0 || (response && ![408, 409, 429].includes(response.status) && response.status < 500)) throw error;
          }
        }
      } catch (error) {
        options.signal?.throwIfAborted();
        failure = error;
      }
    }
    throw new Error('Discovery model failed after bounded attempts.', { cause: failure });
  }
}
