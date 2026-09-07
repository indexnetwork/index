# API Guards

Guards are functions that run before a route handler to enforce authentication, authorization, or feature gating. They either return a value (passed to the handler) or throw to reject the request.

## Guards

### `auth.guard.ts` — `AuthGuard`
Authenticates the request by verifying a Better Auth JWT (`Authorization: Bearer` header or `?token=` query param) first, then falling back to an API key (`x-api-key` header, SHA-256 hashed and looked up in the `apikeys` table). Returns the resolved `AuthenticatedUser` or throws if credentials are missing, invalid, disabled, or expired.

### `auth.guard.ts` — `SessionOnlyGuard`
Accepts only a Better Auth session JWT (`Authorization: Bearer` or `?token=`) and rejects API-key-only requests with `SessionRequiredError` (mapped to HTTP 403 in `main.ts`). Applied to owner control: `DELETE /auth/account`, minting and listing API keys, and the `/agents` writes (create/update/delete, including picking the negotiator) — a leaked key must not be able to mint a successor, retarget the negotiator, or destroy the account.

### `debug.guard.ts` — `DebugGuard`
Environment-based gate for debug API endpoints. Allows requests only when `NODE_ENV === 'development'` or `ENABLE_DEBUG_API === 'true'`; otherwise throws a 404-mapped error.
