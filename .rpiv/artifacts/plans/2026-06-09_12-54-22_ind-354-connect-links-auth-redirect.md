---
date: 2026-06-09T12:54:22+0300
author: Yankı Ekin Yüksel
commit: cc4ceda7a
branch: dev
repository: index
topic: "IND-354: Connect links unauthenticated auth redirect"
tags: [plan, frontend, auth, connect-links, chat]
status: ready
parent: .rpiv/artifacts/designs/2026-06-09_11-48-41_connect-links-auth-redirect.md
last_updated: 2026-06-09T12:54:22+0300
last_updated_by: Yankı Ekin Yüksel
---

# IND-354: Connect Links Auth Redirect Implementation Plan

## Overview

Connect short-links (`/c/:code`) resolve to `/u/:id/chat?msg=<greeting>` but drop unauthenticated visitors on the homepage with no return path. This plan extends `AuthContext.openLoginModal()` to accept an optional `callbackURL` parameter, threads it through to `AuthModal.callbackURL`, and replaces the ChatPage's `navigate('/')` bounce with an inline login modal. See the design artifact for full architectural context.

Design: `.rpiv/artifacts/designs/2026-06-09_11-48-41_connect-links-auth-redirect.md`

## Desired End State

An unauthenticated visitor landing on `/u/:id/chat?msg=<greeting>` sees the login modal overlaid on the chat page instead of being redirected to `/`. After authentication:

- **Email/password**: modal auto-closes, chat page renders with `msg` preserved in the input
- **Magic-link**: email click returns to `/u/:id/chat?msg=...` with the greeting prefilled
- **Google OAuth**: redirect returns to `/u/:id/chat?msg=...` with the greeting prefilled

Dismissing the modal leaves the user on the chat page (spinner visible, no redirect). All 5 existing `openLoginModal()` callers (Header, landing, invitation, index join) continue to work unchanged.

## What We're NOT Doing

- Generic site-wide `returnTo` redirect infrastructure
- `/login` page changes (MCP-specific flow — must not be touched)
- Backend `/c/:code/go` resolver (already correct)
- Existing callers (Header, landing, invitation page, index join page) — all backward compatible
- AuthModal `callbackURL` prop — already exists and works
- Better Auth server config — no changes needed
- `publicPrefixes` in AuthContext — `/u/` already present

---

## Phase 1: AuthContext Extension

### Overview

Widen `openLoginModal` signature from `() => void` to `(callbackURL?: string) => void`. Add `pendingCallbackURL` state alongside `loginModalOpen`. Update the `useCallback` to store the callbackURL and open the modal atomically. Update `onClose` to clear `pendingCallbackURL`. Pass `callbackURL={pendingCallbackURL}` to `<AuthModal>`.

### Changes Required:

#### 1. `frontend/src/contexts/AuthContext.tsx` — MODIFY

**Changes**:
1. Type definition (line 18): `openLoginModal: () => void;` → `openLoginModal: (callbackURL?: string) => void;`
2. Add state (after line 32): `const [pendingCallbackURL, setPendingCallbackURL] = useState<string | undefined>(undefined);`
3. `useCallback` (lines 45-47): accept optional `callbackURL`, store it, open modal
4. `onClose` (line 191): clear `pendingCallbackURL` alongside `loginModalOpen`
5. JSX (line 189-192): pass `callbackURL={pendingCallbackURL}` to `<AuthModal>`

```typescript
  openLoginModal: (callbackURL?: string) => void;
```

```typescript
  const [pendingCallbackURL, setPendingCallbackURL] = useState<string | undefined>(undefined);
```

```typescript
  const openLoginModal = useCallback((callbackURL?: string) => {
    setPendingCallbackURL(callbackURL);
    setLoginModalOpen(true);
  }, []);
```

```tsx
      <AuthModal
        isOpen={loginModalOpen}
        onClose={() => { setPendingCallbackURL(undefined); setLoginModalOpen(false); }}
        callbackURL={pendingCallbackURL}
      />
```

### Success Criteria:

#### Automated Verification:
- [x] TypeScript compiles: `cd frontend && bun run build` exits 0
- [x] `openLoginModal` type widened — no existing caller produces type errors

#### Manual Verification:
- [ ] Open `/u/:id/chat` in logged-out browser → login modal appears (with callbackURL plumbing)
- [ ] Click Header "Login" button → modal appears with default behavior (no callbackURL)
- [ ] Authenticate via email/password → modal closes, user stays on page
- [ ] AuthModal receives `callbackURL` prop when passed from Phase 2's `openLoginModal(window.location.href)`

---

## Phase 2: ChatPage Replacement

### Overview

Replace the `navigate('/')` in the auth-guard `useEffect` with `openLoginModal(window.location.href)`, gated by a `loginPromptedRef` `useRef` that fires exactly once per page load. `navigate` import is preserved — still used by `handleClose`, `handleBack`, and the error button.

### Changes Required:

#### 1. `frontend/src/app/u/[id]/chat/page.tsx` — MODIFY

**Changes**:
1. Destructure `openLoginModal` from `useAuthContext()` alongside `isAuthenticated` and `isLoading`
2. Add `const loginPromptedRef = useRef(false);`
3. Replace the auth-guard `useEffect`: `navigate('/')` → `openLoginModal(window.location.href)` gated by `loginPromptedRef`

```typescript
  const { isAuthenticated, isLoading: authLoading, openLoginModal } = useAuthContext();
```

```typescript
  const loginPromptedRef = useRef(false);
```

```typescript
  useEffect(() => {
    if (!authLoading && !isAuthenticated && !loginPromptedRef.current) {
      loginPromptedRef.current = true;
      openLoginModal(window.location.href);
    }
  }, [authLoading, isAuthenticated, openLoginModal]);
```

### Success Criteria:

#### Automated Verification:
- [ ] TypeScript compiles: `cd frontend && bun run build` exits 0
- [ ] `navigate('/')` no longer present in ChatPage

#### Manual Verification:
- [ ] Open connect short-link (`/c/...`) in logged-out browser → chat page loads → login modal appears
- [ ] Sign in via email/password → lands on `/u/:id/chat` with prefilled message
- [ ] Sign in via magic-link → email returns to `/u/:id/chat?msg=...` with prefilled message
- [ ] Sign in via Google OAuth → OAuth redirect returns to `/u/:id/chat?msg=...` with prefilled message
- [ ] Dismiss login modal (click ×) → stays on `/u/:id/chat` page, spinner visible, no redirect
- [ ] Authenticated user opening connect link → goes directly to chat (no modal) — existing behavior preserved

---

## Plan Review (Step 4)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents._

_No findings — both reviewers cleared the artifact._

---

## Testing Strategy

### Automated:
- `cd frontend && bun run build` — TypeScript compilation check on both phases

### Manual Testing Steps:
1. Open connect short-link (`/c/...`) in logged-out browser → should see login modal, not homepage redirect
2. Sign in via email/password → lands on chat URL with msg preserved
3. Sign in via magic-link → email returns to chat URL with msg preserved
4. Sign in via Google OAuth → redirect returns to chat URL with msg preserved
5. Dismiss modal → stays on chat page (no redirect)
6. Click Header "Login" → modal appears (default behavior, no callbackURL)
7. Authenticated user → goes directly to chat (no modal)

## Performance Considerations

- One additional `useState` (pendingCallbackURL) per AuthContext mount — negligible memory cost
- `useCallback` deps remain `[]` — no re-creation on re-renders. State setters are stable React references
- No additional network requests beyond the login modal's existing provider fetch
- No extra renders beyond the existing modal open/close lifecycle

## Migration Notes

N/A — no persisted data, no schema changes.

## Developer Context

*Initial write. Findings from Step 4 review will be recorded here.*

## References

- Design: `.rpiv/artifacts/designs/2026-06-09_11-48-41_connect-links-auth-redirect.md`
- Research: `.rpiv/artifacts/research/2026-06-09_11-18-58_connect-links-auth-redirect.md`
- Discover: `.rpiv/artifacts/discover/2026-06-09_11-05-29_connect-links-auth-redirect.md`
- Linear issue: [IND-354](https://linear.app/indexnetwork/issue/IND-354/connect-links-c-drop-unauthenticated-users-on-homepage-losing-chat)