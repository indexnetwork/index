---
date: 2026-06-09T11:05:29+0300
author: Yankı Ekin Yüksel
commit: cc4ceda7a
branch: dev
repository: index
topic: "Connect links unauthenticated auth redirect"
tags: [intent, frd, frontend, auth, connect-links]
status: complete
last_updated: 2026-06-09T11:05:29+0300
last_updated_by: Yankı Ekin Yüksel
---

# FRD: Connect links unauthenticated auth redirect

## Summary

Connect short-links (`/c/:code`) resolve to `/u/:id/chat?msg=<greeting>` but drop unauthenticated visitors on the homepage with no return path. Instead of a hard bounce, the chat page should show the login modal inline with a callback URL that preserves the chat destination and prefilled message across OAuth/magic-link flows.

## Problem & Intent

Connect short-links are intentionally unauthenticated — possession of the opaque short code grants access. When a visitor clicks one in a logged-out session, the backend correctly resolves to a chat deep-link with a prefilled greeting. But the frontend chat page hard-bounces unauthenticated users to `/` with no redirect awareness, discarding both the intended counterparty and the prefilled message. The visitor lands on the homepage confused, with no way to reach the conversation they were invited to.

The fix should let the visitor authenticate and land exactly where the short-link intended — at the chat with that specific user, with the greeting already prefilled in the input box.

## Goals

- Unauthenticated visitors landing on `/u/:id/chat?msg=...` can authenticate without losing the URL path or query params
- After authentication (email/password, magic-link, or Google OAuth), the user lands on that same chat URL with `msg` preserved
- The backend `/c/:code/go` endpoint is untouched — it already returns correct URLs

## Non-Goals

- Not changing the backend connect-link resolver behavior
- Not adding a generic site-wide `returnTo` redirect infrastructure — this is a targeted fix for the chat page
- Not altering the `/login` page (MCP-specific flow)

## Functional Requirements

1. Chat page SHALL show the login modal inline when an unauthenticated visitor lands on `/u/:id/chat`
2. Chat page SHALL pass `window.location.href` as `callbackURL` to the login mechanism so OAuth/magic-link flows return to the correct path with `?msg=...` preserved
3. AuthContext SHALL expose a mechanism to set a pending `callbackURL` that flows through to `AuthModal`
4. If the user dismisses the login modal without authenticating, the page SHALL remain in its current state — no redirect to `/`
5. Email/password sign-in SHALL auto-close the modal and show the chat with prefilled message on success
6. Magic-link and Google OAuth flows SHALL redirect back to the original `/u/:id/chat?msg=...` URL after authentication

## Non-Functional Requirements

- **Performance**: No additional network requests beyond the login modal's existing provider fetch
- **Security**: No sensitive data (the `?msg=...` greeting contents) must appear in magic-link email bodies beyond what the `callbackURL` already contains — this is existing behavior
- **UX / Accessibility**: Modal should render over the chat page, not replace it. Loading state (spinner) before auth should not flash the login page background
- **Reliability**: The login prompt fires exactly once per page load — dismissing the modal does not re-prompt

## Constraints & Assumptions

- AuthModal already accepts a `callbackURL` prop (used by magic-link and Google sign-in) — the plumbing exists but is not wired from AuthContext
- The `/login` page is MCP-specific and forwards query params to `/api/auth/mcp/authorize` — must not route general login through it
- The `/u/` prefix is marked as public in AuthContext (`AuthContext.tsx:133`), so the global auth guard does not block the chat page from rendering
- The existing chat page `useEffect` currently calls `navigate('/')` — this is the only code path to replace
- A `useRef` flag prevents re-showing the login modal on subsequent renders after dismissal

## Acceptance Criteria

- [ ] Open `https://protocol.index.network/c/UvThrrgHxC?link_preview=false` in a logged-out browser session — login modal appears instead of homepage redirect
- [ ] Sign in via email/password — lands on `/u/:id/chat` with the prefilled message in the input box
- [ ] Sign in via magic-link — email link returns to `/u/:id/chat?msg=...` with the prefilled message
- [ ] Sign in via Google OAuth — OAuth redirect returns to `/u/:id/chat?msg=...` with the prefilled message
- [ ] Dismiss the login modal (click ×) — stays on `/u/:id/chat` page, no redirect
- [ ] Authenticated user opening a connect link goes directly to chat (no modal) — existing behavior preserved
- [ ] The `navigate('/')` call is removed from `ChatPage` and replaced by the inline login pattern

## Recommended Approach

Extend `AuthContext.openLoginModal()` to accept an optional `callbackURL` string parameter. Store it in pending state and pass it through to `AuthModal`. In `ChatPage`, replace the `navigate('/')` in the auth-guard `useEffect` with a call to `openLoginModal(window.location.href)`, gated by a `useRef` to fire only once. The login modal renders inline over the chat page; email/password sign-in auto-closes the modal; OAuth/magic-link flows use the `callbackURL` to return to the correct URL.

## Decisions

### Mechanism: inline login modal vs. redirect to /login
**Question**: What mechanism should the chat page use to handle unauthenticated visitors?
**Recommended**: Use `openLoginModal()` inline with `callbackURL = window.location.href`
**Chosen**: Use `openLoginModal()` inline
**Rationale**: No redirect bounce, preserves `msg` naturally in-memory (still in URL search params), reuses existing `callbackURL` plumbing in `AuthModal`. The `/login` page is MCP-specific and would risk breakage.

### Modal dismiss behavior
**Question**: If the user dismisses the login modal without authenticating, what should happen?
**Recommended**: Stay on page when dismissed
**Chosen**: Stay on page
**Rationale**: The user is already on the intended page — no reason to redirect to home. Causes less surprise than the current hard bounce.

### Pre-resolution: AuthModal callbackURL plumbing
**Question**: Pre-resolved from codebase evidence — AuthModal already has `callbackURL` prop support but AuthContext doesn't wire it through
**Chosen**: Confirmed
**Rationale**: `evidence: frontend/src/components/AuthModal.tsx:12-13` — prop exists; `evidence: frontend/src/contexts/AuthContext.tsx:189-192` — no callbackURL passed

### Pre-resolution: No generic returnTo convention
**Question**: Pre-resolved from codebase evidence — AuthContext hardcodes `navigate('/')` with no return-URL preservation
**Chosen**: Confirmed
**Rationale**: `evidence: frontend/src/contexts/AuthContext.tsx:136-139`

### Pre-resolution: Backend URLs already correct
**Question**: Pre-resolved from codebase evidence — backend `/c/:code/go` correctly builds `/u/:id/chat?msg=...` URLs
**Chosen**: Confirmed
**Rationale**: `evidence: backend/src/controllers/connect-link.controller.ts:173-174`

## Open Questions

None.

## Suggested Follow-ups

- The current `navigate('/')` in ChatPage does not use `{ replace: true }` (`page.tsx:34`), creating a browser-back redirect loop. Since this call is removed by the fix, no separate action needed.
- The loading state when unauthenticated renders a null page behind the modal — could show the loading tree animation instead for a smoother initial render.

## References

- Linear issue [IND-354](https://linear.app/indexnetwork/issue/IND-354/connect-links-c-drop-unauthenticated-users-on-homepage-losing-chat)
- `backend/src/controllers/connect-link.controller.ts` — backend resolver (unaffected)
- `frontend/src/app/u/[id]/chat/page.tsx` — chat page (primary target)
- `frontend/src/contexts/AuthContext.tsx` — auth state and login modal rendering
- `frontend/src/components/AuthModal.tsx` — login modal with existing callbackURL prop