import { loggerFor, requestContext } from '../core/runtime.js';

export const prepLog = loggerFor('Discovery:Prep');
export const scopeLog = loggerFor('Discovery:Scope');
export const resolveLog = loggerFor('Discovery:Resolve');
export const discoveryLog = loggerFor('Discovery:Discovery');
export const evaluationLog = loggerFor('Discovery:Evaluation');
export const rankingLog = loggerFor('Discovery:Ranking');

/**
 * Error text can include provider response bodies, URLs, and credentials. Keep
 * observability useful by retaining only a conservative error class at this
 * boundary; detailed errors are intentionally not emitted from graph traces.
 */
export function safeDiscoveryError(_error: unknown): string {
  return 'OpportunityEvaluationError: [redacted]';
}

/**
 * Wraps a graph node function to emit agent_start/agent_end trace events
 * at its boundaries so the frontend TRACE panel shows real-time progress.
 * @param traceName - Kebab-case agent name (e.g. "opportunity-prep")
 * @param nodeFn - The original node function
 * @param summaryFn - Optional function to derive a summary string from the node result
 */
export function withNodeTrace<S, R>(
  traceName: string,
  nodeFn: (state: S) => Promise<R>,
  summaryFn?: (result: R) => string | undefined,
): (state: S) => Promise<R> {
  return async (state: S) => {
    const traceEmitter = requestContext.getStore()?.traceEmitter;
    const nodeStart = Date.now();
    traceEmitter?.({ type: "agent_start", name: traceName });
    try {
      const result = await nodeFn(state);
      const durationMs = Date.now() - nodeStart;
      const summary = summaryFn?.(result) ?? undefined;
      traceEmitter?.({ type: "agent_end", name: traceName, durationMs, summary });
      return result;
    } catch (err) {
      const durationMs = Date.now() - nodeStart;
      const errMsg = safeDiscoveryError(err);
      traceEmitter?.({ type: "agent_end", name: traceName, durationMs, summary: `error: ${errMsg}` });
      throw err;
    }
  };
}

/** Shared trace summary: surface `error` when a node returned one. */
export function errorSummary(result: unknown): string | undefined {
  const r = result as Record<string, unknown> | null | undefined;
  return r?.error ? `error: ${r.error}` : undefined;
}
