---
date: 2026-06-11T01:25:06+0300
author: Yankı Ekin Yüksel
commit: c5c2c78664
branch: dev
repository: index
topic: "AgentVillage digest wrong-opportunity delivery — API key mismatch root cause and fix"
tags: [research, codebase, agentvillage, digest, install, connect-link, auth-guard, api-key, identity]
status: ready
last_updated: 2026-06-11T01:25:06+0300
last_updated_by: Yankı Ekin Yüksel
---

# Research: AgentVillage digest wrong-opportunity delivery — API key mismatch root cause and fix

## Research Question

Ground the FRD `.rpiv/artifacts/discover/2026-06-11_00-55-13_agentvillage-digest-wrong-opportunity-delivery.md` in codebase reality. Specifically:
- Does a `GET /api/me`-style endpoint that accepts `x-api-key` already exist?
- Where exactly is the insertion point for an identity check in `installIndex()`?
- What does the full install orchestration look like and what's the blast radius of making `installIndex()` async?
- How is the telegram handle stored (normalize/compare pattern)?
- What does `fetchOpportunitiesFromMcp` currently expose for user identity at runtime?

## Summary

No REST endpoint currently accepts `x-api-key` and returns user identity. The existing `GET /api/me` (`auth.controller.ts:63`) uses `AuthGuard` (JWT only). The fix is a one-line guard swap to `AuthOrApiKeyGuard` — all the plumbing already exists. The `/me` response needs one extension: also fetch the resident's telegram social from `user_socials` (label='telegram') and return a normalized handle. `installIndex()` is synchronous and must go async; `install.ts` calls it synchronously and must `await` it. `fetchOpportunitiesFromMcp` has no identity surface today — the MCP `initialize` response contains only server name/version, not the authenticated userId.

## Detailed Findings

### 1. No API-key-capable identity endpoint exists

`auth.controller.ts:63` — `GET /me` under `@UseGuards(RateLimit('read'), AuthGuard)`. `AuthGuard` verifies a JWT via JWKS (`auth.guard.ts:25`). It does not inspect `x-api-key`. An API-key-only request to `GET /me` throws `'Access token required'`.

`agent.controller.ts:180` — `GET /agents/me` under `AuthOrApiKeyGuard`, but immediately checks `resolveApiKeyAgentId(req)` (`auth.guard.ts:48`) and returns HTTP 400 if no `agentId` metadata is present on the key. Index API keys written by `installIndex()` are not agent-bound, so this endpoint is also unavailable.

**Resolution:** change `auth.controller.ts:63` guard from `AuthGuard` to `AuthOrApiKeyGuard`. No new route. The existing `me()` handler already calls `userService.findWithGraph(user.id)` which returns the full user + socials; the telegram handle is a subset of that.

### 2. AuthOrApiKeyGuard — full resolution flow

`auth.guard.ts:93-160`:
1. Hash the raw `x-api-key` with SHA-256, base64url-encode
2. Look up `apikeys` table by hash — check `enabled` and `expiresAt`
3. Call `resolveApiKeyUserId(row)` (`lib/apikey/principal.ts:44`): prefer `userId`, then `referenceId`; reject (fail closed) if both set and disagree
4. Load `{ id, email, name }` from `users` table
5. Return `AuthenticatedUser { id, email, name }`

The install script needs to call `GET /me` with `x-api-key: <key>` and receive `{ user: { id, email, name, telegramHandle? } }`.

### 3. installIndex() — insertion point and async conversion

`install_index.ts:293-305` (the full `installIndex()` body):

```
readApiKey()                            line ~32-38  — no I/O
readTelegramHandle()                    line ~46-50  — no I/O
upsertEnvVar("INDEX_API_KEY", apiKey)   line ~298    — first write to HERMES_HOME/.env
writeMcpServerEntry(apiKey, handle)     line ~300    — writes config.yaml
reconcileDigestCronJobs(env)            line ~303    — runs hermes CLI subprocesses
```

Identity check inserts **between `readTelegramHandle()` and `upsertEnvVar()`** — before any disk mutation. `installIndex()` must become `async installIndex()` because the check is a fetch call.

`install.ts` imports and calls `installIndex()` at its main flow. It must switch to `await installIndex()`. The top-level `install.ts` script uses a sync `main()` pattern; it would become `async function main()` + `main().catch(...)`.

### 4. reconcile_digest_crons.ts — minimal shim, no flags

`reconcile_digest_crons.ts` is 12 lines: reads `hermesExecEnv()` and calls `reconcileDigestCronJobs()`. No argument parsing, no checks. Extending it with `--check-identity` requires adding `readApiKey()` + `readTelegramHandle()` from `args.ts`/`env.ts`, calling the identity endpoint, printing the result, and exiting 0 (audit mode, no disk changes).

### 5. hermesExecEnv() — environment augmentation

`hermes_cli.ts:14-22`: returns `{ ...process.env, PATH: [hermesBin dir, /opt/hermes/.venv/bin, ~/.npm/bin, ~/.local/bin, process.env.PATH].join(':') }`. Pure env passthrough — no identity semantics. Relevant only as the env passed to cron subprocesses.

### 6. Telegram handle storage pattern

`database.schema.ts:108-120` — `user_socials` table: `{ id, userId, label, value }`.
- `label = 'telegram'` (auto-detected by `detectSocialLabel` at `database.adapter.ts:31`)
- `value` may be bare handle, `@handle`, `t.me/handle`, `https://t.me/handle`
- Normalized in SQL via regex: strip leading `@` or URL prefix, drop everything after first `/`, `?`, or `#` (`database.adapter.ts:4483`)

For the `/me` response: `getUserSocials(userId)` (`database.adapter.ts:4462`) returns all socials. Filter for `label === 'telegram'`, normalize value client-side (strip `@`, strip `t.me/` prefix) → return as `telegramHandle`.

The install script normalizes `readTelegramHandle()` the same way and compares. Install logic:
- Both present and differ → exit 1, print mismatch
- Expected handle present but `/me` returns none → warn, continue
- Either not present → just log identity, continue

### 7. MCP initialize response — no user identity

`mcp.server.ts:454-456`: the `McpServer` is constructed with `{ name: 'index-network', version: '1.0.0' }`. The `initialize` response carries only server name, version, capabilities, and instructions.

`fetchOpportunitiesFromMcp` (`build-daily-brief-context.ts:655-690`): receives `initResp`, checks `initResp.error`, then discards `initResp.result`. No user identity available here.

For runtime logging: the install-time REST endpoint (`GET /api/me`) can be reused by `buildDailyBriefContext` to log the authenticated userId before fetching opportunities. The base URL is already derivable from `INDEX_MCP_URL` (replace `/mcp` suffix with empty string).

### 8. read_user_profiles (no args) — not the right probe path

`profile.tools.ts:293-350`: `read_user_profiles` with no args returns the caller's profile (name, bio, skills, interests). It uses `context.userId` scoped by the MCP auth resolver. The response is a text-format tool output — not structured JSON. Extracting userId from the text output is fragile. The REST `/api/me` endpoint is cleaner for a programmatic check.

## Code References

- `backend/src/controllers/auth.controller.ts:63` — `GET /me` handler; guard swap target
- `backend/src/guards/auth.guard.ts:25` — `AuthGuard` (JWT only)
- `backend/src/guards/auth.guard.ts:93` — `AuthOrApiKeyGuard` hash→lookup→resolve→user flow
- `backend/src/guards/auth.guard.ts:113` — keyHashPrefix logging pattern (sha256 prefix, never raw key)
- `backend/src/lib/apikey/principal.ts:44` — `resolveApiKeyUserId` — prefer userId, fail closed
- `packages/edge-city/agentvillage/install/install_index.ts:32` — `readApiKey()`
- `packages/edge-city/agentvillage/install/install_index.ts:46` — `readTelegramHandle()`
- `packages/edge-city/agentvillage/install/install_index.ts:293` — `installIndex()` body start
- `packages/edge-city/agentvillage/install/install_index.ts:298` — `upsertEnvVar()` — first disk write; insertion point for identity check
- `packages/edge-city/agentvillage/install/install.ts:1-60` — orchestrator; calls `installIndex()` synchronously
- `packages/edge-city/agentvillage/install/reconcile_digest_crons.ts:1-12` — minimal shim
- `packages/edge-city/agentvillage/install/hermes_cli.ts:14` — `hermesExecEnv()`
- `packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts:655` — `fetchOpportunitiesFromMcp` — init + list_opportunities; no identity surface today
- `packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts:704` — `buildDailyBriefContext` INDEX_API_KEY read; logging insertion point
- `packages/protocol/src/mcp/mcp.server.ts:454` — MCP server initialized with `{ name: 'index-network', version: '1.0.0' }` only
- `backend/src/adapters/database.adapter.ts:31` — `detectSocialLabel` — telegram label detection
- `backend/src/adapters/database.adapter.ts:4462` — `getUserSocials(userId)` — all socials for user
- `backend/src/adapters/database.adapter.ts:4483` — `findTelegramHandleOwners` — SQL normalization regex (strip @, URL prefix)
- `backend/src/schemas/database.schema.ts:108` — `user_socials` table definition
- `backend/src/controllers/agent.controller.ts:180` — `GET /agents/me`; requires agentId binding, not usable

## Integration Points

### Inbound References (to `installIndex()`)
- `packages/edge-city/agentvillage/install/install.ts:~45` — only caller; invokes synchronously

### Outbound Dependencies (from the new identity check)
- `GET /api/me` on `PROTOCOL_MCP_URL.replace('/mcp', '')` — new REST dependency from install script; backend must deploy it before install script can call it
- `hermesHome()` (`install_index.ts:20`) + `readApiKey()` + `readTelegramHandle()` — all available before the check runs

### Infrastructure Wiring
- `AuthOrApiKeyGuard` is already registered as a guard; no route registry changes needed for a guard swap
- `userService.findWithGraph()` (`auth.controller.ts:me()`) returns full user + socials array; filtering for label='telegram' is a client-side operation on the existing response data (no new DB method needed)
- `reconcile_digest_crons.ts` has no argument parsing infrastructure; `readFlag` from `install/args.ts` is available for `--check-identity` addition

## Architecture Insights

**Guard swap is safe.** `AuthOrApiKeyGuard` is a strict superset of `AuthGuard` for JWT; it tries Bearer first, then falls back to API key. Existing frontend calls (which send JWT) are unaffected. The only behavioral change for `/me` is that API-key callers now get a response instead of a 401.

**installIndex() must go async.** The function is exported and called by `install.ts`. Making it async requires `install.ts` to `await` it. The script uses top-level async idiom elsewhere (e.g., the file is `#!/usr/bin/env bun`), so `async function main()` + `main().catch(console.error)` is the right pattern.

**No new DB method needed for socials.** `userService.findWithGraph(user.id)` at `auth.controller.ts:71` already fetches socials via `findWithGraph` in the database adapter. The response already carries `socials: Array<{ label, value }>`. The `/me` handler just needs to extract the telegram social from the existing graph response and add it to the returned JSON.

**Reconcile script audit mode is additive.** `reconcile_digest_crons.ts` imports `reconcileDigestCronJobs` from `install_index.ts`; an audit mode can be added without touching the reconcile function itself — just read the API key, call `/api/me`, print result, exit. No flags need to propagate into `reconcileDigestCronJobs`.

**Digest runtime logging.** `buildDailyBriefContext` at line 704 reads `INDEX_API_KEY` from env and `INDEX_MCP_URL`. The backend base URL is `INDEX_MCP_URL.replace(/\/mcp$/, '')`. One `fetch(baseUrl + '/api/me', { headers: { 'x-api-key': apiKey } })` before the MCP call will log `authenticatedAs: { id, name, email }` for every digest run, creating a permanent trail for diagnosing future misconfigurations.

## Precedents & Lessons

3 relevant past changes analyzed.

### Precedent: Recipient-bound connect links
**Commit(s):** `d39d08f4a0` — "Require recipients for connect links (#927)" (2026-06-10)
**Blast radius:** 8 files — `.rpiv/artifacts/` (5 docs), `connect-link.controller.ts`, `connect-link.service.ts`, `connect-link.e2e.spec.ts`

**Follow-up fixes:** None found.

**Takeaway:** Patch was reactive (added after leak was observed). Tests covered both the rejection (wrong user) and success (correct user) paths in `connect-link.e2e.spec.ts`. Same pattern needed here: install-time check test for mismatch + success + missing handle cases.

### Precedent: Share API-key principal resolution, fail closed
**Commit(s):** `420c5602381` — "refactor(auth): share API-key principal resolution, fail closed on divergent columns" (2026-06-08)
**Blast radius:** extracted `resolveApiKeyUserId` to `lib/apikey/principal.ts`; routed both MCP (`mcp.controller.ts`) and REST (`auth.guard.ts`) through it

**Follow-up fixes:** None found.

**Lessons from docs:** This commit explicitly fixed a case where the same API key resolved to different users on different codepaths (MCP preferred `userId`, REST preferred `referenceId`). **This is structurally the same class of bug** — a key resolving to the wrong user. The fix was to centralize resolution and fail closed.

**Takeaway:** Divergent codepaths for the same key always produce subtle identity bugs. Any new path that reads `x-api-key` must go through `AuthOrApiKeyGuard`/`resolveApiKeyUserId`, never hand-roll key-to-user resolution.

### Precedent: Tighten opportunity caller filtering
**Commit(s):** `7162581a44` — "fix(protocol): tighten opportunity caller filtering" (2026-06-07)
**Blast radius:** 3 files in protocol only (`opportunity.tools.ts`, `opportunity.utils.ts`, 1 test)

**Takeaway:** Scattered inline caller checks were consolidated into a single centralized `callerScoped` filter. Pattern to follow: one place to fail, not N scattered conditions.

### Composite Lessons
- Guards added retrospectively after incidents (`d39d08f4a0`, `7162581a44`) consistently miss edge cases (empty/null values). Add explicit tests for empty handle, mismatch, and invalid key at install time — not just the happy path.
- Centralization is the remedy for divergent-codepath identity bugs (`420c5602381`). The new `/api/me` guard swap and the `resolveApiKeyUserId` helper already enforce this for REST; the install script just needs to consume the same endpoint.
- When a check fails because a value is missing vs. wrong, these are different errors. Empty telegram handle → warn and continue; present but wrong → fail. This distinction prevents the fix from becoming a blocker for new residents with incomplete profiles.

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-06-11_00-55-13_agentvillage-digest-wrong-opportunity-delivery.md` — FRD that drove this research; captures the incident, decisions, and open questions this document resolves

## Developer Context

**Q (discover: Fix scope): Root-cause why User C got it, then fix.**
A: Root cause it, close the path. Connect-link patch stays as defense-in-depth.

**Q (discover: Root cause identification — which layer): Whose userId was on the connect link?**
A: User A's — User C's 404 after the patch confirmed the code resolves to `userId=A`, meaning C's workspace authenticated as A via a wrong API key.

**Q (discover: Deployment isolation model): Per-resident Hermes workspace?**
A: Confirmed — separate `HERMES_HOME` per resident.

**Q (discover: Wrong-delivery mechanism): How?**
A: User C's `HERMES_HOME` had User A's `INDEX_API_KEY`. `fetchOpportunitiesFromMcp` → MCP authenticated as A → `mintConnectLink(userId=A, ...)` → A's link in C's digest.

**Q (discover: Faulty window): When?**
A: Staged at 02:00 prepare cron, sent at 08:00. Bug is in prepare path.

**Q (discover: Existing guards): Sufficient?**
A: All three guards stay; root cause is upstream (wrong key → wrong user → correctly scoped data for the wrong person).

**Q (`auth.controller.ts:63`): Where should the API-key-capable identity endpoint live?**
A: Swap `GET /me` from `AuthGuard` to `AuthOrApiKeyGuard`. One guard change, no new route, backward-compatible.

**Q (`install_index.ts:298`): What should the install check compare?**
A: Also verify telegram handle from socials — fetch `user_socials` where `label='telegram'`, normalize, compare against `--telegram-handle`. Mismatch → fail; missing handle → warn and continue.

**Q (empty handle edge case): What if user has no telegram handle in their Index profile?**
A: Warn but continue. Log: "authenticates as {name} ({email}) — no telegram handle on profile, cannot verify @{handle}." Only hard-fail on a present but mismatched handle.

## Open Questions

- How many residents are currently deployed, and which have a potential API key mismatch? An audit script should enumerate all `HERMES_HOME` paths (from Railway env or a fleet config) and call `GET /api/me` with each resident's stored `INDEX_API_KEY` before scheduling re-installs.
- Was the wrong key a one-off installation error, or is there a systemic flaw in the install process (e.g., an onboarding script that copies the key from a template or a previous resident's env file)?
- Does `userService.findWithGraph()` eagerly load socials in the current `me()` handler path, or is it a separate query? Verify at `auth.controller.ts:71` + `database.adapter.ts:4427` that socials are included in the existing `findWithGraph` call before relying on them in the response.
