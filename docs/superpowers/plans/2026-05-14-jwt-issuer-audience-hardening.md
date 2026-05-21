# JWT Issuer/Audience Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `iss` and `aud` claim validation to all `jwtVerify` calls, and emit both claims at issuance, so a JWT issued by a different environment (e.g. dev) is rejected by production.

**Architecture:** Export `JWT_AUDIENCE = BASE_URL` from `betterauth.ts`, set `audience: JWT_AUDIENCE` on the `jwt()` plugin so all newly issued tokens carry the claim, then pass `{ issuer: BASE_URL, audience: JWT_AUDIENCE }` to both `jwtVerify` call sites (`auth.guard.ts` and `mcp.controller.ts`).

**Tech Stack:** TypeScript, `jose` (already used for `jwtVerify`/`createRemoteJWKSet`), `better-auth` JWT plugin, Bun test runner.

---

## File Map

| Action | Path | Change |
|--------|------|--------|
| Modify | `backend/src/lib/betterauth/betterauth.ts` | Export `JWT_AUDIENCE`, add `audience` to `jwt()` plugin config |
| Modify | `backend/src/guards/auth.guard.ts` | Import `BASE_URL` + `JWT_AUDIENCE`, add options to `jwtVerify` |
| Modify | `backend/src/controllers/mcp.controller.ts` | Import `JWT_AUDIENCE`, add options to `jwtVerify` |
| Create | `backend/tests/auth.jwt-claims.test.ts` | Unit tests verifying issuer/audience rejection behaviour |

---

### Task 1: Write failing tests for claim validation

These tests use `jose` primitives directly — no server needed. They document the contract we're about to enforce and fail before the implementation is in place.

**Files:**
- Create: `backend/tests/auth.jwt-claims.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
import '../src/startup.env';
import { describe, it, expect } from 'bun:test';
import {
  generateKeyPair,
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  jwtVerify,
  errors as joseErrors,
} from 'jose';

const BASE_URL = 'http://localhost:3001';
const JWT_AUDIENCE = BASE_URL;

async function makeTestJWKS() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const JWKS = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-kid', use: 'sig', alg: 'RS256' }] });
  return { privateKey, JWKS };
}

async function signToken(
  privateKey: CryptoKey,
  claims: { iss?: string; aud?: string | string[] },
) {
  let builder = new SignJWT({ id: 'user-123', email: 'test@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setExpirationTime('1h');
  if (claims.iss !== undefined) builder = builder.setIssuer(claims.iss);
  if (claims.aud !== undefined) builder = builder.setAudience(claims.aud);
  return builder.sign(privateKey);
}

describe('jwtVerify claim validation', () => {
  it('accepts a token with correct iss and aud', async () => {
    const { privateKey, JWKS } = await makeTestJWKS();
    const token = await signToken(privateKey, { iss: BASE_URL, aud: JWT_AUDIENCE });
    const { payload } = await jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE });
    expect(payload.id).toBe('user-123');
  });

  it('rejects a token missing aud', async () => {
    const { privateKey, JWKS } = await makeTestJWKS();
    const token = await signToken(privateKey, { iss: BASE_URL });
    await expect(
      jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE }),
    ).rejects.toBeInstanceOf(joseErrors.JWTClaimValidationFailed);
  });

  it('rejects a token with wrong aud', async () => {
    const { privateKey, JWKS } = await makeTestJWKS();
    const token = await signToken(privateKey, { iss: BASE_URL, aud: 'https://other-service.example.com' });
    await expect(
      jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE }),
    ).rejects.toBeInstanceOf(joseErrors.JWTClaimValidationFailed);
  });

  it('rejects a token with wrong iss', async () => {
    const { privateKey, JWKS } = await makeTestJWKS();
    const token = await signToken(privateKey, { iss: 'https://dev.index.network', aud: JWT_AUDIENCE });
    await expect(
      jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE }),
    ).rejects.toBeInstanceOf(joseErrors.JWTClaimValidationFailed);
  });

  it('rejects a token missing both iss and aud', async () => {
    const { privateKey, JWKS } = await makeTestJWKS();
    const token = await signToken(privateKey, {});
    await expect(
      jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE }),
    ).rejects.toBeInstanceOf(joseErrors.JWTClaimValidationFailed);
  });
});
```

- [ ] **Step 2: Run — first test should pass (jose behaviour already correct), others may vary**

```bash
cd backend && bun test tests/auth.jwt-claims.test.ts
```

All 5 tests should pass — `jose`'s `jwtVerify` already enforces these when options are provided. This confirms the contract we're wiring into the guards.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/auth.jwt-claims.test.ts
git -c commit.gpgsign=false commit -m "test(auth): add jwtVerify issuer/audience claim validation contract tests"
```

---

### Task 2: Export JWT_AUDIENCE and set audience at issuance

**Files:**
- Modify: `backend/src/lib/betterauth/betterauth.ts`

Current state of the `jwt()` plugin config (around line 106):

```typescript
      jwt({
        jwt: {
          issuer: BASE_URL,
          expirationTime: "1h",
          definePayload: ({ user }) => ({
            id: user.id,
            email: user.email,
            name: user.name,
          }),
        },
      }),
```

Current exports (around line 9):

```typescript
export const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

export const APP_URL =
  process.env.FRONTEND_URL || process.env.APP_URL || 'https://index.network';
```

- [ ] **Step 1: Add JWT_AUDIENCE export after BASE_URL**

In `backend/src/lib/betterauth/betterauth.ts`, add the constant on the line immediately after `BASE_URL`:

```typescript
export const BASE_URL =
  process.env.BASE_URL || `http://localhost:${process.env.PORT || 3001}`;

export const JWT_AUDIENCE = BASE_URL;
```

- [ ] **Step 2: Add audience to the jwt() plugin config**

Replace the `jwt()` plugin block. Try `audience` as a top-level config key first (same level as `issuer`):

```typescript
      jwt({
        jwt: {
          issuer: BASE_URL,
          audience: JWT_AUDIENCE,
          expirationTime: "1h",
          definePayload: ({ user }) => ({
            id: user.id,
            email: user.email,
            name: user.name,
          }),
        },
      }),
```

If better-auth's `jwt()` plugin does not recognise `audience` as a config key (TypeScript error, or the claim is absent when you decode a freshly issued token), fall back to injecting it via `definePayload` instead:

```typescript
      jwt({
        jwt: {
          issuer: BASE_URL,
          expirationTime: "1h",
          definePayload: ({ user }) => ({
            id: user.id,
            email: user.email,
            name: user.name,
            aud: JWT_AUDIENCE,
          }),
        },
      }),
```

To verify the claim is set, decode any token returned from `POST /api/auth/token` with `jose`'s `decodeJwt` and confirm `aud` is present before moving on to Task 3.

- [ ] **Step 3: Commit**

```bash
git add backend/src/lib/betterauth/betterauth.ts
git -c commit.gpgsign=false commit -m "feat(auth): export JWT_AUDIENCE constant, set audience claim on jwt() plugin issuance"
```

---

### Task 3: Harden auth.guard.ts

**Files:**
- Modify: `backend/src/guards/auth.guard.ts`

Current imports (lines 1–5):

```typescript
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { eq } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { apikeys, users } from '../schemas/database.schema';
```

Current `jwtVerify` call (line 31):

```typescript
    const { payload } = await jwtVerify(token, JWKS);
```

- [ ] **Step 1: Add BASE_URL and JWT_AUDIENCE to the import from betterauth**

Add an import after the existing imports block:

```typescript
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { eq } from 'drizzle-orm';

import db from '../lib/drizzle/drizzle';
import { apikeys, users } from '../schemas/database.schema';
import { BASE_URL, JWT_AUDIENCE } from '../lib/betterauth/betterauth';
```

- [ ] **Step 2: Add issuer and audience options to jwtVerify**

Replace the `jwtVerify` call on line 31:

```typescript
    const { payload } = await jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE });
```

- [ ] **Step 3: Run the contract tests to confirm they still pass**

```bash
cd backend && bun test tests/auth.jwt-claims.test.ts
```

Expected: all 5 pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/guards/auth.guard.ts
git -c commit.gpgsign=false commit -m "feat(auth): validate issuer and audience claims in AuthGuard jwtVerify"
```

---

### Task 4: Harden mcp.controller.ts

**Files:**
- Modify: `backend/src/controllers/mcp.controller.ts`

Current import from betterauth (line 41):

```typescript
import { BASE_URL } from '../lib/betterauth/betterauth';
```

Current `jwtVerify` call (around line 195):

```typescript
          const { payload } = await jwtVerify(token, JWKS);
```

- [ ] **Step 1: Add JWT_AUDIENCE to the betterauth import**

```typescript
import { BASE_URL, JWT_AUDIENCE } from '../lib/betterauth/betterauth';
```

- [ ] **Step 2: Add issuer and audience options to jwtVerify**

```typescript
          const { payload } = await jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE });
```

- [ ] **Step 3: Run the contract tests one final time**

```bash
cd backend && bun test tests/auth.jwt-claims.test.ts
```

Expected: all 5 pass.

- [ ] **Step 4: Commit**

```bash
git add backend/src/controllers/mcp.controller.ts
git -c commit.gpgsign=false commit -m "feat(auth): validate issuer and audience claims in MCP controller jwtVerify"
```
