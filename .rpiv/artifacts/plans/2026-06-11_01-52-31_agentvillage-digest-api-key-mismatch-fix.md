---
date: 2026-06-11T01:52:31+0300
author: Yankı Ekin Yüksel
commit: 9291ec3595
branch: dev
repository: index
topic: "AgentVillage digest API key mismatch root-cause fix"
tags: [fix, agentvillage, digest, install, auth-guard, api-key, identity, install_index]
status: ready
parent: .rpiv/artifacts/research/2026-06-11_01-25-06_agentvillage-digest-api-key-mismatch.md
phase_count: 4
phases:
  - { n: 1, title: Backend guard swap }
  - { n: 2, title: Install identity check }
  - { n: 3, title: Async wiring and digest runtime logging }
  - { n: 4, title: Backend test for /me with API key }
unresolved_phase_count: 0
last_updated: 2026-06-11T01:52:31+0300
last_updated_by: Yankı Ekin Yüksel
---

# AgentVillage Digest API Key Mismatch Root-Cause Fix Implementation Plan

## Overview

User C received User A's opportunities in their daily digest because User C's `HERMES_HOME` had User A's `INDEX_API_KEY`. The MCP session authenticated as User A, fetched User A's opportunities, minted User A's connect links, and staged them into User C's digest. Fix: (1) swap `GET /api/auth/me` from `AuthGuard` to `AuthOrApiKeyGuard` so the endpoint accepts API keys, (2) call it during `installIndex()` before any disk write and fail on telegram-handle mismatch, (3) log the authenticated identity before every digest MCP session so misconfigurations are visible in logs.

## Requirements

- A `GET /api/auth/me` must accept `x-api-key` header and return the authenticated user's identity (including `socials[]` for telegram handle extraction)
- `installIndex()` must verify the API key resolves to the expected resident before writing `INDEX_API_KEY` to disk
  - Present + mismatched telegram handle → exit 1 with clear error
  - Profile has no telegram handle but `--telegram-handle` was provided → warn + continue
  - Network error calling `/api/auth/me` → warn + continue
- `buildDailyBriefContext` must log `authenticatedAs: { id, name, email }` before calling `fetchOpportunitiesFromMcp` — never block on failure
- All existing behavior for JWT-authenticated calls to `GET /api/auth/me` must be unchanged

## Current State Analysis

### Key Discoveries

- `auth.controller.ts:63` — `GET /me` under `@UseGuards(RateLimit('read'), AuthGuard)` — JWT only; an API-key-only request throws `'Access token required'`
- `auth.guard.ts:93` — `AuthOrApiKeyGuard` already implements SHA-256 key hash → `apikeys` table lookup → `resolveApiKeyUserId` → user fetch; backward compatible with JWT (tries Bearer first)
- `auth.controller.ts:71` — `userService.findWithGraph(user.id)` — `findWithGraph` returns `{ id, name, email, intro, avatar, location, socials[], onboarding? }` (confirmed at `database.adapter.ts:4427`)
- `auth.controller.ts:78-83` — response is `const { profile: _profile, notificationPreferences, ...userFields } = fullUser; return { user: { ...userFields, notificationPreferences } }` — **`socials` is already in the response envelope** — no response shape change needed
- `install_index.ts` — `installIndex()` is synchronous: `readApiKey()` → `readTelegramHandle()` → `upsertEnvVar()` (first disk write) → `writeMcpServerEntry()` → `reconcileDigestCronJobs()`; identity check inserts between `readTelegramHandle()` and `upsertEnvVar()`
- `install_index.ts:21-23` — `PROTOCOL_MCP_URL` is a module-level constant; backend base URL = `PROTOCOL_MCP_URL.replace(/\/mcp$/, '')`
- `install.ts:183` — `function main(): void`; `install.ts:199` — `installIndex()` called synchronously; `install.ts:214` — `main()` top-level call
- `build-daily-brief-context.ts:704-706` — reads `INDEX_API_KEY` + `INDEX_MCP_URL` from env; backend base URL = `mcpUrl.replace(/\/mcp$/, '')`
- No existing `normalizeTelegramHandle` in install scripts (`args.ts`, `env.ts`); normalization logic in SQL at `database.adapter.ts:4483` — strips `@`, URL prefix, lowercases

### Constraints

- `AuthGuard` → `AuthOrApiKeyGuard` swap is safe: `AuthOrApiKeyGuard` tries JWT Bearer first, so all existing JWT callers (frontend, `/api/auth` flow) are unaffected
- `install.ts main()` must go async to `await installIndex()` — it's currently `function main(): void` + `main()` at the top level
- `fetchOpportunitiesFromMcp` must NOT be blocked by the identity log call; always catch and continue

## Desired End State

```ts
// Backend: GET /api/auth/me now accepts x-api-key
// curl -H 'x-api-key: index_abc123' https://protocol.index.network/api/auth/me
// → { user: { id, name, email, socials: [{ label: 'telegram', value: 'https://t.me/alice' }], ... } }

// Install: identity verified before any disk write
// bun install/install.ts --index-api-key index_abc123 --telegram-handle alice
// → index network: target=production (https://protocol.index.network/mcp)
// → verifying Index Network identity...
// → authenticated as Alice Smith (alice@example.com) — telegram: @alice ✓
// → wrote INDEX_API_KEY to .env
// ...

// Install: mismatch exits non-zero
// bun install/install.ts --index-api-key index_abc123 --telegram-handle bob
// → verifying Index Network identity...
// error: API key authenticates as @alice, expected @bob — wrong key for this resident
// (exit 1)

// Digest: identity logged every run
// [build-daily-brief-context] authenticatedAs: { id: 'user-abc', name: 'Alice Smith', email: 'alice@...' }
```

## What We're NOT Doing

- Adding a new REST endpoint (guard swap is enough; `/api/auth/me` already has the right shape)
- Changing the `/me` response body (socials already returned)
- Adding `--check-identity` mode to `reconcile_digest_crons.ts` (not in FRD scope; deferred)
- Building a fleet audit script (research Open Question #1; deferred)
- Failing the digest on identity log error (always warn + continue)
- Adding new DB methods (existing `findWithGraph` returns socials)
- Schema migrations (no model changes)

## Decisions

### Decision 1: Guard swap vs. new endpoint

**Ambiguity:** Does `GET /api/auth/me` need a new route for API-key access or can the existing handler be extended?

**Explored:**
- Option A: New `GET /api/identify` under `AuthOrApiKeyGuard` on `auth.controller.ts` — adds a route, keeps `/me` JWT-only
- Option B: Swap `GET /me` guard from `AuthGuard` to `AuthOrApiKeyGuard` — one-line change, backward compatible

**Decision:** Option B — swap guard. `AuthOrApiKeyGuard` (`auth.guard.ts:93`) tries JWT Bearer first; existing frontend JWT callers are unaffected. No new route, no new response envelope needed. Modeled after agent.controller.ts and network.controller.ts which use `AuthOrApiKeyGuard` on GET endpoints.

### Decision 2: Response shape change

**Ambiguity:** Does `/me` need to return `telegramHandle: string | null` explicitly?

**Explored:**
- Option A: Add `telegramHandle` as a top-level field by extracting it in `auth.controller.ts:me()`
- Option B: Return `socials[]` as-is (already in the response body) — client filters

**Decision:** Option B — `socials[]` already in `userFields` spread (`auth.controller.ts:78`). Install script filters for `label === 'telegram'` and normalizes inline. Cleaner: the endpoint stays general-purpose; callers extract what they need.

### Decision 3: Network error behavior at install time

**Decision:** Warn + continue. Log: `"  warning: identity check unavailable — proceeding without verification"`. Allows offline installs and container startup-order cases. Only a present + mismatched handle causes exit 1.

### Decision 4: normalizeTelegramHandle implementation

**Decision:** Inline helper in `install_index.ts`, modeled after `database.adapter.ts:4483` SQL normalization — strip leading `@`, strip `https://t.me/` or `http://t.me/` or `t.me/`, lowercase everything.

### Decision 5: Digest identity log failure behavior

**Decision:** Always catch and continue — the digest run must never be blocked by an identity log call that fails due to network issues.

## Phase 1: Backend guard swap

### Overview
Swap `auth.controller.ts:63` from `@UseGuards(RateLimit('read'), AuthGuard)` to `@UseGuards(RateLimit('read'), AuthOrApiKeyGuard)`. This is the foundation: without this, the install script cannot call `/api/auth/me` with an API key. Depends on nothing. All subsequent phases depend on this.

### Changes Required:

#### 1. backend/src/controllers/auth.controller.ts

**File**: `backend/src/controllers/auth.controller.ts`
**Changes**: MODIFY — import `AuthOrApiKeyGuard`, swap guard on `me()`

```ts
// Replace the AuthGuard import line:
import { AuthGuard, AuthOrApiKeyGuard } from '../guards/auth.guard';

// Replace the me() UseGuards decorator:
@Get('/me')
@UseGuards(RateLimit('read'), AuthOrApiKeyGuard)
async me(_req: Request, user: AuthenticatedUser) {
  // body unchanged
}
```

### Success Criteria:

#### Automated Verification:
- [x] ESLint passes: `cd backend && bun run lint`
- [x] `AuthOrApiKeyGuard` exported from guard file: `grep -c 'export const AuthOrApiKeyGuard' backend/src/guards/auth.guard.ts` returns 1
- [x] `AuthGuard` still imported (used by updateProfile + deleteAccount): `grep -c 'AuthGuard' backend/src/controllers/auth.controller.ts` returns >= 3

#### Manual Verification:
- [ ] Only `me()` guard changed; `updateProfile` and `deleteAccount` still use `AuthGuard`
- [ ] Import line has both guards side-by-side (not a replacement)
- [ ] Frontend JWT callers to GET /me unaffected — `AuthOrApiKeyGuard` tries Bearer first

## Phase 2: Install identity check

### Overview
Add `normalizeTelegramHandle()` and `verifyIndexIdentity()` helpers to `install_index.ts`, then make `installIndex()` async and insert the identity check between `readTelegramHandle()` and the first `upsertEnvVar()` call. Depends on Phase 1 (the backend endpoint must accept API keys before the install script can call it).

### Changes Required:

#### 1. packages/edge-city/agentvillage/install/install_index.ts

**File**: `packages/edge-city/agentvillage/install/install_index.ts`
**Changes**: MODIFY — add normalizeTelegramHandle, verifyIndexIdentity; make installIndex() async

```ts
// Add after the existing `buildIndexMcpHeaders` export and before `writeMcpServerEntry`:

/**
 * Normalize a Telegram handle to a bare lowercase handle.
 * Strips leading @, URL prefix (t.me/, https://t.me/, telegram.me/), and
 * everything after the first /, ?, or # — matching the SQL normalization
 * in database.adapter.ts:4483.
 */
export function normalizeTelegramHandle(value: string): string {
  let v = value.trim().toLowerCase();
  v = v.replace(/^(https?:\/\/)?(t\.me|telegram\.me)\//, '');
  v = v.replace(/^@/, '');
  v = v.replace(/[/?#].*$/, '');
  return v;
}

/**
 * Verify that the given API key resolves to the expected resident on Index Network.
 * Calls GET /api/auth/me with the key and compares the profile telegram handle against
 * the expected handle (if provided).
 *
 * Exit codes:
 *   - HTTP 401/403: key is invalid/expired → exit 1
 *   - telegram handle mismatch: wrong key for this resident → exit 1
 *   - network error / missing profile handle: warn + continue
 */
async function verifyIndexIdentity(apiKey: string, telegramHandle: string): Promise<void> {
  const baseUrl = PROTOCOL_MCP_URL.replace(/\/mcp$/, '');
  console.log('  verifying Index Network identity...');

  type MeUser = {
    id: string;
    name: string;
    email: string | null;
    socials?: Array<{ label: string; value: string }>;
  };

  let identity: MeUser | null = null;

  try {
    const resp = await fetch(`${baseUrl}/api/auth/me`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(10_000),
    });

    if (resp.status === 401 || resp.status === 403) {
      console.error(
        `error: API key rejected by Index Network (HTTP ${resp.status}) — invalid or expired key`,
      );
      process.exit(1);
    }

    if (!resp.ok) {
      console.warn(
        `  warning: identity check unavailable (HTTP ${resp.status}) — proceeding without verification`,
      );
      return;
    }

    const json = (await resp.json()) as { user?: MeUser };
    identity = json.user ?? null;
  } catch (err) {
    const reason = err instanceof Error && err.name === 'TimeoutError'
      ? 'timeout after 10 s'
      : 'network error';
    console.warn(
      `  warning: identity check unavailable (${reason}) — proceeding without verification`,
    );
    return;
  }

  if (!identity) {
    console.warn(
      '  warning: identity check returned empty user — proceeding without verification',
    );
    return;
  }

  const displayName = `${identity.name}${identity.email ? ` (${identity.email})` : ''}`;

  if (!telegramHandle) {
    console.log(`  authenticated as ${displayName}`);
    return;
  }

  const telegramSocial = identity.socials?.find((s) => s.label === 'telegram');

  if (!telegramSocial) {
    console.warn(
      `  warning: authenticated as ${displayName} — no telegram handle on profile, cannot verify @${telegramHandle}`,
    );
    return;
  }

  const profileHandle = normalizeTelegramHandle(telegramSocial.value);
  const expectedHandle = normalizeTelegramHandle(telegramHandle);

  if (profileHandle !== expectedHandle) {
    console.error(
      `error: API key authenticates as @${profileHandle}, expected @${expectedHandle} — wrong key for this resident`,
    );
    process.exit(1);
  }

  console.log(`  authenticated as ${displayName} — telegram: @${profileHandle} ✓`);
}

// Replace the existing installIndex() function:
export async function installIndex(): Promise<void> {
  const apiKey = readApiKey();
  const telegramHandle = readTelegramHandle();
  console.log(
    `→ index network: target=${IS_DEV ? 'dev' : 'production'} (${PROTOCOL_MCP_URL})`,
  );
  await verifyIndexIdentity(apiKey, telegramHandle);
  upsertEnvVar('INDEX_API_KEY', apiKey);
  if (telegramHandle) upsertEnvVar('INDEX_TELEGRAM_HANDLE', telegramHandle);
  writeMcpServerEntry(apiKey, telegramHandle);

  if (!process.argv.includes('--skip-crons')) {
    reconcileDigestCronJobs(hermesExecEnv());
  }
}
```

### Success Criteria:

#### Automated Verification:
- [x] `normalizeTelegramHandle` exported: `grep -c 'export function normalizeTelegramHandle' packages/edge-city/agentvillage/install/install_index.ts` returns 1
- [x] `installIndex` is async: `grep -c 'export async function installIndex' packages/edge-city/agentvillage/install/install_index.ts` returns 1
- [x] `normalizeTelegramHandle('@alice')` → `'alice'`
- [x] `normalizeTelegramHandle('https://t.me/Alice/')` → `'alice'`
- [x] `normalizeTelegramHandle('t.me/alice')` → `'alice'`
- [x] `normalizeTelegramHandle('')` → `''` (empty string passthrough)
- [x] `normalizeTelegramHandle('ALICE')` → `'alice'` (case-insensitive)

#### Manual Verification:
- [ ] `verifyIndexIdentity` is NOT exported (internal helper)
- [ ] Identity check is called after `readTelegramHandle()` and before `upsertEnvVar("INDEX_API_KEY", ...)`
- [ ] On HTTP 401/403 → `process.exit(1)` with clear error
- [ ] On network error / non-ok response → warn + continue (no exit)
- [ ] On telegram mismatch → `process.exit(1)` with clear error
- [ ] On missing telegram social but handle provided → warn + continue
- [ ] On no `--telegram-handle` flag → just log identity, no comparison

## Phase 3: Async wiring and digest runtime logging

### Overview
Make `install.ts main()` async to `await installIndex()`. Add a best-effort `/api/auth/me` call at the start of `buildDailyBriefContext` that logs the authenticated identity before any MCP call. Depends on Phase 2 (`installIndex()` is now async). Can run in parallel with Phase 4.

### Changes Required:

#### 1. packages/edge-city/agentvillage/install/install.ts:183-214

**File**: `packages/edge-city/agentvillage/install/install.ts`
**Changes**: MODIFY — `function main(): void` → `async function main()`, `installIndex()` → `await installIndex()`, `main()` → `main().catch(console.error)`

```ts
// Change 1: line 183
- function main(): void {
+ async function main(): Promise<void> {

// Change 2: line 199
-   installIndex();
+   await installIndex();

// Change 3: line 214
- main();
+ main().catch((err) => { console.error(err); process.exit(1); });
```

#### 2. packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts:704

**File**: `packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts`
**Changes**: MODIFY — add best-effort identity log inside `if (apiKey)` block before the existing `fetchOpportunitiesFromMcp` try

```ts
  if (apiKey) {
    // Best-effort identity log before each MCP session. Never blocks digest.
    try {
      const baseUrl = mcpUrl.replace(/\/mcp$/, '');
      const meResp = await fetch(`${baseUrl}/api/auth/me`, { headers: { 'x-api-key': apiKey } });
      if (meResp.ok) {
        const meJson = (await meResp.json()) as {
          user?: { id: string; name: string; email: string | null };
        };
        if (meJson.user) {
          console.log('[build-daily-brief-context] authenticatedAs:', {
            id: meJson.user.id,
            name: meJson.user.name,
            email: meJson.user.email,
          });
        }
      }
    } catch {
      // best-effort; never propagate
    }
    try {
      const deliveredIds = await readDeliveredIds(options.stateFile ?? "memory/heartbeat-state.json", date);
      const fetched = await fetchOpportunitiesFromMcp({ apiKey, mcpUrl });
      // ... rest of existing try block unchanged
    }
  }
```

### Success Criteria:

#### Automated Verification:
- [x] `install.ts` has async main: `grep -c 'async function main' packages/edge-city/agentvillage/install/install.ts` returns 1
- [x] `install.ts` awaits installIndex: `grep -c 'await installIndex' packages/edge-city/agentvillage/install/install.ts` returns 1
- [x] `install.ts` error-catches main: `grep -c 'main().catch' packages/edge-city/agentvillage/install/install.ts` returns 1
- [x] digest identity log present: `grep -c "console.log.*authenticatedAs" packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts` returns 1

#### Manual Verification:
- [ ] `installEdgeos()` and `installGeo()` still called without await (they are synchronous)
- [ ] Identity log `try/catch` never propagates — outer opportunities try/catch is unaffected
- [ ] Identity log is inside the existing `if (apiKey)` block, before `readDeliveredIds` / `fetchOpportunitiesFromMcp`
- [ ] Log format: `console.log('[build-daily-brief-context] authenticatedAs:', { id, name, email })`

## Phase 4: Backend test for /me with API key

### Overview
Add a targeted test that calls `GET /me` with an API key and verifies the response includes the user identity and socials. Depends on Phase 1. Can run in parallel with Phase 3.

### Changes Required:

#### 1. backend/tests/auth-me-apikey.spec.ts

**File**: `backend/tests/auth-me-apikey.spec.ts`
**Changes**: NEW — test GET /me with x-api-key: success (returns user + socials), cross-resolution prevention, invalid key throws, missing auth throws

```ts
import '../src/startup.env';

import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { experimentService } from '../src/services/experiment.service';
import { AuthController } from '../src/controllers/auth.controller';
import { AuthOrApiKeyGuard } from '../src/guards/auth.guard';
import db from '../src/lib/drizzle/drizzle';
import {
  agentPermissions,
  agents,
  apikeys,
  networkMembers,
  networks,
  personalNetworks,
  userProfiles,
  userSocials,
  users,
} from '../src/schemas/database.schema';

const cleanup: Array<() => Promise<void>> = [];

afterAll(async () => {
  for (const f of [...cleanup].reverse()) await f();
});

async function setupExperimentNetwork() {
  const [network] = await db
    .insert(networks)
    .values({
      title: `Auth Me API Key Test ${randomUUID().slice(0, 6)}`,
      isExperiment: true,
      isPersonal: false,
      experimentMasterKeyHash: 'test-hash-not-verified-at-service-layer',
    })
    .returning({ id: networks.id });

  cleanup.push(async () => {
    await db.delete(networkMembers).where(eq(networkMembers.networkId, network.id));
    await db.delete(networks).where(eq(networks.id, network.id));
  });

  return { networkId: network.id };
}

async function cleanupUser(userId: string) {
  await db.delete(apikeys).where(eq(apikeys.userId, userId));
  await db.delete(agentPermissions).where(eq(agentPermissions.userId, userId));
  await db.delete(agents).where(eq(agents.ownerId, userId));
  await db.delete(networkMembers).where(eq(networkMembers.userId, userId));
  await db.delete(userSocials).where(eq(userSocials.userId, userId));
  await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
  const pn = await db
    .select({ networkId: personalNetworks.networkId })
    .from(personalNetworks)
    .where(eq(personalNetworks.userId, userId));
  await db.delete(personalNetworks).where(eq(personalNetworks.userId, userId));
  for (const { networkId: pnId } of pn) {
    await db.delete(networks).where(eq(networks.id, pnId));
  }
  await db.delete(users).where(eq(users.id, userId));
}

describe('AuthController.me() — API key support (Phase 1 guard swap)', () => {
  let controller: AuthController;
  let testUserId: string;
  let testApiKey: string;

  beforeAll(async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `auth-me-apikey-${randomUUID()}@test.example.com`;
    const result = await experimentService.signup(networkId, { email });
    testUserId = result.user.id;
    testApiKey = result.apiKey;
    cleanup.push(() => cleanupUser(testUserId));
    controller = new AuthController();
  });

  it('returns user identity and socials when called with a valid API key', async () => {
    const user = await AuthOrApiKeyGuard(
      new Request('http://localhost/api/auth/me', { headers: { 'x-api-key': testApiKey } }),
    );

    const response = await controller.me(
      new Request('http://localhost/api/auth/me'),
      user,
    );

    expect(response.status).toBe(200);
    const json = await response.json() as {
      user: { id: string; email: string | null; name: string; socials: unknown[] };
    };
    expect(json.user.id).toBe(testUserId);
    expect(json.user.email).toBeTruthy();
    expect(Array.isArray(json.user.socials)).toBe(true);
  }, 10000);

  it('two different API keys resolve to two different users — no cross-resolution', async () => {
    const { networkId: netId2 } = await setupExperimentNetwork();
    const email2 = `auth-me-apikey-other-${randomUUID()}@test.example.com`;
    const result2 = await experimentService.signup(netId2, { email: email2 });
    cleanup.push(() => cleanupUser(result2.user.id));

    const user1 = await AuthOrApiKeyGuard(
      new Request('http://localhost/api/auth/me', { headers: { 'x-api-key': testApiKey } }),
    );
    const user2 = await AuthOrApiKeyGuard(
      new Request('http://localhost/api/auth/me', { headers: { 'x-api-key': result2.apiKey } }),
    );

    expect(user1.id).toBe(testUserId);
    expect(user2.id).toBe(result2.user.id);
    expect(user1.id).not.toBe(user2.id);
  }, 10000);

  it('throws when an invalid API key is supplied', async () => {
    await expect(
      AuthOrApiKeyGuard(
        new Request('http://localhost/api/auth/me', { headers: { 'x-api-key': 'invalid-key-xyz' } }),
      ),
    ).rejects.toThrow();
  });

  it('throws when no authentication is provided', async () => {
    await expect(
      AuthOrApiKeyGuard(new Request('http://localhost/api/auth/me')),
    ).rejects.toThrow();
  });
});
```

### Success Criteria:

#### Automated Verification:
- [ ] Test file exists: `ls backend/tests/auth-me-apikey.spec.ts` exits 0
- [ ] Tests pass: `cd backend && bun test tests/auth-me-apikey.spec.ts`

#### Manual Verification:
- [ ] Covers success path: API key resolves + `me()` returns `{ user: { id, email, socials[] } }`
- [ ] Covers cross-resolution prevention (regression test for the bug): two API keys → two distinct user IDs
- [ ] Covers invalid key → guard throws (HTTP 401 in production via main.ts error mapping)
- [ ] Covers missing auth → guard throws
- [ ] Cleanup mirrors `experiment-signup.spec.ts` pattern (cleanup stack, reversed execution)

## Ordering Constraints

- Phase 1 (guard swap) must complete before Phase 2 (install script) and Phase 4 (test) — the backend endpoint must accept API keys before any calling code can function
- Phase 2 (install identity check) must complete before Phase 3 (async wiring in install.ts) — `install.ts` awaits `installIndex()`, which must be async first
- Phase 3 and Phase 4 can run in parallel after Phases 1 and 2 complete

## Verification Notes

- **Precedent (d39d08f4a0):** Test both rejection (wrong user) and success (correct user) paths — not just happy path
- **Precedent (420c5602381):** Any new path that reads `x-api-key` must go through `AuthOrApiKeyGuard`/`resolveApiKeyUserId` — confirmed: guard swap routes through it
- **Guard regression:** Verify JWT-authenticated frontend calls to `GET /me` still work after the swap — `AuthOrApiKeyGuard` tries Bearer JWT first; JWT callers are unaffected
- **normalizeTelegramHandle coverage:** Test empty string, `@alice`, `t.me/alice`, `https://t.me/alice/`, `ALICE` (case-insensitive) all normalize to `alice`
- **Install edge cases:** Test network error → warn + continue; mismatch → exit 1; missing profile handle → warn + continue; no `--telegram-handle` flag → skip comparison
- **Digest non-blocking:** Verify identity log failure does not propagate to `buildDailyBriefContext` return value or throw

## Performance Considerations

- One extra HTTP call at install time — acceptable (install is a one-time manual operation)
- One extra HTTP call per digest prepare run (~once/day at 02:00) — acceptable latency overhead; always caught so no failure propagation

## Migration Notes

Not applicable — no schema changes, no data migration required.

## Pattern References

- `auth.guard.ts:93-160` — `AuthOrApiKeyGuard` full implementation (hash → lookup → resolve → user)
- `backend/tests/experiment-signup.spec.ts:66-90` — pattern for testing API key creation + use in e2e tests
- `database.adapter.ts:4483` — SQL normalization regex for telegram handle (reference for `normalizeTelegramHandle` TS port)
- `packages/edge-city/agentvillage/install/args.ts:readFlag()` — flag parser pattern used in `readApiKey` / `readTelegramHandle`

## Developer Context

**Q (research: Endpoint approach): Where should API-key-capable identity endpoint live?**
A: Swap `GET /me` from `AuthGuard` to `AuthOrApiKeyGuard`. One guard change, no new route, backward-compatible.

**Q (research: Check strictness): What should the install check compare?**
A: Also verify telegram handle from socials — fetch `user_socials` where `label='telegram'`, normalize, compare against `--telegram-handle`. Mismatch → fail; missing handle → warn and continue.

**Q (research: No handle case): What if user has no telegram handle in their Index profile?**
A: Warn but continue.

**Q (Step 4: Network failure): What if /api/auth/me call fails (network error, timeout, 5xx)?**
A: Warn + continue. Log: "identity check unavailable — proceeding without verification." Only present + mismatched handle causes exit 1.

**Q (Step 5: Decomposition): 4 slices approved.**
A: Phase 1 guard swap → Phase 2 install check → Phase 3 async wiring + digest logging (parallel with 4) → Phase 4 backend test (parallel with 3).

**Step 6.3 Phase 4 by-design violations:**
1. Test calls `AuthOrApiKeyGuard` + `controller.me()` directly (not via RouteRegistry). By-design: no full-server test pattern exists in codebase; direct guard + method is the established convention (`backend/tests/experiment-signup.spec.ts:146`).
2. Invalid/missing key tests assert `.rejects.toThrow()` not HTTP 401. By-design: `AuthOrApiKeyGuard` throws an Error; the 401 status is produced by `main.ts` error mapping, which is not exercised in direct-call tests.

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 1 §1 (auth.controller.ts) | backend/src/main.ts:510 | blocker | actionability | Route is `/api/auth/me` not `/api/me` — `@Controller('/auth')` + GLOBAL_PREFIX `/api` | Update all URL references in the plan and code fences from `/api/me` to `/api/auth/me` | applied: all URL references updated to `/api/auth/me` across all phases and prose |
| code | Phase 2 §1 (install_index.ts) | backend/src/main.ts:510 | blocker | actionability | `fetch(`${baseUrl}/api/auth/me`)` targets a non-existent route at HEAD | Change to `${baseUrl}/api/auth/me` in Phase 2 code fence | applied: Phase 2 code fence URL updated |
| code | Phase 3 §2 (build-daily-brief-context.ts) | backend/src/main.ts:510 | blocker | actionability | Digest identity log also calls non-existent `${baseUrl}/api/me` | Change to `${baseUrl}/api/auth/me` in Phase 3 code fence | applied: Phase 3 code fence URL updated |
| coverage | ## Verification Notes §4 | <n/a> | blocker | verification-coverage | `normalizeTelegramHandle` edge cases: empty string and `ALICE` not covered in Phase 2 SC | Add bullets: `normalizeTelegramHandle('')` → `''` and `normalizeTelegramHandle('ALICE')` → `'alice'` | applied: two SC bullets added to Phase 2 Automated Verification |
| code | Phase 2 §1 (install_index.ts) | <n/a> | concern | code-quality | `verifyIndexIdentity()` has no timeout — stalled fetch can hang install | Add `AbortSignal.timeout(10000)` and treat aborts like network-error warning path | applied: `signal: AbortSignal.timeout(10_000)` added; catch distinguishes TimeoutError from network error |
| code | Phase 3 §1 (install.ts) | packages/edge-city/agentvillage/install/install.ts:214 | concern | code-quality | `main().catch(console.error)` doesn't set exit code 1 on unhandled rejection | Replace with `.catch(err => { console.error(err); process.exit(1); })` | applied: Phase 3 code fence updated to `main().catch((err) => { console.error(err); process.exit(1); })` |
| code | Phase 4 §1 (auth-me-apikey.spec.ts) | <n/a> | concern | actionability | Test calls guard + controller directly; guard swap not exercised end-to-end | Add route-level assertion exercising `/api/auth/me` | deferred: direct guard+controller is the established test pattern; full-server test deferred to follow-up |

## Plan History

- Phase 1: Backend guard swap — approved as generated
- Phase 2: Install identity check — approved as generated
- Phase 3: Async wiring and digest runtime logging — approved as generated (slice-verifier: 2 iterations, log format fix)
- Phase 4: Backend test for /me with API key — approved as generated (slice-verifier: 2 by-design violations ratified by developer)

## References

- Research: `.rpiv/artifacts/research/2026-06-11_01-25-06_agentvillage-digest-api-key-mismatch.md`
- FRD: `.rpiv/artifacts/discover/2026-06-11_00-55-13_agentvillage-digest-wrong-opportunity-delivery.md`
- Precedent: `d39d08f4a0` — "Require recipients for connect links" (2026-06-10)
- Precedent: `420c5602381` — "share API-key principal resolution, fail closed" (2026-06-08)
