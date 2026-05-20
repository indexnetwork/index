import type Redis from 'ioredis';

import type { HitResult, LimiterStorage } from './storage';

const LUA = `
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
local ttl = redis.call('TTL', KEYS[1])
return {n, ttl}
`;

/**
 * Redis-backed rate-limiter storage using a Lua script for atomic increment + TTL.
 *
 * The Lua script is pre-loaded with SCRIPT LOAD (`bootstrap`) and invoked via
 * EVALSHA for every hit. If Redis returns NOSCRIPT (e.g. after a restart or
 * SCRIPT FLUSH), the script is reloaded and the call is retried once.
 */
export class RedisStorage implements LimiterStorage {
  private sha: string | null = null;

  constructor(private readonly redis: Redis) {}

  /**
   * Pre-load the Lua script and cache its SHA.
   * Called automatically on the first `hit` if not yet done.
   */
  async bootstrap(): Promise<void> {
    this.sha = (await this.redis.script('LOAD', LUA)) as string;
  }

  /**
   * Atomically increment the counter for `key` and return the result.
   *
   * @param key       Redis key for this rate-limit bucket.
   * @param windowSec Expiry window in seconds, applied on the first hit.
   * @param max       Maximum allowed hits within the window.
   * @returns         Current count, whether the request is allowed, and when the window resets.
   */
  async hit(key: string, windowSec: number, max: number): Promise<HitResult> {
    if (!this.sha) await this.bootstrap();
    const [n, ttl] = await this.eval(key, windowSec);
    return {
      count: n,
      resetAt: Date.now() + Math.max(ttl, 0) * 1000,
      allowed: n <= max,
      limit: max,
    };
  }

  /** @throws if Redis returns an unexpected error. */
  private async eval(key: string, windowSec: number): Promise<[number, number]> {
    try {
      return (await this.redis.evalsha(this.sha!, 1, key, String(windowSec))) as [number, number];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('NOSCRIPT')) {
        await this.bootstrap();
        return (await this.redis.evalsha(this.sha!, 1, key, String(windowSec))) as [number, number];
      }
      throw err;
    }
  }
}
