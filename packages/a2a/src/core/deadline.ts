/**
 * Every outbound call in this library — a model completion, an A2A
 * `message/send` — talks to something that can accept a connection and then
 * never answer. Without a deadline a negotiation turn stalls indefinitely,
 * with no escape but killing the process, and a caller watching from
 * outside cannot tell a slow model from a dead socket.
 *
 * So each call bounds itself, and each call also accepts the caller's own
 * `signal` so a host can impose its own deadline or forward an interrupt.
 * The two are combined, then told apart again on failure: the library owns
 * only its own clock and never reinterprets a caller's abort.
 */

/** Per-call deadline controls, accepted by every call that goes to the network. */
export interface DeadlineOptions {
  /**
   * Aborts this call — a host's own deadline, or a forwarded interrupt.
   * An abort through this signal is rethrown as-is (its `reason`
   * preserved), so a caller can always tell its own cancellation apart
   * from the built-in timeout below.
   */
  signal?: AbortSignal;
  /**
   * Overrides the built-in timeout for this call, in milliseconds. `0`
   * disables it, leaving `signal` as the only way to give up.
   */
  timeoutMs?: number;
}

function timeoutFor(options: DeadlineOptions | undefined, fallbackMs: number): number {
  const timeoutMs = options?.timeoutMs ?? fallbackMs;
  return Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;
}

/**
 * Builds the signal to hand to `fetch`: the caller's, the built-in
 * deadline, or both. Returns undefined when neither applies.
 */
export function deadlineSignal(
  options: DeadlineOptions | undefined,
  fallbackMs: number,
): AbortSignal | undefined {
  const timeoutMs = timeoutFor(options, fallbackMs);
  if (!timeoutMs) return options?.signal;
  const deadline = AbortSignal.timeout(timeoutMs);
  return options?.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
}

function isAbortError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const name = (error as { name?: unknown }).name;
  return name === "AbortError" || name === "TimeoutError";
}

/**
 * Turns a failed call into the error the caller should actually see.
 *
 * The combined signal stops the fetch whichever clock ran out, so
 * afterwards we have to ask *which* one did. A caller's abort is theirs:
 * it is rethrown untouched, so hosts can match on `signal.reason` and so a
 * cancellation is never mistaken for a fault of ours. Only the built-in
 * deadline is renamed, into an error that says how long it waited —
 * "timed out after 120000ms" is a diagnosis; a bare `AbortError` is not.
 * Anything else passes through unchanged.
 */
export function asDeadlineError(
  error: unknown,
  options: DeadlineOptions | undefined,
  fallbackMs: number,
  what: string,
): unknown {
  if (options?.signal?.aborted) return options.signal.reason ?? error;
  if (!isAbortError(error)) return error;
  return new Error(`${what} timed out after ${timeoutFor(options, fallbackMs)}ms.`, {
    cause: error,
  });
}
