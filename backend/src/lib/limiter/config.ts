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

export function resolveClassConfig(cls: LimiterClass): ClassConfig {
  return CLASS_CONFIG[cls];
}

export function isLimiterDisabled(): boolean {
  return process.env.LIMITER_DISABLE === '1';
}
