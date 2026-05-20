import { describe, test, expect, beforeEach } from 'bun:test';
import { RateLimit, getRateLimitInfo } from '../../../guards/limiter.guard';
import { RateLimiterError } from '../error';

const req = (headers: Record<string, string> = {}): Request =>
  new Request('http://example.com/x', { headers });

const uniqueIp = () => `203.0.113.${Math.floor(Math.random() * 254) + 1}`;

beforeEach(() => {
  process.env.LIMITER_DISABLE = '';
  process.env.RAILWAY_ENVIRONMENT = 'test';
});

describe('RateLimit guard', () => {
  test('allows under the limit, stashes header info', async () => {
    process.env.LIMITER_WRITE_PER_MIN = '5';
    const guard = RateLimit('write');
    const r = req({ 'x-forwarded-for': uniqueIp() });
    await guard(r);
    const info = getRateLimitInfo(r);
    expect(info).toBeDefined();
    expect(info!.limit).toBe(5);
    expect(info!.remaining).toBe(4);
  });

  test('throws RateLimiterError past the limit', async () => {
    process.env.LIMITER_READ_PER_MIN = '2';
    process.env.RAILWAY_ENVIRONMENT = 'test';
    const guard = RateLimit('read');
    const ip = uniqueIp();
    const r = () => req({ 'x-forwarded-for': ip });
    await guard(r());
    await guard(r());
    await expect(guard(r())).rejects.toBeInstanceOf(RateLimiterError);
  });

  test('LIMITER_DISABLE skips everything', async () => {
    process.env.LIMITER_DISABLE = '1';
    const guard = RateLimit('write');
    for (let i = 0; i < 10_000; i++) await guard(req({}));
    // no throw, no info attached
    expect(getRateLimitInfo(req({}))).toBeUndefined();
  });

  test('private IP bypasses', async () => {
    process.env.LIMITER_WRITE_PER_MIN = '1';
    process.env.RAILWAY_ENVIRONMENT = 'test';
    const guard = RateLimit('write');
    const r = req({ 'x-forwarded-for': '10.0.0.1' });
    await guard(r); await guard(r); await guard(r);
    expect(getRateLimitInfo(r)).toBeUndefined();
  });
});
