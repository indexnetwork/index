import * as Sentry from '@sentry/bun';

type LogLevel = 'verbose' | 'debug' | 'info' | 'warn' | 'error';
type SentryLogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error';
type SentryLogAttributeValue = string | number | boolean | string[] | number[] | boolean[];

/** Named context for styled logs (emoji + color). */
export type LogContext =
  | 'controller'
  | 'service'
  | 'agent'
  | 'cli'
  | 'graph'
  | 'job'
  | 'queue'
  | 'protocol'
  | 'route'
  | 'router'
  | 'server'
  | 'lib';

const order: Record<LogLevel, number> = { verbose: 5, debug: 10, info: 20, warn: 30, error: 40 };

const RESET = '\x1b[0m';

/** Valid context names for LOG_FILTER. */
const LOG_CONTEXT_NAMES = new Set<string>([
  'controller', 'service', 'agent', 'cli', 'graph', 'job', 'queue',
  'protocol', 'route', 'router', 'server', 'lib',
]);

/** Parse a comma-separated list of context names into a Set, or null if none are valid. */
function parseContextFilter(raw: string | null | undefined): Set<LogContext> | null {
  const names = (raw || '').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const allowed = new Set<LogContext>();
  for (const name of names) {
    if (LOG_CONTEXT_NAMES.has(name)) allowed.add(name as LogContext);
  }
  return allowed.size > 0 ? allowed : null;
}

/**
 * Parse LOG_FILTER env var. Comma-separated list of context names; only those loggers will emit.
 * Example: LOG_FILTER=graph or LOG_FILTER=graph,protocol
 * If unset or empty, all contexts are allowed.
 */
function envContextFilter(): Set<LogContext> | null {
  return parseContextFilter(process.env.LOG_FILTER);
}

let contextFilter: Set<LogContext> | null = envContextFilter();

export function setContextFilter(filter: string | null) {
  contextFilter = parseContextFilter(filter);
}

function shouldLogByContext(context: LogContext | undefined): boolean {
  if (contextFilter === null) return true;
  if (context === undefined) return false;
  return contextFilter.has(context);
}

/** Whether to use ANSI color (TTY or FORCE_COLOR). */
function useColor(): boolean {
  if (process.env.FORCE_COLOR === '1' || process.env.FORCE_COLOR === 'true') return true;
  return Boolean(process.stdout?.isTTY);
}

/** Hex to ANSI 24-bit foreground (e.g. #ffc106 → RGB escape). */
function hexToAnsi(hex: string): string {
  const n = hex.replace(/^#/, '');
  if (n.length !== 6) return '';
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return `\x1b[38;2;${r};${g};${b}m`;
}

const CONTEXT_STYLES: Record<LogContext, { emoji: string; color: string }> = {
  controller: { emoji: '📡', color: '#ffc106' },
  service: { emoji: '⚙️', color: '#17a2b8' },
  agent: { emoji: '🤖', color: '#6f42c1' },
  cli: { emoji: '💻', color: '#6c757d' },
  graph: { emoji: '🕸️', color: '#20c997' },
  job: { emoji: '⏰', color: '#0dcaf0' },
  queue: { emoji: '📬', color: '#fd7e14' },
  protocol: { emoji: '📜', color: '#198754' },
  route: { emoji: '🛤️', color: '#e83e8c' },
  router: { emoji: '🔀', color: '#e83e8c' },
  server: { emoji: '🌐', color: '#6c757d' },
  lib: { emoji: '📚', color: '#0d6efd' },
};

function envLevel(): LogLevel {
  const v = (process.env.LOG_LEVEL || '').toLowerCase();
  if (v === 'verbose' || v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v;
  if (process.env.DEBUG === '1' || process.env.DEBUG === 'true') return 'debug';
  return process.env.NODE_ENV === 'development' ? 'debug' : 'info';
}

let currentLevel: LogLevel = envLevel();

export function setLevel(level: LogLevel) {
  currentLevel = level;
}

function shouldLog(level: LogLevel) {
  return order[level] >= order[currentLevel];
}

/** Keys that are known to hold embedding/vector data (do not log their values). */
const EMBEDDING_KEYS = new Set([
  'embedding',
  'hydeEmbedding',
  'hydeEmbeddings',
  'vector',
  'vectors',
  'embeddingArray',
  'embeddings',
]);

/**
 * Truncation limits for logged meta. Logs are for humans and Sentry —
 * never dump large payloads (full entities, LLM outputs, API responses).
 */
const MAX_LOG_STRING_LENGTH = 2000;
const MAX_LOG_ARRAY_ITEMS = 25;
const MAX_LOG_OBJECT_KEYS = 50;
const MAX_LOG_DEPTH = 6;

function truncateLogString(value: string): string {
  if (value.length <= MAX_LOG_STRING_LENGTH) return value;
  return `${value.slice(0, MAX_LOG_STRING_LENGTH)}… [truncated ${value.length - MAX_LOG_STRING_LENGTH} chars]`;
}

function isNumberArray(value: unknown): value is number[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    typeof value[0] === 'number'
  );
}

/** Recursively redact embedding/vector arrays so they are never logged. */
function fmt(message: string, meta?: Record<string, unknown>) {
  if (!meta) return message;
  try {
    const sanitized = sanitizeForLogInternal(meta) as Record<string, unknown>;
    const json = JSON.stringify(sanitized);
    return `${message}\n${json}`;
  } catch {
    return message;
  }
}

function sentryLogLevel(level: LogLevel): SentryLogLevel {
  return level === 'verbose' ? 'trace' : level;
}

function normalizeSentryAttributeName(key: string): string {
  return key.replace(/[^a-zA-Z0-9_.-]/g, '_');
}

function truncateSentryString(value: string): string {
  const maxLength = 2000;
  return value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;
}

function toSentryAttributeValue(value: unknown): SentryLogAttributeValue | undefined {
  if (value === undefined || value === null) return undefined;
  const sanitized = sanitizeForLogInternal(value);

  if (typeof sanitized === 'string') return truncateSentryString(sanitized);
  if (typeof sanitized === 'number' && Number.isFinite(sanitized)) return sanitized;
  if (typeof sanitized === 'boolean') return sanitized;

  if (Array.isArray(sanitized)) {
    if (sanitized.every((item): item is string => typeof item === 'string')) {
      return sanitized.map(truncateSentryString);
    }
    if (sanitized.every((item): item is number => typeof item === 'number' && Number.isFinite(item))) {
      return sanitized;
    }
    if (sanitized.every((item): item is boolean => typeof item === 'boolean')) {
      return sanitized;
    }
  }

  try {
    return truncateSentryString(JSON.stringify(sanitized));
  } catch {
    return undefined;
  }
}

function sentryAttributes(
  context: LogContext | undefined,
  source: string | undefined,
  meta: Record<string, unknown> | undefined,
): Record<string, SentryLogAttributeValue> {
  const attributes: Record<string, SentryLogAttributeValue> = {
    service: 'backend',
  };

  if (context) attributes.log_context = context;
  if (source) attributes.log_source = source;

  for (const [key, value] of Object.entries(meta ?? {})) {
    const attributeValue = toSentryAttributeValue(value);
    if (attributeValue !== undefined) {
      attributes[`meta.${normalizeSentryAttributeName(key)}`] = attributeValue;
    }
  }

  return attributes;
}

function emitSentryLog(
  level: LogLevel,
  message: string,
  context: LogContext | undefined,
  source: string | undefined,
  meta: Record<string, unknown> | undefined,
): void {
  if (process.env.NODE_ENV === 'test') return;

  try {
    const attributes = sentryAttributes(context, source, meta);
    switch (sentryLogLevel(level)) {
      case 'trace':
        Sentry.logger.trace(message, attributes);
        break;
      case 'debug':
        Sentry.logger.debug(message, attributes);
        break;
      case 'info':
        Sentry.logger.info(message, attributes);
        break;
      case 'warn':
        Sentry.logger.warn(message, attributes);
        break;
      case 'error':
        Sentry.logger.error(message, attributes);
        break;
    }
  } catch {
    // Logging must never fail the application path.
  }
}

/**
 * Source path is relative to src/ (e.g. "controllers/chat.controller.ts").
 * Non-deprecated: lib/*, controllers/, adapters/, jobs/, queues/, and root main.ts only.
 * index.ts at root is deprecated. All other paths (routes/, services/, agents/, etc.) are deprecated.
 */
export function isDeprecatedSource(sourcePath: string): boolean {
  const normalized = sourcePath.replace(/\\/g, '/');
  if (normalized === 'index.ts') return true;
  if (normalized === 'main.ts') return false;
  if (normalized.startsWith('lib/')) return false;
  if (normalized.startsWith('controllers/')) return false;
  if (normalized.startsWith('adapters/')) return false;
  if (normalized.startsWith('jobs/')) return false;
  if (normalized.startsWith('queues/')) return false;
  return true;
}

/** Red used for error level regardless of context. */
const ERROR_COLOR = '#dc3545';

/** Wrap line with emoji + source + optional color. Format: "emoji source: message" (source required for consistency). Adds [DEPRECATED] for non-blessed paths. Error level always uses red. */
function wrapWithContext(
  context: LogContext | undefined,
  source: string | undefined,
  line: string,
  level?: LogLevel
): { start: string; end: string } {
  if (!context || !CONTEXT_STYLES[context])
    return { start: source ? `${source}: ` : '', end: '' };
  const { emoji, color } = CONTEXT_STYLES[context];
  const useErrorColor = level === 'error';
  const effectiveColor = useErrorColor ? ERROR_COLOR : color;
  const colorOn = useColor() && effectiveColor;
  const ansi = colorOn ? hexToAnsi(effectiveColor) : '';
  const reset = colorOn ? RESET : '';
  // Path-based deprecation only applies to api-internal file-path sources
  // (e.g. "routes/foo.ts"). Protocol/graph/agent sources are component names
  // (e.g. "OpportunityGraph:Prep") and are never deprecated by path.
  const looksLikePath = (s: string) => s.endsWith('.ts') || s.includes('/');
  const deprecatedTag =
    context === 'cli' || context === 'route'
      ? '[DEPRECATED] '
      : context === 'lib' || context === 'job' || context === 'service' || context === 'server' || context === 'controller' || context === 'protocol' || context === 'queue'
        ? ''
        : (source && looksLikePath(source) && isDeprecatedSource(source))
          ? '[DEPRECATED] '
          : '';
  const prefix = source ? `${emoji} ${deprecatedTag}${source}: ` : `${emoji} `;
  return { start: ansi ? `${ansi}${prefix}` : prefix, end: reset };
}

type LogMethod = (message: string, meta?: Record<string, unknown>) => void;

export type LoggerWithSource = {
  verbose: LogMethod;
  debug: LogMethod;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
};

/** Per-level console sink. verbose/debug both route to console.debug. */
const LEVEL_CONSOLE: Record<LogLevel, (line: string) => void> = {
  verbose: (line) => console.debug(line),
  debug: (line) => console.debug(line),
  info: (line) => console.info(line),
  warn: (line) => console.warn(line),
  error: (line) => console.error(line),
};

function createLogger(
  context: LogContext | undefined,
  source?: string
): LoggerWithSource {
  function emit(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    if (
      process.env.NODE_ENV === 'test'
      && process.env.API_TEST_HERMES_ASSURANCE_QUIET === '1'
    ) return;
    if (!shouldLogByContext(context) || !shouldLog(level)) return;
    emitSentryLog(level, message, context, source, meta);
    const line = fmt(message, meta);
    const { start, end } = wrapWithContext(context, source, line, level === 'error' ? 'error' : undefined);
    LEVEL_CONSOLE[level](start + line + end);
  }
  return {
    verbose: (message, meta) => emit('verbose', message, meta),
    debug: (message, meta) => emit('debug', message, meta),
    info: (message, meta) => emit('info', message, meta),
    warn: (message, meta) => emit('warn', message, meta),
    error: (message, meta) => emit('error', message, meta),
  };
}

function addFrom<T extends LogContext>(context: T): LoggerWithSource & { from: (source: string) => LoggerWithSource } {
  const logger = createLogger(context) as LoggerWithSource & { from: (source: string) => LoggerWithSource };
  logger.from = (source: string) => createLogger(context, source);
  return logger;
}

const base = createLogger(undefined, undefined);

/** Logger with optional context (emoji + color). Use .from(source) for a consistent source label in every line — see the per-layer conventions on the pre-bound loggers below. */
export const log = {
  ...base,
  withContext(context: LogContext, source?: string) {
    return source ? createLogger(context, source) : addFrom(context);
  },
  /**
   * Pre-bound loggers. Source label conventions per layer:
   * controllers = lowercase feature ('chat'); services = PascalCase class name ('IntentService');
   * queues = 'XxxJob'/'XxxQueue'; adapters = '<name>.adapter'; guards = '<name>.guard';
   * lib = module name without lib/ prefix or extension ('email/transport.helper');
   * protocol components = PascalCase with optional ':SubScope' ('OpportunityGraph:Prep').
   */
  controller: addFrom('controller'),
  service: addFrom('service'),
  agent: addFrom('agent'),
  cli: addFrom('cli'),
  graph: addFrom('graph'),
  job: addFrom('job'),
  queue: addFrom('queue'),
  protocol: addFrom('protocol'),
  route: addFrom('route'),
  router: addFrom('router'),
  server: addFrom('server'),
  lib: addFrom('lib'),
};

/**
 * Sanitize an object for logging: redact embedding/vector arrays and truncate
 * oversized strings/arrays/objects. Use before logging objects that may contain
 * embeddings or large payloads.
 */
export function sanitizeForLog(value: unknown): unknown {
  return sanitizeForLogInternal(value);
}

function sanitizeForLogInternal(value: unknown, depth = 0): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return truncateLogString(value);
  if (isNumberArray(value)) return `[redacted: ${value.length} values]`;
  if (Array.isArray(value)) {
    if (value.length > 0 && typeof value[0] === 'number') return `[redacted: ${value.length} values]`;
    if (depth >= MAX_LOG_DEPTH) return `[truncated: array(${value.length})]`;
    const items = value
      .slice(0, MAX_LOG_ARRAY_ITEMS)
      .map((item) => sanitizeForLogInternal(item, depth + 1));
    if (value.length > MAX_LOG_ARRAY_ITEMS) {
      items.push(`… [truncated ${value.length - MAX_LOG_ARRAY_ITEMS} more items]`);
    }
    return items;
  }
  if (value instanceof Error) {
    const out: Record<string, unknown> = {
      message: truncateLogString(value.message),
      name: value.name,
    };
    // Capture any extra enumerable own properties (e.g. Drizzle/postgres driver fields: query, parameters, code, constraint)
    for (const [k, v] of Object.entries(value as unknown as Record<string, unknown>)) {
      if (!(k in out)) out[k] = sanitizeForLogInternal(v, depth + 1);
    }
    return out;
  }
  if (typeof value === 'object' && value.constructor === Object) {
    if (depth >= MAX_LOG_DEPTH) return `[truncated: object(${Object.keys(value).length} keys)]`;
    const out: Record<string, unknown> = {};
    let keyCount = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (keyCount >= MAX_LOG_OBJECT_KEYS) {
        out['…'] = `[truncated ${Object.keys(value).length - MAX_LOG_OBJECT_KEYS} more keys]`;
        break;
      }
      keyCount++;
      if (EMBEDDING_KEYS.has(k) || isNumberArray(v)) {
        out[k] = isNumberArray(v) ? `[redacted: ${v.length} values]` : sanitizeForLogInternal(v, depth + 1);
      } else if (v != null && typeof v === 'object' && !Array.isArray(v) && v.constructor === Object) {
        const nested = v as Record<string, unknown>;
        if (Object.keys(nested).length > 0 && Object.keys(nested).every((key) => isNumberArray(nested[key]))) {
          out[k] = Object.fromEntries(
            Object.entries(nested).map(([key, val]) => [
              key,
              isNumberArray(val) ? `[redacted: ${val.length} values]` : val,
            ])
          );
        } else {
          out[k] = sanitizeForLogInternal(v, depth + 1);
        }
      } else {
        out[k] = sanitizeForLogInternal(v, depth + 1);
      }
    }
    return out;
  }
  return value;
}

export type { LogLevel };

