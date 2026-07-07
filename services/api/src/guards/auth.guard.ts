import { jwtVerify, createRemoteJWKSet } from 'jose';
import { eq } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { resolveApiKeyUserId } from '../lib/apikey/principal';
import { apikeys, users } from '../schemas/database.schema';
import { BASE_URL, JWT_AUDIENCE } from '../lib/betterauth/betterauth';
import { log } from '../lib/log';

const logger = log.server.from('auth-guard');

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  name: string;
}

const JWKS = createRemoteJWKSet(
  new URL('/api/auth/jwks', BASE_URL)
);

/** SHA-256 hash a raw API key into the base64url form stored in `apikeys.key`. */
async function hashApiKey(apiKey: string): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(apiKey));
  return btoa(String.fromCharCode(...new Uint8Array(hashBuffer)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Resolve an authenticated user from a Better Auth JWT.
 * Expects `Authorization: Bearer <jwt>` header or `?token=...`.
 */
const resolveJwtUser = async (req: Request): Promise<AuthenticatedUser> => {
  const authHeader = req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.slice(7)
    : new URL(req.url, 'http://localhost').searchParams.get('token');

  if (!token) {
    throw new Error('Access token required');
  }
  try {
    const { payload } = await jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE });
    return {
      id: payload.id as string,
      email: (payload.email as string) ?? null,
      name: payload.name as string,
    };
  } catch {
    throw new Error('Invalid or expired access token');
  }
};

/**
 * Thrown when a session-only endpoint is hit with an API key (or any
 * non-JWT credential). Mapped to HTTP 403 in main.ts.
 */
export class SessionRequiredError extends Error {
  constructor(message = 'This endpoint requires a session token; API keys are not accepted') {
    super(message);
    this.name = 'SessionRequiredError';
  }
}

/**
 * SessionOnlyGuard: accepts ONLY a Better Auth session JWT (`Authorization:
 * Bearer` header or `?token=`), never an API key.
 *
 * Use for endpoints where a leaked agent API key must not be able to act:
 * account deletion and agent-management writes (create/update/delete agents,
 * tokens, permissions, transports). Re-walling those keeps leaked-key blast
 * radius at "act as the user in the product" — a key must never be able to
 * mint successor credentials (which would survive rotation of the leaked
 * key) or destroy the account. See IND-384.
 */
export const SessionOnlyGuard = async (req: Request): Promise<AuthenticatedUser> => {
  const authHeader = req.headers.get('Authorization');
  const queryToken = new URL(req.url, 'http://localhost').searchParams.get('token');

  if (authHeader?.startsWith('Bearer ') || queryToken) {
    return resolveJwtUser(req);
  }

  if (req.headers.get('x-api-key')) {
    logger.warn('API key rejected on session-only endpoint', {
      path: new URL(req.url, 'http://localhost').pathname,
      ua: req.headers.get('user-agent') ?? 'unknown',
    });
    throw new SessionRequiredError();
  }

  throw new Error('Access token required');
};

/**
 * Resolve the `metadata.agentId` of the API key on the request, or null if
 * the request is JWT-authenticated, has no key, or the key has no agent
 * binding. Authorization is intentionally NOT re-checked here — callers
 * must run `AuthGuard` first.
 */
export const resolveApiKeyAgentId = async (req: Request): Promise<string | null> => {
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) return null;
  const queryToken = new URL(req.url, 'http://localhost').searchParams.get('token');
  if (queryToken) return null;

  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) return null;

  const hashed = await hashApiKey(apiKey);

  const [row] = await db
    .select({ metadata: apikeys.metadata })
    .from(apikeys)
    .where(eq(apikeys.key, hashed))
    .limit(1);

  if (!row?.metadata) return null;

  try {
    const parsed = JSON.parse(row.metadata) as Record<string, unknown>;
    return typeof parsed.agentId === 'string' ? parsed.agentId : null;
  } catch {
    return null;
  }
};

/**
 * AuthGuard: tries JWT first, then falls back to API key (`x-api-key` header).
 * API keys are SHA-256 hashed and looked up in the `apikeys` table, then the
 * owning user is loaded from `users` to build the same AuthenticatedUser shape.
 */
export const AuthGuard = async (req: Request): Promise<AuthenticatedUser> => {
  const authHeader = req.headers.get('Authorization');
  const url = new URL(req.url, 'http://localhost');
  const queryToken = url.searchParams.get('token');

  if (authHeader?.startsWith('Bearer ') || queryToken) {
    return resolveJwtUser(req);
  }

  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    throw new Error('Access token or API key required');
  }

  const hashed = await hashApiKey(apiKey);

  const [row] = await db
    .select({
      referenceId: apikeys.referenceId,
      userId: apikeys.userId,
      enabled: apikeys.enabled,
      expiresAt: apikeys.expiresAt,
    })
    .from(apikeys)
    .where(eq(apikeys.key, hashed))
    .limit(1);

  // Log a prefix of the stored SHA-256 hash, never raw x-api-key material.
  const keyHashPrefix = hashed.slice(0, 8);
  const ua = req.headers.get('user-agent') ?? 'unknown';

  if (!row || !row.enabled) {
    logger.warn('API key rejected', { reason: row ? 'disabled' : 'not_found', keyHashPrefix, ua });
    throw new Error('Invalid API key');
  }
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) {
    logger.warn('API key rejected', { reason: 'expired', keyHashPrefix, ua });
    throw new Error('Invalid API key');
  }

  let userId: string | null;
  try {
    userId = resolveApiKeyUserId(row);
  } catch {
    logger.warn('API key rejected', { reason: 'principal_mismatch', keyHashPrefix, ua });
    throw new Error('Invalid API key');
  }
  if (!userId) {
    logger.warn('API key rejected', { reason: 'no_user_ref', keyHashPrefix, ua });
    throw new Error('Invalid API key');
  }

  const [user] = await db
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (!user) {
    logger.warn('API key rejected', { reason: 'user_not_found', keyHashPrefix, ua });
    throw new Error('Invalid API key');
  }

  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name,
  };
};
