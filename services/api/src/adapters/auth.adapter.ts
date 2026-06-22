import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { and, eq, sql } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { ensurePersonalNetwork } from './database.adapter';

/**
 * Database adapter for Better Auth integration.
 * Provides ghost user lifecycle operations:
 * - `createDrizzleAdapter`: wraps the Drizzle adapter with ON CONFLICT upsert
 *   for ghost claiming during email/password signup (dev-only).
 * - `claimGhostUser`: flips isGhost to false; called from the session hook
 *   on every login so magic link and social OAuth de-ghost correctly.
 */
export class AuthDatabaseAdapter {
  /**
   * Returns a configured drizzle adapter for Better Auth's `database` option.
   * Wraps the default adapter to intercept user creation: if a user signs up
   * with an email that belongs to a ghost, the ghost row is updated in-place
   * (isGhost=false, name/avatar updated) via ON CONFLICT DO UPDATE.
   *
   * @remarks This upsert path is only exercised in development where
   * email/password signup is enabled. In production, de-ghosting happens
   * via {@link claimGhostUser} in the session hook instead.
   */
  createDrizzleAdapter() {
    const baseAdapterFactory = drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        ...schema,
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verifications,
        jwks: schema.jwks,
        oauthApplication: schema.oauthApplications,
        oauthAccessToken: schema.oauthAccessTokens,
        oauthConsent: schema.oauthConsents,
        apikey: schema.apikeys,
      },
    });

    // The drizzle adapter is a factory function: (options) => adapterObject
    return (options: unknown) => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
      const resolved = (baseAdapterFactory as Function)(options);

      return {
        ...resolved,
        create: async (params: { model: string; data: Record<string, unknown>; [key: string]: unknown }) => {
          if (params.model === 'user') {
            // Normalize email to lowercase to prevent case-variant duplicates (IND-166).
            const data = { ...params.data } as typeof schema.users.$inferInsert;
            if (typeof data.email === 'string') {
              data.email = data.email.toLowerCase().trim();
            }
            // Use ON CONFLICT to handle ghost claim atomically.
            // If a ghost exists with this email, update it in-place.
            // The WHERE clause ensures we only upsert over ghosts, not real users.
            // If a real (non-ghost) user already has this email, the WHERE doesn't
            // match, RETURNING is empty, and we throw to signal a duplicate signup.
            const result = await db
              .insert(schema.users)
              .values(data)
              .onConflictDoUpdate({
                target: [schema.users.email],
                set: {
                  name: sql`EXCLUDED."name"`,
                  avatar: sql`EXCLUDED."avatar"`,
                  isGhost: sql`false`,
                  updatedAt: sql`now()`,
                },
                setWhere: sql`${schema.users.isGhost} = true`,
              })
              .returning();

            if (!result[0]) {
              // Conflict with a real (non-ghost) user — the WHERE filtered it out
              // so neither INSERT nor UPDATE happened. Surface as a constraint error.
              throw new Error(`User with this email already exists`);
            }

            return result[0];
          }
          return resolved.create(params);
        },
      };
    };
  }

  /**
   * Creates a personal index for the user if one doesn't exist.
   * Idempotent — safe to call on every sign-in.
   * @param userId - The authenticated user
   * @returns The personal index ID
   */
  async ensurePersonalNetwork(userId: string): Promise<string> {
    return ensurePersonalNetwork(userId);
  }

  /**
   * Flips isGhost to false for the given user.
   * No-op if the user is already non-ghost or doesn't exist.
   * Called from the session.create.after hook so every auth flow
   * (magic link, social OAuth) de-ghosts on first real login.
   * @param userId - The user whose ghost flag should be cleared
   */
  async claimGhostUser(userId: string): Promise<void> {
    await db
      .update(schema.users)
      .set({ isGhost: false, updatedAt: new Date() })
      .where(and(eq(schema.users.id, userId), eq(schema.users.isGhost, true)));
  }
}
