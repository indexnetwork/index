/**
 * Attempt-aware execution for live eval harnesses.
 *
 * The evidence runner records every requested run and every provider invocation,
 * including recovered retries and terminal failures. `repeatRuns` remains the
 * fail-fast, output-only compatibility surface used by harnesses not yet
 * migrated to attempt evidence.
 */

export type EvalEvidencePolicy = "normal" | "strict";
export type EvalAttemptOutcome = "success" | "failure" | "timeout" | "cancelled";
export type EvalRunOutcome = "success" | "failed" | "cancelled";

export interface SanitizedEvalError {
  class: string;
  code?: string;
  message: string;
}

export interface EvalAttemptEvidence {
  attemptId: string;
  runId: string;
  runIndex: number;
  attemptNumber: number;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  outcome: EvalAttemptOutcome;
  error?: SanitizedEvalError;
  retryable: boolean;
  /** Exponential backoff actually scheduled after this attempt; zero when terminal. */
  backoffMs: number;
}

/** Persistable run evidence. Runtime outputs are held by {@link EvalRunResult}. */
export interface EvalRunEvidence {
  runId: string;
  caseId: string;
  /** Zero-based index in the configured repetitions for this case. */
  runIndex: number;
  outcome: EvalRunOutcome;
  recovered: boolean;
  attempts: EvalAttemptEvidence[];
}

export interface EvalRunResult<T> extends EvalRunEvidence {
  /** Present only for a terminal successful run and never persisted in execution evidence. */
  output?: T;
}

export interface EvalRunBatch<T> {
  caseId: string;
  requestedRuns: number;
  policy: EvalEvidencePolicy;
  runs: EvalRunResult<T>[];
  successfulRuns: Array<EvalRunResult<T> & { output: T }>;
  outputs: T[];
}

export interface EvalExecutionEvidence {
  policy: EvalEvidencePolicy;
  runs: EvalRunEvidence[];
}

export interface RetryOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  /** Label used in retry warnings, e.g. "matching eval". */
  label?: string;
}

export interface AttemptAwareRunOptions extends RetryOptions {
  caseId: string;
  policy?: EvalEvidencePolicy;
  /** Hard deadline for each provider invocation. */
  attemptTimeoutMs: number;
  /** Cancels the active attempt and marks all not-yet-started slots cancelled. */
  signal?: AbortSignal;
  /** Retry classification. Defaults to retrying every non-cancellation failure. */
  isRetryable?: (error: unknown) => boolean;
}

export interface EvalExecutionSummary {
  requestedRuns: number;
  completedRuns: number;
  failedRuns: number;
  recoveredRuns: number;
  totalAttempts: number;
  complete: boolean;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 1000;
const MAX_ERROR_MESSAGE_LENGTH = 600;

class EvalAttemptTimeoutError extends Error {
  readonly code = "EVAL_ATTEMPT_TIMEOUT";

  constructor(timeoutMs: number) {
    super(`Eval attempt timed out after ${timeoutMs}ms`);
    this.name = "EvalAttemptTimeoutError";
  }
}

class EvalCancelledError extends Error {
  readonly code = "EVAL_CANCELLED";

  constructor() {
    super("Eval execution cancelled");
    this.name = "EvalCancelledError";
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return sleep(ms);
  if (signal.aborted) return Promise.reject(new EvalCancelledError());
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timeout);
      reject(new EvalCancelledError());
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function deterministicRunId(caseId: string, runIndex: number): string {
  return `${encodeURIComponent(caseId)}::run:${runIndex + 1}`;
}

function deterministicAttemptId(runId: string, attemptNumber: number): string {
  return `${runId}::attempt:${attemptNumber}`;
}

function safeInstanceOf(error: unknown, constructor: object): boolean {
  try {
    return Function.prototype[Symbol.hasInstance].call(constructor, error) as boolean;
  } catch {
    return false;
  }
}

function safeProperty(error: unknown, property: string): unknown {
  if ((typeof error !== "object" || error === null) && typeof error !== "function") return undefined;
  try {
    return Reflect.get(error, property);
  } catch {
    return undefined;
  }
}

function safeString(value: unknown): string | undefined {
  try {
    return String(value);
  } catch {
    return undefined;
  }
}

function errorMessage(error: unknown): string {
  if (typeof error === "string") return error;
  const message = safeProperty(error, "message");
  if (typeof message === "string") return message;
  try {
    const serialized = JSON.stringify(error);
    if (typeof serialized === "string") return serialized;
  } catch {
    // Hostile provider values may throw from toJSON/getters/proxy traps.
  }
  return safeString(error) ?? "Unserializable provider error";
}

/** Redacts common credential/header forms plus exact raw environment values. */
export function sanitizeEvalErrorMessage(value: string): string {
  try {
    let message = value
      // Consume complete quoted JSON header values before the plain-header rules.
      .replace(/(["']?(?:cookie|set-cookie)["']?\s*[:=]\s*)"(?:\\.|[^"\\])*"/gi, "$1\"[REDACTED]\"")
      .replace(/(["']?(?:cookie|set-cookie)["']?\s*[:=]\s*)'(?:\\.|[^'\\])*'/gi, "$1'[REDACTED]'")
      .replace(/(["']?(?:authorization|proxy-authorization|x-api-key|api-key)["']?\s*[:=]\s*)"(?:\\.|[^"\\])*"/gi, "$1\"[REDACTED]\"")
      .replace(/(["']?(?:authorization|proxy-authorization|x-api-key|api-key)["']?\s*[:=]\s*)'(?:\\.|[^'\\])*'/gi, "$1'[REDACTED]'")
      .replace(/(["']?(?:api_?key|token|access_?token|secret|password|credential)["']?\s*[:=]\s*)"(?:\\.|[^"\\])*"/gi, "$1\"[REDACTED]\"")
      .replace(/(["']?(?:api_?key|token|access_?token|secret|password|credential)["']?\s*[:=]\s*)'(?:\\.|[^'\\])*'/gi, "$1'[REDACTED]'")
      // A Cookie/Set-Cookie field is one security-sensitive unit. Redact the
      // whole plain-header line, including every cookie and attribute.
      .replace(/\b(cookie|set-cookie)\s*[:=][^\r\n]*/gi, "$1: [REDACTED]")
      .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, "$1 [REDACTED]")
      .replace(/\b(sk|pk|rk|key)-[A-Za-z0-9_-]{8,}\b/gi, "[REDACTED]")
      .replace(/([?&](?:api_?key|token|access_?token|secret|password)=)[^&\s]+/gi, "$1[REDACTED]")
      .replace(/\b(authorization|proxy-authorization|x-api-key|api-key)\s*[:=]\s*[^,;\n}\]]+/gi, "$1: [REDACTED]")
      .replace(/\b(api_?key|token|access_?token|secret|password|credential)\s*[:=]\s*[^\s,"'};\]]+/gi, "$1=[REDACTED]");

    let rawEnvironmentValues: string[] = [];
    try {
      rawEnvironmentValues = Object.values(process.env)
        .filter((entry): entry is string => typeof entry === "string" && entry.length >= 8);
    } catch {
      // Sanitization must remain total even if the environment is unavailable.
    }
    for (const secret of new Set(rawEnvironmentValues)) {
      if (message.includes(secret)) message = message.split(secret).join("[REDACTED_ENV]");
    }
    if (message.length > MAX_ERROR_MESSAGE_LENGTH) {
      message = `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`;
    }
    return message;
  } catch {
    return "[REDACTED_UNAVAILABLE_ERROR_DETAILS]";
  }
}

/** Converts an arbitrary provider error to the only safe error shape persisted in artifacts. */
export function sanitizeEvalError(error: unknown): SanitizedEvalError {
  try {
    const rawCode = safeProperty(error, "code");
    const rawCodeString = typeof rawCode === "string" || typeof rawCode === "number"
      ? safeString(rawCode)
      : undefined;
    const code = rawCodeString ? sanitizeEvalErrorMessage(rawCodeString).slice(0, 100) : undefined;
    const rawName = safeProperty(error, "name");
    const className = safeInstanceOf(error, Error) && typeof rawName === "string" && rawName.length > 0
      ? sanitizeEvalErrorMessage(rawName).slice(0, 100)
      : "Error";
    return {
      class: className,
      ...(code ? { code } : {}),
      message: sanitizeEvalErrorMessage(errorMessage(error)),
    };
  } catch {
    return { class: "Error", message: "[REDACTED_UNAVAILABLE_ERROR_DETAILS]" };
  }
}

function publicRun<T>(run: EvalRunResult<T>): EvalRunEvidence {
  const { output: _output, ...evidence } = run;
  return evidence;
}

/**
 * Attaches requested-slot provenance to scorer outputs without changing domain
 * scoring. Call only with the successful runs whose outputs were scored.
 */
export function attachScoredRunProvenance<C extends { runResults: object[] }>(
  result: C,
  successfulRuns: readonly EvalRunEvidence[],
): C & { scoredRunIds: string[] } {
  if (result.runResults.length !== successfulRuns.length) {
    throw new Error("Scored run result count does not match terminal successful outputs");
  }
  return {
    ...result,
    scoredRunIds: successfulRuns.map((run) => run.runId),
    runResults: result.runResults.map((runResult, index) => ({
      ...runResult,
      runId: successfulRuns[index].runId,
      runIndex: successfulRuns[index].runIndex,
    })),
  };
}

/** Removes runtime outputs while retaining every run and attempt for persistence. */
export function buildExecutionEvidence<T>(
  batches: readonly EvalRunBatch<T>[],
  policy?: EvalEvidencePolicy,
): EvalExecutionEvidence {
  const resolvedPolicy = policy ?? batches[0]?.policy ?? "normal";
  if (batches.some((batch) => batch.policy !== resolvedPolicy)) {
    throw new Error("Cannot combine eval batches with different evidence policies");
  }
  return { policy: resolvedPolicy, runs: batches.flatMap((batch) => batch.runs.map(publicRun)) };
}

/** Derives execution completeness from first-class run evidence. */
export function summarizeExecution(evidence: EvalExecutionEvidence): EvalExecutionSummary {
  const completedRuns = evidence.runs.filter((run) => run.outcome === "success").length;
  const requestedRuns = evidence.runs.length;
  const failedRuns = requestedRuns - completedRuns;
  return {
    requestedRuns,
    completedRuns,
    failedRuns,
    recoveredRuns: evidence.runs.filter((run) => run.recovered).length,
    totalAttempts: evidence.runs.reduce((sum, run) => sum + run.attempts.length, 0),
    complete: completedRuns === requestedRuns,
  };
}

async function invokeAttempt<T>(
  invoke: (context: { signal: AbortSignal; runId: string; attemptId: string; runIndex: number; attemptNumber: number }) => Promise<T>,
  context: { runId: string; attemptId: string; runIndex: number; attemptNumber: number },
  timeoutMs: number,
  externalSignal?: AbortSignal,
): Promise<T> {
  if (externalSignal?.aborted) throw new EvalCancelledError();

  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let timedOut = false;
  let externallyCancelled = false;
  let onExternalAbort: (() => void) | undefined;

  const cancellation = new Promise<never>((_, reject) => {
    onExternalAbort = (): void => {
      externallyCancelled = true;
      controller.abort(externalSignal?.reason);
      reject(new EvalCancelledError());
    };
    externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
    timeoutId = setTimeout(() => {
      timedOut = true;
      const timeoutError = new EvalAttemptTimeoutError(timeoutMs);
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([
      invoke({ ...context, signal: controller.signal }),
      cancellation,
    ]);
  } catch (error) {
    if (externallyCancelled || externalSignal?.aborted) throw new EvalCancelledError();
    if (timedOut) throw new EvalAttemptTimeoutError(timeoutMs);
    throw error;
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (onExternalAbort) externalSignal?.removeEventListener("abort", onExternalAbort);
  }
}

/**
 * Executes every requested run slot sequentially and retains every invocation
 * attempt. Terminal failures do not abort later slots; external cancellation
 * marks all remaining slots cancelled without fabricating provider attempts.
 */
export async function executeRuns<T>(
  invoke: (context: { signal: AbortSignal; runId: string; attemptId: string; runIndex: number; attemptNumber: number }) => Promise<T>,
  requestedRuns: number,
  options: AttemptAwareRunOptions,
): Promise<EvalRunBatch<T>> {
  if (!Number.isInteger(requestedRuns) || requestedRuns < 1) throw new Error("requestedRuns must be a positive integer");
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const label = options.label ?? "eval";
  const policy = options.policy ?? "normal";
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error("maxAttempts must be a positive integer");
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw new Error("retryDelayMs must be non-negative");
  if (!Number.isFinite(options.attemptTimeoutMs) || options.attemptTimeoutMs <= 0) {
    throw new Error("attemptTimeoutMs must be positive");
  }

  const runs: EvalRunResult<T>[] = [];
  for (let runIndex = 0; runIndex < requestedRuns; runIndex++) {
    const runId = deterministicRunId(options.caseId, runIndex);
    if (options.signal?.aborted) {
      runs.push({ runId, caseId: options.caseId, runIndex, outcome: "cancelled", recovered: false, attempts: [] });
      continue;
    }

    const attempts: EvalAttemptEvidence[] = [];
    let output: T | undefined;
    let outcome: EvalRunOutcome = "failed";

    for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber++) {
      if (options.signal?.aborted) {
        outcome = "cancelled";
        break;
      }
      const attemptId = deterministicAttemptId(runId, attemptNumber);
      const startedMs = Date.now();
      const startedAt = new Date(startedMs).toISOString();
      try {
        output = await invokeAttempt(
          invoke,
          { runId, attemptId, runIndex, attemptNumber },
          options.attemptTimeoutMs,
          options.signal,
        );
        const completedMs = Date.now();
        attempts.push({
          attemptId,
          runId,
          runIndex,
          attemptNumber,
          startedAt,
          completedAt: new Date(completedMs).toISOString(),
          durationMs: Math.max(0, completedMs - startedMs),
          outcome: "success",
          retryable: false,
          backoffMs: 0,
        });
        outcome = "success";
        break;
      } catch (error) {
        const completedMs = Date.now();
        const cancelled = safeInstanceOf(error, EvalCancelledError) || options.signal?.aborted === true;
        const timedOut = safeInstanceOf(error, EvalAttemptTimeoutError);
        const sanitizedError = sanitizeEvalError(error);
        let retryable = !cancelled;
        if (retryable && options.isRetryable) {
          try {
            retryable = options.isRetryable(error);
          } catch {
            // A classifier failure must never erase the provider invocation.
            // Fail closed rather than guessing that another paid attempt is safe.
            retryable = false;
          }
        }
        const willRetry = retryable && attemptNumber < maxAttempts;
        const backoffMs = willRetry ? retryDelayMs * 2 ** (attemptNumber - 1) : 0;
        attempts.push({
          attemptId,
          runId,
          runIndex,
          attemptNumber,
          startedAt,
          completedAt: new Date(completedMs).toISOString(),
          durationMs: Math.max(0, completedMs - startedMs),
          outcome: cancelled ? "cancelled" : timedOut ? "timeout" : "failure",
          error: sanitizedError,
          retryable,
          backoffMs,
        });
        if (cancelled) {
          outcome = "cancelled";
          break;
        }
        if (!willRetry) {
          outcome = "failed";
          break;
        }
        try {
          console.warn(
            `[${label}] call failed (run ${runIndex + 1}, attempt ${attemptNumber}/${maxAttempts}); `
              + `retrying in ${backoffMs}ms: ${sanitizedError.message}`,
          );
        } catch {
          // Logging is non-evidence bookkeeping and must not abort execution.
        }
        try {
          await abortableSleep(backoffMs, options.signal);
        } catch {
          outcome = "cancelled";
          break;
        }
      }
    }

    runs.push({
      runId,
      caseId: options.caseId,
      runIndex,
      outcome,
      recovered: outcome === "success" && attempts.length > 1,
      attempts,
      ...(outcome === "success" ? { output: output as T } : {}),
    });
  }

  const successfulRuns = runs.filter(
    (run): run is EvalRunResult<T> & { output: T } => run.outcome === "success" && "output" in run,
  );
  return {
    caseId: options.caseId,
    requestedRuns,
    policy,
    runs,
    successfulRuns,
    outputs: successfulRuns.map((run) => run.output),
  };
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
        `[${options.label}] call failed (attempt ${attempt}/${options.maxAttempts}); retrying in ${delay}ms: ${sanitizeEvalError(err).message}`,
      );
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Output-only compatibility helper. It intentionally retains the historical
 * fail-fast behavior: the first exhausted run throws and later slots are not
 * invoked.
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
