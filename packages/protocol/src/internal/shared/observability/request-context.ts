import type { RequestContext, RequestContextStore } from "../../../platform/runtime/observability.js";

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

type ProtocolRequestContext = Omit<RequestContext, "traceEmitter"> & { traceEmitter?: TraceEmitter };

let store: RequestContextStore | undefined;

/** Configure host-owned request storage once during host composition. */
export function setRequestContextStore(next: RequestContextStore | undefined): void {
  store = next;
}

/**
 * Compatibility request-context facade. Storage is owned by the consuming host;
 * without a configured store it deliberately behaves as an empty context.
 */
export const requestContext = {
  getStore(): ProtocolRequestContext | undefined {
    return store?.getStore() as ProtocolRequestContext | undefined;
  },
  run<T>(context: ProtocolRequestContext, operation: () => T): T {
    return store ? store.run(context, operation) : operation();
  },
};
