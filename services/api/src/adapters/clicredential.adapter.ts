import { and, eq } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { API_KEY_START_LENGTH, generateApiKey, hashApiKey } from '../lib/apikey/credential';
import { apikeys } from '../schemas/database.schema';

const CLI_CREDENTIAL_NAME = 'Index CLI';
const CLI_CREDENTIAL_PERMISSIONS = JSON.stringify({ credential: ['cli'] });
const CLI_CREDENTIAL_LIFETIME_MS = 90 * 24 * 60 * 60 * 1000;

export type CliProtocolVersion = 1 | 2;

export interface CreateCliCredentialResult {
  id: string;
  key: string;
  expiresAt: Date;
}

export interface RevokeCliCredentialInput {
  userId: string;
  callerKey: string;
  keyId: string;
  targetKey: string;
}

export interface CliCredentialStore {
  create(userId: string, protocolVersion: CliProtocolVersion): Promise<CreateCliCredentialResult>;
  revoke(input: RevokeCliCredentialInput): Promise<boolean>;
}

type ApiKeyRow = typeof apikeys.$inferSelect;

function parseCliMetadata(metadata: string | null): { client: 'cli'; protocolVersion: CliProtocolVersion } | null {
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    const record = parsed as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    if (keys.length !== 2 || keys[0] !== 'client' || keys[1] !== 'protocolVersion') return null;
    if (record.client !== 'cli' || (record.protocolVersion !== 1 && record.protocolVersion !== 2)) return null;
    return { client: 'cli', protocolVersion: record.protocolVersion };
  } catch {
    return null;
  }
}

function isServerIssuedCliRow(row: ApiKeyRow, rawKey: string, userId: string): boolean {
  return row.userId === userId
    && row.referenceId === userId
    && row.configId === 'default'
    && row.name === CLI_CREDENTIAL_NAME
    && row.start === rawKey.slice(0, API_KEY_START_LENGTH)
    && row.prefix === null
    && row.permissions === CLI_CREDENTIAL_PERMISSIONS
    && parseCliMetadata(row.metadata) !== null;
}

/**
 * Persists fixed-shape, Better Auth-compatible credentials for the Index CLI.
 */
export class CliCredentialAdapter implements CliCredentialStore {
  /**
   * Create a 90-day CLI credential and return its raw key exactly once.
   *
   * @param userId - Authenticated owner of the credential.
   * @param protocolVersion - Validated CLI bridge protocol version.
   * @returns Raw key, row ID, and expiry.
   */
  async create(
    userId: string,
    protocolVersion: CliProtocolVersion,
  ): Promise<CreateCliCredentialResult> {
    const key = generateApiKey();
    const hashedKey = await hashApiKey(key);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + CLI_CREDENTIAL_LIFETIME_MS);
    const metadata = Object.freeze({ client: 'cli' as const, protocolVersion });

    const [row] = await db
      .insert(apikeys)
      .values({
        key: hashedKey,
        userId,
        referenceId: userId,
        configId: 'default',
        name: CLI_CREDENTIAL_NAME,
        start: key.slice(0, API_KEY_START_LENGTH),
        permissions: CLI_CREDENTIAL_PERMISSIONS,
        createdAt: now,
        updatedAt: now,
        expiresAt,
        enabled: true,
        metadata: JSON.stringify(metadata),
      })
      .returning({ id: apikeys.id, expiresAt: apikeys.expiresAt });

    if (!row.expiresAt) {
      throw new Error('CLI credential expiry was not persisted');
    }

    return { id: row.id, key, expiresAt: row.expiresAt };
  }

  /**
   * Revoke one exact server-issued CLI credential after re-verifying caller and target secrets.
   *
   * @param input - Authenticated owner, raw caller key, exact target ID, and raw target key.
   * @returns True only when the authoritative target row was deleted.
   */
  async revoke(input: RevokeCliCredentialInput): Promise<boolean> {
    const callerHash = await hashApiKey(input.callerKey);
    const targetHash = await hashApiKey(input.targetKey);

    return db.transaction(async (tx) => {
      const [caller] = await tx
        .select()
        .from(apikeys)
        .where(eq(apikeys.key, callerHash))
        .limit(1)
        .for('update');

      if (
        !caller
        || !caller.enabled
        || (caller.expiresAt !== null && caller.expiresAt.getTime() <= Date.now())
        || !isServerIssuedCliRow(caller, input.callerKey, input.userId)
      ) {
        return false;
      }

      const [target] = await tx
        .select()
        .from(apikeys)
        .where(and(eq(apikeys.id, input.keyId), eq(apikeys.key, targetHash)))
        .limit(1)
        .for('update');

      // Expired or disabled prior CLI credentials may still be cleaned up. Their
      // immutable server-issued shape, exact ID, secret hash, and aligned owner
      // remain mandatory.
      if (!target || !isServerIssuedCliRow(target, input.targetKey, input.userId)) {
        return false;
      }

      const deleted = await tx
        .delete(apikeys)
        .where(and(eq(apikeys.id, input.keyId), eq(apikeys.key, targetHash)))
        .returning({ id: apikeys.id });
      return deleted.length === 1;
    });
  }
}

export const cliCredentialAdapter = new CliCredentialAdapter();
