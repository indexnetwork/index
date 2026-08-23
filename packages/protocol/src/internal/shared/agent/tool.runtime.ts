import { timed } from "../observability/performance.js";
import type { TraceEmitter } from "../observability/request-context.js";
import { requestContext } from "../observability/request-context.js";

import type { RawToolDefinition, ResolvedToolContext } from "./tool.helpers.js";

export type ToolTimeoutClass = "fast" | "bounded_slow" | "async_candidate";
export type ToolRuntimeErrorCode = "TOOL_TIMEOUT" | "TOOL_CANCELLED" | "TOOL_OUTPUT_TOO_LARGE";

export interface ToolTimeoutPolicy {
  class: ToolTimeoutClass;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ToolInvocationRuntimeInput {
  toolName: string;
  tool: Pick<RawToolDefinition, "handler">;
  context: ResolvedToolContext;
  query: unknown;
  signal?: AbortSignal;
  traceEmitter?: TraceEmitter;
  timeoutMs?: number;
  maxOutputBytes?: number;
}

const FAST_TIMEOUT_MS = 10_000;
const BOUNDED_SLOW_TIMEOUT_MS = 45_000;
const ASYNC_CANDIDATE_TIMEOUT_MS = 50_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

const FAST_TOOLS = new Set([
  "create_intent_index",
  "delete_intent_index",
  "search_intents",
  "read_networks",
  "update_network",
  "create_network",
  "delete_network",
  "create_network_membership",
  "delete_network_membership",
  "confirm_opportunity_delivery",
  "read_docs",
  "read_own_agent",
  "register_agent",
  "list_agents",
  "update_agent",
  "delete_agent",
  "grant_agent_permission",
  "revoke_agent_permission",
  "retract_premise",
]);

const ASYNC_CANDIDATE_TOOLS = new Set([
  "research_profile",
  "create_intent",
  "update_intent",
  "scrape_url",
  "respond_to_negotiation",
  "create_premise",
  "update_premise",
]);

export function getToolTimeoutPolicy(toolName: string): ToolTimeoutPolicy {
  const classification: ToolTimeoutClass = FAST_TOOLS.has(toolName)
    ? "fast"
    : ASYNC_CANDIDATE_TOOLS.has(toolName)
      ? "async_candidate"
      : "bounded_slow";

  const timeoutMs = classification === "fast"
    ? FAST_TIMEOUT_MS
    : classification === "async_candidate"
      ? ASYNC_CANDIDATE_TIMEOUT_MS
      : BOUNDED_SLOW_TIMEOUT_MS;

  return {
    class: classification,
    timeoutMs,
    maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
  };
}

export class ToolRuntimeError extends Error {
  constructor(
    public readonly code: ToolRuntimeErrorCode,
    message: string,
    public readonly toolName: string,
    public readonly policy: ToolTimeoutPolicy,
  ) {
    super(message);
    this.name = "ToolRuntimeError";
  }
}

/** Builds the typed timeout/cancellation error shared by the abort race and catch paths. */
function makeAbortError(timedOut: boolean, toolName: string, policy: ToolTimeoutPolicy): ToolRuntimeError {
  const code: ToolRuntimeErrorCode = timedOut ? "TOOL_TIMEOUT" : "TOOL_CANCELLED";
  return new ToolRuntimeError(
    code,
    code === "TOOL_TIMEOUT"
      ? `Tool ${toolName} timed out after ${policy.timeoutMs}ms.`
      : `Tool ${toolName} was cancelled before it completed.`,
    toolName,
    policy,
  );
}

function combineSignals(signals: Array<AbortSignal | undefined>): {
  signal: AbortSignal;
  abort: (reason?: unknown) => void;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const listeners: Array<() => void> = [];

  for (const source of signals) {
    if (!source) continue;
    if (source.aborted) {
      controller.abort(source.reason);
      break;
    }
    const onAbort = () => {
      if (!controller.signal.aborted) controller.abort(source.reason);
    };
    source.addEventListener("abort", onAbort, { once: true });
    listeners.push(() => source.removeEventListener("abort", onAbort));
  }

  return {
    signal: controller.signal,
    abort: (reason?: unknown) => {
      if (!controller.signal.aborted) controller.abort(reason);
    },
    cleanup: () => {
      for (const cleanup of listeners) cleanup();
    },
  };
}

export async function invokeToolRuntime(input: ToolInvocationRuntimeInput): Promise<string> {
  return timed(`ToolRuntime.${input.toolName}`, () => invokeToolRuntimeInner(input));
}

async function invokeToolRuntimeInner(input: ToolInvocationRuntimeInput): Promise<string> {
  const basePolicy = getToolTimeoutPolicy(input.toolName);
  const policy = {
    ...basePolicy,
    ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    ...(input.maxOutputBytes !== undefined ? { maxOutputBytes: input.maxOutputBytes } : {}),
  };
  const inherited = requestContext.getStore();
  const combined = combineSignals([input.signal, inherited?.abortSignal]);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    combined.abort(new Error(`Tool ${input.toolName} timed out after ${policy.timeoutMs}ms`));
  }, policy.timeoutMs);

  let removeAbortListener = () => {};
  const abortPromise = new Promise<never>((_, reject) => {
    const onAbort = () => {
      reject(makeAbortError(timedOut, input.toolName, policy));
    };
    combined.signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => combined.signal.removeEventListener("abort", onAbort);
  });

  try {
    const run = () => input.tool.handler({ context: input.context, query: input.query });
    const toolPromise = requestContext.run(
      {
        ...inherited,
        abortSignal: combined.signal,
        traceEmitter: input.traceEmitter ?? inherited?.traceEmitter,
      },
      run,
    );
    const result = await Promise.race([toolPromise, abortPromise]);
    const outputBytes = new TextEncoder().encode(result).byteLength;
    if (outputBytes > policy.maxOutputBytes) {
      throw new ToolRuntimeError(
        "TOOL_OUTPUT_TOO_LARGE",
        `Tool ${input.toolName} returned ${outputBytes} bytes, exceeding the ${policy.maxOutputBytes} byte limit.`,
        input.toolName,
        policy,
      );
    }
    return result;
  } catch (err) {
    if (err instanceof ToolRuntimeError) throw err;
    if (combined.signal.aborted) {
      throw makeAbortError(timedOut, input.toolName, policy);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    removeAbortListener();
    combined.cleanup();
  }
}

export function toolRuntimeErrorToResult(err: unknown): string | null {
  if (!(err instanceof ToolRuntimeError)) return null;
  return JSON.stringify({
    success: false,
    code: err.code,
    error: err.message,
    data: {
      tool: err.toolName,
      timeoutClass: err.policy.class,
      timeoutMs: err.policy.timeoutMs,
      maxOutputBytes: err.policy.maxOutputBytes,
    },
  });
}
