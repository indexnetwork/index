export type LimiterClass = 'auth_write' | 'read' | 'write' | 'mcp_http';

export interface ClassConfig {
  /** Maximum requests allowed per `windowSec`. */
  perMinute: number;
  /** Window in seconds. Always 60 for our fixed-window classes. */
  windowSec: number;
}

export const intEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const CLASS_ENV: Record<LimiterClass, { envVar: string; fallback: number }> = {
  auth_write: { envVar: 'LIMITER_AUTH_WRITE_PER_MIN', fallback: 100 },
  read:       { envVar: 'LIMITER_READ_PER_MIN',       fallback: 1200 },
  write:      { envVar: 'LIMITER_WRITE_PER_MIN',      fallback: 600 },
  mcp_http:   { envVar: 'MCP_HTTP_LIMIT_PER_MIN',     fallback: 240 },
};

/**
 * Resolve the active config for a given rate-limit class.
 * Reads env vars fresh on every call so runtime overrides take effect
 * without a module reload (in contrast to the static {@link CLASS_CONFIG}
 * snapshot, which is captured at module load).
 */
export function resolveClassConfig(cls: LimiterClass): ClassConfig {
  const { envVar, fallback } = CLASS_ENV[cls];
  return { perMinute: intEnv(envVar, fallback), windowSec: 60 };
}

/**
 * Static snapshot of every class config, captured at module load.
 * Use {@link resolveClassConfig} when runtime env overrides must take effect.
 */
export const CLASS_CONFIG: Record<LimiterClass, ClassConfig> = {
  auth_write: resolveClassConfig('auth_write'),
  read:       resolveClassConfig('read'),
  write:      resolveClassConfig('write'),
  mcp_http:   resolveClassConfig('mcp_http'),
};

export function isLimiterDisabled(): boolean {
  return process.env.LIMITER_DISABLE === '1';
}
