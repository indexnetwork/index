---
date: 2026-06-09T23:41:51+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "Recipient-bound connect links"
tags: [research, codebase, connect-links, auth, opportunities, telegram]
status: ready
last_updated: 2026-06-09T23:41:51+0300
last_updated_by: Yankı Ekin Yüksel
---

# Research: Recipient-bound connect links

## Research Question
Move the security boundary to the backend short-link flow: require authentication before `/c/:code/go` performs link side effects, compare the authenticated user to `connect_links.user_id`, and only then call the existing opportunity service and destination-building logic. Preserve login continuity by returning/redirecting to an account-bound continuation that carries the short code, not just the final `/u/:id/chat?msg=...` URL.

## Summary
The current short-link resolver is bearer-by-possession: `/c/:code` and `/c/:code/go` are rate-limited but unauthenticated, resolve `connect_links.user_id`, then execute opportunity side effects as that stored user. The link rows already contain the correct recipient identity because MCP/daily-brief `acceptUrl` generation mints links with `userId: viewerId`; the missing piece is enforcement at resolve time. The safest shape is a frontend continuation route that preserves the short code through login, then calls an authenticated backend resolver with the existing API client authorization header before any greeting generation, `startChat`, `approveIntroduction`, or outreach destination lookup runs.

## Detailed Findings

### Backend short-link resolver is the current security boundary gap
- `ConnectLinkController` explicitly documents that there is no guard and that authentication is currently possession of the short code (`backend/src/controllers/connect-link.controller.ts:68`).
- The browser entry route validates the 10-character code, resolves the link row, and handles `approve_introduction` inline by calling `opportunityService.approveIntroduction(link.opportunityId, link.userId)` without an authenticated user (`backend/src/controllers/connect-link.controller.ts:88-114`).
- The interstitial route fetches `/c/:code/go` with `credentials: 'omit'`, so even a cookie/session-capable auth scheme would not currently be sent by this HTML fetch (`backend/src/controllers/connect-link.controller.ts:26-49`).
- `/c/:code/go` resolves the same link, computes the greeting before the `connect`/`send_direct` branch, then calls `opportunityService.startChat(link.opportunityId, link.userId)` (`backend/src/controllers/connect-link.controller.ts:133-155`). This is the main mutation bug: the controller supplies the actor from the link row, not from a verified session.
- Correct-recipient destination behavior is already contained after `startChat`: Telegram-preferred links try `getCounterpartTelegramHandle`, otherwise fall back to `/u/:counterpart/chat?msg=...`; web links directly build that chat URL (`backend/src/controllers/connect-link.controller.ts:162-175`). Preserve this logic after the account check.
- `outreach` also reveals or creates access to a destination: it may fetch a Telegram handle for the opportunity or call `getConversationIdForOpp` and return `/conversations/:id` (`backend/src/controllers/connect-link.controller.ts:179-189`). The FRD decision to protect all link kinds should include this branch.

### Link rows already store recipient identity
- `connect_links` stores `code`, `user_id`, `opportunity_id`, `kind`, optional `greeting`, optional `preferred_surface`, and `expires_at` (`backend/src/schemas/database.schema.ts:121-134`).
- The schema enforces one row per `(opportunityId, userId, kind)`, so the row is explicitly per-recipient and per-action (`backend/src/schemas/database.schema.ts:138-142`).
- `mintConnectLink` either reuses a fresh row or rotates an expired row for the same `(opportunityId, userId, kind)` tuple (`backend/src/services/connect-link.service.ts:74-171`).
- `resolveConnectLink` returns a `ResolvedLink` containing `userId`, `opportunityId`, `kind`, `greeting`, and narrowed `preferredSurface`; it also handles expired opportunity replacement/self-healing before returning the resolved opportunity id (`backend/src/services/connect-link.service.ts:183-193`, `backend/src/services/connect-link.service.ts:197-247`, `backend/src/services/connect-link.service.ts:247-271`).
- Because `resolveConnectLink` may rewrite an expired link to a visible replacement for the stored recipient, recipient validation must compare authenticated user to the resolved row’s `userId` before trusting the replacement destination (`backend/src/services/connect-link.service.ts:197-247`).

### Existing AuthGuard cannot be used by static interstitial fetch as-is
- `AuthGuard` only accepts an `Authorization: Bearer <jwt>` header or a `token` query parameter; it does not read Better Auth cookies (`backend/src/guards/auth.guard.ts:26-43`).
- Route registry runs each guard and passes the last guard result into the handler’s `user` parameter (`backend/src/main.ts:538-549`). Adding `AuthGuard` after `RateLimit('read')` would make the handler receive `AuthenticatedUser`, but only if the request carries bearer/query token.
- Guard failures with messages like `Access token required` map to HTTP 401 in the central error handler (`backend/src/main.ts:602-608`). That is useful for an API resolver but not sufficient for raw `/c/:code` HTML because the HTML fetch does not attach a token.
- Frontend authenticated API calls already attach bearer JWT via `getJwtToken()` and `Authorization` unless `skipAuth` is set (`frontend/src/lib/api.ts:46-48`). Developer checkpoint selected this as the preferred continuation path rather than putting JWTs in callback URLs or adding cookie-session guard behavior.

### Login continuation plumbing exists but currently targets final chat URL
- `AuthContext.openLoginModal(callbackURL?)` stores a pending callback URL and opens the global auth modal (`frontend/src/contexts/AuthContext.tsx:32-47`).
- `AuthModal` accepts `callbackURL` and passes it to magic-link sign-in and Google OAuth sign-in (`frontend/src/components/AuthModal.tsx:9-13`, `frontend/src/components/AuthModal.tsx:57-66`, `frontend/src/components/AuthModal.tsx:114-121`).
- On successful in-app auth, `AuthContext` closes the modal; the actual redirect for magic link / Google is delegated to Better Auth via `callbackURL` (`frontend/src/contexts/AuthContext.tsx:119-122`).
- The prior chat-page behavior opens login for unauthenticated `/u/:id/chat` visitors with `window.location.href` as callback, preserving final URL and `msg` (`frontend/src/app/u/[id]/chat/page.tsx:33-38`).
- For recipient-bound links, that callback target should become a short-code continuation route rather than `/u/:id/chat?msg=...`, because final chat URLs have no `connect_links.user_id` to compare (`frontend/src/app/u/[id]/chat/page.tsx:20-23`, `frontend/src/app/u/[id]/chat/page.tsx:102-110`).
- `AuthContext` treats `/u/` as public so unauthenticated users can reach the chat page and trigger inline login (`frontend/src/contexts/AuthContext.tsx:129-137`). A new frontend continuation route would need equivalent public-route classification if it is not under an existing public prefix.

### Opportunity mutation is correctly guarded inside service, but controller passes the wrong actor source
- `OpportunityService.startChat` is designed around an authenticated caller id: it checks opportunity existence, accepted-state actor membership, pending/draft/latent status, caller actor membership, and self-accept guard (`backend/src/services/opportunity.service.ts:640-697`).
- It resolves or creates the DM before mutating opportunity state, then un-hides the conversation for the caller (`backend/src/services/opportunity.service.ts:703-724`).
- It stamps the actor action with `stampOpportunityActorAction(opportunityId, userId, 'accepted', userId)` after the DM exists (`backend/src/services/opportunity.service.ts:729`).
- Best-effort sibling opportunity acceptance and contact membership writes run after the status flip (`backend/src/services/opportunity.service.ts:737-754`). These must also remain unreachable for wrong-account link users.
- The service’s existing actor checks do not solve this bug because `ConnectLinkController.go` supplies `link.userId`; a stolen/forwarded link therefore runs the service as the intended recipient (`backend/src/controllers/connect-link.controller.ts:154-155`).
- `approveIntroduction` and outreach helper paths also take a `userId` parameter and should receive the authenticated recipient only after comparison with `link.userId` (`backend/src/services/opportunity.service.ts:563-596`, `backend/src/services/opportunity.service.ts:1141-1197`).

### MCP and daily brief generation already mint account-bound links
- Protocol cards call `attachActionableLinks` when an MCP context and `mintConnectLink` dependency are present (`packages/protocol/src/opportunity/opportunity.tools.ts:947-958`, `packages/protocol/src/opportunity/opportunity.tools.ts:1281-1296`, `packages/protocol/src/opportunity/opportunity.tools.ts:1762-1775`, `packages/protocol/src/opportunity/opportunity.tools.ts:1881-1895`).
- `attachActionableLinks` passes `userId: opts.viewerId`, `opportunityId`, resolved `kind`, `greeting: null`, and `preferredSurface` to `mintConnectLink`, then puts the returned URL on `card.acceptUrl` (`packages/protocol/src/opportunity/opportunity.tools.ts:119-167`).
- The backend MCP adapter delegates to `mintConnectLinkSvc` and returns `buildConnectShortUrl(apiBaseUrl, code)` (`backend/src/controllers/mcp.controller.ts:81-89`).
- MCP identity normalizes `x-index-surface` into `clientSurface` and forwards it into protocol context, which later becomes `preferredSurface` for minting (`backend/src/controllers/mcp.controller.ts:401-429`, `backend/src/controllers/mcp.controller.ts:567`, `packages/protocol/src/opportunity/opportunity.tools.ts:667`).
- Therefore daily brief links are already account-bound in persistence; resolver enforcement should not require changes to protocol card rendering or link minting except tests if behavior/copy changes.

### Test surface is split across service, protocol, controller, and frontend auth
- `connect-link.service.spec.ts` covers mint code shape, idempotency per `(opp,user,kind)`, per-kind code differences, valid/unknown resolve, expiry rotation, and expired/replacement behavior (`backend/src/services/tests/connect-link.service.spec.ts:72-142`, `backend/src/services/tests/connect-link.service.spec.ts:146-233`).
- `opportunity.tools.spec.ts` covers action-kind selection and `attachActionableLinks` mints `connect`, `outreach`, `approve_introduction`, and `send_direct` with `viewerId` and `acceptUrl` fields (`packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts:180-188`, `packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts:276-348`).
- `opportunity.service.startChat.spec.ts` already verifies `startChat` flips pending/draft to accepted, idempotently returns accepted conversations, rejects non-actors, and stamps the actor action with the passed user id (`backend/src/services/tests/opportunity.service.startChat.spec.ts:64-143`).
- `opportunity.controller.spec.ts` covers authenticated opportunity status controller behavior and can be used as a controller-test pattern, but it does not cover `ConnectLinkController.go` branches (`backend/src/controllers/tests/opportunity.controller.spec.ts:294-337`).
- There is no surfaced connect-link controller test covering unauthenticated continuation, wrong-account denial, right-account destination, or all four link kinds; this should be the main targeted backend test addition (`backend/src/controllers/connect-link.controller.ts:133-199`).
- Frontend tests should focus on the new continuation route/modal callback and authenticated API call. Existing behavior to preserve is `AuthModal` forwarding callback URLs for magic link and Google (`frontend/src/components/AuthModal.tsx:63-120`) and `ChatPage` preserving final chat `msg` when users enter via old `/u/:id/chat` (`frontend/src/app/u/[id]/chat/page.tsx:33-38`).

## Code References
- `backend/src/controllers/connect-link.controller.ts:26-49` — Interstitial HTML fetches `/go` without credentials.
- `backend/src/controllers/connect-link.controller.ts:68` — Current no-guard, possession-based auth documentation.
- `backend/src/controllers/connect-link.controller.ts:88-114` — `/c/:code` entry validates code, resolves row, and currently approves introductions inline.
- `backend/src/controllers/connect-link.controller.ts:133-199` — `/c/:code/go` side-effecting resolver for connect/send_direct/outreach/approve_introduction.
- `backend/src/services/connect-link.service.ts:53-55` — Short URL shape `/c/:code?link_preview=false`.
- `backend/src/services/connect-link.service.ts:74-171` — Idempotent mint and expired-row rotation per recipient/opportunity/kind.
- `backend/src/services/connect-link.service.ts:183-193` — `ResolvedLink` includes stored `userId` and narrowed `preferredSurface`.
- `backend/src/services/connect-link.service.ts:197-247` — Expired opportunity replacement lookup scoped to stored user visibility.
- `backend/src/services/connect-link.service.ts:247-271` — `resolveConnectLink` returns null for invalid/terminal links or resolved replacement link.
- `backend/src/schemas/database.schema.ts:121-142` — `connect_links` schema and unique recipient/action constraint.
- `backend/src/guards/auth.guard.ts:26-43` — JWT-only `AuthGuard` contract.
- `backend/src/main.ts:538-549` — Route guard result becomes handler `user` argument.
- `backend/src/main.ts:602-608` — Auth guard failures become 401 responses.
- `backend/src/services/opportunity.service.ts:640-754` — `startChat` actor checks, DM creation, actor stamping, and side effects.
- `backend/src/services/opportunity.service.ts:563-596` — Introducer approval mutation path.
- `backend/src/services/opportunity.service.ts:1141-1197` — Telegram/conversation destination helpers for connect/outreach branches.
- `frontend/src/lib/api.ts:46-48` — Authenticated frontend API requests attach bearer JWT.
- `frontend/src/contexts/AuthContext.tsx:32-47` — Pending callback URL and `openLoginModal` state.
- `frontend/src/contexts/AuthContext.tsx:129-137` — Public route prefix classification includes `/u/`.
- `frontend/src/components/AuthModal.tsx:57-66` — Magic-link sign-in uses `callbackURL`.
- `frontend/src/components/AuthModal.tsx:114-121` — Google sign-in uses `callbackURL`.
- `frontend/src/app/u/[id]/chat/page.tsx:33-38` — Logged-out chat route opens login with current URL.
- `packages/protocol/src/opportunity/opportunity.tools.ts:119-167` — `attachActionableLinks` mints `acceptUrl` with `viewerId`.
- `backend/src/controllers/mcp.controller.ts:81-89` — Backend MCP `mintConnectLink` wrapper returns short URL.
- `backend/src/controllers/mcp.controller.ts:401-429` — MCP client surface normalization.
- `backend/src/controllers/mcp.controller.ts:567` — `x-index-surface` request header mapped to `clientSurface`.
- `backend/src/services/tests/connect-link.service.spec.ts:72-233` — Current service tests for mint/resolve/expiry.
- `packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts:180-348` — Current protocol tests for actionable link kind and mint calls.
- `backend/src/services/tests/opportunity.service.startChat.spec.ts:64-143` — Current service tests for startChat actor/mutation behavior.

## Integration Points

### Inbound References
- `packages/protocol/src/opportunity/opportunity.tools.ts:947-958` — MCP list/details path attaches actionable links to cards for the current context user.
- `packages/protocol/src/opportunity/opportunity.tools.ts:1281-1296` — Additional opportunity tool path attaches actionable links with context user and preferred surface.
- `packages/protocol/src/opportunity/opportunity.tools.ts:1762-1775` — Later card rendering path attaches actionable links for MCP contexts.
- `packages/protocol/src/opportunity/opportunity.tools.ts:1881-1895` — Feed/card path attaches actionable links with the same dependency.
- `frontend/src/app/u/[id]/chat/page.tsx:33-38` — Final chat page currently handles unauthenticated users and preserved `msg` after login.
- `frontend/src/contexts/AuthContext.tsx:191-195` — Global auth modal receives pending callback URL from route-level callers.

### Outbound Dependencies
- `backend/src/controllers/connect-link.controller.ts:101-107` — `/c/:code` depends on `resolveConnectLink` and `approveIntroduction`.
- `backend/src/controllers/connect-link.controller.ts:140-155` — `/c/:code/go` depends on `resolveConnectLink`, `getGreetingForCard`, and `startChat`.
- `backend/src/controllers/connect-link.controller.ts:162-189` — Resolver depends on opportunity service helpers for Telegram handles and conversation ids.
- `backend/src/services/connect-link.service.ts:1-4` — Connect-link service depends directly on Drizzle, `connectLinks`, and `opportunities`.
- `frontend/src/lib/api.ts:46-48` — New frontend continuation should depend on the existing authenticated API client for bearer JWT.

### Infrastructure Wiring
- `backend/src/main.ts:489-493` — Top-level `/c/:code` requests are rewritten to `/api/c/:code` before route handling.
- `backend/src/main.ts:538-549` — Decorator guard output is wired to controller handler user parameter.
- `backend/src/main.ts:602-608` — Auth guard errors are centrally mapped to 401 JSON.
- `backend/src/controllers/connect-link.controller.ts:88-89` and `backend/src/controllers/connect-link.controller.ts:133-134` — Current guard order is only `RateLimit('read')`; any authenticated API resolver should use `RateLimit('read')` before `AuthGuard`.
- `frontend/src/contexts/AuthContext.tsx:129-137` — Any new frontend continuation route must be public or it will redirect unauthenticated users home before opening login.
- `backend/src/controllers/mcp.controller.ts:81-89` and `backend/src/controllers/mcp.controller.ts:127` — MCP dependency injection surfaces backend short-link minting to protocol tools.

## Architecture Insights
- The link row should remain the authority for intended recipient and opportunity; the authenticated session should only prove that the browser user equals `connect_links.user_id` before using the row.
- Avoid putting bearer JWTs in callback URLs even though `AuthGuard` supports `token`; the existing frontend API client already supplies bearer headers and the developer chose that path.
- The correct recipient check belongs before greeting generation as well as before mutation. Greeting generation can be expensive and may reveal opportunity context through downstream redirect text.
- `startChat` is already safe when called with the true authenticated user; the bug is the controller’s actor source, not the service’s actor validation.
- Existing protocol/MCP minting already passes `viewerId`, so changing resolver authorization should not require changing `acceptUrl` generation semantics.
- Wrong-account, malformed, expired, and missing-link responses should converge to generic unavailable/not-found UX, but API-level status codes can still be structured internally if the frontend masks them.
- `approve_introduction` currently runs on `/c/:code` directly while other link kinds defer work to `/go`; protecting all link kinds likely requires moving approval side effects behind the authenticated continuation too.

## Precedents & Lessons
4 similar past change clusters analyzed.

### Precedent: Preserve connect-link deep-link URL through login
**Commit(s)**: `e6514ed99e` — "fix(frontend): preserve deep-link URL and msg for unauthenticated connect-link visitors" (2026-06-09); `0132fd90e1` — "feat: add callbackURL prop to AuthModal for oauth login bridge" (2026-04-03); `6d96cd5fe1` — "Include '/u/' in public route prefixes" (2026-05-25)
**Blast radius**: 4 files across 2 layers
  frontend/auth — `AuthContext.tsx`, `AuthModal.tsx`: callbackURL plumbing and public route behavior
  frontend/chat — `frontend/src/app/u/[id]/chat/page.tsx`: preserved deep-link and `msg` for unauthenticated entry

**Follow-up fixes**:
- `25318cb61e` — "fix(frontend): clear stale auth sessions" (2026-06-01) — auth state could remain stale.
- `e6514ed99e` — "fix(frontend): preserve deep-link URL and msg for unauthenticated connect-link visitors" (2026-06-09) — unauthenticated connect-link users were dropped to home, losing chat continuation.

**Lessons from docs**:
- `.rpiv/artifacts/research/2026-06-09_11-18-58_connect-links-auth-redirect.md` — prior auth-continuation research.
- `.rpiv/artifacts/designs/2026-06-09_11-48-41_connect-links-auth-redirect.md` — prior design for `/u/` public route and chat-page login prompt.
- `.rpiv/artifacts/validation/2026-06-09_13-10-12_ind-354-connect-links-auth-redirect.md` — validation matrix for magic-link, Google OAuth, email/password, dismiss, and authenticated flows.

**Takeaway**: Preserve URL state through auth, but for this feature preserve the short code rather than the final chat URL.

### Precedent: Initial short connect-link mint/resolve and MCP surfacing
**Commit(s)**: `2fc234c3ea` — "feat(connect-links): mint and resolve service with idempotent (opp,user,kind)" (2026-05-08); `214537daea` — "feat(connect-links): GET /c/:code dispatches per-kind redirects" (2026-05-08); `95b6ebe6a4` — "feat(connect-links): POST /opportunities/:id/connect-link mints short URL with backend greeting" (2026-05-08); `6af43dbc50` — "feat(connect-links): MCP list_opportunities surfaces short URL; drop &msg= clause" (2026-05-08)
**Blast radius**: 11 files across 4 layers
  backend/controller — `/c/:code` resolver and opportunity connect-link endpoint
  backend/service — connect-link idempotency and opportunity start-chat support
  protocol — opportunity tools and shared connect-link interface
  tests/init — service/e2e tests and protocol-init wiring

**Follow-up fixes**:
- `f3ee1435b3` — "fix(connect-links): address Copilot review on PR #759" (2026-05-08) — controller/service/test hardening after review.
- `00a5055bcd` — "fix(protocol): surface connector-flow opps in chat tool" (2026-05-09) — protocol tool missed connector-flow opportunities.
- `76e3f6d168` — "fix(backend): interstitial HTML on /c/<code> for visible loading state" (2026-05-12) — direct redirect lacked visible loading state.

**Lessons from docs**:
- `.rpiv/artifacts/discover/2026-06-09_11-05-29_connect-links-auth-redirect.md` — prior discover artifact for auth redirect behavior.

**Takeaway**: Connect-link changes cross backend resolver, opportunity service, protocol tools, and frontend continuation; test all entry surfaces.

### Precedent: Surface-aware connect-link redirects
**Commit(s)**: `83bca6fe3b` — "feat(connect-link): persist preferredSurface at mint time" (2026-05-15); `472ef61d1a` — "feat(connect-link): branch click redirect on link.preferredSurface" (2026-05-15); `84a99f7b2e` — "feat(protocol): forward clientSurface into mintConnectLink calls" (2026-05-15)
**Blast radius**: 4 files across 3 layers
  backend/controller — redirect branch based on preferred surface
  backend/service — persisted/narrowed preferredSurface
  protocol — forwarded clientSurface from tool calls

**Follow-up fixes**:
- `f90da6906a` — "fix(connect-link): narrow preferredSurface defensively + test cleanup" (2026-05-15) — preferredSurface needed defensive validation.
- `bd769f2018` — "fix(protocol): profileUrl is always the Index web profile, never t.me" (2026-06-01) — surface-specific URL semantics regressed.

**Lessons from docs**:
- `.rpiv/artifacts/research/2026-06-09_11-18-58_connect-links-auth-redirect.md` — prior research context.

**Takeaway**: Treat recipient/surface metadata as untrusted at resolve time; defensively narrow before branching.

### Precedent: Expired connect-link replacement/self-healing
**Commit(s)**: `d4946436fb` — "feat: self-heal expired connect links when opportunity is actionable" (2026-05-25); `2a40fe14b9` — "fix(connect-links): resolve expired opportunity replacements" (2026-06-01)
**Blast radius**: 5 files across 2 layers
  backend/service — connect-link replacement resolution and opportunity replacement lookup
  backend/controller — expired-link messaging

**Follow-up fixes**:
- `50a612bf44` — "fix: update expired-link message to reflect self-healing behavior" (2026-05-25) — UX copy lagged behavior.
- `1c7cf9e87d` — "fix(opportunities): resolve enriched replacements" (2026-06-01) — replacement lookup failed for enriched opportunities.
- `38d0887513` — "fix(backend): forward expired connect links to replacement opportunities and handle latent in startChat" (2026-06-08) — expired links still needed forwarding; latent handling was incomplete.

**Lessons from docs**:
- `.rpiv/artifacts/plans/2026-06-09_12-54-22_ind-354-connect-links-auth-redirect.md` — prior implementation-plan context.

**Takeaway**: Explicitly test recipient-bound behavior when links resolve to expired, replacement, or latent opportunities.

### Composite Lessons
- Connect-link continuation commonly breaks at boundaries: backend `/c` resolver → frontend route → auth modal callbackURL → protocol minting.
- Preserve URL state through auth; for this feature the preserved state should be the opaque short code, not the final chat destination.
- Validate recipient, surface, and link metadata at resolve time, not only at mint time.
- Expired/replaced/latent opportunity handling has had multiple follow-up fixes; include it in design/test scope.
- Include auth matrix coverage for logged-out, authenticated correct user, authenticated wrong user, magic link, Google OAuth, email/password, and modal dismiss.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-06-09_23-32-44_recipient-bound-connect-links.md` — source FRD for this research.
- `.rpiv/artifacts/discover/2026-06-09_11-05-29_connect-links-auth-redirect.md` — prior discover artifact for preserving connect-link redirects through auth.
- `.rpiv/artifacts/research/2026-06-09_11-18-58_connect-links-auth-redirect.md` — prior research on connect-link auth redirect behavior.
- `.rpiv/artifacts/designs/2026-06-09_11-48-41_connect-links-auth-redirect.md` — prior design for frontend login continuation.
- `.rpiv/artifacts/plans/2026-06-09_12-54-22_ind-354-connect-links-auth-redirect.md` — prior implementation plan for connect-link auth redirect.
- `.rpiv/artifacts/validation/2026-06-09_13-10-12_ind-354-connect-links-auth-redirect.md` — prior validation artifact for auth redirect behavior.

## Developer Context
**Q (discover: Intended user framing): For this connect-url login issue, what problem are you solving and who hits it?**
A: Daily brief user.

**Q (discover: Possession-based short links must change): From the probe I inferred that connect URLs are currently possession-based: `/c/:code` is unauthenticated, resolves `connect_links.user_id`, and calls `startChat(link.opportunityId, link.userId)` before web login can identify the browser account (`backend/src/controllers/connect-link.controller.ts:68,155`). Keep this behavior or change it?**
A: Change it.

**Q (discover: Preserve recipient binding through login): From the probe I inferred that after fallback to web chat, login returns to `/u/:id/chat?msg=...` and that URL has no connect code or intended-recipient user to compare against (`frontend/src/app/u/[id]/chat/page.tsx:34-36,102-110`). Should the feature preserve recipient binding through login?**
A: Bind through login.

**Q (discover: Scope across acceptance links): You clarified that nowhere should people accept other people's connections. Should this requirement cover only daily-brief `connect` links, or all short-link acceptance kinds the code supports?**
A: All acceptance links.

**Q (discover: Server-side recipient check): Where should the recipient check live for connect-link acceptance? Tradeoff: strongest server-side security vs smallest change to the existing redirect flow.**
A: Server-gated links.

**Q (discover: Wrong-account UX): What should users see when the link is opened by the wrong logged-in account or after logging in as the wrong account?**
A: Not found.

**Q (discover: Correct-recipient destination): For the correct recipient, what should happen after they authenticate through a connect link?**
A: Preserve destination.

**Q (discover: Include non-state-changing outreach links): Should non-state-changing short links, like `outreach` links that only redirect for an already-accepted opportunity, also require the same recipient-account check?**
A: Yes, all links.

**Q (`backend/src/controllers/connect-link.controller.ts:38`, `backend/src/guards/auth.guard.ts:26-43`, `frontend/src/lib/api.ts:46-48`): Static interstitial fetch omits credentials, AuthGuard requires bearer/query JWT, and the frontend API client attaches Authorization. Which continuation shape should the design prefer?**
A: Frontend continuation. Use a frontend route/modal callback that preserves the short code and calls an authenticated backend resolver via the API client; avoid JWTs in URLs.

**Q (research checkpoint): Scan complete — write the doc, or adjust first?**
A: Write the doc.

## Related Research
- `.rpiv/artifacts/research/2026-06-09_11-18-58_connect-links-auth-redirect.md`

## Open Questions
None.
