/**
 * Redis implementation of the Cache interface.
 * Used for HyDE document caching and opportunity graph.
 */

import Redis from 'ioredis';

import { log } from '../lib/log';

// ─────────────────────────────────────────────────────────────────────────────
// Local types (structurally aligned with lib/protocol/interfaces/cache.interface)
// ─────────────────────────────────────────────────────────────────────────────

/** Options for cache set operations. */
export interface CacheOptions {
  /** TTL in seconds */
  ttl?: number;
}

/** Cache interface implemented by this adapter. */
export interface Cache {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, options?: CacheOptions): Promise<void>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  mget<T>(keys: string[]): Promise<(T | null)[]>;
  deleteByPattern(pattern: string): Promise<number>;
}

const logger = log.lib.from("cache.adapter");

/* ------------------------------------------------------------------ */
/*  Shared Redis singleton                                            */
/* ------------------------------------------------------------------ */

let redis: Redis | null = null;

/**
 * Get the shared Redis client for general caching/operations.
 * Uses lazyConnect for efficiency in the main client.
 */
export function getRedisClient(): Redis {
  if (!redis) {
    // Use REDIS_URL if available, otherwise fall back to individual env vars
    const redisUrl = process.env.REDIS_URL;

    if (redisUrl) {
      redis = new Redis(redisUrl, {
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });
    } else {
      redis = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379'),
        password: process.env.REDIS_PASSWORD,
        db: parseInt(process.env.REDIS_DB || '0'),
        maxRetriesPerRequest: 3,
        lazyConnect: true
      });
    }

    redis.on('error', (err: Error) => {
      logger.error('Redis error', { error: err.message });
    });

    redis.on('connect', () => {
      logger.info('Redis connected');
    });
  }

  return redis;
}

// Re-export the canonical side-effect-free detector so existing callers of
// `cache.adapter#isRedisConfigured` keep working without pulling the heavy
// adapter side effects into modules that just want to ask "is Redis set?".
export { isRedisConfigured } from '../lib/redis-env';

/**
 * Creates a new, dedicated Redis client (e.g. for pub/sub subscribers).
 * Uses the same connection config as the shared client but without lazyConnect.
 */
export function createRedisClient(): Redis {
  const redisUrl = process.env.REDIS_URL;
  let client: Redis;
  if (redisUrl) {
    client = new Redis(redisUrl, { maxRetriesPerRequest: 3 });
  } else {
    client = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0'),
      maxRetriesPerRequest: 3,
    });
  }

  client.on('error', (err: Error) => {
    logger.error('Redis client error', { error: err.message });
  });

  return client;
}

/**
 * Close the shared Redis connection and reset the singleton.
 */
export async function closeRedisConnection(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
  }
}

/* ------------------------------------------------------------------ */
/*  Cache adapter                                                     */
/* ------------------------------------------------------------------ */

const KEY_PREFIX = 'protocol:';

function fullKey(key: string): string {
  return key.startsWith(KEY_PREFIX) ? key : `${KEY_PREFIX}${key}`;
}

/**
 * Redis-backed cache adapter implementing the protocol Cache interface.
 * Values are JSON-serialized; TTL is supported per key.
 */
export class RedisCacheAdapter implements Cache {
  private redis = getRedisClient();

  async get<T>(key: string): Promise<T | null> {
    const k = fullKey(key);
    try {
      const raw = await this.redis.get(k);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, options?: CacheOptions): Promise<void> {
    const k = fullKey(key);
    const raw = JSON.stringify(value);
    if (options?.ttl != null && options.ttl > 0) {
      await this.redis.setex(k, options.ttl, raw);
    } else {
      await this.redis.set(k, raw);
    }
  }

  async delete(key: string): Promise<boolean> {
    const k = fullKey(key);
    const n = await this.redis.del(k);
    return n > 0;
  }

  async exists(key: string): Promise<boolean> {
    const k = fullKey(key);
    const n = await this.redis.exists(k);
    return n === 1;
  }

  async mget<T>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];
    const fullKeys = keys.map(fullKey);
    const rawList = await this.redis.mget(...fullKeys);
    return rawList.map((raw) => (raw === null ? null : (JSON.parse(raw) as T)));
  }

  async deleteByPattern(pattern: string): Promise<number> {
    const fullPattern = fullKey(pattern);
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [nextCursor, batch] = await this.redis.scan(
        cursor,
        'MATCH',
        fullPattern,
        'COUNT',
        100
      );
      cursor = nextCursor;
      keys.push(...batch);
    } while (cursor !== '0');
    if (keys.length === 0) return 0;
    await this.redis.del(...keys);
    return keys.length;
  }
}

/**
 * Singleton instance of RedisCacheAdapter for general protocol caching.
 */
export const cacheAdapter = new RedisCacheAdapter();

/**
 * Singleton instance of RedisCacheAdapter for HyDE document caching.
 */
export const hydeCacheAdapter = new RedisCacheAdapter();
