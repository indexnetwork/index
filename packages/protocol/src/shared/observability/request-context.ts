import { AsyncLocalStorage } from "async_hooks";

/**
 * Callback for streaming trace events from deep inside graph nodes back to
 * the caller (typically chat.agent's stream pipeline). Kept as a single emitter
 * to minimize AsyncLocalStorage plumbing.
 */
export type TraceEmitter = (
  event:
    | {
        type: "graph_start" | "graph_end" | "agent_start" | "agent_end";
        name: string;
        durationMs?: number;
        summary?: string;
      }
    | {
        // Lightweight keep-alive/status line. Used by long-blocking tools
        // so SSE transports do not idle out.
        type: "status";
        message: string;
      }
) => void;

interface RequestContext {
  originUrl?: string;
  traceEmitter?: TraceEmitter;
  /** Signal for cooperative cancellation in long-running graph nodes. */
  abortSignal?: AbortSignal;
}

/**
 * AsyncLocalStorage for propagating request-scoped context through the protocol layer.
 * The host application is responsible for calling `requestContext.run()` to set the context.
 */
export const requestContext = new AsyncLocalStorage<RequestContext>();
