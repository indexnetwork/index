import { jwtVerify, createRemoteJWKSet } from 'jose';
import { eq } from 'drizzle-orm/sql';

import { hashApiKey } from '../lib/apikey/credential';
import { resolveApiKeyUserId } from '../lib/apikey/principal';
import { apikeys, users } from '../schemas/database.schema';
import { API_URL, JWT_AUDIENCE } from '../lib/betterauth/betterauth';
import { log } from '../lib/log';
import { getRequestAuthContext, recordRequestAuthContext } from '../lib/request-auth-context';
import { HERMES_NEGOTIATOR_AUDIENCE, HERMES_NEGOTIATOR_CREDENTIAL_KIND, type NegotiationCredentialPrincipal } from '../lib/agent/hermes-credential';

export { HERMES_NEGOTIATOR_AUDIENCE, HERMES_NEGOTIATOR_CREDENTIAL_KIND } from '../lib/agent/hermes-credential';
export type { NegotiationCredentialPrincipal } from '../lib/agent/hermes-credential';

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
  metadata: string | null;
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

/** Thrown when an agent-bound key reaches an owner-control endpoint. */
export class OwnerControlRequiredError extends Error {
  constructor(message = 'This endpoint requires an owner credential; agent-bound API keys are not accepted') {
    super(message);
    this.name = 'OwnerControlRequiredError';
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

function parseApiKeyAudience(metadata: string | null): typeof HERMES_NEGOTIATOR_AUDIENCE | null {
  const parsed = parseApiKeyMetadata(metadata);
  return parsed?.audience === HERMES_NEGOTIATOR_AUDIENCE
    ? HERMES_NEGOTIATOR_AUDIENCE
    : null;
}

function parseApiKeySetupAttemptId(metadata: string | null): string | null {
  const parsed = parseApiKeyMetadata(metadata);
  return typeof parsed?.setupAttemptId === 'string' ? parsed.setupAttemptId : null;
}

/**
 * Dedicated-audience credentials are a closed authentication contract. Inspect
 * the audience directly before resolving an owner so malformed dedicated rows
 * cannot collapse into the legacy `audience: null` / unbound-key behavior.
 */
function hasValidHermesAuthenticationIdentity(row: ApiKeyAuthenticationCredential): boolean {
  const parsed = parseApiKeyMetadata(row.metadata);
  if (parsed?.audience !== HERMES_NEGOTIATOR_AUDIENCE) return true;

  return typeof row.id === 'string'
    && row.id.trim().length > 0
    && typeof parsed.agentId === 'string'
    && parsed.agentId.trim().length > 0
    && typeof parsed.setupAttemptId === 'string'
    && parsed.setupAttemptId.trim().length > 0
    && parsed.kind === HERMES_NEGOTIATOR_CREDENTIAL_KIND
    && row.expiresAt !== null
    && typeof parsed.expiresAt === 'string'
    && parsed.expiresAt === row.expiresAt.toISOString();
}

/** Stable 403 for an explicitly negotiation-only credential used elsewhere. */
export class HermesNegotiatorRouteDeniedError extends Error {
  constructor(message = 'This Hermes negotiator credential is not authorized for this endpoint') {
    super(message);
    this.name = 'HermesNegotiatorRouteDeniedError';
  }
}

/**
 * Centrally enforce the REST allowlist for the dedicated Hermes audience.
 * Legacy agent-bound keys have no explicit audience and retain their historical
 * route behavior. The URL is matched exactly after removing the optional API
 * prefix; query strings never influence admission.
 */
export function assertApiKeyAudienceRoute(
  req: Request,
  principal: Pick<NegotiationCredentialPrincipal, 'agentId' | 'audience'>,
): void {
  if (principal.audience !== HERMES_NEGOTIATOR_AUDIENCE) return;

  const method = req.method.toUpperCase();
  const rawPath = new URL(req.url, 'http://localhost').pathname;
  const path = rawPath === '/api' ? '/' : rawPath.replace(/^\/api(?=\/)/, '');
  if (method === 'GET' && path === '/agents/me') return;

  const escapedAgentId = principal.agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const negotiationRoute = new RegExp(
    `^/agents/${escapedAgentId}/negotiations/(?:pickup|[^/]+/(?:respond|consult))$`,
  );
  if (method === 'POST' && negotiationRoute.test(path)) return;

  throw new HermesNegotiatorRouteDeniedError();
}

/** Read the exact authenticated principal required by negotiation mutations. */
export function requireNegotiationCredentialPrincipal(req: Request): NegotiationCredentialPrincipal {
  const context = getRequestAuthContext(req);
  if (
    context?.kind !== 'api_key'
    || !context.agentId
    || !context.credentialId
  ) {
    throw new OwnerControlRequiredError('Negotiation polling requires an exact agent-bound API key');
  }
  return {
    credentialId: context.credentialId,
    agentId: context.agentId,
    audience: context.audience ?? null,
    setupAttemptId: context.setupAttemptId ?? null,
  };
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
export type AgentPrincipalResolver = (request: Request) => Promise<string | null>;

export const resolveApiKeyAgentId = async (req: Request): Promise<string | null> => {
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) return null;
  const queryToken = new URL(req.url, 'http://localhost').searchParams.get('token');
  if (queryToken) return null;

  const apiKey = req.headers.get('x-api-key');
  if (!apiKey) return null;

  const hashed = await hashApiKey(apiKey);

  const database = (await import('../lib/drizzle/drizzle')).default;
  const [row] = await database
    .select({ metadata: apikeys.metadata })
    .from(apikeys)
    .where(eq(apikeys.key, hashed))
    .limit(1);

  return parseApiKeyAgentId(row?.metadata ?? null);
};

async function hasExactAgentPrincipal(
  request: Request,
  agentId: string,
  resolvePrincipal: AgentPrincipalResolver,
): Promise<boolean> {
  return await resolvePrincipal(request) === agentId;
}

/** Exact agent-bound principal check used by negotiation pickup. */
export async function authorizeNegotiationPickupPrincipal(
  request: Request,
  agentId: string,
  resolvePrincipal: AgentPrincipalResolver = resolveApiKeyAgentId,
): Promise<boolean> {
  return hasExactAgentPrincipal(request, agentId, resolvePrincipal);
}

/** Exact agent-bound principal check used by negotiation respond. */
export async function authorizeNegotiationRespondPrincipal(
  request: Request,
  agentId: string,
  resolvePrincipal: AgentPrincipalResolver = resolveApiKeyAgentId,
): Promise<boolean> {
  return hasExactAgentPrincipal(request, agentId, resolvePrincipal);
}

export async function authenticateApiKey(
  req: Request,
  apiKey: string,
  store: ApiKeyAuthenticationStore = databaseApiKeyAuthenticationStore,
  options: {
    metadataAllowed?: (metadata: string | null) => boolean;
    forceNullAgentId?: boolean;
  } = {},
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
  if (options.metadataAllowed && !options.metadataAllowed(row.metadata)) {
    logger.warn('API key rejected', { reason: 'incompatible_bearer_metadata', keyHashPrefix, ua });
    throw new Error('Invalid API key');
  }
  if (!hasValidHermesAuthenticationIdentity(row)) {
    logger.warn('API key rejected', { reason: 'malformed_hermes_identity', keyHashPrefix, ua });
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

  const context = {
    kind: 'api_key' as const,
    agentId: options.forceNullAgentId ? null : parseApiKeyAgentId(row.metadata),
    audience: options.forceNullAgentId ? null : parseApiKeyAudience(row.metadata),
    credentialId: row.id ?? null,
    setupAttemptId: options.forceNullAgentId ? null : parseApiKeySetupAttemptId(row.metadata),
  };
  recordRequestAuthContext(req, context);
  if (context.agentId) assertApiKeyAudienceRoute(req, {
    agentId: context.agentId,
    audience: context.audience,
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
        return await authenticateApiKey(req, authHeader.slice(7), databaseApiKeyAuthenticationStore, {
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
        metadata: apikeys.metadata,
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

/**
 * Authenticate an owner-control request while rejecting every agent-bound key.
 * Sessions and unbound owner keys remain accepted.
 */
export const OwnerControlGuard = async (
  req: Request,
  authenticate: (request: Request) => Promise<AuthenticatedUser> = AuthGuard,
): Promise<AuthenticatedUser> => {
  const user = await authenticate(req);
  const context = getRequestAuthContext(req);
  if (context?.kind === 'api_key' && context.agentId !== null) {
    throw new OwnerControlRequiredError();
  }
  return user;
};
