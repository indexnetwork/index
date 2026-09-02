import { asDeadlineError, deadlineSignal, type DeadlineOptions } from "./deadline.ts";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

export interface OpenRouterMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface OpenRouterClientOptions {
  apiKey?: string;
  model: string;
  /**
   * Models OpenRouter may route to, in order, when `model` fails — a
   * rate limit, an outage, a moderation flag. Sent as OpenRouter's
   * `models` list; the request is billed at whichever model answered.
   * Empty disables fallback.
   */
  fallbackModels?: string[];
  /** Fires when a response came from a model other than `model`. */
  onFallback?: (model: string) => void;
  referer?: string;
  title?: string;
  maxTokens?: number;
  /**
   * How long one completion may take before it's abandoned, in
   * milliseconds. Defaults to 120s. `0` disables the deadline, leaving a
   * caller's `signal` as the only way to give up.
   */
  timeoutMs?: number;
}

/** Default output cap. Generous enough that a decision carrying structured
 * terms doesn't get cut off mid-JSON, which is otherwise a confusing
 * "malformed response" failure rather than an obvious truncation. */
const DEFAULT_MAX_TOKENS = 2048;

/** Default per-call deadline. Deliberately generous: nothing else
 * supervises this call, and a real reasoning turn can legitimately run
 * close to a minute or more — a deadline that fires on a slow-but-working
 * model is worse than no deadline at all. This bounds the failure that
 * never resolves, it does not police slowness. */
const DEFAULT_TIMEOUT_MS = 120_000;

interface CompletionResponse {
  /** The model that actually answered — differs from the request's
   * `model` when OpenRouter fell back. */
  model?: string;
  choices: { message: { content: string }; finish_reason?: string }[];
}

export class OpenRouterClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly fallbackModels: string[];
  private readonly onFallback?: (model: string) => void;
  private readonly referer?: string;
  private readonly title?: string;
  private readonly maxTokens: number;
  private readonly timeoutMs: number;

  constructor(options: OpenRouterClientOptions) {
    const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OpenRouter API key missing. Pass `apiKey` or set OPENROUTER_API_KEY.",
      );
    }
    this.apiKey = apiKey;
    this.model = options.model;
    // The primary is always tried first; listing it again would only
    // retry the same failure.
    this.fallbackModels = (options.fallbackModels ?? []).filter((model) => model !== options.model);
    this.onFallback = options.onFallback;
    this.referer = options.referer;
    this.title = options.title;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /** Whether a failed call has anywhere else to go. */
  get hasFallback(): boolean {
    return this.fallbackModels.length > 0;
  }

  /**
   * Runs one completion. `preferFallback` skips the primary and goes
   * straight to the fallback chain — for a failure OpenRouter's own
   * routing doesn't classify as one, such as a 200 with nothing in it,
   * which this method handles itself, or a body the caller can't parse.
   */
  async complete(
    messages: OpenRouterMessage[],
    options: { jsonResponse?: boolean; preferFallback?: boolean } & DeadlineOptions = {},
  ): Promise<string> {
    const deadline: DeadlineOptions = {
      signal: options.signal,
      timeoutMs: options.timeoutMs ?? this.timeoutMs,
    };
    const models =
      options.preferFallback && this.hasFallback
        ? this.fallbackModels
        : [this.model, ...this.fallbackModels];

    let response: Response;
    let body: string;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
          ...(this.referer ? { "HTTP-Referer": this.referer } : {}),
          ...(this.title ? { "X-Title": this.title } : {}),
        },
        body: JSON.stringify({
          model: models[0],
          // OpenRouter tries these in order, moving on when one errors
          // (rate limit, downtime, moderation) — see model fallbacks in
          // its docs. `model` stays set as the first to try.
          ...(models.length > 1 ? { models } : {}),
          messages,
          max_tokens: this.maxTokens,
          ...(options.jsonResponse
            ? { response_format: { type: "json_object" } }
            : {}),
        }),
        signal: deadlineSignal(deadline, this.timeoutMs),
      });
      // Read the body inside the deadline too: a response that opens its
      // headers and then stops streaming hangs exactly as long as one that
      // never arrives at all.
      body = await response.text();
    } catch (error) {
      throw asDeadlineError(error, deadline, this.timeoutMs, "OpenRouter request");
    }

    if (!response.ok) {
      throw new Error(`OpenRouter request failed (${response.status}): ${body}`);
    }

    let data: CompletionResponse;
    try {
      data = JSON.parse(body) as CompletionResponse;
    } catch {
      throw new Error(`OpenRouter returned a non-JSON response: ${body}`);
    }

    if (data.model && data.model !== this.model && this.hasFallback) {
      this.onFallback?.(data.model);
    }

    const choice = data.choices?.[0];
    const content = choice?.message.content;
    if (!content) {
      // A 200 with nothing in it is a failed call by any useful measure,
      // but not by OpenRouter's, so its routing never moved on. Move on
      // ourselves, once.
      if (!options.preferFallback && this.hasFallback) {
        return this.complete(messages, { ...options, preferFallback: true });
      }
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
