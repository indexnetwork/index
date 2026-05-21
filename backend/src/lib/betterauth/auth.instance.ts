import { AuthDatabaseAdapter } from '../../adapters/auth.adapter';
import { getRedisClient, isRedisConfigured } from '../../adapters/cache.adapter';
import { getTrustedOrigins } from '../cors';
import { sendMagicLinkEmail } from '../email/magic-link.handler';

import { createAuth, type AuthSecondaryStorage } from './betterauth';

const authDb = new AuthDatabaseAdapter();

/**
 * Shared Redis secondary storage — used by Better Auth's rateLimit block so
 * auth-endpoint throttling shares the same Redis instance as the app-level
 * rate limiter (keyspace prefix: 'better-auth:'). Only constructed when Redis
 * is actually configured; otherwise Better Auth falls back to its built-in
 * in-memory rate limiter (fine for local dev).
 */
const secondaryStorage: AuthSecondaryStorage | undefined = isRedisConfigured()
  ? {
      async get(key) {
        const redis = getRedisClient();
        return redis.get(`better-auth:${key}`);
      },
      async set(key, value, ttl) {
        const redis = getRedisClient();
        if (ttl != null && ttl > 0) {
          await redis.setex(`better-auth:${key}`, ttl, value);
        } else {
          // Better Auth occasionally writes keys without a TTL; cap at 30 days
          // to prevent unbounded Redis growth.
          await redis.setex(`better-auth:${key}`, 60 * 60 * 24 * 30, value);
        }
      },
      async delete(key) {
        const redis = getRedisClient();
        await redis.del(`better-auth:${key}`);
      },
    }
  : undefined;

export const auth = createAuth({
  authDb,
  getTrustedOrigins,
  sendMagicLinkEmail,
  secondaryStorage,
});
