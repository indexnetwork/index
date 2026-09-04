const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

/** The default model for the run loop. */
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
  /**
   * How long one request may take before it is abandoned, in ms. Defaults
   * to 120s — long enough for a slow model on a long transcript, short
   * enough that a dead connection doesn't hang the agent until someone
   * notices.
   */
  timeout?: number;
  /** Attempts per call, including the first. Defaults to 3. Only failures
   * that might succeed on a retry are retried. */
  attempts?: number;
  /** Fires before each retry. Worth surfacing: a request being retried
   * looks exactly like a slow one from the outside. */
  onRetry?: (attempt: number, reason: string) => void;
}

/** Long enough for a slow model, short enough to notice a hang. */
const DEFAULT_TIMEOUT = 120_000;
const DEFAULT_ATTEMPTS = 3;

/** HTTP statuses worth trying again: rate limits, timeouts and the
 * transient 5xx family. Everything else — a bad key, a malformed request —
 * will fail the same way however many times it is sent. */
const RETRYABLE_STATUS: ReadonlySet<number> = new Set([408, 409, 425, 429, 500, 502, 503, 504]);

/** Seconds from a `Retry-After` header, when the server sent a sane one. */
function retryAfter(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 60 ? seconds : undefined;
}

/** An OpenRouter call that failed in a way worth retrying. */
class TransientError extends Error {
  constructor(
    message: string,
    /** Seconds the server asked us to wait, from `Retry-After`. */
    readonly retryAfter?: number,
  ) {
    super(message);
    this.name = "TransientError";
  }
}

/** A minimal OpenRouter chat client that supports tool calling. */
export class ModelClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeout: number;
  private readonly attempts: number;
  private readonly onRetry?: (attempt: number, reason: string) => void;

  constructor(options: ModelClientOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      throw new Error("OpenRouter API key missing. Pass `apiKey` or set OPENROUTER_API_KEY.");
    }
    this.apiKey = apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.attempts = Math.max(1, options.attempts ?? DEFAULT_ATTEMPTS);
    this.onRetry = options.onRetry;
  }

  /**
   * Sends the transcript and returns the assistant's reply, which either
   * carries `tool_calls` to run or the final text.
   *
   * Each attempt is bounded by `timeout`, and transient failures — a
   * timeout, a dropped connection, a rate limit, a 5xx — are retried up to
   * `attempts` times. A caller's own `signal` is never retried: if the
   * user interrupted, they meant it.
   */
  async complete(
    messages: ModelMessage[],
    tools: ToolDefinition[] = [],
    signal?: AbortSignal,
  ): Promise<ModelMessage> {
    let last: unknown;

    for (let attempt = 1; attempt <= this.attempts; attempt++) {
      try {
        return await this.send(messages, tools, signal);
      } catch (cause) {
        // The caller pulled the plug. Not ours to retry.
        if (signal?.aborted) throw cause;
        if (!(cause instanceof TransientError)) throw cause;

        last = cause;
        if (attempt < this.attempts) {
          this.onRetry?.(attempt + 1, cause.message);
          await this.pause(attempt, cause.retryAfter, signal);
        }
      }
    }

    throw new Error(
      `OpenRouter did not answer after ${this.attempts} attempts: ${
        last instanceof Error ? last.message : String(last)
      }`,
    );
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
    try {
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        signal: stop,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.model,
          messages,
          ...(tools.length > 0 ? { tools } : {}),
        }),
      });
    } catch (cause) {
      if (signal?.aborted) throw cause;
      if (deadline.aborted) {
        throw new TransientError(`no answer within ${this.timeout}ms`);
      }
      // A dropped connection or DNS failure — fetch rejects with a
      // TypeError, and the next attempt may well land.
      throw new TransientError(cause instanceof Error ? cause.message : String(cause));
    }

    if (!response.ok) {
      const body = await response.text();
      const detail = `OpenRouter request failed (${response.status}): ${body}`;
      if (RETRYABLE_STATUS.has(response.status)) {
        throw new TransientError(detail, retryAfter(response));
      }
      throw new Error(detail);
    }

    const body = await response.text();
    let data: { choices?: { message?: ModelMessage }[] };
    try {
      data = JSON.parse(body);
    } catch {
      throw new Error(`OpenRouter returned a non-JSON response: ${body.slice(0, 500)}`);
    }

    // A 200 can still carry an error object instead of choices — a provider
    // outage, a moderation refusal — so say what came back.
    const message = data.choices?.[0]?.message;
    if (!message) throw new Error(`OpenRouter response had no message: ${body.slice(0, 500)}`);

    return {
      role: "assistant",
      content: message.content ?? null,
      ...(message.tool_calls?.length ? { tool_calls: message.tool_calls } : {}),
    };
  }

  /** Backs off between attempts — the server's `Retry-After` when it gave
   * one, otherwise 1s, 2s, 4s. Interruptible, so ^C doesn't wait it out. */
  private pause(attempt: number, retryAfter: number | undefined, signal?: AbortSignal): Promise<void> {
    const ms = retryAfter !== undefined ? retryAfter * 1000 : 2 ** (attempt - 1) * 1000;

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
