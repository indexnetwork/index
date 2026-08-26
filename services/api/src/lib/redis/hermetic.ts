/**
 * True when Redis-backed collaborators must stay in-memory: tests without
 * RUN_REDIS_INTEGRATION_TESTS=1. Importing modules that can reach Redis
 * (cache, SSE, discovery locks) must not require a localhost Redis server.
 */
export function useHermeticRedis(): boolean {
  return process.env.NODE_ENV === 'test'
    && process.env.RUN_REDIS_INTEGRATION_TESTS !== '1';
}
