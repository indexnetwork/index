// Load env BEFORE imports that capture config at module load.
process.env.LIMITER_READ_PER_MIN = '5';
process.env.LIMITER_DISABLE = '';
process.env.RAILWAY_ENVIRONMENT = 'test';
process.env.REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';

import { RateLimit, getRateLimitInfo } from '../src/guards/limiter.guard';
import { RateLimiterError } from '../src/lib/limiter/error';

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
  const readGuard = RateLimit('read');
  server = Bun.serve({
    port: 0,
    async fetch(req) {
      try {
        await readGuard(req);
        const info = getRateLimitInfo(req);
        const headers: Record<string, string> = {};
        if (info) {
          headers['ratelimit-limit'] = String(info.limit);
          headers['ratelimit-remaining'] = String(info.remaining);
          headers['ratelimit-reset'] = String(
            Math.max(0, Math.ceil((info.resetAt - Date.now()) / 1000)),
          );
        }
        return Response.json({ ok: true }, { headers });
      } catch (err) {
        if (err instanceof RateLimiterError) {
          return new Response(err.toBody(), err.toResponseInit({}));
        }
        return new Response('error', { status: 500 });
      }
    },
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  server.stop(true);
});

describe('limiter e2e', () => {
  test(
    'burst: first 5 allowed with descending remaining, 6th is 429 with retry-after',
    async () => {
      // Use TEST-NET-3 (203.0.113.x) — globally routable, never private/loopback.
      const ip = `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
      const headers = { 'x-forwarded-for': ip };

      const results: Response[] = [];
      for (let i = 0; i < 6; i++) {
        results.push(await fetch(baseUrl, { headers }));
      }

      // First 5: allowed with descending remaining (4, 3, 2, 1, 0).
      for (let i = 0; i < 5; i++) {
        expect(results[i].status).toBe(200);
        expect(results[i].headers.get('ratelimit-limit')).toBe('5');
        expect(results[i].headers.get('ratelimit-remaining')).toBe(String(4 - i));
      }

      // 6th: denied.
      expect(results[5].status).toBe(429);
      expect(results[5].headers.get('retry-after')).toMatch(/^\d+$/);
      expect(results[5].headers.get('ratelimit-limit')).toBe('5');
      expect(results[5].headers.get('ratelimit-remaining')).toBe('0');

      const body = (await results[5].json()) as unknown;
      expect(body).toMatchObject({ code: 'RATE_LIMITED', class: 'read' });
    },
    10_000,
  );
});
