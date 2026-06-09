---
date: 2026-06-09T11:48:41+0300
author: Yankı Ekin Yüksel
commit: cc4ceda7a
branch: dev
repository: index
topic: "Connect links unauthenticated auth redirect — design"
tags: [design, frontend, auth, connect-links, chat]
status: ready
parent: .rpiv/artifacts/research/2026-06-09_11-18-58_connect-links-auth-redirect.md
last_updated: 2026-06-09T11:48:41+0300
last_updated_by: Yankı Ekin Yüksel
---

# Design: Connect links unauthenticated auth redirect

## Summary

Extend `AuthContext.openLoginModal()` to accept an optional `callbackURL` string parameter, threading it through as `pendingCallbackURL` state to `AuthModal.callbackURL`. Replace the ChatPage's hard `navigate('/')` bounce with `openLoginModal(window.location.href)`, gated by a `useRef` to fire once. No changes to existing callers — backwards compatible via optional parameter.

## Requirements

- Unauthenticated visitors landing on `/u/:id/chat?msg=...` can authenticate without losing the URL path or query params
- After authentication (email/password, magic-link, or Google OAuth), the user lands on the same chat URL with `msg` preserved
- The backend `/c/:code/go` endpoint is untouched — it already returns correct URLs
- If the user dismisses the login modal without authenticating, stay on page — no redirect
- All 5 existing `openLoginModal()` callers (Header, landing, invitation, index join) continue to work unchanged

## Current State Analysis

### Key Discoveries

- `AuthModal` (`AuthModal.tsx:13`) already has `callbackURL?: string` prop, used by magic-link (`line 65`) and Google OAuth (`line 120`). Email/password (`line 96-99`) does not use callbackURL — session established via XHR, no browser redirect.
- `AuthContext` (`AuthContext.tsx:189-192`) renders `<AuthModal>` without passing `callbackURL`. The prop is only used by the standalone `/login` page (`login/page.tsx:41-44`).
- `AuthContext.openLoginModal` (`AuthContext.tsx:18,45-47`) is `() => void` — no parameter support. The `useCallback` deps are `[]` (setters are stable).
- `ChatPage` (`page.tsx:30-34`) uses `navigate('/')` when `isAuthenticated` is false, losing all URL state.
- `useRef` already imported at `page.tsx:1`, `opportunityAcceptedRef` at `page.tsx:26`.
- `/u/` is in `publicPrefixes` (`AuthContext.tsx:133`) — global auth guard does not block the page.
- Better Auth server correctly preserves `callbackURL` through magic-link (embedded in email query param) and Google OAuth (encrypted in server-side state). The `jwtClient()` plugin is uninvolved in OAuth redirects.
- 5 existing callers all pass zero args — optional `?` parameter is sufficient for backward compatibility.
- `Header.tsx:36-47` provides the ref-gating pattern model: `loginInitiatedRef.useRef(false)` + `useEffect` checking `isAuthenticated && loginInitiatedRef.current`.
- Context functions with optional parameters have precedent: `AIChatContext.clearChat(options?)` (`AIChatContext.tsx:958`), `NotificationContext.success(title, message?, duration?)` (`NotificationContext.tsx:58`), `ConversationContext.loadMessages(id, opts?)` (`ConversationContext.tsx:69`).

## Scope

### Building
- `frontend/src/contexts/AuthContext.tsx` — widen `openLoginModal` signature, add `pendingCallbackURL` state, wire to `AuthModal`
- `frontend/src/app/u/[id]/chat/page.tsx` — replace `navigate('/')` with `openLoginModal(window.location.href)` gated by `useRef`

### Not Building
- Generic site-wide `returnTo` redirect infrastructure
- `/login` page changes (MCP-specific flow must not be touched)
- Backend `/c/:code/go` resolver (already correct)
- Existing callers (Header, landing, invitation page, index join page) — all backward compatible
- AuthModal `callbackURL` prop — already exists and works
- Better Auth server config — no changes needed
- `publicPrefixes` in AuthContext — `/u/` already present

## Decisions

### Approach: inline login modal vs. redirect to /login
Extend `AuthContext.openLoginModal()` to accept optional `callbackURL`, rather than routing through `/login`. Chosen in discover (`evidence: frontend/src/app/login/page.tsx:21-25` — MCP-specific forwarding would conflict).

### Modal dismiss behavior
Stay on page when dismissed — no redirect. Chosen in discover.

### Backend unchanged
Connect-link backend resolver at `connect-link.controller.ts:173-174` already builds correct URLs. Chosen — evidence confirmed in research.

### callbackURL not cleared on auto-close
When `AuthContext.tsx:115-120` auto-closes the modal on auth success, `pendingCallbackURL` is not explicitly cleared. Email/password: user already on correct page. OAuth/magic-link: browser already redirected away. Confirmed in checkpoint.

### Spinner persistence after dismiss
After modal dismiss, ChatPage's spinner (`page.tsx:85-90`) remains visible because `isLoading` stays `true` (fetchData returns early when unauthenticated). Accepted — FRD req #4 satisfied.

### Backward compatibility: optional parameter sufficient
`openLoginModal(callbackURL?: string)` — all 5 existing callers pass zero args, `?` defaults to `undefined`. No caller changes needed. Pattern modeled after `NotificationContext.tsx:58`.

### Ref-gating pattern: model after Header.tsx
ChatPage's `loginPromptedRef` follows `Header.tsx:36-47` pattern: `useRef(false)` + `useEffect` with guard condition + ref set to `true` before action. Header pattern is proven (no follow-up bugs).

## Architecture

### `frontend/src/contexts/AuthContext.tsx:18,32,45-47,115-120,189-192` — MODIFY

Type change: `openLoginModal: (callbackURL?: string) => void`
Add state: `const [pendingCallbackURL, setPendingCallbackURL] = useState<string | undefined>(undefined);`
Update useCallback: store callbackURL + open modal atomically
Update onClose: clear pendingCallbackURL alongside loginModalOpen
Update JSX: `<AuthModal callbackURL={pendingCallbackURL}>`

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

### `frontend/src/app/u/[id]/chat/page.tsx:30-34` — MODIFY

Add `const loginPromptedRef = useRef(false);`
Replace `navigate('/')` useEffect with:
```
useEffect(() => {
  if (!authLoading && !isAuthenticated && !loginPromptedRef.current) {
    loginPromptedRef.current = true;
    openLoginModal(window.location.href);
  }
}, [authLoading, isAuthenticated, openLoginModal]);
```

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

## Slices

### Slice 1: AuthContext extension

**Files**: `frontend/src/contexts/AuthContext.tsx`

#### Automated Verification:
- [ ] TypeScript compiles: `cd frontend && bun run build` exits 0
- [ ] `openLoginModal` type widened — no existing caller produces type errors

#### Manual Verification:
- [ ] Open `/u/:id/chat` in logged-out browser → login modal appears (with callbackURL plumbing)
- [ ] Click Header "Login" button → modal appears with default behavior (no callbackURL)
- [ ] Authenticate via email/password → modal closes, user stays on page
- [ ] AuthModal receives `callbackURL` prop when passed from Slice 2's `openLoginModal(window.location.href)`

### Slice 2: ChatPage replacement

**Files**: `frontend/src/app/u/[id]/chat/page.tsx`

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

## Desired End State

```tsx
// AuthContext.tsx — after change
type AuthContextType = {
  openLoginModal: (callbackURL?: string) => void;
  // ...
};

// ChatPage — after change
const loginPromptedRef = useRef(false);

useEffect(() => {
  if (!authLoading && !isAuthenticated && !loginPromptedRef.current) {
    loginPromptedRef.current = true;
    openLoginModal(window.location.href);
  }
}, [authLoading, isAuthenticated, openLoginModal]);
```

## File Map

- `frontend/src/contexts/AuthContext.tsx`  # MODIFY — widen openLoginModal, add pendingCallbackURL
- `frontend/src/app/u/[id]/chat/page.tsx`  # MODIFY — replace navigate('/') with openLoginModal

## Ordering Constraints

Slice 1 must come before Slice 2 (Slice 2 uses the widened `openLoginModal` signature).

## Verification Notes

- **AuthModal URL config**: AuthModal URL config has broken in production before (`72dd330a9`, `3e3a56c47`). No changes to AuthModal's fetch/redirect URLs in this design — only passing `callbackURL` through a prop that already exists.
- **Route visibility**: `/u/` is already in `publicPrefixes` (`AuthContext.tsx:133`). No change needed. If this were a different route prefix, it would need to be added (per `c78ed185e` precedent lesson).
- **Back-button redirect loop**: Current `navigate('/')` lacks `{ replace: true }` (`page.tsx:34`). The inline modal replacement naturally solves this since there's no redirect at all. Removed, not separately fixed.
- **Ghost user edge case**: Chat page has ghost user claiming logic (`f8de285f9`, `a0d830109`). The modal replacement does not affect ghost-claim code paths because ghost users have an existing session (are authenticated). Not exercised by this flow.

## Performance Considerations

- One additional `useState` (pendingCallbackURL) per AuthContext mount — negligible memory cost.
- `useCallback` deps remain `[]` — no re-creation on re-renders. State setters are stable React references.
- No additional network requests beyond the login modal's existing provider fetch.
- No extra renders beyond the existing modal open/close lifecycle.

## Migration Notes

N/A — no persisted data, no schema changes.

## Pattern References

- `frontend/src/contexts/NotificationContext.tsx:58` — context function with optional parameters (pattern for `openLoginModal(callbackURL?)`)
- `frontend/src/contexts/AIChatContext.tsx:958` — `clearChat(options?)` with empty `useCallback` deps `[]` (pattern for `openLoginModal`)
- `frontend/src/components/Header.tsx:36-47` — `loginInitiatedRef` + guarded `useEffect` (pattern for ChatPage `loginPromptedRef`)
- `frontend/src/app/login/page.tsx:37-44` — `callbackURL={window.location.href}` passed to AuthModal (existing usage of callbackURL prop)

## Developer Context

**Q (direction — auto-close cleanup): When the modal auto-closes on auth success, should pendingCallbackURL be cleared?**
A: Follow — don't clear on auto-close. Overwritten on next openLoginModal() call.

**Q (dismiss UX): Spinner persists after modal dismiss. Acceptable for initial fix?**
A: Accept spinner after dismiss.

## Design History

- Slice 1: AuthContext extension — approved as generated
- Slice 2: ChatPage replacement — approved as generated

## References

- `.rpiv/artifacts/research/2026-06-09_11-18-58_connect-links-auth-redirect.md` — Detailed code path analysis
- `.rpiv/artifacts/discover/2026-06-09_11-05-29_connect-links-auth-redirect.md` — Feature requirements
- Linear issue [IND-354](https://linear.app/indexnetwork/issue/IND-354/connect-links-c-drop-unauthenticated-users-on-homepage-losing-chat)