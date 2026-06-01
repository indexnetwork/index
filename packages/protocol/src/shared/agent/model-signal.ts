import { requestContext } from "../observability/request-context.js";

/**
 * Combines an explicit per-call AbortSignal with the current request signal.
 * Either signal aborting should cancel the downstream LangChain/OpenAI call.
 */
function combineAbortSignals(signals: AbortSignal[]): AbortSignal {
  if (signals.length === 1) return signals[0];
  if (typeof AbortSignal.any === "function") {
    return AbortSignal.any(signals);
  }

  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => {
      if (!controller.signal.aborted) controller.abort(signal.reason);
    }, { once: true });
  }
  return controller.signal;
}

/**
 * Returns a LangChain RunnableConfig carrying the active AbortSignal(s),
 * when tool/runtime execution installed one in AsyncLocalStorage or a caller
 * supplied an explicit signal.
 */
export function getAbortSignalConfig(signal?: AbortSignal): { signal: AbortSignal } | undefined {
  const signals = [signal, requestContext.getStore()?.abortSignal].filter(
    (item): item is AbortSignal => item instanceof AbortSignal,
  );
  return signals.length > 0 ? { signal: combineAbortSignals(signals) } : undefined;
}

/** Invokes a LangChain runnable with the current request AbortSignal when present. */
export async function invokeWithAbortSignal<TInput, TOutput>(
  runnable: { invoke(input: TInput, config?: { signal?: AbortSignal }): Promise<TOutput> },
  input: TInput,
  signal?: AbortSignal,
): Promise<TOutput> {
  const config = getAbortSignalConfig(signal);
  return config ? runnable.invoke(input, config) : runnable.invoke(input);
}
