---
date: 2026-06-11T00:55:13+0300
author: Yankı Ekin Yüksel
commit: c5c2c78664
branch: dev
repository: index
topic: "AgentVillage digest wrong-opportunity delivery — root cause and fix"
tags: [intent, frd, agentvillage, digest, connect-link, opportunity, install]
status: ready
last_updated: 2026-06-11T00:55:13+0300
last_updated_by: Yankı Ekin Yüksel
---

# FRD: AgentVillage digest wrong-opportunity delivery — root cause and fix

## Summary
Users received opportunities in their AgentVillage daily digest that belonged to other residents. User C's digest contained a connect link minted for User A, meaning C's Hermes workspace was authenticating as A when the digest was staged. A stop-gap connect-link patch (`resolveConnectLinkForUser`) has shipped, but the root cause — wrong `INDEX_API_KEY` stored in a resident's workspace — remains undetected and potentially present in other residents. This FRD captures the investigation scope and required fix.

## Problem & Intent
User C received an opportunity between User A and User B in their morning digest. A connect link was embedded in C's digest that — after the connect-link patch landed (Jun 10) — returned 404 for User C, confirming the link was minted for User A's userId, not User C's. This means C's Hermes workspace was calling the Index MCP server with User A's `INDEX_API_KEY`, fetching A's opportunities, minting A's connect links, and staging the result as C's morning brief. The install process never verified that the stored API key corresponds to the expected resident.

In the developer's own words: *"we had to make a patch preventing User C from using that connect link, but we still have to debug and find out why User C received the opportunity to begin with. And we have to fix it."*

## Goals
- Identify the root cause: confirm that the wrong `INDEX_API_KEY` in User C's workspace is what caused the mis-delivery.
- Fix the install flow: add an identity-verification step to `installIndex()` so a key that doesn't match the expected resident is rejected at install time, not discovered via a leaked opportunity.
- Audit existing residents: check every deployed resident workspace for an API key mismatch and re-install affected workspaces with the correct key.
- Prevent recurrence: the install-time check should run on every fresh install and every reconcile/update pass.

## Non-Goals
- Replacing or removing the connect-link patch (`resolveConnectLinkForUser`) — it is correct defense-in-depth and stays.
- Redesigning the digest pipeline beyond the API-key identity check.
- Fixing the `callerScoped` filter or `visibilityGuard` SQL — those are independently correct and already in place; they do not address mis-configured API keys because the SQL correctly returns opportunities for whoever the key authenticates as.
- Investigating whether the opportunity was a two-party or three-party connection — that distinction does not change the root cause or the fix.

## Functional Requirements
1. `installIndex()` SHALL call the Index backend with the provided API key before writing it to disk, and verify the returned authenticated user matches the expected resident identity (Telegram handle or resident ID if available).
2. If identity verification fails, `installIndex()` SHALL exit with a non-zero code and a human-readable error before modifying `HERMES_HOME/.env` or `config.yaml`.
3. A reconcile/repair script SHALL be provided (or the existing `reconcile_digest_crons.ts` extended) to check API key identity on already-installed workspaces without re-running the full install.
4. The `buildDailyBriefContext` function (or `fetchOpportunitiesFromMcp`) SHALL log the authenticated user identity returned by the MCP server on each digest build so future mis-configurations leave a detectable trace in logs.
5. Installation docs SHALL note that `--index-api-key` must be the key belonging to the resident's own Index account.

## Non-Functional Requirements
- **Performance**: The identity-check call adds one round-trip to `installIndex()` (< 1 s on typical network). Acceptable for an install-time operation.
- **Security**: The identity check must not log the raw API key; it may log the first 8 chars of its SHA-256 hash (consistent with the pattern in `backend/src/guards/auth.guard.ts:113`).
- **UX / Accessibility**: Install-time failures must produce a clear human-readable message naming the mismatch (e.g., "API key authenticates as user@example.com, expected resident telegram handle @handle").
- **Reliability**: If the identity check endpoint is unreachable (network outage), `installIndex()` should warn and optionally allow a `--skip-key-check` bypass for offline installs, but default to failing fast.

## Constraints & Assumptions
- Each AgentVillage resident has their own isolated Hermes workspace (`HERMES_HOME`) with their own `INDEX_API_KEY`, `memory/`, and kanban state.
- The Index backend exposes an authenticated endpoint that returns the current user's identity (userId, email, or Telegram handle) callable with just `x-api-key`. **This needs to be verified by research** — if no such endpoint exists it must be added (or the MCP `read_user_profiles` tool used instead).
- The AgentVillage landing admin routes (`/api/admin/residents/[tenantId]/…`) are separate from each resident's Hermes digest pipeline and are not implicated in this bug.
- User C's workspace currently has the wrong key and must be re-installed with the correct one as an immediate operational fix (outside the code change).

## Acceptance Criteria
- [ ] Running `bun install/install.ts --index-api-key <WRONG_KEY>` exits non-zero with a message identifying the key mismatch before writing any files.
- [ ] Running `bun install/install.ts --index-api-key <CORRECT_KEY>` completes normally and writes the key.
- [ ] Running the reconcile/audit script against a workspace with a mismatched key prints a warning identifying that workspace.
- [ ] After re-installing User C's workspace with the correct key, the next morning digest for User C contains only opportunities where User C is an actor (verified by checking the staged Kanban body before the send pass).
- [ ] `buildDailyBriefContext` writes a log line containing the authenticated userId returned by the MCP on each digest opportunity fetch (visible in the Hermes run log for the prepare cron).

## Recommended Approach
Add an identity-verification call inside `installIndex()` in `packages/edge-city/agentvillage/install/install_index.ts` that hits a lightweight authenticated endpoint on the Index backend (e.g., a `GET /api/me` returning `{userId, email}`) before writing the key to disk; extend `reconcile_digest_crons.ts` with a `--check-identity` mode that runs the same check against already-installed workspaces; and add a `userId` log field to `fetchOpportunitiesFromMcp` using the authenticated identity returned in the MCP initialize handshake or a separate `/me` probe.

## Decisions

### Fix scope
**Question**: The connect-link patch blocks User C from acting on the link, but User C still saw the opportunity in their digest. What does a complete fix look like?
**Recommended**: Root-cause why User C got it, then fix.
**Chosen**: Root-cause why User C got it, then fix.
**Rationale**: The symptom (connect link misuse) is already blocked by the patch; the underlying cause (wrong identity in workspace) must be identified and closed.

### Root cause identification — which layer
**Question**: What do we know about how the wrong opportunity ended up in User C's digest? Whose userId was the connect link minted for?
**Recommended**: n/a — evidence question
**Chosen**: User A's userId (User C had someone else's link). After the patch, User C gets 404 on the link, confirming the link was minted for a different user.
**Rationale**: evidence: `backend/src/services/connect-link.service.ts:resolveConnectLinkForUser` — filters by `userId`; the 404 confirms the code belongs to User A, not C.

### Deployment isolation model
**Question**: Does each resident have their own isolated Hermes workspace?
**Recommended**: Separate workspace per resident (expected architecture).
**Chosen**: Confirmed — each resident has their own isolated Hermes workspace.
**Rationale**: Confirmed by developer; consistent with `packages/edge-city/agentvillage/install/install_index.ts:installIndex` which writes one `HERMES_HOME/.env` per install invocation.

### Wrong-delivery mechanism
**Question**: Pre-resolved from codebase evidence and interview.
**Recommended**: n/a
**Chosen**: User C's `HERMES_HOME` contains User A's `INDEX_API_KEY`. `stage-daily-brief.ts` → `buildDailyBriefContext` → `fetchOpportunitiesFromMcp` calls MCP with that key, authenticating as User A. Opportunities returned are User A's. `mintConnectLink(userId=A, ...)` mints User A's links. These appear in User C's staged digest.
**Rationale**: evidence: `packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts:fetchOpportunitiesFromMcp` uses `INDEX_API_KEY` from env; `backend/src/services/connect-link.service.ts:mintConnectLink` uses `userId` from `opts.viewerId` which traces to `context.userId` which traces to the authenticated API key.

### Faulty opportunity window
**Question**: Pre-resolved from codebase evidence — prepare cron runs at 02:00 PST, send at 08:00 PST.
**Recommended**: n/a — observation
**Chosen**: The mis-delivered opportunity was staged during the 02:00 prepare pass and sent at 08:00. The bug is in `stage-daily-brief.ts` (the prepare path), not the send pass.
**Rationale**: evidence: `packages/edge-city/agentvillage/install/install_index.ts:DIGEST_CRON_SPECS` — prepare at `0 2 * * *`, send at `0 8 * * *`. Developer confirmed the window.

### Existing guards are defense-in-depth, not root-cause fixes
**Question**: Pre-resolved from codebase evidence — callerScoped filter (Jun 7), networkId two-clause fix (May 29), connect-link recipient check (Jun 10).
**Recommended**: Keep all three; do not remove them.
**Chosen**: All three safeguards stay. Root cause is upstream of them (wrong key → wrong user → correct opportunities for the wrong person → correct links for the wrong person).
**Rationale**: evidence: `packages/protocol/src/opportunity/opportunity.tools.ts:1539` (`callerScoped`), `backend/src/adapters/database.adapter.ts:5076` (networkId filter), `backend/src/controllers/connect-link.controller.ts:78` (`resolveConnectLinkForUser`). These guards are correct; they just don't apply when the API key already maps to the wrong user.

## Open Questions
- Does the Index backend currently expose a lightweight `GET /api/me` (or equivalent) that returns authenticated user identity for an API key? If not, must one be added as part of this fix, or should the identity check use the MCP `initialize` response metadata? **Research should verify** `backend/src/controllers/` and `backend/src/main.ts` for any existing `/me` route.
- How many residents are currently deployed, and how many have a potential API key mismatch? An audit script should enumerate all `HERMES_HOME` paths and check each before re-installs are scheduled.
- Was the wrong key a one-off installation error, or is there a systemic flaw in the install process (e.g., an onboarding script that copies the key from a template)?

## Suggested Follow-ups
- `packages/edge-city/agentvillage/skills/edge-esmeralda/prompts/prepare.md` comment in `stage-daily-brief.ts` header mentions "the cron prompt still fetches Index opportunities through MCP and writes to `memory/digest-opportunities.txt`" — this comment is outdated (the current prompt does not do this); worth cleaning up to avoid confusion: `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts:1–15`.
- The `callerScoped` filter logs warnings to Sentry when an opportunity row returns for a user who is not an actor. If these warnings fire in production, they would have flagged the mis-configuration before the digest shipped. Consider hooking Sentry alerts on `list_opportunities: skipping opportunity where caller is not an actor`: `packages/protocol/src/opportunity/opportunity.tools.ts:1539`.

## References
- Input: free-text description of the AgentVillage daily digest wrong-opportunity bug
- `packages/edge-city/agentvillage/install/install_index.ts` — install flow, API key storage
- `packages/edge-city/agentvillage/skills/index-network/scripts/build-daily-brief-context.ts` — `fetchOpportunitiesFromMcp` (MCP identity boundary)
- `packages/edge-city/agentvillage/skills/index-network/scripts/stage-daily-brief.ts` — prepare-pass entry point
- `backend/src/services/connect-link.service.ts` — `mintConnectLink` + `resolveConnectLinkForUser` (the patch)
- `backend/src/controllers/connect-link.controller.ts` — `/c/:code/go` handler
- `backend/src/adapters/database.adapter.ts:5037` — `getOpportunitiesForUser` + visibilityGuard
- `packages/protocol/src/opportunity/opportunity.tools.ts:1461` — `list_opportunities` handler
- git: `d39d08f4a0` — "Require recipients for connect links" (the patch, Jun 10 2026)
- git: `7162581a44` — "fix(protocol): tighten opportunity caller filtering" (Jun 7 2026)
- git: `58145358e1` — "fix(backend): scope opportunity reads to opps wholly within the network" (May 29 2026)
