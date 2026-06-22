import { describe, test, expect } from 'bun:test';
import Redis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

// Probe Redis at module load — Redis-path assertions are skipped when no
// Redis is reachable. The Memory-path test runs unconditionally.
const redisUp = await (async () => {
  const probe = new Redis(REDIS_URL, { lazyConnect: true, maxRetriesPerRequest: 1 });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    try { await probe.quit(); } catch { /* ignore */ }
  }
})();

if (!redisUp) {
  console.log(`[limiter index.test] SKIP Redis-path tests — Redis not reachable at ${REDIS_URL}`);
}

describe('limiter selector', () => {
  // Module-level `storagePromise` is reset per-test via the `?cb=` query-string
  // cache buster on the dynamic import — each test gets a fresh module instance.

  test('returns MemoryStorage when REDIS_URL missing', async () => {
    const prev = process.env.REDIS_URL;
    delete process.env.REDIS_URL;
    const { getStorage } = await import(`../index?cb=${Math.random()}`);
    const s = await getStorage();
    expect(s.constructor.name).toBe('MemoryStorage');
    if (prev) process.env.REDIS_URL = prev;
  });

  test.if(redisUp)('returns RedisStorage when REDIS_URL set', async () => {
    process.env.REDIS_URL = REDIS_URL;
    const { getStorage } = await import(`../index?cb=${Math.random()}`);
    const s = await getStorage();
    expect(s.constructor.name).toBe('RedisStorage');
  });

  test.if(redisUp)('successive calls share the same storage instance (promise cached on success)', async () => {
    // Verifies the happy-path side of the retry fix: when init() succeeds, the promise
    // is kept cached so we get the same instance on subsequent calls.
    process.env.REDIS_URL = REDIS_URL;
    const mod = await import(`../index?cb=${Math.random()}`);
    const s1 = await mod.getStorage();
    const s2 = await mod.getStorage();
    // Both calls resolve to the same storage instance — no double-init
    expect(s1).toBe(s2);
    expect(s1.constructor.name).toBe('RedisStorage');
  });
});
