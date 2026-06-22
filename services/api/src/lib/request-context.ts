import { AsyncLocalStorage } from "async_hooks";

/** Callback for streaming graph/agent trace events from deep inside graph nodes. */
export type TraceEmitter = (event: {
  type: "graph_start" | "graph_end" | "agent_start" | "agent_end";
  name: string;
  durationMs?: number;
  summary?: string;
}) => void;

interface RequestContext {
  originUrl?: string;
  traceEmitter?: TraceEmitter;
}

export const requestContext = new AsyncLocalStorage<RequestContext>();
