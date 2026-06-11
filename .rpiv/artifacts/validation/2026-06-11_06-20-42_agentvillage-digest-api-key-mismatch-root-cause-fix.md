---
date: 2026-06-11T06:20:42+0300
author: Yankı Ekin Yüksel
commit: 0ee89a4dcd
branch: fix/agentvillage-digest-api-key-mismatch
repository: index
topic: "Validation of AgentVillage digest API key mismatch root-cause fix"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-06-11_01-52-31_agentvillage-digest-api-key-mismatch-fix.md"
tags: [validation, fix, agentvillage, digest, install, auth-guard, api-key, identity, install_index]
last_updated: 2026-06-11T06:20:42+0300
---

## Validation Report: AgentVillage Digest API Key Mismatch Root-Cause Fix

### Implementation Status

- ✓ Phase 1: Backend guard swap — Fully implemented
- ✓ Phase 2: Install identity check — Fully implemented
- ✓ Phase 3: Async wiring and digest runtime logging — Fully implemented
- ✓ Phase 4: Backend test for /me with API key — Fully implemented

### Automated Verification Results

- ✓ ESLint passes (`cd backend && bun run lint`): 0 errors, 58 pre-existing warnings — none from changed files
- ✓ `AuthOrApiKeyGuard` exported (`grep -c 'export const AuthOrApiKeyGuard' backend/src/guards/auth.guard.ts`): returns 1
- ✓ `AuthGuard` still imported (`grep -c 'AuthGuard' backend/src/controllers/auth.controller.ts`): returns 3 (import line + `updateProfile` + `deleteAccount`)
- ✓ `normalizeTelegramHandle` exported (`grep -c 'export function normalizeTelegramHandle' ...install_index.ts`): returns 1
- ✓ `installIndex` is async (`grep -c 'export async function installIndex' ...install_index.ts`): returns 1
- ✓ `normalizeTelegramHandle('@alice')` → `'alice'`: PASS
- ✓ `normalizeTelegramHandle('https://t.me/Alice/')` → `'alice'`: PASS
- ✓ `normalizeTelegramHandle('t.me/alice')` → `'alice'`: PASS
- ✓ `normalizeTelegramHandle('')` → `''`: PASS
- ✓ `normalizeTelegramHandle('ALICE')` → `'alice'`: PASS
- ✓ `async function main` in `install.ts`: returns 1
- ✓ `await installIndex` in `install.ts`: returns 1
- ✓ `main().catch` in `install.ts`: returns 1
- ✓ `console.log.*authenticatedAs` in `build-daily-brief-context.ts`: returns 1
- ✓ Test file exists (`ls backend/tests/auth-me-apikey.spec.ts`): exits 0
- ✓ Tests pass (`cd backend && bun test tests/auth-me-apikey.spec.ts`): 4 pass, 0 fail (ran twice; consistent)
- ✓ No regressions detected

### Code Review Findings

#### Matches Plan:

- `auth.controller.ts:5` — Both guards imported side-by-side: `import { AuthGuard, AuthOrApiKeyGuard } from '../guards/auth.guard'`
- `auth.controller.ts:64` — Only `me()` uses `AuthOrApiKeyGuard`; ordering correct: `@UseGuards(RateLimit('read'), AuthOrApiKeyGuard)`
- `auth.controller.ts:96,128` — `updateProfile` and `deleteAccount` unchanged: `@UseGuards(RateLimit('write'), AuthGuard)`
- `install_index.ts:66` — `normalizeTelegramHandle` exported, correct normalization order: lowercase → strip URL prefix → strip `@` → strip path suffix
- `install_index.ts:84` — `verifyIndexIdentity` declared without `export` (private/internal)
- `install_index.ts:100` — `AbortSignal.timeout(10_000)` present on the identity fetch
- `install_index.ts:103–107` — HTTP 401/403 → `console.error` clear message + `process.exit(1)`
- `install_index.ts:110–114` — Non-ok non-401/403 → `console.warn` + `return` (no exit)
- `install_index.ts:120–127` — Network/timeout error → `console.warn` distinguishing TimeoutError vs. network error + `return`
- `install_index.ts:138–140` — Empty `telegramHandle` → log identity only, return without comparison
- `install_index.ts:143–149` — Missing telegram social → `console.warn` + `return` (no exit)
- `install_index.ts:155–159` — Handle mismatch → `console.error` clear message + `process.exit(1)`
- `install_index.ts:398–404` — Call order: `readApiKey()` → `readTelegramHandle()` → `await verifyIndexIdentity()` → first `upsertEnvVar()` — identity check is before any disk mutation
- `install.ts:183` — `async function main(): Promise<void>` (was `function main(): void`)
- `install.ts:199` — `await installIndex()` — awaited
- `install.ts:200–201` — `installEdgeos()` and `installGeo()` still called synchronously (no await)
- `install.ts:214` — `main().catch((err) => { console.error(err); process.exit(1); })` — correct exit-code-1 form (not bare `console.error`)
- `build-daily-brief-context.ts:707–726` — Identity log try/catch is inside `if (apiKey)` block, before `readDeliveredIds` (line 728) and `fetchOpportunitiesFromMcp` (line 729); catch block is empty of executable statements (comment only)
- `build-daily-brief-context.ts:717–720` — Log format matches: `console.log('[build-daily-brief-context] authenticatedAs:', { id, name, email })`
- `auth-me-apikey.spec.ts:23,26` — Cleanup stack pattern identical to `experiment-signup.spec.ts`: `[...cleanup].reverse()`
- `auth-me-apikey.spec.ts:82–97` — Success path: `AuthOrApiKeyGuard` + `controller.me()` → `response.status === 200`, `json.user.id`, `email`, `socials[]`
- `auth-me-apikey.spec.ts:99–115` — Cross-resolution: two distinct keys → `user1.id !== user2.id`
- `auth-me-apikey.spec.ts:118–123,126–129` — Invalid key throws; missing auth throws

#### Deviations from Plan:

None. Implementation is a faithful realization of the plan.

#### Pattern Conformance:

- ✓ Guard swap follows the established mixed-controller pattern present in `network.controller.ts`, `intent.controller.ts`, `agent.controller.ts`, and `opportunity.controller.ts` — `RateLimit` first, auth guard second
- ✓ `AuthOrApiKeyGuard` on read-only GET endpoint (`/me`), `AuthGuard` on mutating endpoints — consistent with `agent.controller.ts:/me` (closest existing analog)
- ✓ Import style (`AuthGuard` + `AuthOrApiKeyGuard` as values, `AuthenticatedUser` as a separate `import type`) matches `opportunity.controller.ts` pattern exactly
- ✓ Test cleanup stack, helper signatures (`setupExperimentNetwork`, `cleanupUser`), and `AuthOrApiKeyGuard(new Request(...))` call style are identical to `experiment-signup.spec.ts`
- Acceptable variation: `auth-me-apikey.spec.ts` uses `beforeAll` for shared state; `experiment-signup.spec.ts` creates fixtures per-test. Both are valid given the test structures differ.

#### Potential Issues:

- `install_index.ts:143` — `s.label === "telegram"` is case-sensitive. In practice, Index Network stores social labels as lowercase (`database.adapter.ts` write paths), so the risk is negligible. No change required.
- `build-daily-brief-context.ts:711` — Identity log fetch has no timeout (unlike `verifyIndexIdentity`'s `AbortSignal.timeout(10_000)`). A stalled call could delay the 02:00 digest cron. The plan marks this as best-effort with a "never propagate" catch, so a stall would eventually be released by the OS, but could delay digest startup. Non-blocking concern; no action required before merge.

### Manual Testing Required:

1. Phase 1 — Guard scope isolation:
   - [ ] Only `me()` guard changed; `updateProfile` and `deleteAccount` still use `AuthGuard`
   - [ ] Import line has both guards side-by-side (not a replacement import)
   - [ ] Frontend JWT callers to `GET /api/auth/me` unaffected — `AuthOrApiKeyGuard` tries Bearer JWT first

2. Phase 2 — Install identity verification:
   - [ ] On HTTP 401/403: error message printed, `process.exit(1)` called — verified by reading code at `install_index.ts:103–107`
   - [ ] On network error / non-ok response: warns and continues — verified by reading code at `install_index.ts:110–127`
   - [ ] On telegram mismatch: error message printed, `process.exit(1)` called — verified by reading code at `install_index.ts:155–159`
   - [ ] On missing telegram social but handle provided: warns and continues — verified by reading code at `install_index.ts:143–149`
   - [ ] On no `--telegram-handle` flag: just logs identity, no comparison — verified by reading code at `install_index.ts:138–140`

3. Phase 3 — Async wiring and digest logging:
   - [ ] `installEdgeos()` and `installGeo()` still called without await — confirmed at `install.ts:200–201`
   - [ ] Identity log `try/catch` never propagates — `catch {}` block has no executable statements at `build-daily-brief-context.ts:724–726`
   - [ ] Identity log is inside the existing `if (apiKey)` block, before `readDeliveredIds` / `fetchOpportunitiesFromMcp` — confirmed at lines 707, 728, 729

4. Phase 4 — Tests:
   - [ ] Covers success path: API key resolves + `me()` returns `{ user: { id, email, socials[] } }` — confirmed by test at `auth-me-apikey.spec.ts:80–98`
   - [ ] Covers cross-resolution prevention — confirmed at `auth-me-apikey.spec.ts:99–115`
   - [ ] Covers invalid key → guard throws — confirmed at `auth-me-apikey.spec.ts:118–123`
   - [ ] Covers missing auth → guard throws — confirmed at `auth-me-apikey.spec.ts:126–129`
   - [ ] Cleanup mirrors `experiment-signup.spec.ts` — confirmed identical stack/reversal pattern

### Recommendations:

- Ready to merge — implementation is complete and all automated criteria pass.
- Before opening a PR, bump the `packages/edge-city/agentvillage` version in `package.json` per CLAUDE.md's "Finishing a Branch" checklist (the submodule has new commits on `fix/install-index-identity-check`).
- Push `fix/install-index-identity-check` to `Edge-City/agentvillage` and open a PR there before promoting the monorepo's submodule pointer to `dev` — per the CLAUDE.md agentvillage submodule workflow.
- The identity log fetch timeout (`build-daily-brief-context.ts:711`) can be added in a follow-up if cron delay is observed in practice.
