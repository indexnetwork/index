import { jwtVerify, createRemoteJWKSet } from 'jose';

import { API_URL, JWT_AUDIENCE } from '../lib/betterauth/betterauth';
import { log } from '../lib/log';
import { getRequestAuthContext, recordRequestAuthContext } from '../lib/request-auth-context';

const logger = log.server.from('auth.guard');

export interface AuthenticatedUser {
  id: string;
  email: string | null;
  name: string;
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
 * Use for owner control: agent create/update/delete (including choosing the
 * negotiator) and account deletion. Key management itself is guarded the same
 * way by the Better Auth apiKey plugin, which requires a session because
 * `enableSessionForAPIKeys` is off. This keeps a leaked key's blast radius at
 * "act as the user in the product" — it can never mint a successor credential
 * that survives its own rotation, nor destroy the account. See IND-384.
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

/**
 * Resolve the owning user behind an `x-api-key` credential. Verification,
 * expiry, enablement and rate limiting all belong to the Better Auth apiKey
 * plugin; this only maps the verified key to the user it references.
 *
 * @param req - The request carrying the credential, for provenance recording.
 * @param apiKey - The raw secret from the `x-api-key` header.
 * @returns The authenticated owner.
 * @throws Error when the key is unknown, disabled, expired or orphaned.
 */
export async function authenticateApiKey(
  req: Request,
  apiKey: string,
): Promise<AuthenticatedUser> {
  const ua = req.headers.get('user-agent') ?? 'unknown';
  const { auth } = await import('../lib/betterauth/auth.instance');

  const { valid, error, key } = await auth.api.verifyApiKey({ body: { key: apiKey } });
  if (!valid || !key) {
    logger.warn('API key rejected', { reason: error?.code ?? 'invalid', ua });
    throw new Error('Invalid API key');
  }

  const user = await resolveApiKeyOwner(key.referenceId);
  if (!user) {
    logger.warn('API key rejected', { reason: 'user_not_found', ua });
    throw new Error('Invalid API key');
  }

  recordRequestAuthContext(req, { kind: 'api_key' });
  return user;
}

async function resolveApiKeyOwner(userId: string): Promise<AuthenticatedUser | null> {
  const database = (await import('../lib/drizzle/drizzle')).default;
  const { eq } = await import('drizzle-orm/sql');
  const { users } = await import('../schemas/database.schema');

  const [user] = await database
    .select({ id: users.id, email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  return user ? { id: user.id, email: user.email ?? null, name: user.name } : null;
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
