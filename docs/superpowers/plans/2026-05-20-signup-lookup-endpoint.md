# Signup-Lookup Endpoint Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /api/networks/:id/signup/lookup` — a read-only sibling of `/signup` that lets a master-key-bearing integrator verify a user is fully provisioned for an experiment network without rotating that user's API key.

**Architecture:** Three-layer add: promote one private helper on `network-invitation.service` to public, add a pure-read `lookupSignup` method on `experiment.service`, wire a new controller handler that reuses the existing `ExperimentMasterKeyGuard` inline. New integration test file mirrors `experiment-signup.test.ts` but drives the controller directly so the guard, handler, and service are all exercised end-to-end.

**Tech Stack:** Bun runtime, TypeScript, Drizzle ORM, PostgreSQL with pgvector, `bun:test`, decorator-based router (`src/lib/router/router.decorators.ts`).

**Spec:** `docs/superpowers/specs/2026-05-20-signup-lookup-endpoint-design.md`

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Modify | `backend/src/services/network-invitation.service.ts` | Promote `findScopedAgentId` from private to public so `experiment.service` can reuse it. |
| Modify | `backend/src/services/experiment.service.ts` | Export `SignupNotCompleteError`; add `lookupSignup(networkId, email)` method (read-only, four-step check). |
| Modify | `backend/src/controllers/network.controller.ts` | Add `signupLookup` handler at `@Post('/:id/signup/lookup')` — guard inline, maps `SignupNotCompleteError` → 409. |
| Create | `backend/tests/experiment-signup-lookup.test.ts` | End-to-end controller-level tests covering the happy path, every 409 partial-state branch, body validation, master-key auth, and idempotence. |
| Modify | `docs/specs/api-reference.md` | New endpoint entry directly after the `/signup` section. |
| Modify | `docs/guides/instaclaw-install.md` | New "Idempotent re-check" subsection pointing to the lookup endpoint. |
| Modify | `docs/guides/edgeclaw-instaclaw-integration.md` | Same subsection in the EdgeOS-side walkthrough. |

---

## Task 1: Promote `findScopedAgentId` to public

The lookup service needs to ask "does this user have a scoped agent for this network?" The existing private method on `networkInvitationService` does exactly that. Promoting it (rather than duplicating the query in `experiment.service`) keeps the agent-permission query in one place.

**Files:**
- Modify: `backend/src/services/network-invitation.service.ts:147-160`

- [ ] **Step 1: Change the method visibility**

Open `backend/src/services/network-invitation.service.ts`. Locate the `findScopedAgentId` method (around line 147). Change `private async findScopedAgentId(` to `async findScopedAgentId(` (remove the `private` keyword). The method body is unchanged.

After change:

```ts
async findScopedAgentId(userId: string, networkId: string): Promise<string | null> {
  const [row] = await db
    .select({ agentId: schema.agentPermissions.agentId })
    .from(schema.agentPermissions)
    .innerJoin(schema.agents, eq(schema.agents.id, schema.agentPermissions.agentId))
    .where(and(
      eq(schema.agentPermissions.userId, userId),
      eq(schema.agentPermissions.scope, 'network'),
      eq(schema.agentPermissions.scopeId, networkId),
      isNull(schema.agents.deletedAt),
    ))
    .limit(1);
  return row?.agentId ?? null;
}
```

- [ ] **Step 2: Verify the file still type-checks**

Run: `cd backend && bunx tsc --noEmit`
Expected: clean exit, no errors. The method was already used internally so promoting it cannot break callers.

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/network-invitation.service.ts
git commit -m "refactor(network-invitation): make findScopedAgentId public

Required by the new experimentService.lookupSignup read path."
```

---

## Task 2: Add `SignupNotCompleteError` and `experimentService.lookupSignup`

Pure read-only method. Performs four checks (user exists + not soft-deleted; membership exists + not soft-deleted; scoped agent exists) and throws a sentinel error if any fails.

**Files:**
- Modify: `backend/src/services/experiment.service.ts` (add error class + method)
- Test: `backend/tests/experiment-signup-lookup.test.ts` (new file; service-level cases now, controller-level added in Task 3)

- [ ] **Step 1: Write the failing service-level tests**

Create `backend/tests/experiment-signup-lookup.test.ts`:

```ts
import '../src/startup.env';

import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { experimentService, SignupNotCompleteError } from '../src/services/experiment.service';
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
      title: `EdgeClaw Lookup Test ${randomUUID().slice(0, 6)}`,
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

describe('experimentService.lookupSignup', () => {
  it('returns user when fully provisioned', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `lookup-ok-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    const result = await experimentService.lookupSignup(networkId, email);

    expect(result.user.id).toBe(signedUp.user.id);
    expect(result.user.email).toBe(email);
  }, 15_000);

  it('is idempotent: does not rotate the user key', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `lookup-idem-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    const before = await db
      .select({ id: apikeys.id, createdAt: apikeys.createdAt })
      .from(apikeys)
      .where(eq(apikeys.userId, signedUp.user.id));

    await experimentService.lookupSignup(networkId, email);
    await experimentService.lookupSignup(networkId, email);
    await experimentService.lookupSignup(networkId, email);

    const after = await db
      .select({ id: apikeys.id, createdAt: apikeys.createdAt })
      .from(apikeys)
      .where(eq(apikeys.userId, signedUp.user.id));

    expect(after.length).toBe(before.length);
    expect(after.map(r => r.id).sort()).toEqual(before.map(r => r.id).sort());
  }, 15_000);

  it('throws SignupNotCompleteError when email is unknown', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `lookup-missing-${randomUUID()}@example.com`;

    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('throws SignupNotCompleteError when user is soft-deleted', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `lookup-softdel-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, signedUp.user.id));

    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('throws SignupNotCompleteError when membership is missing', async () => {
    const { networkId } = await setupExperimentNetwork();
    const { networkId: otherNetworkId } = await setupExperimentNetwork();
    const email = `lookup-nomember-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(otherNetworkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    // User signed up to otherNetworkId, not networkId — has no membership in networkId.
    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('throws SignupNotCompleteError when membership is soft-deleted', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `lookup-memsoftdel-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    await db
      .update(networkMembers)
      .set({ deletedAt: new Date() })
      .where(and(
        eq(networkMembers.networkId, networkId),
        eq(networkMembers.userId, signedUp.user.id),
      ));

    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('throws SignupNotCompleteError when scoped agent is missing', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `lookup-noagent-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    // Drop the scoped agent permission so the membership exists but no scoped agent does.
    await db
      .delete(agentPermissions)
      .where(and(
        eq(agentPermissions.userId, signedUp.user.id),
        eq(agentPermissions.scope, 'network'),
        eq(agentPermissions.scopeId, networkId),
      ));

    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('throws SignupNotCompleteError when scoped agent is soft-deleted', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `lookup-agentsoftdel-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    // Soft-delete the agent linked to the permission row.
    await db
      .update(agents)
      .set({ deletedAt: new Date() })
      .where(eq(agents.ownerId, signedUp.user.id));

    await expect(experimentService.lookupSignup(networkId, email)).rejects.toBeInstanceOf(SignupNotCompleteError);
  }, 15_000);

  it('normalizes the email (case + whitespace) before lookup', async () => {
    const { networkId } = await setupExperimentNetwork();
    const email = `lookup-norm-${randomUUID()}@example.com`;

    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    const result = await experimentService.lookupSignup(networkId, `  ${email.toUpperCase()}  `);

    expect(result.user.id).toBe(signedUp.user.id);
  }, 15_000);
});
```

- [ ] **Step 2: Run the new test file to verify it fails**

Run: `cd backend && bun test tests/experiment-signup-lookup.test.ts`
Expected: every test fails — `experimentService.lookupSignup` and `SignupNotCompleteError` do not yet exist (import error, then assertion errors).

- [ ] **Step 3: Add the error class and method to `experiment.service.ts`**

Open `backend/src/services/experiment.service.ts`.

At the top of the file, just below the existing imports, add a `SignupNotCompleteError` export:

```ts
/**
 * Thrown by {@link ExperimentService.lookupSignup} when the (network, email)
 * pair is not in a fully-provisioned state. The controller maps it to HTTP 409.
 */
export class SignupNotCompleteError extends Error {
  constructor() {
    super('User has not completed signup for this network');
    this.name = 'SignupNotCompleteError';
  }
}
```

Then add a public method on the `ExperimentService` class (place it directly after `signup`, before `importMembers`):

```ts
/**
 * Read-only check that `(networkId, email)` is fully provisioned. Does NOT
 * create, update, or rotate anything. Used by the headless signup-lookup
 * endpoint so integrators can verify state without invalidating a deployed key.
 *
 * @throws SignupNotCompleteError when the user is missing/soft-deleted, has
 *         no live membership in the network, or has no live scoped agent for it.
 */
async lookupSignup(
  networkId: string,
  email: string,
): Promise<{ user: { id: string; email: string } }> {
  const normalizedEmail = email.toLowerCase().trim();

  const [user] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(and(eq(schema.users.email, normalizedEmail), isNull(schema.users.deletedAt)))
    .limit(1);
  if (!user) throw new SignupNotCompleteError();

  const [membership] = await db
    .select({ userId: schema.networkMembers.userId })
    .from(schema.networkMembers)
    .where(and(
      eq(schema.networkMembers.networkId, networkId),
      eq(schema.networkMembers.userId, user.id),
      isNull(schema.networkMembers.deletedAt),
    ))
    .limit(1);
  if (!membership) throw new SignupNotCompleteError();

  const agentId = await networkInvitationService.findScopedAgentId(user.id, networkId);
  if (!agentId) throw new SignupNotCompleteError();

  return { user };
}
```

You will also need to import `and`, `eq`, `isNull` from `drizzle-orm`. The current `experiment.service.ts` already imports them — verify the existing import line is `import { and, eq, isNull, sql } from 'drizzle-orm';`.

- [ ] **Step 4: Run the test file again to verify all service-level tests pass**

Run: `cd backend && bun test tests/experiment-signup-lookup.test.ts`
Expected: all 9 tests pass.

- [ ] **Step 5: Type-check**

Run: `cd backend && bunx tsc --noEmit`
Expected: clean exit.

- [ ] **Step 6: Commit**

```bash
git add backend/src/services/experiment.service.ts backend/tests/experiment-signup-lookup.test.ts
git commit -m "feat(experiment): add lookupSignup read-only state check

Provides a side-effect-free way to ask whether a (networkId, email) pair
is fully provisioned (user live, membership live, scoped agent live).
Throws SignupNotCompleteError for any partial/missing state — the
caller does not need to distinguish the four failure paths."
```

---

## Task 3: Wire up the controller route

Adds the HTTP handler and the controller-level tests. Reuses `ExperimentMasterKeyGuard` inline (same pattern as `/signup`).

**Files:**
- Modify: `backend/src/controllers/network.controller.ts` (add handler near the existing `signup`)
- Test: `backend/tests/experiment-signup-lookup.test.ts` (extend the existing file with controller-driven cases)

- [ ] **Step 1: Write the failing controller-level tests**

Append the following describe block to `backend/tests/experiment-signup-lookup.test.ts` (after the existing `experimentService.lookupSignup` describe):

```ts
import { generateMasterKey } from '../src/lib/experiment/master-key';
import { NetworkController } from '../src/controllers/network.controller';

async function setupExperimentNetworkWithKey() {
  const { key, hash } = await generateMasterKey();

  const [network] = await db
    .insert(networks)
    .values({
      title: `EdgeClaw Lookup HTTP ${randomUUID().slice(0, 6)}`,
      isExperiment: true,
      isPersonal: false,
      experimentMasterKeyHash: hash,
    })
    .returning({ id: networks.id });

  cleanup.push(async () => {
    await db.delete(networkMembers).where(eq(networkMembers.networkId, network.id));
    await db.delete(networks).where(eq(networks.id, network.id));
  });

  return { networkId: network.id, masterKey: key };
}

function buildLookupRequest(networkId: string, masterKey: string | null, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (masterKey !== null) headers['x-api-key'] = masterKey;
  return new Request(`http://localhost/api/networks/${networkId}/signup/lookup`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('NetworkController.signupLookup', () => {
  const controller = new NetworkController();

  it('returns 200 with the user when fully provisioned', async () => {
    const { networkId, masterKey } = await setupExperimentNetworkWithKey();
    const email = `http-ok-${randomUUID()}@example.com`;
    const signedUp = await experimentService.signup(networkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, { email }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(200);
    const body = await res.json() as { user: { id: string; email: string } };
    expect(body.user.id).toBe(signedUp.user.id);
    expect(body.user.email).toBe(email);
  }, 15_000);

  it('returns 409 when the email is unknown', async () => {
    const { networkId, masterKey } = await setupExperimentNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, { email: `missing-${randomUUID()}@example.com` }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(409);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('User has not completed signup for this network');
  }, 15_000);

  it('returns 409 when membership is missing in this network', async () => {
    const { networkId, masterKey } = await setupExperimentNetworkWithKey();
    const { networkId: otherNetworkId } = await setupExperimentNetworkWithKey();
    const email = `http-othermember-${randomUUID()}@example.com`;
    const signedUp = await experimentService.signup(otherNetworkId, { email });
    cleanup.push(() => cleanupUser(signedUp.user.id));

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, { email }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(409);
  }, 15_000);

  it('returns 400 when body is missing email', async () => {
    const { networkId, masterKey } = await setupExperimentNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, {}),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('email is required');
  }, 15_000);

  it('returns 400 when email is malformed', async () => {
    const { networkId, masterKey } = await setupExperimentNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, { email: 'not-an-email' }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Invalid email format');
  }, 15_000);

  it('returns 400 when body is unparseable JSON', async () => {
    const { networkId, masterKey } = await setupExperimentNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, masterKey, 'not-json'),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(400);
  }, 15_000);

  it('returns 401 when x-api-key header is missing', async () => {
    const { networkId } = await setupExperimentNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, null, { email: `noauth-${randomUUID()}@example.com` }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(401);
  }, 15_000);

  it('returns 403 when master key is wrong', async () => {
    const { networkId } = await setupExperimentNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(networkId, 'wrong-key-' + randomUUID(), { email: `badauth-${randomUUID()}@example.com` }),
      null,
      { id: networkId },
    );

    expect(res.status).toBe(403);
  }, 15_000);

  it('returns 403 when the network is not an experiment network', async () => {
    const [plain] = await db
      .insert(networks)
      .values({
        title: `Plain network ${randomUUID().slice(0, 6)}`,
        isExperiment: false,
        isPersonal: false,
      })
      .returning({ id: networks.id });
    cleanup.push(() => db.delete(networks).where(eq(networks.id, plain.id)).then(() => undefined));

    const { masterKey } = await setupExperimentNetworkWithKey();

    const res = await controller.signupLookup(
      buildLookupRequest(plain.id, masterKey, { email: `plain-${randomUUID()}@example.com` }),
      null,
      { id: plain.id },
    );

    expect(res.status).toBe(403);
  }, 15_000);
});
```

- [ ] **Step 2: Run the new tests to verify they fail**

Run: `cd backend && bun test tests/experiment-signup-lookup.test.ts`
Expected: the new `NetworkController.signupLookup` block fails — `controller.signupLookup` is not a function yet. The earlier service-level tests still pass.

- [ ] **Step 3: Add the handler to the controller**

Open `backend/src/controllers/network.controller.ts`.

At the top of the file, update the existing import line for `experiment.service` to also bring in the error class. The current import is:

```ts
import { experimentService, type ImportRow } from '../services/experiment.service';
```

Change it to:

```ts
import { experimentService, SignupNotCompleteError, type ImportRow } from '../services/experiment.service';
```

Then locate the `signup` method on `NetworkController` (around line 99). Add a new handler method directly after it (before `searchPersonalNetworkMembers`):

```ts
/**
 * Read-only signup state check for an experiment network. Master-key
 * authenticated. Returns 200 with `{ user: { id, email } }` when the user is
 * fully provisioned for this network; 409 (single canned message) for any
 * partial/missing state. No side effects — safe to call from retry loops or
 * health probes.
 */
@Post('/:id/signup/lookup')
async signupLookup(req: Request, _user: unknown, params: Record<string, string>) {
  let network: ExperimentNetwork;
  try {
    network = await ExperimentMasterKeyGuard(req, params);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  const body = await req.json().catch(() => null) as { email?: string } | null;
  if (!body || typeof body.email !== 'string' || body.email.length === 0) {
    return new Response(JSON.stringify({ error: 'email is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (!EMAIL_REGEX.test(body.email)) {
    return new Response(JSON.stringify({ error: 'Invalid email format' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    const result = await experimentService.lookupSignup(network.id, body.email);
    return Response.json(result, { status: 200 });
  } catch (err: unknown) {
    if (err instanceof SignupNotCompleteError) {
      return new Response(
        JSON.stringify({ error: 'User has not completed signup for this network' }),
        { status: 409, headers: { 'Content-Type': 'application/json' } },
      );
    }
    logger.error('Signup lookup failed', { networkId: network.id, error: errorMessage(err) });
    return new Response(JSON.stringify({ error: 'Lookup failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
```

Note the body parser: `req.json().catch(() => null)` followed by a `!body || ...` check. This collapses "unparseable JSON" and "missing email" into the same 400 "email is required" response, matching the 400-on-bad-JSON test case.

- [ ] **Step 4: Run the full test file to verify everything passes**

Run: `cd backend && bun test tests/experiment-signup-lookup.test.ts`
Expected: all tests pass — both the service-level block and the controller-level block.

- [ ] **Step 5: Verify route registration in startup logs (manual sanity check)**

Run: `cd backend && bun run dev 2>&1 | head -100 | grep -i "signup/lookup"`
Expected: one line confirming `POST /api/networks/:id/signup/lookup` is registered. Kill the dev server (Ctrl-C) once you see the line.

- [ ] **Step 6: Type-check + lint**

Run in parallel:
- `cd backend && bunx tsc --noEmit`
- `cd backend && bun run lint`

Expected: both exit cleanly.

- [ ] **Step 7: Commit**

```bash
git add backend/src/controllers/network.controller.ts backend/tests/experiment-signup-lookup.test.ts
git commit -m "feat(network): wire POST /:id/signup/lookup handler

Master-key-authed read-only endpoint mirroring the /signup auth shape.
Maps SignupNotCompleteError to a single 409 with a canned message;
returns 400 for missing/malformed email; reuses ExperimentMasterKeyGuard
for 401/403."
```

---

## Task 4: Update `docs/specs/api-reference.md`

Add a new endpoint entry directly beneath the existing `/signup` entry.

**Files:**
- Modify: `docs/specs/api-reference.md` (insert after the `/signup` section's closing `---`, around line 1827 — find by searching for the `### POST /api/networks/:id/signup` heading and walking down to the first `---` separator)

- [ ] **Step 1: Insert the new section**

Open `docs/specs/api-reference.md`. Find the `### POST /api/networks/:id/signup` heading. Walk down past its `**Errors**` block to the next `---` separator. Insert the following block immediately after that `---` (so the new entry sits between `/signup` and `/members/import/parse`):

```markdown
### POST /api/networks/:id/signup/lookup

Read-only sibling of `/signup`. Verifies, without side effects, that a given email is fully provisioned for this experiment network — user is live, member of the network, and has a network-scoped personal agent. Use this to check provisioning state without rotating the user's API key (which is what `/signup` does on every call).

**Auth**: `ExperimentMasterKeyGuard` — `x-api-key` header containing the network's master key.

**Path params**:
- `id` — Network ID (must be an experiment network with a master key set).

**Request body**:
```json
{ "email": "attendee@example.com" }
```

Only `email` is read; any other fields in the body are ignored. Email is normalized (lowercased + trimmed) before lookup.

**Response 200** (fully provisioned):
```json
{ "user": { "id": "uuid", "email": "attendee@example.com" } }
```

The response does **not** include an API key or an MCP server config — the integrator is presumed to hold the key from its original `/signup` call. If the key has been lost, call `/signup` to mint a fresh one (this will rotate any deployed key, so prefer not to).

**Response 409** — User is not in a fully-provisioned state. A single canned message is returned for every "no" path (email unknown, user soft-deleted, no membership, membership soft-deleted, no scoped agent, scoped agent soft-deleted). The integrator's recovery is the same in all cases: call `/signup` proper.
```json
{ "error": "User has not completed signup for this network" }
```

**Idempotency**: 100% read-only. Safe to call from retry loops, dashboards, or health probes. Calling 1× or N× has identical effect.

**Errors**:
- `400` — Missing or malformed email; unparseable body.
- `401` — Missing `x-api-key` header.
- `403` — Master key invalid; network not experiment type; network deleted.

**Example (curl)**:
```bash
curl -X POST https://protocol.index.network/api/networks/<NETWORK_ID>/signup/lookup \
  -H 'x-api-key: <MASTER_KEY>' \
  -H 'content-type: application/json' \
  -d '{ "email": "attendee@example.com" }'
```

---
```

- [ ] **Step 2: Commit**

```bash
git add docs/specs/api-reference.md
git commit -m "docs(api-reference): document POST /networks/:id/signup/lookup"
```

---

## Task 5: Update integration guides

Two partner-facing guides need a short paragraph pointing at the new endpoint.

**Files:**
- Modify: `docs/guides/instaclaw-install.md`
- Modify: `docs/guides/edgeclaw-instaclaw-integration.md`

- [ ] **Step 1: Add subsection to `instaclaw-install.md`**

Open `docs/guides/instaclaw-install.md`. Find the section that describes the `/signup` call (search for `POST https://protocol.dev.index.network/api/networks/<NETWORK_ID>/signup`). After that section's request/response narrative — but before the `**Heads up on prod cutover**` paragraph if it follows nearby — insert:

```markdown
### Idempotent re-check (without rotating the key)

Calling `/signup` for an email that has already been provisioned **rotates that user's API key** (the previously-deployed key stops authenticating). If you need to verify a user is provisioned without disturbing them — retry logic, health checks, status dashboards — call `/signup/lookup` instead:

```bash
curl -X POST https://protocol.dev.index.network/api/networks/<NETWORK_ID>/signup/lookup \
  -H 'x-api-key: <MASTER_KEY>' \
  -H 'content-type: application/json' \
  -d '{ "email": "attendee@example.com" }'
```

- **200** — user is fully provisioned for this network. Response body is `{ "user": { "id": "...", "email": "..." } }`. No key is returned.
- **409** — user is not fully provisioned (unknown email, missing membership, missing agent, or any soft-deleted state). Fall through to `/signup` to provision.

See the full contract at `docs/specs/api-reference.md` (`POST /api/networks/:id/signup/lookup`).
```

- [ ] **Step 2: Add subsection to `edgeclaw-instaclaw-integration.md`**

Open `docs/guides/edgeclaw-instaclaw-integration.md`. Find the section that describes the `/signup` call in the EdgeOS-side walkthrough (search for `POST /api/networks/:id/signup` in the EdgeOS section). Insert the same subsection (adjusting the URL host: the guide uses `https://protocol.index.network`, not the dev host):

```markdown
### Idempotent re-check (without rotating the key)

Calling `/signup` for an email that has already been provisioned **rotates that user's API key** (the previously-deployed key stops authenticating). If you need to verify a user is provisioned without disturbing them — retry logic, status dashboards, health probes — call `/signup/lookup` instead:

```bash
curl -X POST https://protocol.index.network/api/networks/<NETWORK_ID>/signup/lookup \
  -H 'x-api-key: <MASTER_KEY>' \
  -H 'content-type: application/json' \
  -d '{ "email": "attendee@example.com" }'
```

- **200** — user is fully provisioned for this network. Response body is `{ "user": { "id": "...", "email": "..." } }`. No key is returned.
- **409** — user is not fully provisioned. Fall through to `/signup` to provision.

See `docs/specs/api-reference.md` (`POST /api/networks/:id/signup/lookup`) for the full contract.
```

- [ ] **Step 3: Commit**

```bash
git add docs/guides/instaclaw-install.md docs/guides/edgeclaw-instaclaw-integration.md
git commit -m "docs(guides): document the idempotent signup-lookup path

Tells InstaClaw + EdgeOS integrators to use /signup/lookup for
provisioning checks instead of calling /signup, which always rotates
the deployed API key."
```

---

## Task 6: Final verification

Sanity-check everything one more time before declaring done.

- [ ] **Step 1: Run the full new test file**

Run: `cd backend && bun test tests/experiment-signup-lookup.test.ts`
Expected: every test passes. Note the count (should be 9 service-level + 9 controller-level = 18).

- [ ] **Step 2: Run the sibling test to confirm no regression**

Run: `cd backend && bun test tests/experiment-signup.test.ts`
Expected: all 4 tests in the sibling still pass (the visibility change on `findScopedAgentId` and the new service method must not have disturbed the existing signup path).

- [ ] **Step 3: Type-check + lint at root**

Run in parallel:
- `cd backend && bunx tsc --noEmit`
- `cd backend && bun run lint`

Expected: both exit cleanly.

- [ ] **Step 4: Confirm git tree is clean**

Run: `git status`
Expected: working tree clean; all four commits present in `git log --oneline | head -5`.

- [ ] **Step 5: Smoke-test the route exists in dev**

Run: `cd backend && bun run dev` in one terminal. In another:

```bash
curl -i -X POST http://localhost:3001/api/networks/00000000-0000-0000-0000-000000000000/signup/lookup \
  -H 'x-api-key: wrong-key' \
  -H 'content-type: application/json' \
  -d '{ "email": "ping@example.com" }'
```

Expected: HTTP/1.1 403 (master key invalid against a non-existent network resolves to Forbidden through the guard). If you get 404 the route is not registered. Kill the dev server when done.

---

## Self-Review Notes

Checked against the spec (`docs/superpowers/specs/2026-05-20-signup-lookup-endpoint-design.md`) before saving:

- **Spec coverage:** All four 409 partial-state branches (user missing, user soft-deleted, no membership, soft-deleted membership, no agent, soft-deleted agent) are covered by tests in Task 2 and Task 3. The "Profile fields on the body are ignored" leniency is implicitly covered — the handler only reads `body.email`. Email normalization (lowercase + trim) is covered by the `normalizes the email` test in Task 2.
- **Placeholder scan:** No `TBD`, `TODO`, "implement later", or "similar to" markers. Every step shows runnable code or an exact command.
- **Type consistency:** `SignupNotCompleteError` is exported from `experiment.service.ts` (Task 2) and imported by the controller (Task 3). `lookupSignup` signature `(networkId: string, email: string) => Promise<{ user: { id; email } }>` is consistent across the spec, the service implementation, the service-level tests, and the controller call site. `findScopedAgentId(userId, networkId)` signature unchanged from the existing private method — only the visibility flipped.
- **No skipped spec items:** "Routing-collision check" from the spec was discharged during planning by reading `matchPath` in `backend/src/main.ts:155` — the `^...$`-anchored regex means `/signup` and `/signup/lookup` cannot shadow each other. Documented in this plan's architecture line; no Task needed.
