# API Guards

Guards are functions that run before a route handler to enforce authentication, authorization, feature gating, or rate limiting. They either return a value (passed to the handler) or throw to reject the request.

## Guards

### `auth.guard.ts` — `AuthGuard`
Authenticates the request by verifying a Better Auth JWT (`Authorization: Bearer` header or `?token=` query param) first, then falling back to an API key (`x-api-key` header, SHA-256 hashed and looked up in the `apikeys` table). Returns the resolved `AuthenticatedUser` or throws if credentials are missing, invalid, disabled, or expired.

### `auth.guard.ts` — `SessionOnlyGuard`
Accepts only a Better Auth session JWT (`Authorization: Bearer` or `?token=`) and rejects API-key-only requests with `SessionRequiredError` (mapped to HTTP 403 in `main.ts`). Applied to endpoints where a leaked agent API key must not be able to act: `DELETE /auth/account` and the `/agents` management writes (create/update/delete agent, tokens, permissions, transports) — a key that can mint successor credentials or grant itself permissions defeats rotation of the leaked key (IND-384).

### `agent-scope.guard.ts` — `assertAgentNetworkScope` / `withAgentScope`
Restricts API-key-authenticated agents to their bound network: if the key's agent has a `scope='network'` permission, requests targeting any other network throw a `ScopeViolationError` (mapped to HTTP 403). JWT-authenticated requests and global (unscoped) agents pass through unaffected; `withAgentScope` exposes the scope for handlers that need to filter list results.

### `debug.guard.ts` — `DebugGuard`
Environment-based gate for debug API endpoints. Allows requests only when `NODE_ENV === 'development'` or `ENABLE_DEBUG_API === 'true'`; otherwise throws a 404-mapped error.

### `master-key.guard.ts` — `MasterKeyGuard`
Authorizes master-key-protected network endpoints (master-key signup, CSV import, cohort delete) by validating the `x-api-key` header against the network's stored `masterKeyHash`. Returns the network (`{ id, title }`) on success; throws a 400/401/403 `Response` if the network id is missing, the key is absent, or the network has no master key / the key doesn't match.

### `limiter.guard.ts` — `RateLimit(class)`
Factory that returns a per-route-class rate-limiting guard, run before auth. Buckets requests by verified user id (hashed) or client IP, enforces the class's per-minute limit via Redis-backed storage (failing open on storage errors), stashes `RateLimitInfo` for response headers, and throws `RateLimiterError` (429) when the limit is exceeded; private/loopback IPs and system agents bypass limiting.
