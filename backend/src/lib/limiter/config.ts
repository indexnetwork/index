export type LimiterClass = 'auth_write' | 'read' | 'write';

export interface ClassConfig {
  /** Maximum requests allowed per `windowSec`. */
  perMinute: number;
  /** Window in seconds. Always 60 for our fixed-window classes. */
  windowSec: number;
}

const intEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export const CLASS_CONFIG: Record<LimiterClass, ClassConfig> = {
  auth_write: { perMinute: intEnv('LIMITER_AUTH_WRITE_PER_MIN', 10), windowSec: 60 },
  read:       { perMinute: intEnv('LIMITER_READ_PER_MIN', 120),      windowSec: 60 },
  write:      { perMinute: intEnv('LIMITER_WRITE_PER_MIN', 60),      windowSec: 60 },
};

const CLASS_ENV: Record<LimiterClass, { envVar: string; fallback: number }> = {
  auth_write: { envVar: 'LIMITER_AUTH_WRITE_PER_MIN', fallback: 10 },
  read:       { envVar: 'LIMITER_READ_PER_MIN',       fallback: 120 },
  write:      { envVar: 'LIMITER_WRITE_PER_MIN',      fallback: 60 },
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

export function isLimiterDisabled(): boolean {
  return process.env.LIMITER_DISABLE === '1';
}
