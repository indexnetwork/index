import { describe, test, expect, beforeEach } from 'bun:test';
import { MemoryStorage } from '../storage.memory';

describe('MemoryStorage', () => {
  let s: MemoryStorage;
  beforeEach(() => { s = new MemoryStorage(); });

  test('increments and marks denied past max', async () => {
    const r1 = await s.hit('k', 60, 2);
    expect(r1).toMatchObject({ count: 1, allowed: true, limit: 2 });
    const r2 = await s.hit('k', 60, 2);
    expect(r2).toMatchObject({ count: 2, allowed: true });
    const r3 = await s.hit('k', 60, 2);
    expect(r3).toMatchObject({ count: 3, allowed: false });
  });

  test('separate keys have independent buckets', async () => {
    await s.hit('a', 60, 1);
    const r = await s.hit('b', 60, 1);
    expect(r).toMatchObject({ count: 1, allowed: true });
  });

  test('bucket resets after window expiry', async () => {
    await s.hit('k', 1, 1);  // 1-second window
    await Bun.sleep(1100);
    const r = await s.hit('k', 1, 1);
    expect(r).toMatchObject({ count: 1, allowed: true });
  });

  test('resetAt reports a future epoch ms', async () => {
    const r = await s.hit('k', 60, 5);
    expect(r.resetAt).toBeGreaterThan(Date.now());
    expect(r.resetAt).toBeLessThanOrEqual(Date.now() + 60_000);
  });
});
