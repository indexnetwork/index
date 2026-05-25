import { describe, test, expect, beforeEach, afterEach } from 'bun:test';

describe('limiter config', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => { process.env = { ...originalEnv }; });
  afterEach(() => { process.env = originalEnv; });

  test('defaults match spec', async () => {
    delete process.env.LIMITER_READ_PER_MIN;
    delete process.env.LIMITER_WRITE_PER_MIN;
    delete process.env.LIMITER_AUTH_WRITE_PER_MIN;
    const { CLASS_CONFIG } = await import(`../config?cb=${Math.random()}`);
    expect(CLASS_CONFIG.read.perMinute).toBe(120);
    expect(CLASS_CONFIG.write.perMinute).toBe(60);
    expect(CLASS_CONFIG.auth_write.perMinute).toBe(10);
  });

  test('env vars override defaults', async () => {
    process.env.LIMITER_READ_PER_MIN = '300';
    const { resolveClassConfig } = await import(`../config?cb=${Math.random()}`);
    expect(resolveClassConfig('read').perMinute).toBe(300);
  });

  test('LIMITER_DISABLE flag', async () => {
    process.env.LIMITER_DISABLE = '1';
    const { isLimiterDisabled } = await import(`../config?cb=${Math.random()}`);
    expect(isLimiterDisabled()).toBe(true);
  });
});
