/**
 * Generic repeat-with-retry runner shared by every harness.
 *
 * Each harness supplies a zero-arg `invoke` closure that calls its agent once;
 * `repeatRuns` calls it `runs` times, retrying transient live-model/API failures
 * with exponential backoff so long full-corpus runs are less brittle.
 */

export interface RetryOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Label used in retry warnings, e.g. "matching eval". */
  label?: string;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Invoke once, retrying transient failures with exponential backoff. */
export async function invokeWithRetry<T>(invoke: () => Promise<T>, options: Required<RetryOptions>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await invoke();
    } catch (err) {
      lastError = err;
      if (attempt >= options.maxAttempts) break;
      const delay = options.retryDelayMs * 2 ** (attempt - 1);
      console.warn(
        `[${options.label}] call failed (attempt ${attempt}/${options.maxAttempts}); retrying in ${delay}ms: ${describeError(err)}`,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Calls `invoke` `runs` times sequentially, collecting each output. Each call is
 * retried independently per {@link RetryOptions}.
 *
 * @param invoke - Zero-arg closure that runs the agent once and resolves to its output.
 * @param runs - Number of repetitions.
 * @param options - Retry tuning.
 * @returns One output per run, in order.
 */
export async function repeatRuns<T>(invoke: () => Promise<T>, runs: number, options: RetryOptions = {}): Promise<T[]> {
  const resolved: Required<RetryOptions> = {
    maxAttempts: options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    retryDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
    label: options.label ?? "eval",
  };
  const outputs: T[] = [];
  for (let i = 0; i < runs; i++) {
    outputs.push(await invokeWithRetry(invoke, resolved));
  }
  return outputs;
}
