import { describe, test, expect, beforeEach } from 'bun:test';
import { RateLimit, getRateLimitInfo } from '../../../guards/limiter.guard';
import { CLASS_CONFIG } from '../config';
import { RateLimiterError } from '../error';

const req = (headers: Record<string, string> = {}): Request =>
  new Request('http://example.com/x', { headers });

const uniqueIp = () => `203.0.113.${Math.floor(Math.random() * 254) + 1}`;

beforeEach(() => {
  process.env.RAILWAY_ENVIRONMENT = 'test';
});

describe('RateLimit guard', () => {
  test('allows under the limit, stashes header info', async () => {
    const guard = RateLimit('write');
    const r = req({ 'x-forwarded-for': uniqueIp() });
    await guard(r);
    const info = getRateLimitInfo(r);
    const limit = CLASS_CONFIG.write.perMinute;
    expect(info).toBeDefined();
    expect(info!.limit).toBe(limit);
    expect(info!.remaining).toBe(limit - 1);
  });

  test('throws RateLimiterError past the limit', async () => {
    process.env.RAILWAY_ENVIRONMENT = 'test';
    // The tightest class, so exhausting a real budget stays cheap.
    const guard = RateLimit('intake_synthesis');
    const ip = uniqueIp();
    const r = () => req({ 'x-forwarded-for': ip });
    for (let i = 0; i < CLASS_CONFIG.intake_synthesis.perMinute; i++) await guard(r());
    await expect(guard(r())).rejects.toBeInstanceOf(RateLimiterError);
  });

  test('private IP bypasses', async () => {
    process.env.RAILWAY_ENVIRONMENT = 'test';
    const guard = RateLimit('write');
    const r = req({ 'x-forwarded-for': '10.0.0.1' });
    await guard(r); await guard(r); await guard(r);
    expect(getRateLimitInfo(r)).toBeUndefined();
  });
});
