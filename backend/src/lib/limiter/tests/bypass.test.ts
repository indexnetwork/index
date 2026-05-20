import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { RateLimit, getRateLimitInfo } from '../../../guards/limiter.guard';

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env = {
    ...originalEnv,
    RAILWAY_ENVIRONMENT: 'test',
    LIMITER_WRITE_PER_MIN: '1',
    LIMITER_READ_PER_MIN: '1',
  };
});
afterEach(() => { process.env = originalEnv; });

const req = (headers: Record<string, string> = {}): Request =>
  new Request('http://example.com/x', { headers });

describe('bypass rules', () => {
  test('private IPv4 (10.x) bypasses the limiter', async () => {
    process.env.LIMITER_WRITE_PER_MIN = '1';
    const guard = RateLimit('write');
    const r = req({ 'x-forwarded-for': '10.0.0.5' });
    for (let i = 0; i < 5; i++) await guard(r);
    expect(getRateLimitInfo(r)).toBeUndefined();
  });

  test('IPv6 link-local fe80::/10 bypasses', async () => {
    process.env.LIMITER_WRITE_PER_MIN = '1';
    const guard = RateLimit('write');
    const r = req({ 'x-forwarded-for': 'fe80::1' });
    for (let i = 0; i < 5; i++) await guard(r);
    expect(getRateLimitInfo(r)).toBeUndefined();
  });

  test('IPv6 ULA fc00::/7 bypasses', async () => {
    process.env.LIMITER_READ_PER_MIN = '1';
    const guard = RateLimit('read');
    const r = req({ 'x-forwarded-for': 'fc00::1' });
    for (let i = 0; i < 3; i++) await guard(r);
    expect(getRateLimitInfo(r)).toBeUndefined();
  });

  test("'unknown' (off-Railway local dev sentinel) bypasses", async () => {
    // When RAILWAY_ENVIRONMENT is unset, resolveClientIp falls through to the
    // socket peer path; with no server argument it returns 'unknown', which bypasses.
    process.env.RAILWAY_ENVIRONMENT = '';
    process.env.LIMITER_WRITE_PER_MIN = '1';
    const guard = RateLimit('write');
    const r = req({});
    for (let i = 0; i < 5; i++) await guard(r);
    expect(getRateLimitInfo(r)).toBeUndefined();
  });

  test("'unresolved' (on-Railway misconfig sentinel) does NOT bypass — gets rate-limited", async () => {
    // On Railway with no forwarded headers, resolveClientIp returns 'unresolved'.
    // The guard must NOT bypass it; it lands in the shared 'ip:unresolved' bucket.
    // Use a high limit so we don't accidentally exceed it (other tests may share the bucket).
    process.env.LIMITER_WRITE_PER_MIN = '1000';
    const guard = RateLimit('write');
    const r = req({});  // no IP headers → 'unresolved' on Railway
    // The call must succeed (not return early via bypass) and attach rate-limit info
    await guard(r);
    expect(getRateLimitInfo(r)).toBeDefined();
    expect(getRateLimitInfo(r)!.limit).toBe(1000);
  });
});
