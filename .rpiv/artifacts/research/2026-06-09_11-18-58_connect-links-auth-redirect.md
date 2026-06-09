---
date: 2026-06-09T11:18:58+0300
author: Yankı Ekin Yüksel
commit: cc4ceda7a
branch: dev
repository: index
topic: "Connect links unauthenticated auth redirect — research"
tags: [research, frontend, auth, connect-links, chat]
status: complete
last_updated: 2026-06-09T11:18:58+0300
last_updated_by: Yankı Ekin Yüksel
---

# Research: Connect links unauthenticated auth redirect

## Research Question

Trace the code paths for extending `AuthContext.openLoginModal()` to accept an optional `callbackURL` string parameter, replacing the ChatPage's hard `navigate('/')` bounce with an inline login modal. Cover: AuthContext signature change, backward compatibility with existing callers, end-to-end magic-link and Google OAuth callbackURL routing, email/password implicit URL preservation, dismiss behavior and ref gating, and the precedent landscape.

## Summary

The fix is clean and low-risk. `AuthModal` already accepts a `callbackURL` prop (`AuthModal.tsx:13`) used by magic-link (line 65) and Google OAuth (line 120), but `AuthContext` renders `<AuthModal>` at line 189-192 without passing any `callbackURL`. The gap is a single plumbing layer: add `pendingCallbackURL` state in `AuthContext`, thread it through `openLoginModal(callbackURL?)` to `<AuthModal callbackURL={pendingCallbackURL}>`. All 5 existing callers (Header, landing page, invitation page, index join page) pass zero arguments and remain unaffected. The Better Auth server correctly preserves `callbackURL` through both magic-link email links (embedded as query param) and Google OAuth (encrypted in server-side state), so passing `window.location.href` from the ChatPage `useEffect` correctly restores the full path including `?msg=...`.

## Detailed Findings

### AuthContext: openLoginModal signature and state wiring

The `openLoginModal` function is defined at `AuthContext.tsx:18` as `openLoginModal: () => void`. The implementation at lines 45-47 simply calls `setLoginModalOpen(true)` with no parameter support. A new `pendingCallbackURL` state variable must be added alongside `loginModalOpen` (line 32), the type widened to `(callbackURL?: string) => void`, and the `useCallback` updated to set both states atomically. The `onClose` handler at line 191 must clear `pendingCallbackURL` alongside `loginModalOpen` to prevent stale state leaking between modal opens. No `useEffect` cleanup is needed between opens because each `openLoginModal()` call overwrites `pendingCallbackURL` immediately via the setter.

### AuthModal: existing callbackURL plumbing

`AuthModal.tsx:13` defines `callbackURL?: string` in `AuthModalProps`. Two of the three auth paths use it:

- **Magic link** (line 63-66): `authClient.signIn.magicLink({ email, callbackURL })` — Better Auth server embeds `callbackURL` as a query parameter in the email verification URL and redirects there after token validation.
- **Google OAuth** (line 118-120): `authClient.signIn.social({ provider: 'google', callbackURL })` — Better Auth stores `callbackURL` encrypted in the OAuth state (server-side `generateState` at `oauth2/state.mjs`), invisible to Google during the round-trip. On callback, parsed state restores `callbackURL` and the user is redirected there.
- **Email/password** (line 96-99): does NOT accept or pass `callbackURL`. The session is established via XHR (`authClient.signIn.email({ email, password })`), the modal closes, and the user stays on the current page. URL unchanged.

Both OAuth/magic-link paths have a fallback: `callbackURL ?? window.location.origin` (lines 65, 120). When `callbackURL` is `undefined` (current state from `openLoginModal()` path), the user lands at `/` after authentication. The fix overrides this fallback by providing `pendingCallbackURL`.

### ChatPage: auth-guard replacement

The auth-guard `useEffect` at `page.tsx:30-34` currently calls `navigate('/')` when `isAuthenticated` is `false`, discarding all URL state. The FRD proposes replacing it with `openLoginModal(window.location.href)`, gated by a `useRef` to fire exactly once per page load. `useRef` is already imported at line 1 and `opportunityAcceptedRef` is used at line 26 — an additional `loginPromptedRef` is the only new variable needed.

Timeline after the change:
1. `authLoading` transitions `true` → `false` (AuthContext resolved)
2. Effect fires: `!authLoading && !isAuthenticated && !loginPromptedRef.current` → `true`
3. `loginPromptedRef.current = true`, `openLoginModal(window.location.href)` called
4. Modal opens over the spinner (AuthModal is sibling of children, `position: fixed`)
5. User authenticates or dismisses

After dismissal, the effect's dependencies (`authLoading`, `isAuthenticated`, `openLoginModal`) are unchanged — React does not re-invoke the callback. Even if a future state change triggered re-execution, `loginPromptedRef.current = true` blocks the body.

### AuthContext redirect check compatibility

`AuthContext.tsx:177-182` checks `shouldRedirectToHome` based on pathname. The `/u/` prefix is in `publicPrefixes` (line 133), so the global guard does NOT intercept unauthenticated visits to `/u/:id/chat`. This is correct — the chat page handles auth itself via the new modal pattern. No change needed to `publicPrefixes`.

### Email/password: implicit URL preservation

Email/password sign-in (`AuthModal.tsx:85-112`) does not navigate the browser. `authClient.signIn.email()` establishes a session via XHR, the modal closes via `onClose()` (line 106), and React re-renders: `isAuthenticated` flips to `true`, the fetchData `useEffect` (ChatPage.tsx:36-51) fires, `prefillMessage` is still in state from `searchParams.get('msg')` at line 19, and the ChatView renders with the prefilled message. Since `window.location.href` was never modified, the URL path and `?msg=...` survive intact without any `callbackURL` involvement.

### Spinner persistence after dismiss

After the user dismisses the modal without authenticating, `loginModalOpen` is `false`, `isAuthenticated` is still `false`. The ChatPage's local `isLoading` (line 30, default `true`) never transitions to `false` because the fetchData effect (line 36) returns early when `isAuthenticated` is false. The spinner at lines 85-90 renders. This satisfies FRD requirement #4 (stay on page, no redirect).

### Backward compatibility with existing callers

All 5 existing callers pass zero arguments to `openLoginModal()`:
- `Header.tsx:35` — calls `openLoginModal()`, has its own post-auth `useEffect` that navigates to `/`
- `landing/page.tsx:313` and `332` — calls `openLoginModal()`, no post-auth redirect (user stays on landing)
- `l/[code]/page.tsx:145` — calls `openLoginModal()`, relies on `useEffect` reload loop after auth
- `index/[indexId]/page.tsx:161` — stores `pending_network_join` in localStorage, then calls `openLoginModal()`, `IndexesContext.tsx:82-88` reads it after auth

Because the parameter is optional (`callbackURL?: string`), all callers continue to work: `openLoginModal()` desugars to `openLoginModal(undefined)`, setting `pendingCallbackURL = undefined` with zero behavioral change. No code changes needed in any existing caller.

## Code References

- `frontend/src/contexts/AuthContext.tsx:18` — `openLoginModal: () => void` type definition (widen to `(callbackURL?: string) => void`)
- `frontend/src/contexts/AuthContext.tsx:45-47` — `useCallback` implementation (add `pendingCallbackURL`+`loginModalOpen` atomic set)
- `frontend/src/contexts/AuthContext.tsx:32` — `loginModalOpen` state (add `pendingCallbackURL` alongside)
- `frontend/src/contexts/AuthContext.tsx:189-192` — `<AuthModal>` rendering (add `callbackURL={pendingCallbackURL}`)
- `frontend/src/contexts/AuthContext.tsx:115-120` — auto-close modal on auth (no change needed, `pendingCallbackURL` not cleared intentionally)
- `frontend/src/components/AuthModal.tsx:13` — `callbackURL?: string` prop definition
- `frontend/src/components/AuthModal.tsx:63-66` — magic-link `callbackURL` usage
- `frontend/src/components/AuthModal.tsx:118-120` — Google OAuth `callbackURL` usage
- `frontend/src/components/AuthModal.tsx:85-106` — email/password sign-in (no callbackURL)
- `frontend/src/app/u/[id]/chat/page.tsx:30-34` — auth-guard `useEffect` (target for replacement)
- `frontend/src/app/u/[id]/chat/page.tsx:1` — `useRef` already imported
- `frontend/src/app/u/[id]/chat/page.tsx:26` — `opportunityAcceptedRef` usage (pattern for `loginPromptedRef`)
- `frontend/src/app/u/[id]/chat/page.tsx:19` — `prefillMessage` from `searchParams.get('msg')`
- `frontend/src/app/u/[id]/chat/page.tsx:85-90` — spinner render (modal overlays this)
- `frontend/src/contexts/AuthContext.tsx:133` — `publicPrefixes` including `/u/`
- `frontend/src/lib/auth-client.ts:8` — Better Auth client with `magicLinkClient()`
- `backend/src/lib/betterauth/betterauth.ts:154-158` — magic-link plugin config

## Integration Points

### Inbound References
- `frontend/src/components/Header.tsx:35` — calls `openLoginModal()` (zero args)
- `frontend/src/app/landing/page.tsx:313,332` — calls `openLoginModal()` (zero args)
- `frontend/src/app/l/[code]/page.tsx:145` — calls `openLoginModal()` (zero args)
- `frontend/src/app/index/[indexId]/page.tsx:161` — calls `openLoginModal()` (zero args)

### Outbound Dependencies
- `frontend/src/lib/auth-client.ts:8` — `authClient.signIn.magicLink()` and `authClient.signIn.social()` consume `callbackURL`
- `backend/src/lib/betterauth/betterauth.ts:154-158` — Better Auth server config for magic-link plugin

### Infrastructure Wiring
- `AuthContext.tsx:189-192` — React rendering of `<AuthModal>` (the wiring point for `callbackURL`)
- `AuthContext.tsx:45-47` — `useCallback` defining `openLoginModal` (the injection point for `callbackURL`)

## Architecture Insights

- **Three-tier redirect contract**: `AuthModal` handles the per-auth-method redirect logic (magic-link email URL construction, Google OAuth state), `AuthContext` provides the modal state and URL plumbing, and individual pages/components trigger the flow. No page-level useEffect knows about the underlying redirect mechanism — only AuthModal does. The FRD keeps this layering intact.
- **Redirect vs stay distinction**: For flows where the browser navigates away (magic-link email click, Google OAuth), `callbackURL` is essential. For flows where the browser stays (email/password XHR), no redirect mechanism is needed — URL preservation is automatic. The FRD correctly handles both via the same `pendingCallbackURL` state.
- **No generic returnTo infrastructure**: The FRD intentionally avoids building a site-wide return-URL pattern. The three existing redirect patterns (Header: navigate to `/`; landing: stay; invitation: reload) are each caller-managed via their own useEffects or localStorage. The FRD's change is a targeted `callbackURL` generalization that only the ChatPage uses, keeping the existing patterns untouched.

## Precedents & Lessons

5 similar past changes analyzed.

### Precedent: Intent-sharing connect flow — public /i/ routes with inline login modal
**Commit(s)**: `6bbfb7f8e` — "feat(intent-sharing): redesign shared intent page with public access and connect flow" (2026-03-25)
**Blast radius**: 5 files across 2 layers
  frontend/src/app/i/[token]/page.tsx — redesign + connect flow
  frontend/src/components/Header.tsx — Login button for logged-out visitors
  frontend/src/contexts/AuthContext.tsx — made /i/ routes public

**Follow-up fixes**:
- `c78ed185e` — "fix: allow found-in-translation routes without authentication" (2026-03-31) — the `isPublicPage` list in AuthContext didn't include `/found-in-translation`
- `0249a5fab` — "Add header to /i page and suppress header on /i routes"

**Takeaway**: When making a page public with inline login, update the `isPublicPage` array in AuthContext or the global auth guard bounces visitors. `/u/` is already in the list — no change needed.

### Precedent: AuthModal callbackURL prop for OAuth login bridge
**Commit(s)**: `0132fd90e` — "feat: add callbackURL prop to AuthModal for oauth login bridge" (2026-04-03)
**Blast radius**: 1 file, 1 layer — `frontend/src/components/AuthModal.tsx`

**Follow-up fixes**:
- `3e3a56c47` — "fix(frontend): use VITE_PROTOCOL_URL for auth providers fetch in AuthModal" (2026-04-09) — hardcoded `/api` broke in production

**Takeaway**: AuthModal URL config must use `VITE_PROTOCOL_URL`, not hardcoded values.

### Precedent: Persist pending index and auto-join on login
**Commit(s)**: `72dd330a9` — "Persist pending index and auto-join on login" (2026-02-25)
**Blast radius**: 3 files — `index/[indexId]/page.tsx`, `AuthModal.tsx`, `IndexesContext.tsx`

**Takeaway**: localStorage pending-state pattern works reliably (no follow-up bugs in 30 days).

### Precedent: Persist invite code and accept after onboarding
**Commit(s)**: `08cae54f9` — "Persist invite code and accept after onboarding" (2026-03-13)
**Blast radius**: 2 files — `l/[code]/page.tsx`, `onboarding/page.tsx`

**Takeaway**: Second successful localStorage deferred-join precedent, no follow-up bugs.

### Precedent: Ghost user chat page with prefill message
**Commit(s)**: `f8de285f9` — "feat(frontend): differentiate CTA for ghost vs onboarded users with prefill invite flow" (2026-03-14)
**Blast radius**: 5 files — `chat/page.tsx`, `ChatContent.tsx`, `ChatView.tsx`, `OpportunityCardInChat.tsx`, `opportunities.ts`

**Follow-up fixes**:
- `a0d830109` — "fix: ghost user claim via session hook + disable email/password in prod" (2026-03-22) — ghost users were never de-ghosted because `findUserByEmail` runs before `createUser`

**Takeaway**: Chat page auth guard `navigate('/')` has no `{ replace: true }`, creating a back-button redirect loop. The inline modal replacement naturally solves this.

### Composite Lessons
- **Route visibility list is brittle**: Every new public page must be added to the `isPublicPage` array in `AuthContext.tsx:133`. `/u/` is already present — no change needed for this fix.
- **AuthModal URL config breaks in production**: Twice the source of production-only bugs (`72dd330a9` hardcoded `http://localhost:3000`, `3e3a56c47` hardcoded `/api`). All fetch/redirect URLs must use `VITE_PROTOCOL_URL` or `window.location.origin`.
- **localStorage pending-state pattern works reliably**: Three precedents used localStorage for deferred auth actions with zero follow-up bugs.
- **AuthModal `callbackURL` prop exists but is unwired**: The prop at `AuthModal.tsx:13` is only used by the standalone `/login` page. `AuthContext` at line 189-192 does not pass it. This is the exact plumbing gap the planned change fills.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-06-09_11-05-29_connect-links-auth-redirect.md` — Feature requirements: extend openLoginModal(), pass callbackURL, replace ChatPage navigate('/')

## Developer Context
**Q (discover: Mechanism: inline login modal vs. redirect to /login): What mechanism should the chat page use to handle unauthenticated visitors?**
A: Use `openLoginModal()` inline with `callbackURL = window.location.href`

**Q (discover: Modal dismiss behavior): If the user dismisses the login modal without authenticating, what should happen?**
A: Stay on page when dismissed

**Q (discover: Pre-resolution: AuthModal callbackURL plumbing): Pre-resolved from codebase evidence**
A: Confirmed — `AuthModal.tsx:12-13` prop exists, `AuthContext.tsx:189-192` doesn't wire it

**Q (discover: Pre-resolution: No generic returnTo convention): Pre-resolved from codebase evidence**
A: Confirmed — `AuthContext.tsx:136-139` hardcodes `navigate('/')`

**Q (discover: Pre-resolution: Backend URLs already correct): Pre-resolved from codebase evidence**
A: Confirmed — `connect-link.controller.ts:173-174` builds correct URLs

## Related Research
- None — this is the first research artifact for this area.

## Open Questions

None.