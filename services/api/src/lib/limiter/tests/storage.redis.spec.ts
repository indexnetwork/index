import { afterAll, beforeAll, describe, expect, mock, test } from 'bun:test';
import Redis from 'ioredis';

import { resolveRedisIntegrationTestUrl } from '../../redis/test-integration';
import { RedisStorage } from '../storage.redis';

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

let redis: Redis;
let storage: RedisStorage;

beforeAll(async () => {
  if (!redisAvailable || !redisUrl) return;
  redis = new Redis(redisUrl, { lazyConnect: true });
  await redis.connect();
  storage = new RedisStorage(redis);
  await storage.bootstrap();
});

afterAll(async () => {
  await redis?.quit();
});

const key = (suffix: string) => `limiter-test:${Date.now()}:${suffix}:${Math.random()}`;

describe('RedisStorage hermetic contracts', () => {
  test('reloads and retries exactly once after NOSCRIPT without flushing a server', async () => {
    let evalCalls = 0;
    const fakeRedis = {
      script: mock(async () => `sha-${evalCalls + 1}`),
      evalsha: mock(async () => {
        evalCalls += 1;
        if (evalCalls === 1) throw new Error('NOSCRIPT missing script');
        return [2, 60];
      }),
    };
    const fakeStorage = new RedisStorage(fakeRedis as never);

    const result = await fakeStorage.hit('key', 60, 10);

    expect(result).toMatchObject({ count: 2, allowed: true, limit: 10 });
    expect(fakeRedis.script).toHaveBeenCalledTimes(2);
    expect(fakeRedis.evalsha).toHaveBeenCalledTimes(2);
  });
});

describe.if(redisAvailable)('RedisStorage integration', () => {
  test('increments and denies past max', async () => {
    const testKey = key('increments');
    const first = await storage.hit(testKey, 60, 2);
    expect(first).toMatchObject({ count: 1, allowed: true, limit: 2 });
    await storage.hit(testKey, 60, 2);
    const third = await storage.hit(testKey, 60, 2);
    expect(third).toMatchObject({ count: 3, allowed: false });
  });

  test('sets TTL on first hit', async () => {
    const testKey = key('ttl');
    await storage.hit(testKey, 30, 5);
    const ttl = await redis.ttl(testKey);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  test('returns a future reset timestamp', async () => {
    const testKey = key('reset');
    const result = await storage.hit(testKey, 60, 10);
    expect(result.resetAt).toBeGreaterThan(Date.now());
    expect(result.resetAt).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});
