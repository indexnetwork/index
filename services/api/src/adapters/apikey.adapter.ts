import { and, eq } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { API_KEY_START_LENGTH, generateApiKey, hashApiKey } from '../lib/apikey/credential';
import * as schema from '../schemas/database.schema';

export interface ApiKeyRecord {
  id: string;
  name: string | null;
  start: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreateApiKeyResult {
  id: string;
  key: string;
  name: string | null;
  createdAt: string;
}

export interface ApiKeyStore {
  create(userId: string, name: string): Promise<CreateApiKeyResult>;
  list(userId: string): Promise<ApiKeyRecord[]>;
  revoke(userId: string, keyId: string): Promise<void>;
  revokeOwnBySecret(userId: string, keyId: string, secret: string): Promise<boolean>;
}

/**
 * ApiKeyAdapter
 *
 * Persists user API keys in the `apikey` table. A key names a user and nothing
 * else — it carries no agent binding and no permission payload, so possession
 * grants exactly the product surface its owner has.
 */
export class ApiKeyAdapter implements ApiKeyStore {
  /**
   * Mint a key for a user and return the raw secret exactly once.
   *
   * @param userId - Owner of the credential.
   * @param name - Display label shown in settings.
   * @returns Row ID, raw secret, name and creation time.
   */
  async create(userId: string, name: string): Promise<CreateApiKeyResult> {
    const plainKey = generateApiKey();
    const hashedKey = await hashApiKey(plainKey);
    const now = new Date();

    const [row] = await db
      .insert(schema.apikeys)
      .values({
        key: hashedKey,
        userId,
        referenceId: userId,
        name,
        start: plainKey.substring(0, API_KEY_START_LENGTH),
        createdAt: now,
        updatedAt: now,
        enabled: true,
      })
      .returning({ id: schema.apikeys.id, createdAt: schema.apikeys.createdAt });

    return {
      id: row.id,
      key: plainKey,
      name,
      createdAt: row.createdAt.toISOString(),
    };
  }

  /**
   * List a user's enabled keys. Secrets are never returned after creation.
   *
   * @param userId - Owner whose keys are listed.
   * @returns Masked key records ordered as stored.
   */
  async list(userId: string): Promise<ApiKeyRecord[]> {
    const rows = await db
      .select()
      .from(schema.apikeys)
      .where(
        and(
          eq(schema.apikeys.userId, userId),
          eq(schema.apikeys.enabled, true),
        ),
      );

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      start: row.start ?? '',
      createdAt: row.createdAt.toISOString(),
      lastUsedAt: row.lastRequest?.toISOString() ?? null,
    }));
  }

  /**
   * Hard-delete one of the user's keys by ID.
   *
   * @param userId - Owner of the credential.
   * @param keyId - Exact row to delete.
   * @throws Error('Key not found') when the row is missing or owned by someone else.
   */
  async revoke(userId: string, keyId: string): Promise<void> {
    const result = await db
      .delete(schema.apikeys)
      .where(
        and(
          eq(schema.apikeys.id, keyId),
          eq(schema.apikeys.userId, userId),
        ),
      )
      .returning({ id: schema.apikeys.id });

    if (result.length === 0) {
      throw new Error('Key not found');
    }
  }

  /**
   * Delete one key after re-proving its raw secret. This is the logout path for
   * clients that hold only a key: they can retire their own credential without
   * a session, and cannot name a different row.
   *
   * @param userId - Owner resolved from the caller's credential.
   * @param keyId - Exact row to delete.
   * @param secret - Raw secret that must hash to that row's stored key.
   * @returns True only when the authoritative row was deleted.
   */
  async revokeOwnBySecret(userId: string, keyId: string, secret: string): Promise<boolean> {
    const hashed = await hashApiKey(secret);

    const deleted = await db
      .delete(schema.apikeys)
      .where(
        and(
          eq(schema.apikeys.id, keyId),
          eq(schema.apikeys.key, hashed),
          eq(schema.apikeys.userId, userId),
        ),
      )
      .returning({ id: schema.apikeys.id });

    return deleted.length === 1;
  }
}

export const apiKeyAdapter = new ApiKeyAdapter();
