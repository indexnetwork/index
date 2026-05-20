import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import Redis from 'ioredis';
import { RedisStorage } from '../storage.redis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
let redis: Redis;
let s: RedisStorage;

beforeAll(async () => {
  redis = new Redis(REDIS_URL, { lazyConnect: true });
  await redis.connect();
  s = new RedisStorage(redis);
  await s.bootstrap();
});

afterAll(async () => {
  await redis.quit();
});

const k = (suffix: string) => `limiter-test:${Date.now()}:${suffix}:${Math.random()}`;

describe('RedisStorage', () => {
  test('increments, denies past max', async () => {
    const key = k('increments');
    const r1 = await s.hit(key, 60, 2);
    expect(r1).toMatchObject({ count: 1, allowed: true, limit: 2 });
    await s.hit(key, 60, 2);
    const r3 = await s.hit(key, 60, 2);
    expect(r3).toMatchObject({ count: 3, allowed: false });
  });

  test('TTL set on first hit', async () => {
    const key = k('ttl');
    await s.hit(key, 30, 5);
    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(30);
  });

  test('NOSCRIPT recovery: works after SCRIPT FLUSH', async () => {
    const key = k('noscript');
    await s.hit(key, 60, 10);
    await redis.script('FLUSH');
    const r = await s.hit(key, 60, 10);
    expect(r.count).toBe(2);
  });

  test('resetAt is a future epoch ms', async () => {
    const key = k('reset');
    const r = await s.hit(key, 60, 10);
    expect(r.resetAt).toBeGreaterThan(Date.now());
    expect(r.resetAt).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});
