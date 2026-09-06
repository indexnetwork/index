import { jwtVerify, createRemoteJWKSet } from 'jose';
import { eq } from 'drizzle-orm/sql';

import { hashApiKey } from '../lib/apikey/credential';
import { resolveApiKeyUserId } from '../lib/apikey/principal';
import { apikeys, users } from '../schemas/database.schema';
import { API_URL, JWT_AUDIENCE } from '../lib/betterauth/betterauth';
import { log } from '../lib/log';
import { getRequestAuthContext, recordRequestAuthContext } from '../lib/request-auth-context';

const logger = log.server.from('auth.guard');

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  name: string;
}

export interface ApiKeyAuthenticationCredential {
  id?: string;
  referenceId: string | null;
  userId: string | null;
  enabled: boolean;
  expiresAt: Date | null;
}

/** Persistence boundary used by the real API-key authentication algorithm. */
export interface ApiKeyAuthenticationStore {
  findCredentialByHash(hash: string): Promise<ApiKeyAuthenticationCredential | null>;
  findUserById(userId: string): Promise<AuthenticatedUser | null>;
}

const JWKS = createRemoteJWKSet(
  new URL('/api/auth/jwks', API_URL)
);

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
    const { payload } = await jwtVerify(token, JWKS, { issuer: API_URL, audience: JWT_AUDIENCE });
    const user = {
      id: payload.id as string,
      email: (payload.email as string) ?? null,
      name: payload.name as string,
    };
    recordRequestAuthContext(req, { kind: 'session' });
    return user;
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
 * Use for owner control: minting and revoking API keys, agent create/update/
 * delete (including choosing the negotiator), and account deletion. This keeps
 * a leaked key's blast radius at "act as the user in the product" — it can
 * never mint a successor credential that survives its own rotation, nor destroy
 * the account. See IND-384.
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
 * True iff the request is authenticated by a genuine Better Auth session JWT
 * (`Authorization: Bearer` header or `?token=`), i.e. a human acting in the
 * product — NOT an agent/API-key principal. Reads the authoritative context
 * recorded by the successful guard.
 *
 * Used to prove owner-action provenance for Lens B outcome capture (IND-434):
 * only explicit human session actions may become preference labels; API-key /
 * agent-mediated status mutations must never be recorded as owner decisions.
 */
export const isSessionAuthenticated = (req: Request): boolean =>
  getRequestAuthContext(req)?.kind === 'session';

export async function authenticateApiKey(
  req: Request,
  apiKey: string,
  store: ApiKeyAuthenticationStore = databaseApiKeyAuthenticationStore,
): Promise<AuthenticatedUser> {
  const hashed = await hashApiKey(apiKey);
  const row = await store.findCredentialByHash(hashed);

  // Log a prefix of the stored SHA-256 hash, never raw credential material.
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

  const user = await store.findUserById(userId);

  if (!user) {
    logger.warn('API key rejected', { reason: 'user_not_found', keyHashPrefix, ua });
    throw new Error('Invalid API key');
  }

  recordRequestAuthContext(req, { kind: 'api_key' });

  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name,
  };
}

/**
 * AuthGuard: verifies genuine JWTs (`Authorization: Bearer` header or
 * `?token=`), else accepts an `x-api-key` credential. Nothing else.
 */
export const AuthGuard = async (req: Request): Promise<AuthenticatedUser> => {
  const authHeader = req.headers.get('Authorization');
  const queryToken = new URL(req.url, 'http://localhost').searchParams.get('token');

  if (authHeader?.startsWith('Bearer ') || queryToken) {
    return resolveJwtUser(req);
  }

  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    throw new Error('Access token or API key required');
  }

  return authenticateApiKey(req, apiKey);
};

const databaseApiKeyAuthenticationStore: ApiKeyAuthenticationStore = {
  async findCredentialByHash(hash) {
    const database = (await import('../lib/drizzle/drizzle')).default;
    const [row] = await database
      .select({
        id: apikeys.id,
        referenceId: apikeys.referenceId,
        userId: apikeys.userId,
        enabled: apikeys.enabled,
        expiresAt: apikeys.expiresAt,
      })
      .from(apikeys)
      .where(eq(apikeys.key, hash))
      .limit(1);
    return row ?? null;
  },
  async findUserById(userId) {
    const database = (await import('../lib/drizzle/drizzle')).default;
    const [user] = await database
      .select({ id: users.id, email: users.email, name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return user ? { id: user.id, email: user.email ?? null, name: user.name } : null;
  },
};
