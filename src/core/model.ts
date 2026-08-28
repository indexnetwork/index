const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** The default model for the run loop. Matches the negotiator's default, so
 * an agent and its negotiations run on the same model unless you say
 * otherwise. */
export const DEFAULT_MODEL = "google/gemini-3.7-flash";

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** One message in the loop's transcript, in the OpenAI/OpenRouter shape the
 * API expects back verbatim on the next call. */
export interface ModelMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  /** Set on assistant messages that called tools. */
  tool_calls?: ToolCall[];
  /** Set on tool messages, pointing at the call they answer. */
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ModelClientOptions {
  apiKey?: string;
  model?: string;
  referer?: string;
  title?: string;
}

/**
 * A minimal OpenRouter chat client that supports tool calling.
 *
 * `@indexnetwork/negotiator` ships its own `OpenRouterClient`, but it sends
 * no `tools` and reads only `choices[0].message.content` — tool calls would
 * be dropped on the floor. That client stays responsible for negotiation
 * turns; this one drives the agent loop.
 */
export class ModelClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly referer?: string;
  private readonly title?: string;

  constructor(options: ModelClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter API key missing. Pass `apiKey` or set OPENROUTER_API_KEY.");
    }
    this.apiKey = apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.referer = options.referer;
    this.title = options.title;
  }

  /** Sends the transcript and returns the assistant's reply, which either
   * carries `tool_calls` to run or the final text. */
  async complete(
    messages: ModelMessage[],
    tools: ToolDefinition[] = [],
    signal?: AbortSignal,
  ): Promise<ModelMessage> {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(this.referer ? { "HTTP-Referer": this.referer } : {}),
        ...(this.title ? { "X-Title": this.title } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenRouter request failed (${response.status}): ${await response.text()}`);
    }

    const data = (await response.json()) as {
      choices?: { message?: ModelMessage }[];
    };

    const message = data.choices?.[0]?.message;
    if (!message) throw new Error("OpenRouter response had no message.");

    return {
      role: "assistant",
      content: message.content ?? null,
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    };
  }
}
