import { drizzleAdapter } from 'better-auth/adapters/drizzle';

import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';

/**
 * Database adapter for Better Auth integration.
 */
export class AuthDatabaseAdapter {
  /**
   * Returns a configured drizzle adapter for Better Auth's `database` option.
   * Wraps the default adapter to intercept user creation so that an email
   * collision with an existing account surfaces as a duplicate signup rather
   * than a silent overwrite.
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
        deviceCode: schema.deviceCodes,
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
            // Use ON CONFLICT so a duplicate email is detected atomically.
            // Any email collision is an existing real account: RETURNING comes
            // back empty and we throw to signal a duplicate signup.
            const result = await db
              .insert(schema.users)
              .values(data)
              .onConflictDoNothing({ target: [schema.users.email] })
              .returning();

            if (!result[0]) {
              // Conflict with an existing account — nothing was inserted
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
}
