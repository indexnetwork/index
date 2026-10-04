const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Ordered defaults; OpenRouter handles provider and model failover. */
const DEFAULT_MODELS: readonly string[] = Object.freeze([
  "google/gemini-3.7-flash",
  "google/gemini-3.8-flash",
  "anthropic/claude-haiku-4.5",
]);

/** Long enough for a slow model, short enough to notice a hang. */
const DEFAULT_TIMEOUT = 120_000;
/** One tool call fits. This model bills reasoning as output, up to 65,536 tokens otherwise. */
const MAX_TOKENS = 2048;
/** Gemini 3 requires reasoning. Low matches the protocol agents, and the text stays out of the transcript. */
const REASONING = { effort: "low", exclude: true } as const;

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** One message in the transcript, in the shape OpenRouter expects back verbatim. */
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** Set on assistant messages that called tools. */
  tool_calls?: ToolCall[];
  /** Set on tool messages, pointing at the call they answer. */
  tool_call_id?: string;
  /**
   * Thought signature from the previous completion. Gemini rejects the next
   * tool round unless this comes back unchanged.
   */
  reasoning?: string | null;
  reasoning_details?: unknown;
}

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

/** The model capability the caller supplies. */
export interface Model {
  /**
   * @param messages - The conversation for this call.
   * @param tools - Available tool definitions.
   * @param signal - Cancellation for this call.
   * @param toolChoice - When `"required"`, the model must call a tool. Omit it to allow a plain reply.
   * @returns The assistant's text or tool calls.
   * @throws On cancellation or any model failure.
   */
  complete(messages: ModelMessage[], tools?: ToolDefinition[], signal?: AbortSignal, toolChoice?: "required"): Promise<ModelMessage>;
}

export interface ModelClientOptions {
  apiKey?: string;
  /** One to three ordered OpenRouter models. Replaces the defaults. */
  models?: readonly string[];
  /** How long one request may take before it is abandoned, in ms. */
  timeout?: number;
}

/**
 * A minimal OpenRouter chat client with tool calling.
 *
 * A failed call throws. Nothing here retries or waits out a rate limit: a
 * wake or a negotiator run is cheap to lose and its trigger comes again.
 */
export class ModelClient implements Model {
  private readonly apiKey: string;
  private readonly models: readonly string[];
  private readonly timeout: number;

  /**
   * @param options - Credential, model list, and request timeout. Env fills the key.
   * @throws When no API key is available or the model list is unusable.
   */
  constructor(options: ModelClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) throw new Error("OpenRouter API key missing. Pass `apiKey` or set OPENROUTER_API_KEY.");
    this.apiKey = apiKey;
    this.models = [...(options.models ?? DEFAULT_MODELS)];
    if (!this.models.length || this.models.length > 3 || this.models.some((model) => !model.trim())) {
      throw new Error("Provide one to three nonempty OpenRouter model IDs.");
    }
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * @param messages - The conversation to continue.
   * @param tools - Functions available to every model in the list.
   * @param signal - Cancels the request.
   * @param toolChoice - When `"required"`, the model must call one of `tools`.
   * @returns The assistant's text or tool calls.
   * @throws When the request is cancelled, times out, or OpenRouter refuses it.
   */
  async complete(messages: ModelMessage[], tools: ToolDefinition[] = [], signal?: AbortSignal, toolChoice?: "required"): Promise<ModelMessage> {
    const deadline = AbortSignal.timeout(this.timeout);
    const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;

    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal: stop,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        models: this.models,
        messages,
        max_tokens: MAX_TOKENS,
        reasoning: REASONING,
        ...(tools.length ? { tools, provider: { require_parameters: true }, ...(toolChoice ? { tool_choice: toolChoice } : {}) } : {}),
      }),
    });
    const body = await response.text();

    let data: { error?: { code?: number }; choices?: { message?: ModelMessage; error?: { code?: number } }[] } = {};
    try {
      data = JSON.parse(body) as typeof data;
    } catch {
      if (response.ok) throw new Error(`OpenRouter returned a non-JSON response: ${body.slice(0, 500)}`);
    }

    // Providers can return an error in a 200 body after the headers were sent.
    const error = data.error ?? data.choices?.[0]?.error;
    if (!response.ok || error) {
      throw new Error(`OpenRouter request failed (${error?.code ?? response.status}): ${body.slice(0, 500)}`);
    }

    const message = data.choices?.[0]?.message;
    if (!message) throw new Error(`OpenRouter response had no message: ${body.slice(0, 500)}`);

    return {
      role: "assistant",
      content: message.content ?? null,
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
      ...(message.reasoning != null ? { reasoning: message.reasoning } : {}),
      ...(message.reasoning_details != null ? { reasoning_details: message.reasoning_details } : {}),
    };
  }
}
