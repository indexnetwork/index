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
}

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly referer?: string;
  private readonly title?: string;

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
  }

  async complete(messages: OpenRouterMessage[]): Promise<string> {
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
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(
        `OpenRouter request failed (${response.status}): ${body}`,
      );
    }

    const data = (await response.json()) as {
      choices: { message: { content: string } }[];
    };

    const content = data.choices[0]?.message.content;
    if (!content) {
      throw new Error("OpenRouter response had no content.");
    }
    return content;
  }
}
