export type LimiterClass = 'auth_write' | 'read' | 'write' | 'intake_synthesis' | 'mcp_http';

export interface ClassConfig {
  /** Maximum requests allowed per `windowSec`. */
  perMinute: number;
  /** Window in seconds. Always 60 for our fixed-window classes. */
  windowSec: number;
}

/** Per-minute request budget for each rate-limit class. */
const CLASS_PER_MINUTE: Record<LimiterClass, number> = {
  auth_write:       100,
  read:             1200,
  write:            600,
  // Routes that launch a background LLM synthesis plus a full intent-graph run
  // and write a durable proposal row per call. The generic write budget lets one
  // user start 600 of those a minute, so these get their own much tighter class.
  intake_synthesis: 20,
  mcp_http:         240,
};

/** Resolve the active config for a given rate-limit class. */
export function resolveClassConfig(cls: LimiterClass): ClassConfig {
  return { perMinute: CLASS_PER_MINUTE[cls], windowSec: 60 };
}

/** Every class config, keyed by class. */
export const CLASS_CONFIG: Record<LimiterClass, ClassConfig> = {
  auth_write:       resolveClassConfig('auth_write'),
  read:             resolveClassConfig('read'),
  write:            resolveClassConfig('write'),
  intake_synthesis: resolveClassConfig('intake_synthesis'),
  mcp_http:         resolveClassConfig('mcp_http'),
};
