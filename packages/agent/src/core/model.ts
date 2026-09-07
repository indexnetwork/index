const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** Ordered defaults; OpenRouter handles provider and model failover. */
export const DEFAULT_MODELS: readonly string[] = Object.freeze([
  "google/gemini-3.7-flash",
  "google/gemini-3.8-flash",
  "anthropic/claude-haiku-4.5",
]);

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
  /** One to three ordered OpenRouter models. Replaces DEFAULT_MODELS. */
  models?: readonly string[];
  /**
   * How long one request may take before it is abandoned, in ms. Defaults
   * to 120s — long enough for a slow model on a long transcript, short
   * enough that a dead connection doesn't hang the agent until someone
   * notices.
   */
  timeout?: number;
  /** Attempts for transient failures, including the first. Defaults to 3.
   * Rate limits wait until recovery or cancellation without spending this budget. */
  attempts?: number;
  /** Fires before each retry. Worth surfacing: a request being retried
   * looks exactly like a slow one from the outside. */
  onRetry?: (attempt: number, reason: string) => void;
}

/** Long enough for a slow model, short enough to notice a hang. */
const DEFAULT_TIMEOUT = 120_000;
const DEFAULT_ATTEMPTS = 3;
const QUOTA_RETRY_DELAY = 30_000;
const MAX_QUOTA_RETRY_DELAY = 300_000;
const RETRY_JITTER = 1_000;

/** A final 429 pauses clients sharing a key and model list in this process.
 * OpenRouter owns individual model/provider capacity; we only remember when
 * it asked this pool of callers to try again. Expired entries are removed. */
const cooldowns = new Map<string, number>();

/** HTTP statuses worth trying again: rate limits, timeouts and the
 * transient 5xx family. Everything else — a bad key, a malformed request —
 * will fail the same way however many times it is sent. */
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

interface OpenRouterError {
  code?: number;
  metadata?: { error_type?: string; headers?: Record<string, string> };
}

/** Wait in milliseconds, from HTTP headers or OpenRouter's error metadata. */
function retryAfter(response: Response, error?: OpenRouterError): number | undefined {
  const delays: number[] = [];
  const now = Date.now();
  for (const headers of [response.headers, new Headers(error?.metadata?.headers)]) {
    const after = headers.get("retry-after");
    if (after?.trim()) {
      const seconds = Number(after);
      const ms = Number.isFinite(seconds) ? seconds * 1_000 : Date.parse(after) - now;
      if (Number.isFinite(ms) && ms >= 0) delays.push(ms);
    }
    const reset = headers.get("x-ratelimit-reset");
    if (reset?.trim()) {
      const timestamp = Number(reset);
      // Reset timestamps may be Unix seconds or milliseconds.
      const at = Number.isFinite(timestamp)
        ? timestamp * (timestamp < 1e12 ? 1_000 : 1)
        : Date.parse(reset);
      if (Number.isFinite(at) && at >= now) delays.push(at - now);
    }
  }
  return delays.length ? Math.max(...delays) : undefined;
}

/** An OpenRouter call that failed in a way worth retrying. */
class TransientError extends Error {
  constructor(
    message: string,
    /** Milliseconds the server asked us to wait. */
    readonly retryAfter?: number,
    readonly status?: number,
  ) {
    super(message);
    this.name = "TransientError";
  }
}

/** A minimal OpenRouter chat client that supports tool calling. */
export class ModelClient {
  private readonly apiKey: string;
  private readonly models: readonly string[];
  private readonly cooldownKey: string;
  private readonly timeout: number;
  private readonly attempts: number;
  private readonly onRetry?: (attempt: number, reason: string) => void;

  constructor(options: ModelClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter API key missing. Pass `apiKey` or set OPENROUTER_API_KEY.");
    }
    this.apiKey = apiKey;
    this.models = [...(options.models ?? DEFAULT_MODELS)];
    if (!this.models.length || this.models.length > 3 || this.models.some((model) => !model.trim())) {
      throw new Error("Provide one to three nonempty OpenRouter model IDs.");
    }
    this.cooldownKey = JSON.stringify([apiKey, this.models]);
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
    this.onRetry = options.onRetry;
  }

  /**
   * Sends the transcript and returns the assistant's reply, which either
   * carries `tool_calls` to run or the final text.
   *
   * OpenRouter tries the ordered models within each request. A final rate
   * limit waits for the shared cooldown and retries until recovery or
   * cancellation. Other transient failures are bounded by `attempts`.
   * @param messages - The conversation to continue, unchanged across retries.
   * @param tools - Functions available to every model in the list.
   * @param signal - Cancels both requests and cooldown waits.
   * @returns The assistant's text or tool calls.
   * @throws On cancellation, a permanent error, or exhausted transient retries.
   */
  async complete(
    messages: ModelMessage[],
    tools: ToolDefinition[] = [],
    signal?: AbortSignal,
  ): Promise<ModelMessage> {
    let failures = 0;
    let rateLimits = 0;
    for (let attempt = 1; ; attempt++) {
      await this.waitForQuota(attempt, signal);
      try {
        return await this.send(messages, tools, signal);
      } catch (cause) {
        // The caller pulled the plug. Not ours to retry.
        if (signal?.aborted) throw cause;
        if (!(cause instanceof TransientError)) throw cause;

        if (cause.status === 429) {
          const delay = cause.retryAfter ?? Math.min(
            MAX_QUOTA_RETRY_DELAY,
            QUOTA_RETRY_DELAY * 2 ** Math.min(rateLimits, 4),
          );
          rateLimits++;
          cooldowns.set(this.cooldownKey, Math.max(
            cooldowns.get(this.cooldownKey) ?? 0,
            Date.now() + Math.max(1_000, delay),
          ));
          continue;
        }

        if (++failures >= this.attempts) {
          throw new Error(`OpenRouter did not answer after ${attempt} attempts: ${cause.message}`, { cause });
        }
        this.onRetry?.(attempt + 1, cause.message);
        await this.pause(cause.retryAfter ?? 2 ** (failures - 1) * 1_000, signal);
      }
    }
  }

  /** New calls also wait; one session's 429 must not trigger a retry storm. */
  private async waitForQuota(attempt: number, signal?: AbortSignal): Promise<void> {
    while (true) {
      signal?.throwIfAborted();
      const remaining = (cooldowns.get(this.cooldownKey) ?? 0) - Date.now();
      if (remaining <= 0) {
        cooldowns.delete(this.cooldownKey);
        return;
      }
      this.onRetry?.(attempt, `OpenRouter rate limited; retrying in ${Math.ceil(remaining / 1_000)}s.`);
      await this.pause(remaining + Math.random() * RETRY_JITTER, signal);
    }
  }

  /** One attempt, bounded by `timeout`. */
  private async send(
    messages: ModelMessage[],
    tools: ToolDefinition[],
    signal?: AbortSignal,
  ): Promise<ModelMessage> {
    // The caller's signal and our deadline both have to be able to stop
    // this, and the two are told apart afterwards by asking the caller's.
    const deadline = AbortSignal.timeout(this.timeout);
    const stop = signal ? AbortSignal.any([signal, deadline]) : deadline;

    let response: Response;
    let body: string;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: stop,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          models: this.models,
          messages,
          ...(tools.length > 0 ? { tools, provider: { require_parameters: true } } : {}),
        }),
      });
      body = await response.text();
    } catch (cause) {
      if (signal?.aborted) throw cause;
      if (deadline.aborted) {
        throw new TransientError(`no answer within ${this.timeout}ms`);
      }
      // A dropped connection or DNS failure — fetch rejects with a
      // TypeError, and the next attempt may well land.
      throw new TransientError(cause instanceof Error ? cause.message : String(cause));
    }

    let data: { error?: OpenRouterError; choices?: { message?: ModelMessage; error?: OpenRouterError }[] } = {};
    try {
      data = JSON.parse(body);
    } catch {
      if (response.ok) throw new Error(`OpenRouter returned a non-JSON response: ${body.slice(0, 500)}`);
    }

    // Providers can return a rate limit in a 200 body after headers were sent.
    const error = data.error ?? data.choices?.[0]?.error;
    if (!response.ok || error) {
      const status = error?.metadata?.error_type === "rate_limit_exceeded"
        ? 429 : error?.code ?? response.status;
      const detail = `OpenRouter request failed (${status}): ${body}`;
      if (RETRYABLE_STATUS.has(status)) {
        throw new TransientError(detail, retryAfter(response, error), status);
      }
      throw new Error(detail);
    }

    const message = data.choices?.[0]?.message;
    if (!message) throw new Error(`OpenRouter response had no message: ${body.slice(0, 500)}`);

    return {
      role: "assistant",
      content: message.content ?? null,
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    };
  }

  /** Interruptible wait, so shutdown never has to wait out a quota reset. */
  private pause(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        signal?.removeEventListener("abort", abort);
        resolve();
      }, ms);

      const abort = () => {
        clearTimeout(timer);
        reject(signal?.reason ?? new Error("aborted"));
      };

      if (signal?.aborted) return abort();
      signal?.addEventListener("abort", abort, { once: true });
    });
  }
}
