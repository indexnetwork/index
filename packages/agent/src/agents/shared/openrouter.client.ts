import type { Model, ModelMessage, ToolDefinition } from "./reasoning/reasoning.loop.js";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Ordered defaults; OpenRouter handles provider and model failover. */
const DEFAULT_MODELS: readonly string[] = Object.freeze([
  "google/gemini-3.7-flash",
  "google/gemini-3.8-flash",
  "anthropic/claude-haiku-4.5",
]);

const DEFAULT_TIMEOUT = 120_000;

interface OpenRouterResponse {
  error?: { code?: number };
  choices?: { message?: ModelMessage; error?: { code?: number } }[];
}

/** Host-supplied credentials and settings for direct model requests. */
export interface OpenRouterClientOptions {
  apiKey: string;
  /** One to three ordered OpenRouter models. Replaces the defaults. */
  models?: readonly string[];
  /** Maximum duration of one request, including its response body, in milliseconds. */
  timeout?: number;
}

/** OpenRouter model access without reasoning policy, environment reads, or automatic retries. */
export class OpenRouterClient implements Model {
  private readonly apiKey: string;
  private readonly models: readonly string[];
  private readonly timeout: number;

  /**
   * Configures model access without making a request.
   * @param options - Required credential, optional ordered models, and per-request timeout.
   * @throws When the API key is blank or the model list is unusable.
   */
  constructor(options: OpenRouterClientOptions) {
    if (!options.apiKey?.trim()) throw new Error("OpenRouter API key missing. Pass `apiKey`.");
    this.apiKey = options.apiKey;
    this.models = [...(options.models ?? DEFAULT_MODELS)];
    if (!this.models.length || this.models.length > 3 || this.models.some((model) => !model.trim())) {
      throw new Error("Provide one to three nonempty OpenRouter model IDs.");
    }
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * @param messages - The current direct run's transcript.
   * @param tools - Agent-supplied tool definitions, without their local handlers.
   * @param abortSignal - Runner-owned cancellation, combined with the request deadline.
   * @returns The assistant's text or requested tool calls.
   * @throws On cancellation, timeout, network failure, or an unsuccessful or unusable response.
   */
  async complete(messages: ModelMessage[], tools: ToolDefinition[], abortSignal: AbortSignal): Promise<ModelMessage> {
    abortSignal.throwIfAborted();
    const stop = AbortSignal.any([abortSignal, AbortSignal.timeout(this.timeout)]);

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: stop,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        models: this.models,
        messages,
        ...(tools.length ? { tools, provider: { require_parameters: true } } : {}),
      }),
    });
    stop.throwIfAborted();
    const body = await response.text();
    stop.throwIfAborted();

    let data: OpenRouterResponse | null = null;
    try {
      data = JSON.parse(body) as OpenRouterResponse | null;
    } catch {
      if (response.ok) throw new Error(`OpenRouter returned a non-JSON response: ${body.slice(0, 500)}`);
    }

    // A provider may report failure in the body even after successful HTTP headers.
    const error = data?.error ?? data?.choices?.[0]?.error;
    if (!response.ok || error) {
      throw new Error(`OpenRouter request failed (${error?.code ?? response.status}): ${body.slice(0, 500)}`);
    }

    const message = data?.choices?.[0]?.message;
    if (!message) throw new Error(`OpenRouter response had no message: ${body.slice(0, 500)}`);

    return {
      role: "assistant",
      content: message.content ?? null,
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    };
  }
}
