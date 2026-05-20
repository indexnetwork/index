import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { resolveClientIp, sha256Truncated } from '../identifier';

const originalEnv = { ...process.env };
beforeEach(() => { process.env = { ...originalEnv, RAILWAY_ENVIRONMENT: 'production' }; });
afterEach(() => { process.env = originalEnv; });

const req = (headers: Record<string, string>): Request =>
  new Request('http://example.com/x', { headers });

describe('resolveClientIp (Railway env)', () => {
  test('picks x-envoy-external-address first', () => {
    const r = req({
      'x-envoy-external-address': '203.0.113.10',
      'x-forwarded-for': '198.51.100.1',
    });
    expect(resolveClientIp(r)).toBe('203.0.113.10');
  });

  test('falls back to first hop of x-forwarded-for', () => {
    const r = req({ 'x-forwarded-for': '198.51.100.1, 10.0.0.1' });
    expect(resolveClientIp(r)).toBe('198.51.100.1');
  });

  test('falls back to x-original-forwarded-for', () => {
    const r = req({ 'x-original-forwarded-for': '198.51.100.7' });
    expect(resolveClientIp(r)).toBe('198.51.100.7');
  });

  test('returns "unknown" when nothing parses', () => {
    expect(resolveClientIp(req({}))).toBe('unknown');
  });

  test('rejects malformed IP and tries the next header', () => {
    const r = req({
      'x-envoy-external-address': 'not-an-ip',
      'x-forwarded-for': '203.0.113.5',
    });
    expect(resolveClientIp(r)).toBe('203.0.113.5');
  });
});

describe('resolveClientIp (local dev, RAILWAY_ENVIRONMENT unset)', () => {
  beforeEach(() => { delete process.env.RAILWAY_ENVIRONMENT; });
  test('ignores forwarded headers; returns socket peer if available', () => {
    const r = req({ 'x-forwarded-for': '1.2.3.4' });
    const fakeServer = { requestIP: () => ({ address: '127.0.0.1', port: 0, family: 'IPv4' } as const) };
    expect(resolveClientIp(r, fakeServer)).toBe('127.0.0.1');
  });
});

describe('sha256Truncated', () => {
  test('produces 16-hex-char prefix', async () => {
    const h = await sha256Truncated('hello');
    expect(h).toMatch(/^[a-f0-9]{16}$/);
    expect(await sha256Truncated('hello')).toBe(h);
  });
});

describe('resolveIdentifier (smoke)', () => {
  test('x-api-key produces kind=apikey with hashed value', async () => {
    const { resolveIdentifier } = await import('../identifier');
    const r = new Request('http://example.com/x', {
      headers: { 'x-api-key': 'super-secret-key' },
    });
    const id = await resolveIdentifier(r);
    expect(id.kind).toBe('apikey');
    expect(id.value).toMatch(/^[a-f0-9]{16}$/);
    expect(id.value).not.toBe('super-secret-key');
  });

  test('session cookie produces kind=cookie with hashed value', async () => {
    const { resolveIdentifier } = await import('../identifier');
    const r = new Request('http://example.com/x', {
      headers: { cookie: 'other=foo; better-auth.session_token=abc-123-def' },
    });
    const id = await resolveIdentifier(r);
    expect(id.kind).toBe('cookie');
    expect(id.value).toMatch(/^[a-f0-9]{16}$/);
  });
});
