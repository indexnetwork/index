/**
 * Protocol-layer logging: call-scoped inputs, outputs, and context for debugging.
 * Use protocolLogger('ComponentName') for the logger, then wrap calls with
 * withCallLogging. All protocol code should log inputs at call start and
 * outputs (or summary) + duration at end.
 */

import { log, sanitizeForLog } from "./log.js";
import type { LoggerWithSource } from "./log.js";

export type { LoggerWithSource };

/** Create a protocol logger for a given source (e.g. "ChatTools", "DiscoverNodes"). */
export function protocolLogger(source: string): LoggerWithSource {
  return log.protocol.from(source);
}

export interface CallLogOptions {
  /** Log full output on success (default: true). Set false for very large payloads. */
  logOutput?: boolean;
  /** Extra context to include in both start and end (e.g. userId, networkId). */
  context?: Record<string, unknown>;
}

/**
 * Wraps an async call with consistent logging: inputs at start, outputs + duration at end,
 * error + duration on failure. All payloads are sanitized (embeddings redacted).
 */
export async function withCallLogging<T>(
  logger: LoggerWithSource,
  callName: string,
  inputs: Record<string, unknown>,
  fn: () => Promise<T>,
  options: CallLogOptions = {}
): Promise<T> {
  const { logOutput = true, context = {} } = options;
  const start = Date.now();
  const sanitizedInputs = sanitizeForLog(inputs) as Record<string, unknown>;
  logger.verbose('call start', { callName, inputs: sanitizedInputs, ...context });

  try {
    const result = await fn();
    const durationMs = Date.now() - start;
    const outMeta: Record<string, unknown> = {
      callName,
      durationMs,
      ...context,
    };
    if (logOutput) {
      outMeta.output = sanitizeForLog(result);
    }
    logger.verbose('call end', outMeta);
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    logger.error('call failed', {
      callName,
      error: err,
      durationMs,
      ...context,
    });
    throw err;
  }
}
