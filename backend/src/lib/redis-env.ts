/**
 * Side-effect-free Redis-config detection. Lives in `lib/` (not `adapters/`)
 * so callers can check whether Redis is configured WITHOUT importing
 * `cache.adapter.ts`, which eagerly constructs `RedisCacheAdapter` singletons
 * at module load and would otherwise connect to localhost even when no Redis
 * is intended.
 */
export function isRedisConfigured(): boolean {
  return !!(process.env.REDIS_URL || process.env.REDIS_HOST);
}
