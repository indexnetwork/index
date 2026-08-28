const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterClientOptions {
  apiKey?: string;
  model: string;
  referer?: string;
  title?: string;
  maxTokens?: number;
}

/** Default output cap. Generous enough that a decision carrying structured
 * terms doesn't get cut off mid-JSON, which is otherwise a confusing
 * "malformed response" failure rather than an obvious truncation. */
const DEFAULT_MAX_TOKENS = 2048;

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly referer?: string;
  private readonly title?: string;
  private readonly maxTokens: number;

  constructor(options: OpenRouterClientOptions) {
    const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OpenRouter API key missing. Pass `apiKey` or set OPENROUTER_API_KEY.",
      );
    }
    this.apiKey = apiKey;
    this.model = options.model;
    this.referer = options.referer;
    this.title = options.title;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
  }

  async complete(
    messages: OpenRouterMessage[],
    options: { jsonResponse?: boolean } = {},
  ): Promise<string> {
    const response = await fetch(OPENROUTER_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
        ...(this.referer ? { "HTTP-Referer": this.referer } : {}),
        ...(this.title ? { "X-Title": this.title } : {}),
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        max_tokens: this.maxTokens,
        ...(options.jsonResponse
          ? { response_format: { type: "json_object" } }
          : {}),
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenRouter request failed (${response.status}): ${body}`,
      );
    }

    const data = (await response.json()) as {
      choices: { message: { content: string }; finish_reason?: string }[];
    };

    const choice = data.choices[0];
    const content = choice?.message.content;
    if (!content) {
      throw new Error("OpenRouter response had no content.");
    }
    // Truncation produces syntactically broken output, which downstream
    // reads as "the model returned nonsense" unless we name the real cause.
    if (choice?.finish_reason === "length") {
      throw new Error(
        `OpenRouter response was truncated at the ${this.maxTokens}-token limit. ` +
          "Raise `maxTokens`, or ask for shorter messages/terms.",
      );
    }
    return content;
  }
}
