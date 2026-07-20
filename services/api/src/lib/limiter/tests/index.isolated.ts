import { afterAll, describe, expect, test } from 'bun:test';
import Redis from 'ioredis';

import { resolveRedisIntegrationTestUrl } from '../../redis/test-integration';

const originalRedisUrl = process.env.REDIS_URL;
const redisUrl = resolveRedisIntegrationTestUrl();
let redisAvailable = false;

if (redisUrl) {
  const probe = new Redis(redisUrl, {
    connectTimeout: 3_000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  try {
    await probe.connect();
    await probe.ping();
    redisAvailable = true;
  } catch {
    throw new Error('[redis-test] Dedicated Redis integration target is unreachable.');
  } finally {
    await probe.quit().catch(() => undefined);
  }
}

afterAll(() => {
  if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
  else process.env.REDIS_URL = originalRedisUrl;
});

describe('limiter selector', () => {
  // Module-level storagePromise is reset per test via the query-string cache
  // buster on the dynamic import.
  test('returns MemoryStorage when REDIS_URL missing', async () => {
    delete process.env.REDIS_URL;
    const { getStorage } = await import(`../index?cb=${Math.random()}`);
    const storage = await getStorage();
    expect(storage.constructor.name).toBe('MemoryStorage');
  });

  test.if(redisAvailable)('returns RedisStorage when explicitly opted in', async () => {
    process.env.REDIS_URL = redisUrl!;
    const { getStorage } = await import(`../index?cb=${Math.random()}`);
    const storage = await getStorage();
    expect(storage.constructor.name).toBe('RedisStorage');
  });

  test.if(redisAvailable)('caches a successful Redis storage instance', async () => {
    process.env.REDIS_URL = redisUrl!;
    const module = await import(`../index?cb=${Math.random()}`);
    const first = await module.getStorage();
    const second = await module.getStorage();
    expect(first).toBe(second);
    expect(first.constructor.name).toBe('RedisStorage');
  });
});
