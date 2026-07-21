import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import Redis from 'ioredis';

import { RateLimit, getRateLimitInfo } from '../src/guards/limiter.guard';
import { RateLimiterError } from '../src/lib/limiter/error';
import { resolveRedisIntegrationTestUrl } from '../src/lib/redis/test-integration';

const ENV_KEYS = [
  'LIMITER_READ_PER_MIN',
  'LIMITER_DISABLE',
  'RAILWAY_ENVIRONMENT',
  'REDIS_URL',
] as const;
const originalEnv: Record<string, string | undefined> = Object.fromEntries(
  ENV_KEYS.map((key) => [key, process.env[key]]),
);
const redisUrl = resolveRedisIntegrationTestUrl();

process.env.LIMITER_READ_PER_MIN = '5';
process.env.LIMITER_DISABLE = '';
process.env.RAILWAY_ENVIRONMENT = 'test';
if (redisUrl) process.env.REDIS_URL = redisUrl;

let redisAvailable = false;
if (redisUrl) {
  const probe = new Redis(redisUrl, {
    connectTimeout: 3_000,
    lazyConnect: true,
    maxRetriesPerRequest: 1,
  });
  try {
    await probe.connect();
    await probe.ping();
    redisAvailable = true;
  } catch {
    throw new Error('[redis-test] Dedicated Redis integration target is unreachable.');
  } finally {
    await probe.quit().catch(() => undefined);
  }
}

let server: ReturnType<typeof Bun.serve>;
let baseUrl: string;

beforeAll(() => {
  if (!redisAvailable) return;
  const readGuard = RateLimit('read');
  server = Bun.serve({
    port: 0,
    async fetch(request) {
      try {
        await readGuard(request);
        const info = getRateLimitInfo(request);
        const headers: Record<string, string> = {};
        if (info) {
          headers['ratelimit-limit'] = String(info.limit);
          headers['ratelimit-remaining'] = String(info.remaining);
          headers['ratelimit-reset'] = String(
            Math.max(0, Math.ceil((info.resetAt - Date.now()) / 1000)),
          );
        }
        return Response.json({ ok: true }, { headers });
      } catch (error) {
        if (error instanceof RateLimiterError) {
          return new Response(error.toBody(), error.toResponseInit({}));
        }
        return new Response('error', { status: 500 });
      }
    },
  });
  baseUrl = `http://localhost:${server.port}`;
});

afterAll(() => {
  if (server) server.stop(true);
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe.if(redisAvailable)('limiter e2e', () => {
  test(
    'allows five requests and rate-limits the sixth',
    async () => {
      const ip = `203.0.113.${Math.floor(Math.random() * 254) + 1}`;
      const headers = { 'x-forwarded-for': ip };
      const results: Response[] = [];
      for (let index = 0; index < 6; index += 1) {
        results.push(await fetch(baseUrl, { headers }));
      }

      for (let index = 0; index < 5; index += 1) {
        expect(results[index].status).toBe(200);
        expect(results[index].headers.get('ratelimit-limit')).toBe('5');
        expect(results[index].headers.get('ratelimit-remaining')).toBe(String(4 - index));
      }

      expect(results[5].status).toBe(429);
      expect(results[5].headers.get('retry-after')).toMatch(/^\d+$/);
      expect(results[5].headers.get('ratelimit-limit')).toBe('5');
      expect(results[5].headers.get('ratelimit-remaining')).toBe('0');
      expect((await results[5].json()) as unknown).toMatchObject({
        code: 'RATE_LIMITED',
        class: 'read',
      });
    },
    10_000,
  );
});
