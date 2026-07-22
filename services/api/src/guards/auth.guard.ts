import { jwtVerify, createRemoteJWKSet } from 'jose';
import { eq } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
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

function parseApiKeyMetadata(metadata: string | null): Record<string, unknown> | null {
  if (!metadata) return null;
  try {
    const parsed: unknown = JSON.parse(metadata);
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function parseApiKeyAgentId(metadata: string | null): string | null {
  const parsed = parseApiKeyMetadata(metadata);
  return typeof parsed?.agentId === 'string' ? parsed.agentId : null;
}

function isLegacyCliV1Metadata(metadata: string | null): boolean {
  const parsed = parseApiKeyMetadata(metadata);
  return parsed?.client === 'cli'
    && parsed.protocolVersion === 1
    && parsed.agentId === undefined;
}

/**
 * True iff the request is authenticated by a genuine Better Auth session JWT
 * (`Authorization: Bearer` header or `?token=`), i.e. a human acting in the
 * product — NOT an agent/API-key principal. Reads the authoritative context
 * recorded by the successful guard, so a temporary Bearer-carried CLI key is
 * still API-key provenance rather than being inferred from header shape.
 *
 * Used to prove owner-action provenance for Lens B outcome capture (IND-434):
 * only explicit human session actions may become preference labels; API-key /
 * agent-mediated status mutations must never be recorded as owner decisions.
 */
export const isSessionAuthenticated = (req: Request): boolean =>
  getRequestAuthContext(req)?.kind === 'session';

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

  return parseApiKeyAgentId(row?.metadata ?? null);
};

async function resolveApiKeyCredential(
  req: Request,
  apiKey: string,
  options: {
    metadataAllowed?: (metadata: string | null) => boolean;
    forceNullAgentId?: boolean;
  } = {},
): Promise<AuthenticatedUser> {
  const hashed = await hashApiKey(apiKey);
  const [row] = await db
    .select({
      referenceId: apikeys.referenceId,
      userId: apikeys.userId,
      enabled: apikeys.enabled,
      expiresAt: apikeys.expiresAt,
      metadata: apikeys.metadata,
    })
    .from(apikeys)
    .where(eq(apikeys.key, hashed))
    .limit(1);

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
  if (options.metadataAllowed && !options.metadataAllowed(row.metadata)) {
    logger.warn('API key rejected', { reason: 'incompatible_bearer_metadata', keyHashPrefix, ua });
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

  recordRequestAuthContext(req, {
    kind: 'api_key',
    agentId: options.forceNullAgentId ? null : parseApiKeyAgentId(row.metadata),
  });

  return {
    id: user.id,
    email: user.email ?? null,
    name: user.name,
  };
}

/**
 * AuthGuard: verifies genuine JWTs first, then accepts normal `x-api-key`
 * credentials. TEMPORARY: a failed Bearer JWT may fall back only to a
 * metadata-tagged CLI protocol-v1 API key so already-released CLIs can recover
 * via `index login`. Query tokens and all other API-key kinds never fall back.
 */
export const AuthGuard = async (req: Request): Promise<AuthenticatedUser> => {
  const authHeader = req.headers.get('Authorization');
  const queryToken = new URL(req.url, 'http://localhost').searchParams.get('token');

  if (authHeader?.startsWith('Bearer ')) {
    try {
      return await resolveJwtUser(req);
    } catch (jwtError) {
      try {
        return await resolveApiKeyCredential(req, authHeader.slice(7), {
          metadataAllowed: isLegacyCliV1Metadata,
          forceNullAgentId: true,
        });
      } catch {
        throw jwtError;
      }
    }
  }

  // Never interpret query-string tokens as API keys.
  if (queryToken) return resolveJwtUser(req);

  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) {
    throw new Error('Access token or API key required');
  }

  return resolveApiKeyCredential(req, apiKey);
};
