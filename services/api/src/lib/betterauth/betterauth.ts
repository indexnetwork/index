import { betterAuth } from "better-auth";
import { magicLink, bearer, jwt, mcp, deviceAuthorization } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";

import { resolveClassConfig } from "../limiter/config";

export const API_URL =
  process.env.API_URL || `http://localhost:${process.env.PORT || 3001}`;

export const JWT_AUDIENCE = API_URL;

export const WEB_APP_URL = process.env.WEB_APP_URL || 'https://index.network';

/** Contract for the auth database adapter injected into createAuth. */
export interface AuthDbContract {
  /** Returns a configured adapter object for Better Auth's `database` option. */
  createDrizzleAdapter(): unknown;
}

/**
 * Better Auth's `secondaryStorage` contract — a generic KV used by the
 * library for rate-limit counters (when `rateLimit.storage` is set to
 * `'secondary-storage'`) and for any other secondary-storage needs.
 */
export interface AuthSecondaryStorage {
  get(key: string): Promise<string | null | undefined>;
  set(key: string, value: string, ttl?: number): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Dependencies injected into the Better Auth factory.
 * Keeps this lib module free of direct adapter/infrastructure imports.
 */
export interface AuthDeps {
  authDb: AuthDbContract;
  getTrustedOrigins: (req?: Request) => Promise<string[]> | string[];
  sendMagicLinkEmail: (email: string, url: string) => Promise<void>;
  /**
   * Backing store for Better Auth's rate-limit counters. When omitted (no
   * Redis configured), Better Auth falls back to its built-in in-memory
   * rate limiter — suitable for local dev, not for multi-instance prod.
   */
  secondaryStorage?: AuthSecondaryStorage;
}

/**
 * Creates a configured Better Auth instance.
 * All infrastructure access is provided through `deps` so this module
 * follows the project layering rules (lib receives adapters via injection).
 *
 * @remarks Email/password auth is disabled in production — only magic link
 * and social OAuth are available.
 */
export function createAuth(deps: AuthDeps) {
  const { authDb, getTrustedOrigins, sendMagicLinkEmail, secondaryStorage } = deps;

  // Snapshot auth_write config once so all customRules entries use a consistent
  // value (resolveClassConfig reads env vars on every call).
  const authWrite = resolveClassConfig("auth_write");
  const authWriteRule = { window: authWrite.windowSec, max: authWrite.perMinute };

  return betterAuth({
    baseURL: API_URL,
    database: authDb.createDrizzleAdapter(),
    basePath: "/api/auth",
    /**
     * Backing store for Better Auth's rate-limit counters. Injected via
     * AuthDeps so this lib module stays free of direct adapter imports.
     *
     * Better Auth v1.6+ resolves `rateLimit.storage = 'secondary-storage'`
     * against this top-level object (Pattern B in the rate-limiter plan).
     */
    secondaryStorage,
    session: {
      /**
       * Keep sessions in Postgres even when secondaryStorage is configured.
       * Without this, Better Auth silently migrates sessions to Redis on first
       * restart, logging out every existing user.
       */
      storeSessionInDatabase: true,
      /**
       * 30 days rather than the 7-day default. Native devices now hold a
       * session instead of a long-lived API key, and they cache the issued
       * expiry locally to decide whether to send a request at all, so a short
       * window would sign the Mac app out roughly weekly. Revocation is the
       * safety valve: a device can sign itself out and the owner can revoke any
       * device from settings.
       */
      expiresIn: 60 * 60 * 24 * 30,
    },
    rateLimit: {
      enabled: true,
      // Route through secondaryStorage only when one was injected; otherwise
      // Better Auth uses its built-in in-memory limiter (fine for local dev,
      // not multi-instance safe).
      ...(secondaryStorage ? { storage: "secondary-storage" as const } : {}),
      customRules: {
        "/sign-in/email":      authWriteRule,
        "/sign-up/email":      authWriteRule,
        "/sign-in/magic-link": authWriteRule,
        "/forget-password":    authWriteRule,
        "/reset-password":     authWriteRule,
        "/verify-email":       authWriteRule,
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
      // A key names a user and nothing else. `enableSessionForAPIKeys` stays at
      // its default of off, so create/list/delete need the owner's own session:
      // a leaked key acts as the user in the product but cannot mint a
      // successor. The plugin's own throttle is disabled — it defaults to 10
      // requests per key per day, and volume is already capped by the
      // `RateLimit` guards and the MCP tool limiter.
      apiKey({
        defaultKeyLength: 64,
        rateLimit: { enabled: false },
      }),
      // Native clients (Mac app, CLI, Hermes) sign in as devices, each holding
      // its own session rather than a shared long-lived key. `/cli-auth` runs
      // the whole grant server-side from the owner's browser session and hands
      // the device only the code, so there is no approval prompt and no
      // attacker-supplied code can enter the flow. The code is redeemed
      // immediately after the redirect, hence the short expiry.
      // `schema: {}` is required, not decorative: the plugin's option parser
      // declares `schema` without `.optional()`, so omitting it fails at boot.
      deviceAuthorization({
        expiresIn: "5m",
        interval: "1s",
        schema: {},
      }),
      jwt({
        jwt: {
          issuer: API_URL,
          audience: JWT_AUDIENCE,
          expirationTime: "1h",
          definePayload: ({ user }) => ({
            id: user.id,
            email: user.email,
            name: user.name,
          }),
        },
      }),
      mcp({
        loginPage: `${WEB_APP_URL}/login`,
        // No consentPage needed: the mcp() plugin skips consent automatically when the
        // authorization request does not include prompt=consent, which Claude Code never
        // sends. The flow goes: /mcp/authorize → session check → code → callback.
      }),
    ],
    advanced: {
      // Cookie attributes must match the scheme the API is actually served on.
      // `SameSite=None` requires `Secure`, and browsers drop Secure cookies set
      // over plain http — Chrome carves out localhost, Firefox does not, so an
      // unconditional `secure: true` makes local email/password login succeed
      // server-side while the browser silently discards the session cookie.
      defaultCookieAttributes: API_URL.startsWith("https")
        ? { sameSite: "none", secure: true }
        : { sameSite: "lax", secure: false },
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
  });
}
