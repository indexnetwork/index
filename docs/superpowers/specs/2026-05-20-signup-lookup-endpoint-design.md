# Signup-lookup endpoint — design

**Status:** approved (brainstorm) — ready for implementation plan
**Date:** 2026-05-20

## Context

`POST /api/networks/:id/signup` is the master-key-authenticated, headless provisioning endpoint integrators (InstaClaw, EdgeOS, EdgeClaw) use to sign attendees into an experiment network. Under the hood it calls `experimentService.signup(...)`, which hardcodes `networkInvitationService.ensureMembership({ rotateKey: true })`. Every call for an already-signed-up email therefore **revokes the user's existing API key and mints a new one** (`backend/src/services/experiment.service.ts:66`). Any deployed installation tied to the old key — including an EdgeClaw runtime the attendee has already configured — instantly stops authenticating.

The integrator has no read-only way to ask "is this email already provisioned for this network?". Calling `/signup` to find out has the side effect of breaking the attendee.

## Existing surface

- `POST /api/networks/:id/signup` — provisioning. Master-key-auth. Mints user, ensures membership, ensures scoped agent, rotates the agent's token, returns `{ user, apiKey, mcpServer }`. Calls `experimentService.signup` which delegates to `networkInvitationService.ensureMembership({ rotateKey: true })`.
- `networkInvitationService.ensureMembership` already supports `rotateKey: false`, but that mode also *creates* the user + membership + agent if missing. It is not a read-only lookup; it's an upsert that happens to skip rotation when the agent already exists.
- `networkInvitationService.findScopedAgentId(userId, networkId)` exists as a private method and is the right read-only primitive — but it's private.
- Master-key authentication is `ExperimentMasterKeyGuard(req, params)` (`backend/src/guards/experiment.guard.ts`). It returns an `ExperimentNetwork` on success and throws a `Response` on failure (400/401/403). Already used by `/signup`; reused verbatim here.
- Router (`backend/src/main.ts:155`) uses `^pattern$`-anchored regex with `:param` = `([^/]+)`. `/signup` cannot shadow `/signup/lookup` and vice versa — no specificity issue.

## Goals

- An integrator holding the master key can verify, without side effects, whether a given email is fully provisioned (user exists, member of the network, scoped agent exists).
- A single failure status communicates every "not signed up" path — the integrator's next move is always the same (call `/signup` proper).
- No DB writes, no email, no token rotation, no event emission.

## Non-goals

- Returning the user's existing API key. Keys are stored only as hashes; we cannot reissue them. The integrator is presumed to hold the key from its original `/signup` call. There is no "lost the key" recovery path through this endpoint — that is rotation, which is what `/signup` already does.
- Returning profile fields (name, bio, location, socials). Out of scope per YAGNI; if integrators later need a profile snapshot, `GET /api/users/:id` is the right place, not a signup endpoint.
- A flag on `/signup` itself. Considered and rejected — `POST /signup` that doesn't sign up overloads the verb.
- Changing `/signup`'s current rotate-on-resignup semantics. The bulk-import path (`/members/import`) relies on rotation; we don't disturb it.

## Endpoint contract

```
POST /api/networks/:id/signup/lookup
Headers:
  x-api-key: <masterKey>            ; network's experiment master key
  Content-Type: application/json
```

### Request body

```json
{ "email": "alice@example.com" }
```

| Field | Required | Validation |
|---|---|---|
| `email` | yes | Non-empty string; matches `EMAIL_REGEX` from `network.controller.ts:12`. Lowercased + trimmed before query. |

No other fields are accepted; profile fields on the body are ignored (not an error — leniency, since integrators may reuse their `/signup` request DTO).

### Responses

**200 OK** — user exists (not soft-deleted), is a member of this network, and has a scoped agent for this network.

```json
{
  "user": { "id": "uuid", "email": "alice@example.com" }
}
```

**409 Conflict** — any partial or missing state. All four sub-cases collapse to this single response:

1. No user with this email.
2. User exists but is soft-deleted (`users.deletedAt IS NOT NULL`).
3. User exists but is not a member of this network — no `network_members` row, or only a soft-deleted one (`network_members.deletedAt IS NOT NULL`).
4. User is a member but has no scoped agent for this network (`agent_permissions.scope='network'` with `scopeId=:id` and `agents.deletedAt IS NULL` returns no row).

```json
{ "error": "User has not completed signup for this network" }
```

Single failure code by design: the integrator's recovery path (call `POST /signup` with full payload to provision) is the same in all four cases. Distinguishing them would only add branching the integrator has no use for.

**400 Bad Request** — body validation. Mirrors `/signup`:

```json
{ "error": "email is required" }
// or
{ "error": "Invalid email format" }
```

**401 / 403** — from `ExperimentMasterKeyGuard`, unchanged.

### Idempotence & side effects

None. The handler runs SELECTs only. Calling it 1× or 1000× has identical effect on the database, identical effect on the user's deployed integration, and identical effect on the agent's token. Safe to call from health-check loops or retry storms.

## Service layer

A new method on `experimentService`:

```ts
class ExperimentService {
  async lookupSignup(
    networkId: string,
    email: string,
  ): Promise<{ user: { id: string; email: string } }>;
}
```

Behavior:

1. Normalize `email` (lowercase + trim).
2. Look up the user by email with `users.deletedAt IS NULL`.
3. Confirm a live `network_members` row exists for `(userId, networkId)` with `network_members.deletedAt IS NULL`.
4. Confirm a scoped agent exists via `networkInvitationService.findScopedAgentId(userId, networkId)`.
5. Return `{ user: { id, email } }` only when all three checks pass; throw a sentinel `SignupNotCompleteError` otherwise.

Controller maps `SignupNotCompleteError` → 409 with the canned message. Any other thrown error → 500 with a `Lookup failed` body (matches the `/signup` handler's error envelope).

### Visibility change on `networkInvitationService.findScopedAgentId`

`findScopedAgentId` is currently private (`backend/src/services/network-invitation.service.ts:147`). Promote to `public` (or wrap in a small `getMembershipState(userId, networkId): Promise<{ memberId: string; agentId: string | null } | null>` if we prefer to bundle the membership + agent check). The cross-service import already exists with an eslint-disable comment in `experiment.service.ts:19`; this stays consistent with the documented "experiment-service is a thin facade over network-invitation" pattern.

Recommendation: minimal change — just promote `findScopedAgentId` to public. `lookupSignup` does the user query and membership query directly via drizzle, mirroring the inline-query style already used elsewhere in `experiment.service.ts`.

## Controller wiring

Add directly under the existing `signup` handler in `backend/src/controllers/network.controller.ts`:

```ts
@Post('/:id/signup/lookup')
async signupLookup(req: Request, _user: unknown, params: Record<string, string>) {
  let network: ExperimentNetwork;
  try {
    network = await ExperimentMasterKeyGuard(req, params);
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }

  const body = await req.json().catch(() => ({})) as { email?: string };
  if (!body.email || typeof body.email !== 'string') {
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
  } catch (err) {
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

`SignupNotCompleteError` is a small named subclass of `Error` exported from `experiment.service.ts` (or a sibling `experiment.errors.ts` — keep co-located with the service for now).

## Tests

New file `backend/tests/experiment-signup-lookup.test.ts`, sibling of `experiment-signup.test.ts` and following the same harness pattern (real DB, real services, master-key seeded in `beforeAll`):

| Case | Setup | Expectation |
|---|---|---|
| Happy path | Seed user + membership + scoped agent | 200 with `user.id` matching seeded uuid, `user.email` matching seeded email |
| Email unknown | No user row for the email | 409 |
| User soft-deleted | User row exists with `deletedAt` set | 409 |
| User exists, no membership | User exists but no `network_members` row for this network | 409 |
| Member soft-deleted | `network_members` row exists with `deletedAt` set | 409 |
| Member, no scoped agent | User + membership exist, no `agent_permissions` row with `scope='network', scopeId=:id` | 409 |
| Member, scoped agent soft-deleted | User + membership + agent_permissions row exist, but the linked `agents.deletedAt` is set | 409 |
| Missing email | Empty body | 400 "email is required" |
| Malformed email | Body `{ email: "not-an-email" }` | 400 "Invalid email format" |
| Missing master key header | No `x-api-key` | 401 |
| Wrong master key | Bad `x-api-key` | 403 |
| Wrong network id | Valid key, non-experiment network id | 403 |
| Idempotence | Call lookup 3× back-to-back on a happy-path user | Each returns 200; no DB writes between calls (asserted via `agent_tokens` count unchanged and the most recent token's `createdAt` unchanged) |

The idempotence test is the load-bearing one — it codifies the contract.

## Documentation updates

- `docs/specs/api-reference.md` — add a new entry directly beneath the `POST /api/networks/:id/signup` section, titled `POST /api/networks/:id/signup/lookup`. Mirror the existing entry's structure: auth, request body, success response, error responses, examples (curl).
- `docs/guides/instaclaw-install.md` — add a short "Idempotent re-check" subsection explaining that integrators can poll `/signup/lookup` to verify a user is provisioned without disturbing their key. Reference the api-reference entry for the full contract.
- `docs/guides/edgeclaw-instaclaw-integration.md` — same paragraph in the EdgeOS-side walkthrough, in the section that describes retry behavior.

## Migration / rollout

No schema migration. No data migration. No behavior change to existing `/signup` callers — the new route is additive.

## Out of scope (intentionally listed to prevent scope creep)

- Profile snapshot in the lookup response.
- A "rotate key" flag on `/signup`.
- Making `/signup` idempotent by default.
- A separate "rotate key" endpoint distinct from `/signup`.
- Distinguishing 404 from 409 across the four failure sub-cases.
- Returning the `mcpServer` config from the lookup response.
- Allowing non-master-key auth (session, agent API key) to call lookup.
- Rate-limiting beyond whatever already wraps `/signup`.
