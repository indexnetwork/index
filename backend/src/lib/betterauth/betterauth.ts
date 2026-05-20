import { betterAuth } from "better-auth";
import { magicLink, bearer, jwt, mcp } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";

import { log } from "../log";
import { getRedisClient } from "../../adapters/cache.adapter";
import { resolveClassConfig } from "../limiter/config";

const logger = log.server.from("betterauth");

export const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

export const JWT_AUDIENCE = BASE_URL;

export const APP_URL =
  process.env.FRONTEND_URL || process.env.APP_URL || 'https://index.network';

/** Contract for the auth database adapter injected into createAuth. */
export interface AuthDbContract {
  /** Returns a configured adapter object for Better Auth's `database` option. */
  createDrizzleAdapter(): unknown;
  ensurePersonalNetwork(userId: string): Promise<string>;
  /** Flips isGhost to false for the given user. No-op if already non-ghost. */
  claimGhostUser(userId: string): Promise<void>;
}

/**
 * Dependencies injected into the Better Auth factory.
 * Keeps this lib module free of direct adapter/infrastructure imports.
 */
export interface AuthDeps {
  authDb: AuthDbContract;
  getTrustedOrigins: (req?: Request) => Promise<string[]> | string[];
  sendMagicLinkEmail: (email: string, url: string) => Promise<void>;
}

/**
 * Creates a configured Better Auth instance.
 * All infrastructure access is provided through `deps` so this module
 * follows the project layering rules (lib receives adapters via injection).
 *
 * @remarks Email/password auth is disabled in production — only magic link
 * and social OAuth are available. Ghost user de-ghosting is handled by the
 * session.create.after hook which calls `claimGhostUser` on every login.
 * The adapter-level ON CONFLICT upsert in `createDrizzleAdapter` remains
 * as a dev-only fallback for email/password signups.
 */
export function createAuth(deps: AuthDeps) {
  const { authDb, getTrustedOrigins, sendMagicLinkEmail } = deps;

  return betterAuth({
    baseURL: BASE_URL,
    database: authDb.createDrizzleAdapter(),
    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            try {
              await authDb.claimGhostUser(session.userId);
            } catch (err) {
              logger.error('Failed to claim ghost user on sign-in', { userId: session.userId, error: err });
            }
            try {
              await authDb.ensurePersonalNetwork(session.userId);
            } catch (err) {
              logger.error('Failed to ensure personal index on sign-in', { userId: session.userId, error: err });
            }
          },
        },
      },
      user: {
        create: {
          after: async (user) => {
            try {
              await authDb.ensurePersonalNetwork(user.id);
            } catch (err) {
              logger.error('Failed to create personal index on registration', { userId: user.id, error: err });
            }
          },
        },
      },
    },
    basePath: "/api/auth",
    /**
     * Shared Redis secondary storage — used by the rateLimit block below so
     * Better Auth's auth-endpoint throttling shares the same Redis instance as
     * the app-level rate limiter (keyspace prefix: 'better-auth:').
     *
     * Better Auth v1.6+ resolves `rateLimit.storage = 'secondary-storage'`
     * against this top-level object (Pattern B in the rate-limiter plan).
     * The `set` value is always a JSON string when Better Auth writes rate-limit
     * state; `get` must return a string (or null/undefined) — Better Auth
     * JSON.parses it internally.
     */
    secondaryStorage: {
      get: async (key: string) => {
        const redis = getRedisClient();
        return redis.get(`better-auth:${key}`);
      },
      set: async (key: string, value: string, ttl?: number) => {
        const redis = getRedisClient();
        if (ttl != null && ttl > 0) {
          await redis.setex(`better-auth:${key}`, ttl, value);
        } else {
          await redis.set(`better-auth:${key}`, value);
        }
      },
      delete: async (key: string) => {
        const redis = getRedisClient();
        await redis.del(`better-auth:${key}`);
      },
    },
    rateLimit: {
      enabled: true,
      storage: "secondary-storage",
      customRules: {
        "/sign-in/email":      { window: resolveClassConfig("auth_write").windowSec, max: resolveClassConfig("auth_write").perMinute },
        "/sign-up/email":      { window: resolveClassConfig("auth_write").windowSec, max: resolveClassConfig("auth_write").perMinute },
        "/sign-in/magic-link": { window: resolveClassConfig("auth_write").windowSec, max: resolveClassConfig("auth_write").perMinute },
        "/forget-password":    { window: resolveClassConfig("auth_write").windowSec, max: resolveClassConfig("auth_write").perMinute },
        "/reset-password":     { window: resolveClassConfig("auth_write").windowSec, max: resolveClassConfig("auth_write").perMinute },
        "/verify-email":       { window: resolveClassConfig("auth_write").windowSec, max: resolveClassConfig("auth_write").perMinute },
      },
    },
    emailAndPassword: { enabled: process.env.NODE_ENV !== 'production' },
    user: {
      fields: {
        image: "avatar",
      },
    },
    socialProviders: {
      ...(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? {
            google: {
              clientId: process.env.GOOGLE_CLIENT_ID,
              clientSecret: process.env.GOOGLE_CLIENT_SECRET,
            },
          }
        : {}),
    },
    trustedOrigins: getTrustedOrigins,
    plugins: [
      magicLink({
        sendMagicLink: async ({ email, url }) => {
          await sendMagicLinkEmail(email, url);
        },
        expiresIn: 600,
      }),
      bearer(),
      jwt({
        jwt: {
          issuer: BASE_URL,
          audience: JWT_AUDIENCE,
          expirationTime: "1h",
          definePayload: ({ user }) => ({
            id: user.id,
            email: user.email,
            name: user.name,
          }),
        },
      }),
      // Cast needed: @better-auth/core version mismatch between plugins (1.5.6) and
      // root lockfile (1.4.18) causes incompatible Plugin types. Runtime is fine.
      apiKey({
        enableSessionForAPIKeys: true,
        enableMetadata: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
      mcp({
        loginPage: `${APP_URL}/login`,
        // No consentPage needed: the mcp() plugin skips consent automatically when the
        // authorization request does not include prompt=consent, which Claude Code never
        // sends. The flow goes: /mcp/authorize → session check → code → callback.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    ],
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
      },
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
  });
}
