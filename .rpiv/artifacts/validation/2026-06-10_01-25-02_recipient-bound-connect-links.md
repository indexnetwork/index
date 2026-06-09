---
template_version: 1
date: 2026-06-10T01:25:02+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "Validation of Recipient-bound connect links"
status: ready
verdict: pass
parent: "/Users/aposto/Projects/index/.worktrees/research-recipient-bound-connect-links/.rpiv/artifacts/plans/2026-06-10_01-05-37_recipient-bound-connect-links.md"
tags: [validation, connect-links, auth, opportunities, frontend]
last_updated: 2026-06-10T01:25:02+0300
---

## Validation Report: Recipient-bound connect links

### Implementation Status

- ✓ Phase 1: Authenticated backend resolver — Fully implemented and verified against all checked criteria.
- ○ Phase 2: Frontend continuation service and route — Not implemented; not marked complete in the plan and not included in this validation verdict.
- ○ Phase 3: Frontend and auth-route regression coverage — Not implemented; not marked complete in the plan and not included in this validation verdict.
- ○ Phase 4: Verification hardening for all link kinds — Not separately marked complete; Phase 1's backend test updates already cover all backend link kinds, but the Phase 4 checklist remains unchecked and outside this validation verdict.

### Automated Verification Results

- ✓ Backend connect-link tests pass: `cd backend && bun test tests/connect-link.e2e.spec.ts tests/connect-link.surface.spec.ts` — 14 pass, 0 fail, 51 assertions.
- ✓ Guard order is present on the side-effecting resolver: `grep -n "@UseGuards(RateLimit('read'), AuthGuard)" backend/src/controllers/connect-link.controller.ts` — found at `backend/src/controllers/connect-link.controller.ts:78`.
- ✓ Authenticated `/go` uses recipient-aware resolution and public controller has no `resolveConnectLink(code)` call: `grep -n "resolveConnectLinkForUser(code, user.id)" backend/src/controllers/connect-link.controller.ts` appears at `backend/src/controllers/connect-link.controller.ts:84`; `grep -n "resolveConnectLink(code)" backend/src/controllers/connect-link.controller.ts` returned no matches.
- ✓ No regressions detected in the completed Phase 1 validation surface.

### Code Review Findings

#### Matches Plan:

- `backend/src/controllers/connect-link.controller.ts:55-65` — public `/c/:code` performs presence/syntax validation only and redirects valid-looking codes to `${FRONTEND_URL}/c/:code` without calling DB-backed link resolution or opportunity side effects.
- `backend/src/controllers/connect-link.controller.ts:77-86` — authenticated `/c/:code/go` uses `@UseGuards(RateLimit('read'), AuthGuard)`, masks malformed/unresolved/wrong-recipient cases as 404, and calls `resolveConnectLinkForUser(code, user.id)` before any opportunity work.
- `backend/src/controllers/connect-link.controller.ts:88-139` — greeting generation, `approveIntroduction`, `startChat`, Telegram lookup, and conversation lookup are all below the recipient-aware resolution/null-return guard.
- `backend/src/services/connect-link.service.ts:288-318` — `resolveConnectLinkForUser` filters by both `connect_links.code` and `connect_links.user_id` before opportunity replacement lookup and scopes TTL extension by the same pair.
- `backend/tests/connect-link.e2e.spec.ts:64-123` — e2e coverage verifies malformed public links, public redirect for connect and approve-introduction codes, authenticated 404 masking, and wrong-account masking.
- `backend/tests/connect-link.surface.spec.ts:121-300` — surface tests pass authenticated users into `go`, preserve correct-recipient Telegram/web destinations, verify `send_direct`, `outreach`, and `approve_introduction`, and assert wrong-account calls leave status/approval state unchanged.

#### Deviations from Plan:

None. Implementation is a faithful realization of the completed Phase 1 plan. Later phases remain intentionally unchecked and unimplemented.

#### Pattern Conformance:

- ✓ Decorator and guard ordering follows existing controller conventions, with `RateLimit('read')` before `AuthGuard` on the authenticated resolver.
- ✓ Backend tests follow repository patterns: env loaded first, destructured `bun:test` imports, direct controller integration coverage, and cleanup in `afterAll`/`beforeEach` where mutable rows are created.
- ✓ Explicit `TEST_TIMEOUT_MS = 15_000` in `backend/tests/connect-link.surface.spec.ts` is consistent with repo guidance to set timeouts for slower backend/integration tests.
- Minor observation: `ConnectLinkController.go` continues to orchestrate destination construction in-controller. This is an acceptable variation, not a Phase 1 deviation, because the pre-existing controller owned this flow and the plan explicitly scoped only recipient binding and public/auth route separation.

### Manual Testing Required:

1. Phase 1 backend behavior:
   - [ ] Public `/c/:code` performs only code syntax validation and redirects to `${FRONTEND_URL}/c/:code` for well-formed codes.
   - [ ] Wrong-account `/c/:code/go` returns `{ "error": "Link not found" }` with 404 before greeting generation or opportunity side effects.
   - [ ] Correct-recipient Telegram/web destination behavior remains unchanged except authenticated user is now passed to `go`.
   - [ ] Ratify the known Slice 1 atomicity tension: public `/c/:code` redirects to the frontend continuation route introduced in Phase 2, so do not deploy Phase 1 alone unless a temporary frontend route exists.

### Recommendations:

- Ready to commit Phase 1 backend changes — the completed, checked plan criteria are implemented and validated.
- Continue with Phase 2 before deployment so public `/c/:code` has the frontend continuation route it now redirects to.
