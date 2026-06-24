import { eq } from 'drizzle-orm/sql';

import db from '../lib/drizzle/drizzle';
import { agentPermissions } from '../schemas/database.schema';
import type { AuthenticatedUser } from './auth.guard';
import { resolveApiKeyAgentId } from './auth.guard';

/**
 * Thrown by `assertAgentNetworkScope` when an API-key-authenticated request
 * targets a network outside the agent's bound scope. Carried up through the
 * controller and mapped to HTTP 403 by the route registry's error handler in
 * `main.ts`. The custom class lets the handler distinguish scope violations
 * from generic `Error`s without string-matching.
 */
export class ScopeViolationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScopeViolationError';
  }
}

/**
 * Resolve the network the given agent's network-level access is restricted to.
 *
 * Returns `null` (no network restriction) when either:
 *  - the agent has only `scope='global'` permissions, OR
 *  - the agent has no `scope='network'` permissions / doesn't exist.
 *
 * If the agent has at least one `scope='network'` permission, returns the
 * single shared `scopeId` even if a stale/global permission row is also present.
 * This intentionally fails closed for mixed-permission agents: a key that was
 * ever bound to a network must not silently become global because an unrelated
 * global row exists. Other non-global permissions (e.g. `scope='node'`) are
 * ignored here because they don't constrain network-level access. Throws if the
 * agent's network-scoped permissions disagree on `scopeId` (defensive — should
 * never happen for imported agents).
 *
 * @param agentId - The agent UUID whose permissions are inspected
 * @returns The bound network id, or `null` if the agent has no network restriction
 * @throws If the agent has multiple distinct network scopes
 */
export const resolveAgentNetworkScopeById = async (agentId: string): Promise<string | null> => {
  const rows = await db
    .select({ scope: agentPermissions.scope, scopeId: agentPermissions.scopeId })
    .from(agentPermissions)
    .where(eq(agentPermissions.agentId, agentId));

  if (rows.length === 0) return null;

  const networkScoped = rows.filter((r) => r.scope === 'network' && r.scopeId);
  if (networkScoped.length === 0) return null;

  const distinctIds = new Set(networkScoped.map((r) => r.scopeId!));
  if (distinctIds.size > 1) {
    throw new Error(`Agent ${agentId} has conflicting network scopes: ${[...distinctIds].join(', ')}`);
  }
  return networkScoped[0].scopeId!;
};

/**
 * Resolve the network the current request's agent is restricted to, or null
 * if the request is JWT-authenticated, has no API key, the key carries no
 * `metadata.agentId`, or the agent has no network-scoped permissions.
 *
 * If the agent has any network-scoped permissions, returns the single `scopeId`
 * they share, even when a stale/global permission row is also present. Throws if
 * the agent's network-scoped permissions disagree on `scopeId` (defensive —
 * should never happen for imported agents).
 *
 * @param req - The incoming request whose `x-api-key` header is inspected
 * @returns The bound network id, or `null` if the agent is not network-scoped
 * @throws If the agent has multiple distinct network scopes
 */
export const resolveAgentNetworkScope = async (req: Request): Promise<string | null> => {
  // JWT auth wins: if the caller is a session/JWT user, ignore any incidental
  // `x-api-key` header (which may be forwarded by a proxy or carried over from
  // a prior request) so they aren't unexpectedly 403'd by an unrelated key.
  const authHeader = req.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) return null;
  const queryToken = new URL(req.url, 'http://localhost').searchParams.get('token');
  if (queryToken) return null;

  const agentId = await resolveApiKeyAgentId(req);
  if (!agentId) return null;
  return resolveAgentNetworkScopeById(agentId);
};

/**
 * Assert the current request's agent (if network-scoped) is allowed to act
 * on `networkId`. No-op for JWT-authenticated requests and for global agents.
 *
 * @param req - The incoming request whose agent scope is checked
 * @param networkId - The network the caller intends to act on
 * @throws If the agent is bound to a different network than `networkId`
 */
export const assertAgentNetworkScope = async (req: Request, networkId: string): Promise<void> => {
  const scope = await resolveAgentNetworkScope(req);
  if (scope === null) return;
  if (scope !== networkId) {
    throw new ScopeViolationError(
      `Agent is restricted to its bound network scope and cannot act on network ${networkId}`,
    );
  }
};

/**
 * Returns the auth'd user paired with the agent's network scope (if any).
 * Use this in handlers that need to filter list results by scope. Use
 * `assertAgentNetworkScope` directly when the network is known up-front
 * from the route param.
 *
 * @param req - Incoming Request
 * @param user - Already-resolved AuthenticatedUser (from AuthGuard / AuthOrApiKeyGuard)
 * @returns `{ user, networkScopeId }` where `networkScopeId` is null for unscoped callers
 */
export const withAgentScope = async (
  req: Request,
  user: AuthenticatedUser,
): Promise<{ user: AuthenticatedUser; networkScopeId: string | null }> => {
  return { user, networkScopeId: await resolveAgentNetworkScope(req) };
};
