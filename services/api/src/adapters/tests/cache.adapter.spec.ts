/**
 * Unit tests for RedisCacheAdapter (Cache interface implementation).
 * Requires Redis to be available (e.g. localhost:6379). Run with Redis up to exercise the adapter.
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { getRedisClient } from '../cache.adapter';
import { RedisCacheAdapter } from '../cache.adapter';

const KEY_PREFIX = 'protocol:';

const TEST_PREFIX = 'test:cache:' + Date.now() + ':';

describe('RedisCacheAdapter', () => {
  let cache: RedisCacheAdapter;

  beforeAll(() => {
    cache = new RedisCacheAdapter();
  });

  afterAll(async () => {
    await cache.deleteByPattern(TEST_PREFIX + '*');
  });

  describe('set → get → delete cycle', () => {
    it('should set value, get it back, then delete and get null', async () => {
      const key = TEST_PREFIX + 'cycle:1';
      const value = { foo: 'bar', count: 42 };

      await cache.set(key, value);
      const got = await cache.get<typeof value>(key);
      expect(got).not.toBeNull();
      expect(got?.foo).toBe('bar');
      expect(got?.count).toBe(42);

      const existed = await cache.delete(key);
      expect(existed).toBe(true);

      const afterDelete = await cache.get(key);
      expect(afterDelete).toBeNull();

      const deleteAgain = await cache.delete(key);
      expect(deleteAgain).toBe(false);
    });

    it('should support TTL option', async () => {
      const key = TEST_PREFIX + 'ttl:1';
      await cache.set(key, { x: 1 }, { ttl: 1 });
      expect(await cache.get(key)).not.toBeNull();
      expect(await cache.exists(key)).toBe(true);
      await new Promise((r) => setTimeout(r, 1100));
      expect(await cache.get(key)).toBeNull();
      await cache.delete(key);
    });
  });

  describe('mget', () => {
    it('should return values for multiple keys in order', async () => {
      const k1 = TEST_PREFIX + 'mget:a';
      const k2 = TEST_PREFIX + 'mget:b';
      const k3 = TEST_PREFIX + 'mget:c';
      await cache.set(k1, { id: 'a' });
      await cache.set(k2, { id: 'b' });
      await cache.set(k3, { id: 'c' });

      const results = await cache.mget<{ id: string }>([k1, k2, k3]);
      expect(results).toHaveLength(3);
      expect(results[0]?.id).toBe('a');
      expect(results[1]?.id).toBe('b');
      expect(results[2]?.id).toBe('c');

      await cache.delete(k1);
      await cache.delete(k2);
      await cache.delete(k3);
    });

    it('should return null for missing keys', async () => {
      const k1 = TEST_PREFIX + 'mget:hit';
      const k2 = TEST_PREFIX + 'mget:missing';
      await cache.set(k1, { v: 1 });

      const results = await cache.mget<{ v: number }>([k1, k2]);
      expect(results[0]?.v).toBe(1);
      expect(results[1]).toBeNull();

      await cache.delete(k1);
    });

    it('should return empty array for empty keys', async () => {
      const results = await cache.mget<string>([]);
      expect(results).toEqual([]);
    });
  });

  describe('deleteByPattern', () => {
    it('should clear all keys matching pattern', async () => {
      const base = TEST_PREFIX + 'pattern:';
      await cache.set(base + '1', { x: 1 });
      await cache.set(base + '2', { x: 2 });
      await cache.set(base + '3', { x: 3 });

      expect(await cache.exists(base + '1')).toBe(true);
      expect(await cache.exists(base + '2')).toBe(true);
      expect(await cache.exists(base + '3')).toBe(true);

      const deleted = await cache.deleteByPattern(base + '*');
      expect(deleted).toBe(3);

      expect(await cache.get(base + '1')).toBeNull();
      expect(await cache.get(base + '2')).toBeNull();
      expect(await cache.get(base + '3')).toBeNull();
    });

    it('should return 0 when no keys match', async () => {
      const deleted = await cache.deleteByPattern(TEST_PREFIX + 'nomatch:xyz:*');
      expect(deleted).toBe(0);
    });
  });

  describe('key prefix', () => {
    it('should round-trip value for key that already starts with protocol:', async () => {
      const prefixedKey = KEY_PREFIX + TEST_PREFIX + 'prefixed:1';
      const value = { prefixed: true };
      await cache.set(prefixedKey, value);
      const got = await cache.get<typeof value>(prefixedKey);
      expect(got).not.toBeNull();
      expect(got?.prefixed).toBe(true);
      await cache.delete(prefixedKey);
    });
  });

  describe('get on invalid JSON', () => {
    it('should return null when stored value is not valid JSON', async () => {
      const key = TEST_PREFIX + 'invalid:json:1';
      const redis = getRedisClient();
      const fullKey = key.startsWith(KEY_PREFIX) ? key : KEY_PREFIX + key;
      await redis.set(fullKey, 'not valid json {');
      const got = await cache.get(key);
      expect(got).toBeNull();
      await redis.del(fullKey);
    });
  });
});
