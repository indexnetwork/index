import { z } from 'zod';
import type { AnnotationBundle } from '../schema.ts';

export type Layer = 'mandate' | 'fidelity' | 'acts' | 'findings';

export interface LayerRequest {
  layer: Layer;
  interactionId: string;
  system: string;
  user: string;
}

export interface Completer {
  name: string;
  complete(request: LayerRequest): Promise<unknown>;
}

export class RecordedCompleter implements Completer {
  readonly name: string;

  constructor(private readonly bundle: AnnotationBundle) {
    this.name = bundle.annotator;
  }

  async complete(request: LayerRequest): Promise<unknown> {
    return this.bundle[request.layer];
  }
}

const ChatResponseSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

export interface OpenRouterOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export class OpenRouterCompleter implements Completer {
  readonly name: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(private readonly options: OpenRouterOptions) {
    this.model = options.model ?? 'google/gemini-3.7-flash';
    this.baseUrl = options.baseUrl ?? 'https://openrouter.ai/api/v1';
    this.name = `openrouter:${this.model}`;
  }

  async complete(request: LayerRequest): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.options.apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: request.system },
          { role: 'user', content: request.user },
        ],
      }),
    });
    if (!response.ok) throw new Error(`OpenRouter ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const parsed = ChatResponseSchema.parse(await response.json());
    return JSON.parse(parsed.choices[0]!.message.content);
  }
}

export function completerFromEnv(env: Record<string, string | undefined> = process.env): Completer | null {
  const apiKey = env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  return new OpenRouterCompleter({ apiKey, model: env.TRACE_ANNOTATOR_MODEL });
}
