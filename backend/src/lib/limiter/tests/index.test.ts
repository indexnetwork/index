import { describe, test, expect, beforeEach } from 'bun:test';

describe('limiter selector', () => {
  beforeEach(() => {
    // reset module cache
    delete require.cache[require.resolve('../index')];
  });

  test('returns MemoryStorage when REDIS_URL missing', async () => {
    const prev = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    const { getStorage } = await import(`../index?cb=${Math.random()}`);
    const s = await getStorage();
    expect(s.constructor.name).toBe('MemoryStorage');
    if (prev) process.env.REDIS_URL = prev;
  });

  test('returns RedisStorage when REDIS_URL set', async () => {
    process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';
    const { getStorage } = await import(`../index?cb=${Math.random()}`);
    const s = await getStorage();
    expect(s.constructor.name).toBe('RedisStorage');
  });
});
