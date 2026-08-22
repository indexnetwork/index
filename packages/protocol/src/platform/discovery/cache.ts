/**
 * Cache interface for protocol layer (HyDE, opportunities).
 * Implementations live in src/adapters (e.g. Redis).
 */

export interface CacheOptions {
  /** TTL in seconds */
  ttl?: number;
}

export interface Cache {
  /**
   * Get a cached value by key.
   * @returns The cached value or null if not found/expired
   */
  get<T>(key: string): Promise<T | null>;

  /**
   * Set a value in cache with optional TTL.
   */
  set<T>(key: string, value: T, options?: CacheOptions): Promise<void>;

  /**
   * Delete a cached value.
   * @returns true if the key existed and was removed
   */
  delete(key: string): Promise<boolean>;

  /**
   * Check if a key exists in cache.
   */
  exists(key: string): Promise<boolean>;

  /**
   * Get multiple values by keys.
   * @returns Array of values in same order as keys; null for missing/expired
   */
  mget<T>(keys: string[]): Promise<(T | null)[]>;

  /**
   * Delete all keys matching pattern (e.g. "hyde:intent:*").
   * @returns Number of keys deleted
   */
  deleteByPattern(pattern: string): Promise<number>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NARROWED CACHE INTERFACES
// ═══════════════════════════════════════════════════════════════════════════════

/** Cache interface for HyDE Graph operations. */
export type HydeCache = Pick<Cache, 'get' | 'set' | 'delete' | 'exists'>;

/** Cache interface for Opportunity Graph operations. */
export type OpportunityCache = Pick<Cache, 'get' | 'set' | 'mget'>;
