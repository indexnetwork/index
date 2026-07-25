/**
 * platform — IND-543 outer shell.
 *
 * Curated contracts that are truly cross-domain: model primitives,
 * observability extension hooks, timeout/abort/request-context.
 *
 * Boundary: neutral-platform.  MUST NOT import any capability module
 * internals (signals, communities, opportunities, negotiation, …).
 * Permitted sources: shared/interfaces, shared/schemas, shared/observability,
 * shared/agent model + runtime helpers.
 *
 * These re-exports are temporary aliases; the implementation files remain in
 * shared/ until the domain migration issues land.
 */

// ── Model primitives ──────────────────────────────────────────────────────────
export { getModelName } from '../shared/agent/model.config.js';

// ── Request / abort context ───────────────────────────────────────────────────
export { requestContext } from '../shared/observability/request-context.js';

// ── Observability extension points ────────────────────────────────────────────
export { setLoggerFactory } from '../shared/observability/log.js';
export { setTimingWrapper } from '../shared/observability/performance.js';

// ── Tool invocation runtime ───────────────────────────────────────────────────
export {
  getToolTimeoutPolicy,
  invokeToolRuntime,
  toolRuntimeErrorToResult,
} from '../shared/agent/tool.runtime.js';
