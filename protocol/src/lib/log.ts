type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const order: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function envLevel(): LogLevel {
  const v = (process.env.LOG_LEVEL || '').toLowerCase();
  if (v === 'debug' || v === 'info' || v === 'warn' || v === 'error') return v;
  if (process.env.DEBUG === '1' || process.env.DEBUG === 'true') return 'debug';
  return 'info';
}

let currentLevel: LogLevel = envLevel();

export function setLevel(level: LogLevel) {
  currentLevel = level;
}

function shouldLog(level: LogLevel) {
  return order[level] >= order[currentLevel];
}

function fmt(message: string, meta?: Record<string, unknown>) {
  if (!meta) return message;
  try { return `${message} ${JSON.stringify(meta)}`; } catch { return message; }
}

export const log = {
  debug(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('debug')) console.debug(fmt(message, meta));
  },
  info(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('info')) console.info(fmt(message, meta));
  },
  warn(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('warn')) console.warn(fmt(message, meta));
  },
  error(message: string, meta?: Record<string, unknown>) {
    if (shouldLog('error')) console.error(fmt(message, meta));
  },
};

export type { LogLevel };

