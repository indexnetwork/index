# JWT Issuer/Audience Hardening — Design Spec

**Date:** 2026-05-14
**Issue:** IND-257
**Status:** Approved

## Problem

`jwtVerify` calls in `auth.guard.ts` and `mcp.controller.ts` do not validate `iss` (issuer) or `aud` (audience) claims. The `jwt()` plugin in `betterauth.ts` already sets `issuer: BASE_URL` at issuance, but neither verification site checks it. No `aud` claim is set at all. A JWT issued by a different environment (e.g. dev against prod) would be accepted.

## Approach

Export a named `JWT_AUDIENCE` constant from `betterauth.ts`, set `audience: JWT_AUDIENCE` on issuance, and pass `{ issuer: BASE_URL, audience: JWT_AUDIENCE }` to both `jwtVerify` calls.

`JWT_AUDIENCE = BASE_URL` — same value as the issuer. Single-service JWT, so no need for a distinct audience identifier.

## Files Changed

### `backend/src/lib/betterauth/betterauth.ts`

- Export `JWT_AUDIENCE = BASE_URL` alongside the existing `BASE_URL` export.
- Add `audience: JWT_AUDIENCE` to the `jwt()` plugin's `jwt` config object.

```ts
export const JWT_AUDIENCE = BASE_URL;

jwt({
  jwt: {
    issuer: BASE_URL,
    audience: JWT_AUDIENCE,
    expirationTime: "1h",
    definePayload: ({ user }) => ({ id: user.id, email: user.email, name: user.name }),
  },
})
```

### `backend/src/guards/auth.guard.ts`

- Import `BASE_URL` and `JWT_AUDIENCE` from `betterauth`.
- Pass `{ issuer: BASE_URL, audience: JWT_AUDIENCE }` as the options argument to `jwtVerify`.

### `backend/src/controllers/mcp.controller.ts`

- Already imports `BASE_URL` from `betterauth`. Also import `JWT_AUDIENCE`.
- Pass the same `{ issuer: BASE_URL, audience: JWT_AUDIENCE }` options to its `jwtVerify` call.

## Migration Impact

JWT Bearer tokens are only used interactively (CLI, browser OAuth flow). All headless/automation access uses `x-api-key`, which goes through a completely separate path and is unaffected. Live JWT tokens at deploy time will fail verification for at most 1h (their expiry), after which newly issued tokens carry `aud` and pass. Acceptable for a security fix.

## Out of Scope

- `aud` on opaque OAuth tokens (handled by `mcp()` plugin, not `jwtVerify`)
- API key auth — unaffected
- Third-party service audience discrimination — not needed currently
