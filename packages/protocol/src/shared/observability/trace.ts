/**
 * Trace helpers — wrap async work in `graph_start`/`graph_end` or
 * `agent_start`/`agent_end` events automatically. Pulls the emitter from the
 * ambient request context so callers don't pass it manually.
 *
 * Available in two flavours:
 *  - Functional: `traceGraph(name, fn)` / `traceAgent(name, fn)` — for inline
 *    blocks. Returns whatever the wrapped function returns.
 *  - Decorator: `@TraceGraph(name)` / `@TraceAgent(name)` — for class methods.
 *    Uses the legacy decorator shape already adopted by `@Timed()`.
 */
import { requestContext } from "./request-context.js";

type Emitter = (event: Record<string, unknown>) => void;

function getEmitter(): Emitter | undefined {
  const raw = requestContext.getStore()?.traceEmitter;
  // The ambient TraceEmitter is typed against a constrained event union; we
  // emit a broader shape here. Same wide-cast pattern used elsewhere
  // (see opportunity.graph.ts, opportunity.discover.ts).
  return raw as unknown as Emitter | undefined;
}

/**
 * Wrap an async function so it emits `graph_start` / `graph_end` events around
 * its execution. `durationMs` is measured in wall time. If the wrapped
 * function throws, `graph_end` still fires before the error propagates.
 *
 * Use ONLY for actual LangGraph compiled state machines (Opportunity graph,
 * Negotiation graph, etc). For logical groupings of inline work, use
 * `tracePhase` — it has a distinct visual in the trace UI so users can tell
 * "this is a graph" from "this is a phase".
 */
export async function traceGraph<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const emit = getEmitter();
  emit?.({ type: "graph_start", name });
  const start = Date.now();
  try {
    return await fn();
  } finally {
    emit?.({ type: "graph_end", name, durationMs: Date.now() - start });
  }
}

/**
 * Wrap an async function so it emits `phase_start` / `phase_end` events around
 * its execution. Phases are logical groupings of inline async work — they
 * share container semantics with graphs (they can host agents) but render
 * differently in the trace UI to make it clear they're NOT LangGraph state
 * machines.
 */
export async function tracePhase<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const emit = getEmitter();
  emit?.({ type: "phase_start", name });
  const start = Date.now();
  try {
    return await fn();
  } finally {
    emit?.({ type: "phase_end", name, durationMs: Date.now() - start });
  }
}

/**
 * Wrap an async function so it emits `agent_start` / `agent_end` events. The
 * optional `summarize` callback produces a short string shown in the trace
 * panel; receives the wrapped function's resolved value.
 */
export async function traceAgent<T>(
  name: string,
  fn: () => Promise<T>,
  summarize?: (value: T) => string | undefined,
): Promise<T> {
  const emit = getEmitter();
  emit?.({ type: "agent_start", name });
  const start = Date.now();
  let value: T;
  try {
    value = await fn();
  } catch (err) {
    emit?.({ type: "agent_end", name, durationMs: Date.now() - start });
    throw err;
  }
  const durationMs = Date.now() - start;
  const summary = summarize?.(value);
  emit?.({ type: "agent_end", name, durationMs, ...(summary ? { summary } : {}) });
  return value;
}

/**
 * Method decorator. Wraps the decorated async method in `traceGraph(name, ...)`.
 * Use on class methods that represent a logical "graph" (a sub-flow with
 * internal agent calls).
 *
 * @example
 * class RefinePhase {
 *   @TraceGraph("Refine")
 *   async run() { ... }
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function TraceGraph(name: string): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    descriptor.value = function (this: any, ...args: any[]) {
      return traceGraph(name, () => original.apply(this, args));
    };
  };
}

/**
 * Method decorator. Wraps the decorated async method in `traceAgent(name, ...)`.
 * Use on class methods that represent a single agent step (one LLM call,
 * one summarization, etc).
 *
 * @example
 * class ChatSummary {
 *   @TraceAgent("Chat summary")
 *   async run() { ... }
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function TraceAgent(name: string): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    descriptor.value = function (this: any, ...args: any[]) {
      return traceAgent(name, () => original.apply(this, args));
    };
  };
}

/**
 * Method decorator. Wraps the decorated async method in `tracePhase(name, ...)`.
 * Use for logical groupings of inline work that aren't LangGraph state machines.
 *
 * @example
 * class RefinePhase {
 *   @TracePhase("Refine")
 *   async run() { ... }
 * }
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function TracePhase(name: string): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function (_target: any, _propertyKey: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    descriptor.value = function (this: any, ...args: any[]) {
      return tracePhase(name, () => original.apply(this, args));
    };
  };
}
