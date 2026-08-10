import { jwtVerify, createRemoteJWKSet } from 'jose';
import { and, eq } from 'drizzle-orm/sql';

import { hashApiKey } from '../lib/apikey/credential';
import { resolveApiKeyUserId } from '../lib/apikey/principal';
import { agents, agentPermissions, apikeys, hermesAgentCredentials, indexAppOwnerCredentials, users } from '../schemas/database.schema';
import { API_URL, JWT_AUDIENCE } from '../lib/betterauth/betterauth';
import { log } from '../lib/log';
import { getRequestAuthContext, recordRequestAuthContext } from '../lib/request-auth-context';
import { HERMES_AGENT_AUDIENCE, hashHermesSecret } from '../lib/agent/hermes-authorization';
import { INDEX_APP_OWNER_AUDIENCE, INDEX_APP_OWNER_CREDENTIAL_PREFIX, hashIndexAppOwnerSecret } from '../lib/agent/index-app-owner-authorization';
import { HERMES_CANONICAL_ACTIONS, type HermesCapability } from '../lib/agent/hermes-capabilities';
import { HERMES_AGENT_CREDENTIAL_PREFIX, HERMES_NEGOTIATOR_AUDIENCE, HERMES_NEGOTIATOR_CREDENTIAL_KIND, type NegotiationCredentialPrincipal } from '../lib/agent/hermes-credential';

export { HERMES_AGENT_CREDENTIAL_PREFIX, HERMES_NEGOTIATOR_AUDIENCE, HERMES_NEGOTIATOR_CREDENTIAL_KIND } from '../lib/agent/hermes-credential';
export { INDEX_APP_OWNER_AUDIENCE, INDEX_APP_OWNER_CREDENTIAL_PREFIX } from '../lib/agent/index-app-owner-authorization';
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

export interface HermesAgentAuthenticationCredential {
  id: string;
  ownerId: string;
  audience: string;
  agentId: string;
  installationId: string;
  setupAttemptId: string;
  actions: readonly string[];
  activationState: 'pending' | 'active' | 'revoked';
  expiresAt: Date;
}

export interface HermesAgentAuthenticationAuthority {
  id: string;
  ownerId: string;
  runtimeKind: 'hermes' | null;
  installationId: string | null;
  setupAttemptId: string | null;
  status: 'active' | 'inactive';
  deletedAt: Date | null;
  actions: readonly string[] | null;
}

/** Dedicated active-row persistence boundary. It never reads legacy `apikey`. */
export interface HermesAgentAuthenticationStore {
  findCredentialByHash(hash: string): Promise<HermesAgentAuthenticationCredential | null>;
  findAgentAuthority(agentId: string, ownerId: string): Promise<HermesAgentAuthenticationAuthority | null>;
  findUserById(userId: string): Promise<AuthenticatedUser | null>;
}

export interface IndexAppOwnerAuthenticationCredential {
  id: string;
  ownerId: string;
  audience: string;
  installationId: string;
  generation: string;
  activationState: 'pending' | 'active' | 'revoked';
  expiresAt: Date;
}

export interface IndexAppOwnerInstallationAuthority {
  credentialId: string;
  ownerId: string;
  installationId: string;
  generation: string;
}

export interface IndexAppOwnerAuthenticationStore {
  findCredentialByHash(hash: string): Promise<IndexAppOwnerAuthenticationCredential | null>;
  findCurrentInstallationAuthority(
    ownerId: string,
    installationId: string,
  ): Promise<IndexAppOwnerInstallationAuthority | null>;
  findUserById(userId: string): Promise<AuthenticatedUser | null>;
}

export type IndexAppOwnerPrincipal = {
  ownerId: string;
  credentialId: string;
  audience: typeof INDEX_APP_OWNER_AUDIENCE;
  installationId: string;
  generation: string;
  expiresAt: Date;
  activationState: 'active';
};

export type HermesAgentPrincipal = {
  ownerId: string;
  credentialId: string;
  audience: typeof HERMES_AGENT_AUDIENCE;
  agentId: string;
  installationId: string;
  setupAttemptId: string;
  actions: readonly HermesCapability[];
  expiresAt: Date;
  activationState: 'active';
};

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

export class HermesAgentRouteDeniedError extends HermesNegotiatorRouteDeniedError {
  constructor(message = 'This Hermes agent credential is not authorized for this endpoint') {
    super(message);
    this.name = 'HermesAgentRouteDeniedError';
  }
}

export class IndexAppOwnerRouteDeniedError extends Error {
  constructor(message = 'This Index app owner credential is not authorized for this endpoint') {
    super(message);
    this.name = 'IndexAppOwnerRouteDeniedError';
  }
}

const INDEX_APP_OWNER_OPPORTUNITY_STATUS_SUBSET: ReadonlySet<string> = new Set(['accepted', 'rejected']);

/** Dedicated native owner status mutation subset; session/legacy callers retain the global controller contract. */
export function authorizeIndexAppOwnerOpportunityStatus(request: Request, status: string): boolean {
  const context = getRequestAuthContext(request);
  return context?.kind !== 'api_key' || context.audience !== INDEX_APP_OWNER_AUDIENCE
    || INDEX_APP_OWNER_OPPORTUNITY_STATUS_SUBSET.has(status);
}

export type IndexAppOwnerRouteDecision =
  | { allowed: true }
  | { allowed: false; reason: 'dedicated_owner_route_denied' };

const INDEX_APP_OWNER_STATIC_ROUTES = new Set([
  'GET /auth/me', 'PATCH /auth/profile/update',
  'GET /agent-runtime', 'PUT /agent-runtime',
  'POST /agent-runtime/hermes/prepare', 'POST /agent-runtime/reconcile-index',
  'POST /agent-runtime/rollback',
  'GET /networks', 'POST /networks', 'GET /networks/discovery/public',
  'GET /network-requests', 'POST /network-requests',
  'GET /agents', 'POST /intents/list',
  'POST /intents/confirm', 'POST /intents/reject',
  'POST /intents/intake/start', 'POST /intents/intake/question',
  'POST /intents/intake/prepare', 'POST /intents/intake/proposal',
  'POST /intents/intake/revise',
  'GET /opportunities', 'GET /opportunities/radar', 'GET /opportunities/chat-context',
  'GET /questions', 'POST /tools/read_user_contexts',
  'POST /tools/preview_user_context', 'POST /tools/confirm_user_context',
  'POST /enrichment/enrich', 'GET /conversations', 'GET /conversations/negotiations',
  'GET /conversations/stream', 'POST /conversations/dm', 'POST /chat/stream',
  'POST /storage/avatars', 'POST /storage/index-images',
]);

/** Exact product-only route matrix for the dedicated native owner principal. */
export function authorizeIndexAppOwner(input: { method: string; path: string }): IndexAppOwnerRouteDecision {
  const method = input.method.toUpperCase();
  const path = normalizeAudiencePath(input.path);
  if (INDEX_APP_OWNER_STATIC_ROUTES.has(`${method} ${path}`)) return { allowed: true };
  const segment = '[^/]+';
  const routes: ReadonlyArray<readonly [string, RegExp]> = [
    ['GET', new RegExp(`^/networks/${segment}/(?:overview|my-intents)$`)],
    ['POST', new RegExp(`^/networks/${segment}/(?:join|leave)$`)],
    ['PATCH', new RegExp(`^/network-requests/${segment}$`)],
    ['DELETE', new RegExp(`^/network-requests/${segment}$`)],
    ['GET', new RegExp(`^/users/${segment}$`)], ['GET', /^\/users\/batch$/],
    ['GET', new RegExp(`^/users/${segment}/negotiations$`)],
    ['GET', new RegExp(`^/intents/${segment}$`)],
    ['PATCH', new RegExp(`^/intents/${segment}/(?:archive|status)$`)],
    ['GET', new RegExp(`^/opportunities/${segment}$`)],
    ['GET', new RegExp(`^/opportunities/${segment}/invite-message$`)],
    ['PATCH', new RegExp(`^/opportunities/${segment}/status$`)],
    ['POST', new RegExp(`^/opportunities/${segment}/start-chat$`)],
    ['POST', new RegExp(`^/questions/${segment}/(?:answer|dismiss)$`)],
    ['GET', new RegExp(`^/conversations/${segment}/messages$`)],
    ['POST', new RegExp(`^/conversations/${segment}/messages$`)],
    ['PATCH', new RegExp(`^/conversations/${segment}/metadata$`)],
    ['DELETE', new RegExp(`^/conversations/${segment}$`)],
    ['DELETE', new RegExp(`^/agent-runtime/hermes/${segment}$`)],
  ];
  return routes.some(([allowedMethod, pattern]) => method === allowedMethod && pattern.test(path))
    ? { allowed: true }
    : { allowed: false, reason: 'dedicated_owner_route_denied' };
}

export type HermesAgentRouteDecision =
  | { allowed: true }
  | { allowed: false; reason: 'dedicated_principal_route_denied' };

const HERMES_AGENT_STATIC_ROUTES: ReadonlySet<string> = new Set([
  'POST /mcp',
  'GET /agents/me',
  'GET /auth/me',
  'POST /hermes-authorizations/disconnect',
  'PATCH /auth/profile/update',
  'POST /intents/list',
  'GET /opportunities',
  'GET /questions',
  'GET /networks',
  'GET /networks/discovery/public',
  'GET /network-requests',
  'POST /network-requests',
  'POST /tools/read_user_contexts',
  'POST /tools/confirm_user_context',
  'POST /storage/avatars',
  'POST /storage/index-images',
  'POST /enrichment/sync',
  'POST /enrichment/enrich',
  'GET /conversations',
  'GET /conversations/stream',
  'POST /conversations/dm',
]);

function hasExactCanonicalHermesActions(actions: readonly string[]): actions is readonly HermesCapability[] {
  return actions.length === HERMES_CANONICAL_ACTIONS.length
    && HERMES_CANONICAL_ACTIONS.every((action, index) => actions[index] === action);
}

function normalizeAudiencePath(rawPath: string): string {
  try {
    const path = new URL(rawPath, 'http://localhost').pathname;
    return path === '/api' ? '/' : path.replace(/^\/api(?=\/)/, '');
  } catch {
    return '';
  }
}

/** Exact method/path matrix for the active full standalone principal. */
export function authorizeHermesAgent(input: {
  method: string;
  path: string;
  agentId?: string;
  actions: readonly string[];
}): HermesAgentRouteDecision {
  if (!hasExactCanonicalHermesActions(input.actions)) {
    return { allowed: false, reason: 'dedicated_principal_route_denied' };
  }
  const method = input.method.toUpperCase();
  const path = normalizeAudiencePath(input.path);
  if (HERMES_AGENT_STATIC_ROUTES.has(`${method} ${path}`)) return { allowed: true };

  const segment = '[^/]+';
  const dynamicRoutes: ReadonlyArray<readonly [string, RegExp]> = [
    ['PATCH', new RegExp(`^/intents/${segment}/(?:status|archive)$`)],
    ['PATCH', new RegExp(`^/opportunities/${segment}/status$`)],
    ['POST', new RegExp(`^/opportunities/${segment}/start-chat$`)],
    ['POST', new RegExp(`^/questions/${segment}/(?:answer|dismiss)$`)],
    ['GET', new RegExp(`^/users/${segment}$`)],
    ['POST', new RegExp(`^/networks/${segment}/join$`)],
    ['PATCH', new RegExp(`^/network-requests/${segment}$`)],
    ['DELETE', new RegExp(`^/network-requests/${segment}$`)],
    ['GET', new RegExp(`^/conversations/${segment}/messages$`)],
    ['POST', new RegExp(`^/conversations/${segment}/messages$`)],
  ];
  if (dynamicRoutes.some(([allowedMethod, pattern]) => method === allowedMethod && pattern.test(path))) {
    return { allowed: true };
  }

  if (input.agentId) {
    const escapedAgentId = input.agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const negotiationRoute = new RegExp(
      `^/agents/${escapedAgentId}/negotiations/(?:pickup|${segment}/(?:respond|consult))$`,
    );
    if (method === 'POST' && negotiationRoute.test(path)) return { allowed: true };
  }
  return { allowed: false, reason: 'dedicated_principal_route_denied' };
}

/** Assert the full-principal route matrix after exact credential validation. */
export function assertHermesAgentAudienceRoute(
  context: Pick<HermesAgentPrincipal, 'audience' | 'agentId' | 'actions'>,
  request: Request,
): void {
  if (context.audience !== HERMES_AGENT_AUDIENCE) return;
  const decision = authorizeHermesAgent({
    method: request.method,
    path: request.url,
    agentId: context.agentId,
    actions: context.actions,
  });
  if (!decision.allowed) throw new HermesAgentRouteDeniedError();
}

/** Read the exact authenticated principal required by negotiation mutations. */
export function requireNegotiationCredentialPrincipal(req: Request): NegotiationCredentialPrincipal {
  const context = getRequestAuthContext(req);
  if (
    context?.kind !== 'api_key'
    || !context.agentId
    || !context.credentialId
    || context.audience === INDEX_APP_OWNER_AUDIENCE
  ) {
    throw new OwnerControlRequiredError('Negotiation polling requires an exact agent-bound API key');
  }
  return {
    credentialId: context.credentialId,
    agentId: context.agentId,
    audience: context.audience ?? null,
    setupAttemptId: context.setupAttemptId ?? null,
    ...(context.installationId ? { installationId: context.installationId } : {}),
    ...(context.actions ? { actions: context.actions } : {}),
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
  const authenticated = getRequestAuthContext(req);
  if (authenticated?.kind === 'api_key') return authenticated.agentId;

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

function nonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function invalidIndexAppOwnerCredential(reason: string, hash: string): Error {
  logger.warn('Index app owner credential rejected', {
    reason,
    keyHashPrefix: hash.slice(0, 8),
  });
  return new Error('Invalid API key');
}

export async function resolveIndexAppOwnerCredential(
  rawCredential: string,
  store: IndexAppOwnerAuthenticationStore = databaseIndexAppOwnerAuthenticationStore,
): Promise<{ user: AuthenticatedUser; principal: IndexAppOwnerPrincipal }> {
  if (!rawCredential.startsWith(INDEX_APP_OWNER_CREDENTIAL_PREFIX)
      || rawCredential.length <= INDEX_APP_OWNER_CREDENTIAL_PREFIX.length) throw new Error('Invalid API key');
  const hash = await hashIndexAppOwnerSecret(rawCredential);
  const row = await store.findCredentialByHash(hash);
  if (!row || !nonemptyString(row.id) || !nonemptyString(row.ownerId)
      || row.audience !== INDEX_APP_OWNER_AUDIENCE
      || !nonemptyString(row.installationId) || !nonemptyString(row.generation)
      || row.activationState !== 'active' || !(row.expiresAt instanceof Date)
      || !Number.isFinite(row.expiresAt.getTime()) || row.expiresAt.getTime() <= Date.now()) {
    throw invalidIndexAppOwnerCredential('malformed_or_inactive_row', hash);
  }
  const authority = await store.findCurrentInstallationAuthority(row.ownerId, row.installationId);
  if (!authority || authority.credentialId !== row.id || authority.ownerId !== row.ownerId
      || authority.installationId !== row.installationId || authority.generation !== row.generation) {
    throw invalidIndexAppOwnerCredential('stale_installation_authority', hash);
  }
  const user = await store.findUserById(row.ownerId);
  if (!user || user.id !== row.ownerId) throw invalidIndexAppOwnerCredential('owner_not_found', hash);
  return {
    user,
    principal: {
      ownerId: row.ownerId, credentialId: row.id, audience: INDEX_APP_OWNER_AUDIENCE,
      installationId: row.installationId, generation: row.generation,
      expiresAt: new Date(row.expiresAt), activationState: 'active',
    },
  };
}

export async function authenticateIndexAppOwnerCredential(
  req: Request,
  rawCredential: string,
  store: IndexAppOwnerAuthenticationStore = databaseIndexAppOwnerAuthenticationStore,
): Promise<AuthenticatedUser> {
  const { user, principal } = await resolveIndexAppOwnerCredential(rawCredential, store);
  const decision = authorizeIndexAppOwner({ method: req.method, path: req.url });
  if (!decision.allowed) throw new IndexAppOwnerRouteDeniedError();
  recordRequestAuthContext(req, {
    kind: 'api_key', agentId: null, audience: INDEX_APP_OWNER_AUDIENCE,
    credentialId: principal.credentialId, installationId: principal.installationId,
    setupAttemptId: principal.generation,
  });
  return user;
}

function invalidHermesAgentCredential(reason: string, hash: string): Error {
  logger.warn('Hermes agent credential rejected', {
    reason,
    keyHashPrefix: hash.slice(0, 8),
  });
  return new Error('Invalid API key');
}

/** Resolve one exact active dedicated principal without admitting a route. */
export async function resolveHermesAgentCredential(
  rawCredential: string,
  store: HermesAgentAuthenticationStore = databaseHermesAgentAuthenticationStore,
): Promise<{ user: AuthenticatedUser; principal: HermesAgentPrincipal }> {
  if (
    !rawCredential.startsWith(HERMES_AGENT_CREDENTIAL_PREFIX)
    || rawCredential.length <= HERMES_AGENT_CREDENTIAL_PREFIX.length
  ) throw new Error('Invalid API key');

  const hash = await hashHermesSecret(rawCredential);
  const row = await store.findCredentialByHash(hash);
  if (
    !row
    || !nonemptyString(row.id)
    || !nonemptyString(row.ownerId)
    || row.audience !== HERMES_AGENT_AUDIENCE
    || !nonemptyString(row.agentId)
    || !nonemptyString(row.installationId)
    || !nonemptyString(row.setupAttemptId)
    || row.activationState !== 'active'
    || !(row.expiresAt instanceof Date)
    || !Number.isFinite(row.expiresAt.getTime())
    || row.expiresAt.getTime() <= Date.now()
    || !Array.isArray(row.actions)
    || !hasExactCanonicalHermesActions(row.actions)
  ) throw invalidHermesAgentCredential('malformed_or_inactive_row', hash);

  const authority = await store.findAgentAuthority(row.agentId, row.ownerId);
  if (
    !authority
    || authority.id !== row.agentId
    || authority.ownerId !== row.ownerId
    || authority.runtimeKind !== 'hermes'
    || authority.installationId !== row.installationId
    || authority.setupAttemptId !== row.setupAttemptId
    || authority.status !== 'active'
    || authority.deletedAt !== null
    || !Array.isArray(authority.actions)
    || !hasExactCanonicalHermesActions(authority.actions)
  ) throw invalidHermesAgentCredential('stale_agent_authority', hash);

  const user = await store.findUserById(row.ownerId);
  if (!user || user.id !== row.ownerId) {
    throw invalidHermesAgentCredential('owner_not_found', hash);
  }

  return {
    user,
    principal: {
      ownerId: row.ownerId,
      credentialId: row.id,
      audience: HERMES_AGENT_AUDIENCE,
      agentId: row.agentId,
      installationId: row.installationId,
      setupAttemptId: row.setupAttemptId,
      actions: [...HERMES_CANONICAL_ACTIONS],
      expiresAt: new Date(row.expiresAt),
      activationState: 'active',
    },
  };
}

/** Authenticate and route-admit one active full standalone credential. */
export async function authenticateHermesAgentCredential(
  req: Request,
  rawCredential: string,
  store: HermesAgentAuthenticationStore = databaseHermesAgentAuthenticationStore,
): Promise<AuthenticatedUser> {
  const { user, principal } = await resolveHermesAgentCredential(rawCredential, store);
  recordRequestAuthContext(req, {
    kind: 'api_key',
    agentId: principal.agentId,
    audience: principal.audience,
    credentialId: principal.credentialId,
    setupAttemptId: principal.setupAttemptId,
    installationId: principal.installationId,
    actions: principal.actions,
  });
  assertHermesAgentAudienceRoute(principal, req);
  return user;
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

/** Prefix dispatcher that keeps dedicated hashes out of the frozen legacy lookup. */
export function authenticateRequestApiKey(
  req: Request,
  apiKey: string,
  stores: {
    legacy?: ApiKeyAuthenticationStore;
    hermesAgent?: HermesAgentAuthenticationStore;
    indexAppOwner?: IndexAppOwnerAuthenticationStore;
  } = {},
): Promise<AuthenticatedUser> {
  if (apiKey.startsWith(INDEX_APP_OWNER_CREDENTIAL_PREFIX)) {
    return authenticateIndexAppOwnerCredential(
      req,
      apiKey,
      stores.indexAppOwner ?? databaseIndexAppOwnerAuthenticationStore,
    );
  }
  if (apiKey.startsWith(HERMES_AGENT_CREDENTIAL_PREFIX)) {
    return authenticateHermesAgentCredential(
      req,
      apiKey,
      stores.hermesAgent ?? databaseHermesAgentAuthenticationStore,
    );
  }
  return authenticateApiKey(req, apiKey, stores.legacy ?? databaseApiKeyAuthenticationStore);
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

  return authenticateRequestApiKey(req, apiKey);
};

const databaseIndexAppOwnerAuthenticationStore: IndexAppOwnerAuthenticationStore = {
  async findCredentialByHash(hash) {
    const database = (await import('../lib/drizzle/drizzle')).default;
    const [row] = await database.select({
      id: indexAppOwnerCredentials.id,
      ownerId: indexAppOwnerCredentials.ownerId,
      audience: indexAppOwnerCredentials.audience,
      installationId: indexAppOwnerCredentials.installationId,
      generation: indexAppOwnerCredentials.generation,
      activationState: indexAppOwnerCredentials.activationState,
      expiresAt: indexAppOwnerCredentials.expiresAt,
    }).from(indexAppOwnerCredentials)
      .where(eq(indexAppOwnerCredentials.secretHash, hash)).limit(1);
    return row ?? null;
  },
  async findCurrentInstallationAuthority(ownerId, installationId) {
    const database = (await import('../lib/drizzle/drizzle')).default;
    const [row] = await database.select({
      credentialId: indexAppOwnerCredentials.id,
      ownerId: indexAppOwnerCredentials.ownerId,
      installationId: indexAppOwnerCredentials.installationId,
      generation: indexAppOwnerCredentials.generation,
    }).from(indexAppOwnerCredentials).where(and(
      eq(indexAppOwnerCredentials.ownerId, ownerId),
      eq(indexAppOwnerCredentials.installationId, installationId),
      eq(indexAppOwnerCredentials.audience, INDEX_APP_OWNER_AUDIENCE),
      eq(indexAppOwnerCredentials.activationState, 'active'),
    )).limit(1);
    return row ?? null;
  },
  async findUserById(userId) {
    const database = (await import('../lib/drizzle/drizzle')).default;
    const [user] = await database.select({ id: users.id, email: users.email, name: users.name })
      .from(users).where(eq(users.id, userId)).limit(1);
    return user ? { id: user.id, email: user.email ?? null, name: user.name } : null;
  },
};

const databaseHermesAgentAuthenticationStore: HermesAgentAuthenticationStore = {
  async findCredentialByHash(hash) {
    const database = (await import('../lib/drizzle/drizzle')).default;
    const [row] = await database.select({
      id: hermesAgentCredentials.id,
      ownerId: hermesAgentCredentials.ownerId,
      audience: hermesAgentCredentials.audience,
      agentId: hermesAgentCredentials.agentId,
      installationId: hermesAgentCredentials.installationId,
      setupAttemptId: hermesAgentCredentials.setupAttemptId,
      actions: hermesAgentCredentials.actions,
      activationState: hermesAgentCredentials.activationState,
      expiresAt: hermesAgentCredentials.expiresAt,
    }).from(hermesAgentCredentials)
      .where(eq(hermesAgentCredentials.secretHash, hash))
      .limit(1);
    return row ?? null;
  },
  async findAgentAuthority(agentId, ownerId) {
    const database = (await import('../lib/drizzle/drizzle')).default;
    const [row] = await database.select({
      id: agents.id,
      ownerId: agents.ownerId,
      runtimeKind: agents.runtimeKind,
      installationId: agents.installationId,
      setupAttemptId: agents.runtimeSetupAttemptId,
      status: agents.status,
      deletedAt: agents.deletedAt,
      actions: agentPermissions.actions,
    }).from(agents)
      .leftJoin(agentPermissions, and(
        eq(agentPermissions.agentId, agents.id),
        eq(agentPermissions.userId, ownerId),
        eq(agentPermissions.scope, 'global'),
      ))
      .where(and(eq(agents.id, agentId), eq(agents.ownerId, ownerId)))
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
