/* eslint-disable no-console */
/**
 * Web logger — labelled, level-aware wrapper around the browser console.
 *
 * Mirrors the server logger API (`log.<context>.from(source)`) from
 * `services/api/src/lib/log.ts` so log call sites look the same across the
 * repo. Every line is prefixed `[context:source]`, debug output is stripped
 * in production builds, and oversized meta payloads are truncated so we never
 * dump big data into the console.
 *
 * Usage:
 * ```ts
 * import { log } from '@/lib/logger';
 * const logger = log.context.from('ConversationContext');
 * logger.error('Failed to fetch conversations', { error: err });
 * ```
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/** Where in the web app the log originates. */
export type LogContext = 'ui' | 'context' | 'hook' | 'page' | 'lib';

type LogMethod = (message: string, meta?: Record<string, unknown>) => void;

export type LoggerWithSource = {
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
};

const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Debug lines are visible in dev; production builds start at info. */
const currentLevel: LogLevel = import.meta.env.DEV ? 'debug' : 'info';

function shouldLog(level: LogLevel): boolean {
  return order[level] >= order[currentLevel];
}

/** Truncation limits — logs must stay readable, never dump payloads. */
const MAX_STRING_LENGTH = 1000;
const MAX_ARRAY_ITEMS = 20;
const MAX_DEPTH = 4;

function sanitize(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}… [truncated ${value.length - MAX_STRING_LENGTH} chars]`
      : value;
  }
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'number') return `[redacted: ${value.length} values]`;
    if (depth >= MAX_DEPTH) return `[truncated: array(${value.length})]`;
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => sanitize(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`… [truncated ${value.length - MAX_ARRAY_ITEMS} more items]`);
    return items;
  }
  if (value instanceof Error) {
    return { name: value.name, message: sanitize(value.message, depth + 1) };
  }
  if (typeof value === 'object' && value.constructor === Object) {
    if (depth >= MAX_DEPTH) return `[truncated: object(${Object.keys(value).length} keys)]`;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitize(v, depth + 1)])
    );
  }
  return value;
}

const LEVEL_CONSOLE: Record<LogLevel, (...args: unknown[]) => void> = {
  debug: console.debug,
  info: console.info,
  warn: console.warn,
  error: console.error,
};

function createLogger(context: LogContext, source: string): LoggerWithSource {
  const prefix = `[${context}:${source}]`;
  const emit = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    if (!shouldLog(level)) return;
    LEVEL_CONSOLE[level](prefix, message, ...(meta ? [sanitize(meta)] : []));
  };
  return {
    debug: (message, meta) => emit('debug', message, meta),
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta),
  };
}

function withFrom(context: LogContext) {
  return { from: (source: string) => createLogger(context, source) };
}

/**
 * Pre-bound context loggers. Pick the context matching the file's location:
 * - `log.ui`      — components/
 * - `log.context` — contexts/
 * - `log.hook`    — hooks/
 * - `log.page`    — app/ (route pages)
 * - `log.lib`     — lib/, services/
 */
export const log = {
  ui: withFrom('ui'),
  context: withFrom('context'),
  hook: withFrom('hook'),
  page: withFrom('page'),
  lib: withFrom('lib'),
};
