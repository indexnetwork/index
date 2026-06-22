import { and, eq, sql } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';

/** Key length matching Better Auth's default (64 chars, a-zA-Z). */
const KEY_LENGTH = 64;
/** Number of starting characters to store for display. */
const START_CHARS = 6;

export interface AgentTokenRecord {
  id: string;
  name: string | null;
  start: string;
  createdAt: string;
  lastUsedAt: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CreateAgentTokenResult {
  id: string;
  key: string;
  name: string | null;
  createdAt: string;
}

/**
 * Hash a plaintext API key using SHA-256 + base64url (no padding).
 * Matches Better Auth's `defaultKeyHasher` so keys created here
 * are verified correctly by the Better Auth middleware.
 */
async function hashKey(key: string): Promise<string> {
  const encoded = new TextEncoder().encode(key);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  // base64url without padding, matching Better Auth's encoding
  return Buffer.from(hash).toString('base64url');
}

/** Generate a random key string (a-zA-Z) matching Better Auth's format. */
function generateKey(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

function parseMetadata(value: unknown): Record<string, unknown> | null {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }

    return null;
  }

  if (typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return null;
}

export interface AgentTokenStore {
  create(userId: string, params: { name: string; agentId: string }): Promise<CreateAgentTokenResult>;
  list(userId: string): Promise<AgentTokenRecord[]>;
  revoke(userId: string, tokenId: string): Promise<void>;
  /** Hard-deletes every api key whose metadata.agentId matches. Returns row count. */
  revokeAllForAgent(agentId: string): Promise<number>;
}

/**
 * AgentTokenAdapter
 *
 * Manages API keys for agents via direct Drizzle queries against
 * Better Auth's `apikey` table, using compatible key generation
 * and hashing so keys are verified by Better Auth's middleware.
 */
export class AgentTokenAdapter implements AgentTokenStore {
  async create(userId: string, params: { name: string; agentId: string }): Promise<CreateAgentTokenResult> {
    const plainKey = generateKey(KEY_LENGTH);
    const hashedKey = await hashKey(plainKey);
    const now = new Date();

    const [row] = await db
      .insert(schema.apikeys)
      .values({
        key: hashedKey,
        userId,
        referenceId: userId,
        name: params.name,
        start: plainKey.substring(0, START_CHARS),
        metadata: JSON.stringify({ agentId: params.agentId }),
        createdAt: now,
        updatedAt: now,
        enabled: true,
      })
      .returning({ id: schema.apikeys.id, createdAt: schema.apikeys.createdAt });

    return {
      id: row.id,
      key: plainKey,
      name: params.name,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async list(userId: string): Promise<AgentTokenRecord[]> {
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
      metadata: parseMetadata(row.metadata),
    }));
  }

  async revoke(userId: string, tokenId: string): Promise<void> {
    const result = await db
      .delete(schema.apikeys)
      .where(
        and(
          eq(schema.apikeys.id, tokenId),
          eq(schema.apikeys.userId, userId),
        ),
      )
      .returning({ id: schema.apikeys.id });

    if (result.length === 0) {
      throw new Error('Token not found');
    }
  }

  /**
   * Hard-deletes every api key whose `metadata.agentId` matches the given
   * agent id. The `metadata` column stores a JSON-encoded string, so the
   * predicate must cast to `jsonb` before extracting the field.
   *
   * @param agentId - the agent whose tokens should be revoked
   * @returns the number of rows deleted
   */
  async revokeAllForAgent(agentId: string): Promise<number> {
    const result = await db
      .delete(schema.apikeys)
      .where(sql`(${schema.apikeys.metadata})::jsonb->>'agentId' = ${agentId}`)
      .returning({ id: schema.apikeys.id });
    return result.length;
  }
}

export const agentTokenAdapter = new AgentTokenAdapter();
