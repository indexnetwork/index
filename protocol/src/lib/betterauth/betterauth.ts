import { betterAuth } from "better-auth";
import { magicLink, bearer, jwt } from "better-auth/plugins";

import { log } from "../log";

const logger = log.server.from("betterauth");

export const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

/** Contract for the auth database adapter injected into createAuth. */
export interface AuthDbContract {
  /** Returns a configured adapter object for Better Auth's `database` option. */
  createDrizzleAdapter(): unknown;
  prepareGhostClaim(email: string): Promise<string | null>;
  claimGhostUser(realUserId: string, ghostId: string): Promise<void>;
  restoreGhostEmail(ghostId: string, email: string): Promise<void>;
}

/**
 * Dependencies injected into the Better Auth factory.
 * Keeps this lib module free of direct adapter/infrastructure imports.
 */
export interface AuthDeps {
  authDb: AuthDbContract;
  getTrustedOrigins: (req?: Request) => Promise<string[]> | string[];
  sendMagicLinkEmail: (email: string, url: string) => Promise<void>;
  ensureWallet?: (userId: string) => Promise<void>;
}

/**
 * Creates a configured Better Auth instance.
 * All infrastructure access is provided through `deps` so this module
 * follows the project layering rules (lib receives adapters via injection).
 */
export function createAuth(deps: AuthDeps) {
  const { authDb, getTrustedOrigins, sendMagicLinkEmail, ensureWallet } = deps;

  /**
   * Tracks ghost IDs that were freed in `create.before` so `create.after` can claim them.
   * Keyed by the new real user's ID to avoid races between concurrent signups.
   */
  const pendingGhostClaims = new Map<string, string>();

  return betterAuth({
    baseURL: BASE_URL,
    database: authDb.createDrizzleAdapter(),
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            // Free the ghost's email before Better Auth inserts the real user,
            // otherwise the unique constraint on users.email blocks signup.
            try {
              const ghostId = await authDb.prepareGhostClaim(user.email);
              if (ghostId) {
                pendingGhostClaims.set(user.id, ghostId);
              }
            } catch (err) {
              logger.error('Failed to prepare ghost claim', { email: user.email.replace(/(.{2}).+(@.+)/, '$1***$2'), error: err });
            }
            return { data: user };
          },
          after: async (user) => {
            try {
              if (ensureWallet) await ensureWallet(user.id);
            } catch (_) { /* wallet generation failure shouldn't block registration */ }

            const ghostId = pendingGhostClaims.get(user.id);
            if (ghostId) {
              try {
                await authDb.claimGhostUser(user.id, ghostId);
                pendingGhostClaims.delete(user.id);
              } catch (err) {
                // Restore ghost email so the ghost row isn't orphaned with a placeholder email
                try {
                  await authDb.restoreGhostEmail(ghostId, user.email);
                } catch (restoreErr) {
                  logger.error('Failed to restore ghost email after claim failure', { ghostId, error: restoreErr });
                }
                pendingGhostClaims.delete(user.id);
                logger.error('Ghost claiming failed', { userId: user.id, ghostId, error: err });
              }
            }
          },
        },
      },
    },
    basePath: "/api/auth",
    emailAndPassword: { enabled: true },
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
          expirationTime: "1h",
          definePayload: ({ user }) => ({
            id: user.id,
            email: user.email,
            name: user.name,
          }),
        },
      }),
    ],
    advanced: {
      defaultCookieAttributes: {
        sameSite: "none",
        secure: true,
      },
    },
  });
}
