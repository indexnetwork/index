import { AsyncLocalStorage } from 'node:async_hooks';

import type { Logger, RunOptions } from './types.js';

/** Isolated per invocation, including concurrent model and embedding calls. */
export const requestContext = new AsyncLocalStorage<RunOptions>();

export function getAbortSignalConfig(): { signal?: AbortSignal } {
  return { signal: requestContext.getStore()?.signal };
}

export function loggerFor(source: string): Logger {
  const emit = (level: keyof Logger) => (message: string, meta?: Record<string, unknown>) =>
    requestContext.getStore()?.logger?.[level](message, { ...meta, source });
  return { verbose: emit('verbose'), debug: emit('debug'), info: emit('info'), warn: emit('warn'), error: emit('error') };
}

export async function timed<T>(name: string, operation: () => Promise<T>): Promise<T> {
  const started = Date.now();
  getAbortSignalConfig().signal?.throwIfAborted();
  try {
    const result = await operation();
    getAbortSignalConfig().signal?.throwIfAborted();
    return result;
  } finally {
    loggerFor(name).debug('Completed', { durationMs: Date.now() - started });
  }
}
