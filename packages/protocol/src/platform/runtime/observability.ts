/** A host-provided structured logger used by protocol workflows. */
export interface Logger {
  verbose(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
}

export type ProtocolTraceEvent = {
  type: "graph_start" | "graph_end" | "agent_start" | "agent_end";
  name: string;
  durationMs?: number;
  summary?: string;
} | {
  type: "status";
  message: string;
};

/** Values a host may propagate through one protocol request. */
export interface RequestContext {
  originUrl?: string;
  abortSignal?: AbortSignal;
  traceEmitter?: (event: ProtocolTraceEvent) => void;
}

/** A host-owned store for request-scoped values. */
export interface RequestContextStore {
  getStore(): RequestContext | undefined;
  run<T>(context: RequestContext, operation: () => T): T;
}

/** A host-normalized failure suitable for transport or job handling. */
export interface ProtocolError {
  code: string;
  message: string;
  cause?: unknown;
}
