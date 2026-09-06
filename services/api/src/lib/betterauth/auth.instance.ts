import { AuthDatabaseAdapter } from '../../adapters/auth.adapter';
import { getRedisClient } from '../../adapters/cache.adapter';
import { getTrustedOrigins } from '../cors';
import { sendMagicLinkEmail } from '../email/magic-link.handler';
import { isRedisConfigured } from '../redis-env';

import { createAuth, type AuthSecondaryStorage } from './betterauth';

const authDb = new AuthDatabaseAdapter();

/**
 * Shared Redis secondary storage. Only constructed when Redis is actually
 * configured; otherwise Better Auth uses its built-in in-memory store.
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
