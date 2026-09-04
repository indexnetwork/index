export type LimiterClass = 'auth_write' | 'read' | 'write' | 'intent_llm' | 'mcp_http';

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
  // Routes that run a model call per request (signal clarification, and the
  // intent graph behind create). The generic write budget lets one user start
  // 600 of those a minute, so these get their own much tighter class.
  intent_llm:       20,
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
  intent_llm:       resolveClassConfig('intent_llm'),
  mcp_http:         resolveClassConfig('mcp_http'),
};
