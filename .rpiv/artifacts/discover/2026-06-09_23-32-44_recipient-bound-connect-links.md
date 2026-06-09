---
date: 2026-06-09T23:32:44+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "Recipient-bound connect links"
tags: [intent, frd, connect-links, opportunities, telegram, auth]
status: ready
last_updated: 2026-06-09T23:32:44+0300
last_updated_by: Yankı Ekin Yüksel
---

# FRD: Recipient-bound connect links

## Summary
Connect and opportunity short links must be bound to the intended recipient account, including links delivered through AgentVillage Telegram daily briefs. If a logged-out user opens a valid link, the login flow must only allow the link recipient to complete the opportunity action and reach the opportunity chat; any other account should receive a generic not-found/unavailable result.

## Problem & Intent
The initial affected user is the **Daily brief user**: the intended recipient of a Telegram daily brief must be the only account that can open that specific opportunity chat after login.

Developer clarification: "I think in nowhere in the system, other people should be able to accept other people's connections. This is a security issue."

Original feature description: "Check the last features we implemented. In agentvillage telegram, I get my daily brief and click the connect url on one of the connections. If I am not logged in, the system allows me to login and redirects to the opportunity chat. But in the login phase, I can use any account I want, which is a problem. If User A received the connect url, only user a should be able to reach the opportunity via login, otherwise, we can just state Opportunity not found or something like that."

## Goals
- Ensure only the user recorded on a short link can use that link to accept, approve, or access the linked opportunity flow.
- Preserve the existing successful destination behavior for the correct recipient: Telegram-preferred links should still deep-link to Telegram when possible, otherwise fall back to web chat with the prepared greeting.
- Treat wrong-account access as a privacy/security failure and avoid revealing that the opportunity or link exists for another user.
- Apply the recipient-account check consistently across all connect-link kinds, not only daily-brief `connect` links.

## Non-Goals
- Do not redesign opportunity discovery, daily brief generation, or how `acceptUrl` is minted.
- Do not add a new user-facing account-switching UX that confirms the link belongs to another account.
- Do not change the intended successful Telegram/web destination beyond inserting the required recipient authentication check.
- Do not implement source changes in this FRD; downstream `research`, `design`, and `implement` should handle code changes.

## Functional Requirements
1. The system SHALL require an authenticated user before executing any `/c/:code` side effect or redirect that represents another user’s opportunity connection flow.
2. The system SHALL compare the authenticated user id with the resolved `connect_links.user_id` before processing any valid short-link kind.
3. The system SHALL deny wrong-account access with the same generic not-found/unavailable behavior used for missing or expired links.
4. The system SHALL protect all short-link kinds, including state-changing `connect`, `send_direct`, and `approve_introduction` links, plus non-state-changing `outreach` links.
5. The system SHALL preserve the short-link code through login so the backend can perform recipient verification after authentication rather than relying only on `/u/:id/chat?msg=...`.
6. The system SHALL preserve current success destinations for the correct recipient: Telegram preferred surface should redirect to `t.me` when a handle exists, otherwise to the existing web chat fallback.
7. The system SHALL avoid accepting or stamping an opportunity actor action before the recipient-account check passes.

## Non-Functional Requirements
- **Performance**: No special latency target beyond preserving the current short-link interstitial behavior; the added recipient check should be a lightweight auth/session and link-row comparison before existing work.
- **Security**: Short-link possession alone is insufficient. Authorization must be account-bound, and wrong-account responses must not reveal whether a link is valid for another user.
- **UX / Accessibility**: Logged-out correct recipients should be guided through login and then continue to the existing destination. Wrong-account users should see generic unavailable/not-found messaging, not a detailed account mismatch explanation.
- **Reliability**: Login callbacks must preserve enough state to retry the link resolution after auth. Expired, malformed, missing, wrong-account, and already-invalid links should consistently fail without mutating opportunity state.

## Constraints & Assumptions
- The short URL currently contains only an opaque 10-character code; the intended recipient and opportunity are stored server-side in `connect_links`.
- The backend connect-link controller currently has no auth guard because possession of the code was treated as authentication.
- The frontend chat callback currently has no connect-link code or intended-recipient id, so a frontend-only guard cannot prevent server-side acceptance.
- The implementation should keep controller/service layering intact: controllers enforce HTTP/auth boundaries and call services; services enforce opportunity invariants.
- The implementation should add targeted tests rather than relying on the full test suite.

## Acceptance Criteria
- [ ] With a valid connect link for User A, opening `/c/<code>` while logged out prompts or redirects through login while preserving `<code>`; after authenticating as User A, the browser reaches the same Telegram or web chat destination the current flow would have produced.
- [ ] With the same valid connect link for User A, authenticating as User B returns the generic not-found/unavailable response and does not call `startChat` or mutate opportunity actor state.
- [ ] For `connect`, `send_direct`, and `approve_introduction` links, wrong-account requests return generic not-found/unavailable and leave opportunity status/actor action unchanged.
- [ ] For `outreach` links, wrong-account requests return generic not-found/unavailable and do not reveal the counterpart chat/Telegram destination.
- [ ] Existing malformed, expired, or missing code behavior remains generic and indistinguishable from wrong-account behavior from the user’s perspective.
- [ ] Running the targeted backend connect-link tests, e.g. `cd backend && bun test src/controllers/tests/connect-link.controller.spec.ts`, exits 0 after implementation.
- [ ] Running any affected frontend auth/callback test or build target chosen by implementation, e.g. `cd frontend && bun run build`, exits 0 after implementation.

## Recommended Approach
Move the security boundary to the backend short-link flow: require authentication before `/c/:code/go` performs link side effects, compare the authenticated user to `connect_links.user_id`, and only then call the existing opportunity service and destination-building logic. Preserve login continuity by returning/redirecting to an account-bound continuation that carries the short code, not just the final `/u/:id/chat?msg=...` URL.

## Decisions

### Intended user framing
**Question**: For this connect-url login issue, what problem are you solving and who hits it?
**Recommended**: n/a — `intent` question
**Chosen**: Daily brief user.
**Rationale**: Developer selected the daily brief recipient as the primary user and later clarified the broader security rule in their own words.

### Possession-based short links must change
**Question**: From the probe I inferred that connect URLs are currently possession-based: `/c/:code` is unauthenticated, resolves `connect_links.user_id`, and calls `startChat(link.opportunityId, link.userId)` before web login can identify the browser account (`backend/src/controllers/connect-link.controller.ts:68,155`). Keep this behavior or change it?
**Recommended**: Change it.
**Chosen**: Change it.
**Rationale**: evidence: `backend/src/controllers/connect-link.controller.ts:68,155` + confirmed; possession-only access lets another account accept or reach the connection.

### Preserve recipient binding through login
**Question**: From the probe I inferred that after fallback to web chat, login returns to `/u/:id/chat?msg=...` and that URL has no connect code or intended-recipient user to compare against (`frontend/src/app/u/[id]/chat/page.tsx:34-36,102-110`). Should the feature preserve recipient binding through login?
**Recommended**: Bind through login.
**Chosen**: Bind through login.
**Rationale**: evidence: `frontend/src/app/u/[id]/chat/page.tsx:34-36,102-110` + confirmed; the post-login account must be checked against the link recipient.

### Scope across acceptance links
**Question**: You clarified that nowhere should people accept other people's connections. Should this requirement cover only daily-brief `connect` links, or all short-link acceptance kinds the code supports?
**Recommended**: All acceptance links.
**Chosen**: All acceptance links.
**Rationale**: The developer framed this as a general security invariant, not a daily-brief-only bug.

### Server-side recipient check
**Question**: Where should the recipient check live for connect-link acceptance? Tradeoff: strongest server-side security vs smallest change to the existing redirect flow.
**Recommended**: Server-gated links.
**Chosen**: Server-gated links.
**Rationale**: Backend validation protects before state changes; frontend-only checks would happen after the current controller has already accepted as `link.userId`.

### Wrong-account UX
**Question**: What should users see when the link is opened by the wrong logged-in account or after logging in as the wrong account?
**Recommended**: Not found.
**Chosen**: Not found.
**Rationale**: Generic not-found/unavailable messaging avoids leaking that an opportunity exists for another account.

### Correct-recipient destination
**Question**: For the correct recipient, what should happen after they authenticate through a connect link?
**Recommended**: Preserve destination.
**Chosen**: Preserve destination.
**Rationale**: Keep the successful Telegram/web behavior already implemented in `backend/src/controllers/connect-link.controller.ts:162-175` while adding the security gate.

### Include non-state-changing outreach links
**Question**: Should non-state-changing short links, like `outreach` links that only redirect for an already-accepted opportunity, also require the same recipient-account check?
**Recommended**: Yes, all links.
**Chosen**: Yes, all links.
**Rationale**: The developer wanted a system-wide rule that other people should not use another user’s connection links, including access-only redirects.

## Open Questions
- None explicitly deferred.

## References
- Skill input: free-text feature description provided at invocation.
- `backend/src/controllers/connect-link.controller.ts`
- `backend/src/services/connect-link.service.ts`
- `backend/src/services/opportunity.service.ts`
- `frontend/src/app/u/[id]/chat/page.tsx`
- `packages/protocol/src/opportunity/opportunity.tools.ts`
