/**
 * Protocol-internal logging module.
 *
 * Self-contained — no imports from outside the protocol library.
 * Ships with a minimal console-based default. The host application can
 * call `setLoggerFactory()` at startup to wire in a richer implementation
 * (e.g. the project-wide `log` utility with ANSI colors, context filtering,
 * and embedding redaction).
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

type LogMethod = (message: string, meta?: Record<string, unknown>) => void;

export type LoggerWithSource = {
  verbose: LogMethod;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
};

export type LogContext = 'protocol' | 'lib' | 'agent' | 'graph';

export type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error';

// ═══════════════════════════════════════════════════════════════════════════════
// DEFAULT IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════════

function defaultCreateLogger(_context: string, source: string): LoggerWithSource {
  const prefix = `[${source}]`;
  const emit = (sink: (...args: unknown[]) => void, msg: string, meta?: Record<string, unknown>) =>
    sink(prefix, msg, ...(meta ? [sanitizeFn(meta)] : []));
  return {
    // eslint-disable-next-line no-console
    verbose: (msg, meta) => emit(console.debug, msg, meta),
    // eslint-disable-next-line no-console
    debug: (msg, meta) => emit(console.debug, msg, meta),
    // eslint-disable-next-line no-console
    info: (msg, meta) => emit(console.info, msg, meta),
    // eslint-disable-next-line no-console
    warn: (msg, meta) => emit(console.warn, msg, meta),
    // eslint-disable-next-line no-console
    error: (msg, meta) => emit(console.error, msg, meta),
  };
}

/** Truncation limits for the default (host-less) sanitizer — never dump big payloads. */
const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 25;
const MAX_DEPTH = 6;

function defaultSanitize(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    return value.length > MAX_STRING_LENGTH
      ? `${value.slice(0, MAX_STRING_LENGTH)}… [truncated ${value.length - MAX_STRING_LENGTH} chars]`
      : value;
  }
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'number') return `[redacted: ${value.length} values]`;
    if (depth >= MAX_DEPTH) return `[truncated: array(${value.length})]`;
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => defaultSanitize(item, depth + 1));
    if (value.length > MAX_ARRAY_ITEMS) items.push(`… [truncated ${value.length - MAX_ARRAY_ITEMS} more items]`);
    return items;
  }
  if (value instanceof Error) {
    return { name: value.name, message: defaultSanitize(value.message, depth + 1) };
  }
  if (typeof value === 'object' && value.constructor === Object) {
    if (depth >= MAX_DEPTH) return `[truncated: object(${Object.keys(value).length} keys)]`;
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, defaultSanitize(v, depth + 1)])
    );
  }
  return value;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLUGGABLE FACTORY
// ═══════════════════════════════════════════════════════════════════════════════

type LoggerFactory = (context: string, source: string) => LoggerWithSource;
type SanitizeFn = (value: unknown) => unknown;

let createLoggerFn: LoggerFactory = defaultCreateLogger;
let sanitizeFn: SanitizeFn = defaultSanitize;
/** Bumped on every setLoggerFactory() call; invalidates cached logger instances. */
let factoryGeneration = 0;

/**
 * Override the logger factory used by all protocol-internal logging.
 * Call this at application startup to wire in your project's logger.
 *
 * @example
 * ```ts
 * import { log, sanitizeForLog } from "./lib/log.js";
 * import { setLoggerFactory } from "./lib/protocol/support/log.js";
 *
 * setLoggerFactory(
 *   (context, source) => log.withContext(context as LogContext, source),
 *   sanitizeForLog,
 * );
 * ```
 */
export function setLoggerFactory(factory: LoggerFactory, sanitize?: SanitizeFn) {
  createLoggerFn = factory;
  if (sanitize) sanitizeFn = sanitize;
  factoryGeneration++;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC API
// ═══════════════════════════════════════════════════════════════════════════════

/** Sanitize an object for logging (redacts embeddings when host logger is wired in). */
export function sanitizeForLog(value: unknown): unknown {
  return sanitizeFn(value);
}

/**
 * Late-bound logger: resolves the current factory at emit time (cached per
 * factory generation). This makes `const logger = log.lib.from('X')` at module
 * import time safe — loggers created BEFORE the host calls `setLoggerFactory()`
 * still pick up the rich implementation afterwards.
 */
function makeLateBoundLogger(context: string, source: string): LoggerWithSource {
  let cached: LoggerWithSource | undefined;
  let cachedGeneration = -1;
  const resolve = (): LoggerWithSource => {
    if (!cached || cachedGeneration !== factoryGeneration) {
      cached = createLoggerFn(context, source);
      cachedGeneration = factoryGeneration;
    }
    return cached;
  };
  return {
    verbose: (msg, meta) => resolve().verbose(msg, meta),
    debug: (msg, meta) => resolve().debug(msg, meta),
    info: (msg, meta) => resolve().info(msg, meta),
    warn: (msg, meta) => resolve().warn(msg, meta),
    error: (msg, meta) => resolve().error(msg, meta),
  };
}

function lazyContext(context: string) {
  return {
    from: (source: string) => makeLateBoundLogger(context, source),
  };
}

/**
 * Logger with pre-bound context. Usage:
 * ```ts
 * const logger = log.protocol.from('MyComponent');
 * logger.info('started');
 * ```
 *
 * Loggers are late-bound: the factory is resolved at emit time, so
 * `setLoggerFactory()` at app startup upgrades even loggers that were created
 * at module import time.
 */
export const log = {
  protocol: lazyContext('protocol'),
  lib: lazyContext('lib'),
  agent: lazyContext('agent'),
  graph: lazyContext('graph'),
};
