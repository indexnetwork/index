---
date: 2026-06-10T14:27:05+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "AgentVillage OpenRouter workspace triage runbook"
tags: [plan, agentvillage, control-plane, openrouter, dashboard-proxy, docs]
status: ready
parent: .rpiv/artifacts/research/2026-06-10_13-38-04_agentvillage-openrouter-workspace-triage.md
phase_count: 3
phases:
  - { n: 1, title: Operator runbook }
  - { n: 2, title: README integration }
  - { n: 3, title: Quickstart troubleshooting handoff }
unresolved_phase_count: 0
last_updated: 2026-06-10T14:27:05+0300
last_updated_by: Yankı Ekin Yüksel
---

# AgentVillage OpenRouter Workspace Triage Runbook Implementation Plan

## Overview
Add a docs-only operator runbook for AgentVillage/Hermes incidents involving OpenRouter rate limits and inaccessible dashboards/workspaces. The plan keeps hosted AgentVillage OpenRouter-first, uses existing tenant detail and top-up API behavior, and links the runbook from package-level and quickstart documentation without changing runtime code.

## Requirements
- Provide an operator procedure for identifying the affected tenant from UUID, short ID, email, Telegram bot username, dashboard URL, or idempotency key.
- Document how to inspect tenant OpenRouter metadata (`limitUsd`, `expiresAt`, `usageUsd`, `limitRemainingUsd`, `disabled`) without exposing plaintext keys or other secrets.
- Document `POST /tenants/:id/openrouter/topup` as the immediate scoped-key top-up workaround.
- Document dashboard/workspace access triage using proxy errors: `missing_token`, `unauthorized`, `tenant_not_found`, `edgeos_lookup_failed:*`, and `dashboard_unreachable:*`.
- Make clear that hosted tenants use scoped OpenRouter keys and that connecting Hermes to a Claude account through the dashboard is not a supported hosted workaround.
- Link the runbook from `README.md` and `docs/QUICKSTART.md`.
- Keep the change documentation-only; do not modify control-plane, sidecar, dashboard-proxy, schema, or provisioning code.

## Current State Analysis
The control-plane and dashboard-proxy already expose the operational signals needed for a runbook. What is missing is an operator-facing procedure that safely combines tenant identification, OpenRouter budget inspection/top-up, dashboard-proxy error classification, and support-reply guidance.

### Key Discoveries
- `packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:9-12` defines default scoped key budget/expiry policy.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:46-63` creates tenant OpenRouter keys and returns plaintext only at create time with hash/limit/expiry metadata.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:65-83` and `:1655-1661` pass plaintext OpenRouter keys only to sidecar provisioning.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:275-285` loads tenant detail by full UUID; short IDs are not a control-plane lookup surface.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1157-1179` surfaces OpenRouter budget metadata on `tenant.openrouter` and suppresses live metadata when OpenRouter lookup fails.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1692-1712` patches the existing scoped OpenRouter key limit in place and returns metadata-only top-up results.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:87-99` resolves dashboard-proxy short IDs for URL routing only.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:301-330` preserves distinct tenant/token/dashboard error categories for access triage.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:136-180` reports sidecar/gateway readiness and validates provision-time OpenRouter key input.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/boot/start-tenant.sh:31-41` starts dashboard and gateway separately, so gateway readiness is not sufficient proof that the dashboard is reachable.
- `packages/edge-city/agentvillage-controlplane/README.md:44-80` uses a compact API table for endpoint summaries.
- `packages/edge-city/agentvillage-controlplane/docs/QUICKSTART.md:79-87` uses a troubleshooting table for user-facing handoff guidance.

## Desired End State
Operators can apply the runbook with the existing control-plane API:

```bash
export CP_URL="https://your-control-plane.up.railway.app"
export CP_KEY="your-control-plane-api-key"
export TENANT_ID="paste-full-tenant-uuid"

curl -s "$CP_URL/tenants/$TENANT_ID?detail=1" \
  -H "Authorization: Bearer $CP_KEY" | jq '.tenant.openrouter'

curl -s -X POST "$CP_URL/tenants/$TENANT_ID/openrouter/topup" \
  -H "Authorization: Bearer $CP_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amountUsd": 10}' | jq
```

Residents and operators can discover the runbook from the package README and Quickstart troubleshooting table:

```md
**Operator runbook:** [OpenRouter rate-limit and workspace-access triage](docs/OPENROUTER_WORKSPACE_TRIAGE.md)
```

## What We're NOT Doing
- Not adding provider fallback, Claude/Anthropic account linking, user-owned provider keys, or provider switching.
- Not changing tenant provisioning, sidecar runtime behavior, OpenRouter key rotation, or container restart behavior.
- Not adding control-plane short-ID lookup support; operators resolve short IDs by listing/filtering tenants.
- Not changing dashboard-proxy authentication, cookie, token, or error behavior.
- Not changing database schema or migrations.
- Not adding productized diagnostics or automated recovery flows.

## Decisions

### Decision 1: Keep this docs-only
The research Developer Context selected “Triage + workaround” and “Operator runbook” as the first implementation shape. Runtime behavior already supports the required workflow through tenant detail/top-up and dashboard-proxy error categories, so this plan only changes Markdown.

### Decision 2: Treat hosted Hermes as OpenRouter-first
`packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:199-201` defaults generated Hermes config to `openrouter`, and `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:150-180` requires `openrouterApiKey` during provisioning. The runbook therefore states that Claude-account dashboard connection is not a supported hosted workaround.

### Decision 3: Use metadata-only OpenRouter inspection and in-place top-up
`packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1157-1179` exposes `limitUsd`, `expiresAt`, and live key metadata when queryable, while `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1692-1712` updates the scoped key limit in place. The runbook must not expose plaintext keys or recommend restarts for budget-only issues.

### Decision 4: Preserve dashboard-proxy error categories
`packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:301-330` distinguishes `tenant_not_found`, `missing_token`, authorization failures, and `dashboard_unreachable:*`. The runbook maps these exact machine-readable errors to operator actions rather than collapsing them into generic login or OpenRouter failures.

### Decision 5: Use list/filter for short IDs
`packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:275-285` loads tenant detail by full UUID while `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:87-99` resolves short IDs only in the proxy. The developer confirmed the runbook workaround is sufficient: list tenants and filter locally to resolve short IDs.

## Phase 1: Operator runbook

### Overview
Adds the complete operator runbook. Depends on no prior phase; Phase 2 and Phase 3 link to this file.

### Changes Required:

#### 1. packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md
**File**: `packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md`
**Changes**: NEW — operator procedure for OpenRouter budget/top-up and dashboard/workspace access triage.

````markdown
# OpenRouter rate-limit and workspace-access triage

Use this runbook when an AgentVillage/Hermes resident reports OpenRouter rate limits, failed OpenRouter login, or an inaccessible workspace/dashboard.

Hosted tenants are provisioned as OpenRouter-backed Hermes containers. The control plane creates a scoped OpenRouter key for each tenant and injects it into the container during `/provision`. Connecting Hermes to a Claude account in the dashboard is **not** a supported workaround for hosted tenant provider limits.

## Prerequisites

```bash
export CP_URL="https://your-control-plane.up.railway.app"
export CP_KEY="your-control-plane-api-key"
```

All control-plane calls use:

```bash
-H "Authorization: Bearer $CP_KEY"
```

Never paste plaintext OpenRouter keys, Telegram bot tokens, Index API keys, EdgeOS bearer tokens, or tenant API server keys into public support channels.

## 1. Identify the tenant

Accepted inputs from the report:

- tenant UUID
- 8-character short id from the dashboard URL
- resident email
- Telegram bot username
- dashboard URL containing the tenant UUID/short id
- idempotency key from provisioning logs

If you have the full tenant UUID, inspect it directly:

```bash
export TENANT_ID="paste-full-tenant-uuid"

curl -s "$CP_URL/tenants/$TENANT_ID?detail=1" \
  -H "Authorization: Bearer $CP_KEY" | jq
```

If you only have an idempotency key:

```bash
export IDEMPOTENCY_KEY="paste-key"
export IDEMPOTENCY_KEY_ENCODED="$(node -e 'process.stdout.write(encodeURIComponent(process.env.IDEMPOTENCY_KEY || ""))')"

curl -s "$CP_URL/tenants/by-idempotency/$IDEMPOTENCY_KEY_ENCODED" \
  -H "Authorization: Bearer $CP_KEY" | jq
```

If you have an email, Telegram bot username, or 8-character short id, list tenants and filter locally. The short id is the tenant UUID without dashes, truncated to 8 characters.

```bash
export LOOKUP="paste-email-bot-username-or-short-id"

curl -s "$CP_URL/tenants" \
  -H "Authorization: Bearer $CP_KEY" \
  | jq --arg q "$LOOKUP" \
    '.tenants[]
     | select(
         .email == $q
         or .telegramBotUsername == $q
         or ((.id | gsub("-"; "")) | startswith($q))
       )
     | { id, email, telegramBotUsername, status, sidecarReady, gatewayReady }'
```

Expected tenant status for normal support is `status: "live"`, `sidecarReady: true`, and `gatewayReady` not `false`. If the tenant is missing or not live, stop here and handle it as a provisioning/deployment issue rather than an OpenRouter top-up.

## 2. Check OpenRouter budget and disabled state

Use tenant detail and inspect the `tenant.openrouter` block:

```bash
curl -s "$CP_URL/tenants/$TENANT_ID?detail=1" \
  -H "Authorization: Bearer $CP_KEY" \
  | jq '.tenant.openrouter'
```

Expected fields:

```json
{
  "limitUsd": 10,
  "expiresAt": "2026-09-08T00:00:00.000Z",
  "usageUsd": 9.85,
  "limitRemainingUsd": 0.15,
  "disabled": false
}
```

Interpretation:

| Signal | Diagnosis | Operator action |
|--------|-----------|-----------------|
| `disabled: true` | OpenRouter disabled the scoped tenant key or the key is unusable. | Top up if budget exhaustion is likely; if it remains disabled, escalate to OpenRouter/account investigation. |
| `limitRemainingUsd <= 0` | Tenant budget is exhausted. | Top up the tenant key. |
| `usageUsd` close to `limitUsd` | Tenant is near exhaustion. | Top up proactively if the resident is actively blocked. |
| `usageUsd`, `limitRemainingUsd`, or `disabled` missing | OpenRouter metadata could not be fetched. | Verify `OPENROUTER_MANAGEMENT_KEY` on the control plane and retry; do not assume the tenant has budget. |
| Budget healthy | Provider budget is probably not the cause. | Continue to dashboard/workspace access triage. |

## 3. Top up a scoped OpenRouter key

Top-up extends the existing scoped tenant key. It does not rotate the key and should not require a container restart.

```bash
curl -s -X POST "$CP_URL/tenants/$TENANT_ID/openrouter/topup" \
  -H "Authorization: Bearer $CP_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amountUsd": 10}' | jq
```

Successful response fields:

```json
{
  "limitUsd": 20,
  "usageUsd": 9.85,
  "limitRemainingUsd": 10.15,
  "disabled": false
}
```

If `disabled` remains `true` after top-up, do not keep adding spend. Escalate with the tenant id, OpenRouter key hash from the tenant row if available to operators, and the exact OpenRouter error seen by Hermes.

## 4. Triage dashboard/workspace access

The dashboard proxy accepts a tenant id/short id path prefix and one of these token sources:

- `Authorization: Bearer <token>`
- `?token=<token>` query parameter, which the proxy exchanges for cookies
- existing dashboard proxy cookies

The token may be the tenant `apiServerKey` or a valid EdgeOS bearer token. `GET /tenants/:id?detail=1` includes `tenant.dashboardToken` only when the tenant was provisioned with an EdgeOS bearer token.

Build a clean dashboard URL from the tenant id or short id and a valid token:

```text
https://<dashboard-proxy-domain>/<TENANT_ID>?token=<TOKEN>
```

If access fails, classify the response before prescribing a fix:

| Proxy error | HTTP | Meaning | Operator action |
|-------------|------|---------|-----------------|
| `missing_token` | 401 | No bearer token, query token, or auth cookie reached the proxy. | Send a fresh dashboard link with `?token=...`, or ask the user to clear stale dashboard cookies and retry the fresh link. |
| `unauthorized` | 401 | EdgeOS rejected the provided token, or the token is expired/invalid. | Generate/use a valid EdgeOS bearer token or use the tenant `apiServerKey` for operator-only debugging. |
| `tenant_not_found` | 404 | The path prefix/cookie does not resolve to exactly one live tenant. | Verify tenant id/short id, tenant status, and dashboard URL prefix. |
| `edgeos_lookup_failed: ...` | 502 | Proxy could not validate the EdgeOS token. | Retry; if persistent, check EdgeOS API health/config (`EDGEOS_API_BASE`). |
| `dashboard_unreachable: ...` | 502 | Token and tenant resolved, but the private Hermes dashboard was unreachable. | Check tenant `sidecarReady`/`gatewayReady`, Railway service health, and tenant dashboard logs. |

Do not describe all dashboard failures as “OpenRouter login failed.” A successful dashboard proxy check can still leave a separate OpenRouter budget problem, and an OpenRouter top-up will not fix a missing or unauthorized dashboard token.

## 5. Reply template for the resident

Use this shape after diagnosis:

```text
Thanks for the report — hosted AgentVillage/Hermes tenants use a scoped OpenRouter key that we manage per workspace. Connecting Hermes to a Claude account through the dashboard is not currently a supported workaround for hosted tenants.

I checked your tenant and found: <OpenRouter exhausted/disabled | dashboard token issue | dashboard service unreachable | no tenant found | needs deeper investigation>.

Next step: <we topped up the tenant OpenRouter budget; please retry> / <please use this fresh workspace link> / <we are checking the tenant service and will follow up>.
```

## 6. Escalate when

Escalate beyond this runbook if any of these are true:

- OpenRouter remains `disabled: true` after a reasonable top-up.
- OpenRouter metadata fields are unavailable and `OPENROUTER_MANAGEMENT_KEY` is configured.
- Dashboard proxy resolves the tenant/token but consistently returns `dashboard_unreachable`.
- The tenant is authenticated and dashboard-reachable, but Hermes cannot load AgentVillage workspace files (`AGENTS.md`, `USER.md`, or skills).
- Multiple tenants hit budget exhaustion at the same time, suggesting a global model/provider usage change.
````

### Success Criteria:

#### Automated Verification:
- [x] Runbook file exists: `test -f packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md`
- [x] Markdown diff has no whitespace errors: `git diff --check -- packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md`
- [x] Required OpenRouter metadata fields are documented: `grep -E "limitUsd|expiresAt|usageUsd|limitRemainingUsd|disabled" packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md`
- [x] Idempotency key lookup URL-encodes the path segment: `grep -F "IDEMPOTENCY_KEY_ENCODED" packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md`
- [x] Required dashboard proxy errors are documented: `grep -E "missing_token|unauthorized|tenant_not_found|edgeos_lookup_failed|dashboard_unreachable" packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md`
- [x] Top-up endpoint is documented: `grep -F '/tenants/$TENANT_ID/openrouter/topup' packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md`

#### Manual Verification:
- [x] Runbook states hosted tenants use scoped OpenRouter keys and Claude-account dashboard connection is not a supported hosted workaround.
- [x] Runbook warns operators not to expose plaintext OpenRouter keys, Telegram bot tokens, Index API keys, EdgeOS bearer tokens, or tenant API server keys.
- [x] Tenant identification section documents full UUID direct lookup and list/filter lookup for email, Telegram bot username, and short IDs.
- [x] OpenRouter top-up section states the top-up extends the existing scoped key without rotation or tenant restart.
- [x] Resident reply template avoids unsupported provider-fallback guidance.

## Phase 2: README integration

### Overview
Links the runbook from the package README and records the top-up endpoint in the compact API table. Depends on Phase 1.

### Changes Required:

#### 1. packages/edge-city/agentvillage-controlplane/README.md
**File**: `packages/edge-city/agentvillage-controlplane/README.md`
**Changes**: MODIFY — add operator runbook link, top-up API row, and docs layout entry.

````markdown
**Quickstart:** [docs/QUICKSTART.md](docs/QUICKSTART.md)

**Operator runbook:** [OpenRouter rate-limit and workspace-access triage](docs/OPENROUTER_WORKSPACE_TRIAGE.md)
```

```markdown
| `POST` | `/tenants/:id/openrouter/topup` | Increase the scoped tenant OpenRouter key limit |
```

```markdown
## Layout

```
control-plane/       API, migrations, container boot scripts + sidecar
docs/QUICKSTART.md                    end-user: bot token → tenant → pairing
docs/RAILWAY.md                       repeatable Railway + GitHub Actions setup
docs/OPENROUTER_WORKSPACE_TRIAGE.md   operator rate-limit/workspace-access runbook
```
````

### Success Criteria:

#### Automated Verification:
- [ ] README links the operator runbook: `grep -F "docs/OPENROUTER_WORKSPACE_TRIAGE.md" packages/edge-city/agentvillage-controlplane/README.md`
- [ ] README documents the OpenRouter top-up endpoint: `grep -F 'POST` | `/tenants/:id/openrouter/topup`' packages/edge-city/agentvillage-controlplane/README.md`
- [ ] Markdown diff has no whitespace errors: `git diff --check -- packages/edge-city/agentvillage-controlplane/README.md`

#### Manual Verification:
- [ ] The runbook link appears near the existing Quickstart link at the top of the README.
- [ ] The API table keeps the existing `Method | Path | Purpose` convention and uses a one-line endpoint purpose.
- [ ] The `## Layout` section lists `docs/OPENROUTER_WORKSPACE_TRIAGE.md` with a concise operator-runbook description.

## Phase 3: Quickstart troubleshooting handoff

### Overview
Adds a user-facing troubleshooting handoff from Quickstart to the operator runbook. Depends on Phase 1 and can be applied after Phase 2 or independently once Phase 1 exists.

### Changes Required:

#### 1. packages/edge-city/agentvillage-controlplane/docs/QUICKSTART.md
**File**: `packages/edge-city/agentvillage-controlplane/docs/QUICKSTART.md`
**Changes**: MODIFY — add troubleshooting row for OpenRouter rate limits and inaccessible workspace/dashboard reports.

```markdown
| OpenRouter rate limit or dashboard/workspace inaccessible | Operators should follow [OpenRouter rate-limit and workspace-access triage](./OPENROUTER_WORKSPACE_TRIAGE.md); hosted tenants use a scoped OpenRouter key, not a Claude-account dashboard workaround |
```

### Success Criteria:

#### Automated Verification:
- [ ] Quickstart links to the operator runbook: `grep -F "./OPENROUTER_WORKSPACE_TRIAGE.md" packages/edge-city/agentvillage-controlplane/docs/QUICKSTART.md`
- [ ] Quickstart mentions the hosted scoped OpenRouter key framing: `grep -F "hosted tenants use a scoped OpenRouter key" packages/edge-city/agentvillage-controlplane/docs/QUICKSTART.md`
- [ ] Markdown diff has no whitespace errors: `git diff --check -- packages/edge-city/agentvillage-controlplane/docs/QUICKSTART.md`
- [ ] All docs whitespace checks pass: `git diff --check -- packages/edge-city/agentvillage-controlplane/README.md packages/edge-city/agentvillage-controlplane/docs/QUICKSTART.md packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md`

#### Manual Verification:
- [ ] The troubleshooting row stays concise and routes operational detail to the runbook rather than duplicating it in Quickstart.
- [ ] The row explicitly avoids the Claude-account dashboard workaround for hosted tenants.
- [ ] The relative docs link uses `./OPENROUTER_WORKSPACE_TRIAGE.md` from the `docs/` directory.

## Ordering Constraints
- Phase 1 must be implemented before Phase 2 and Phase 3 because both phases link to the new runbook file.
- Phase 2 and Phase 3 can be applied in either order after Phase 1.
- Do not implement runtime code changes while executing this plan.
- If implementation happens in the submodule, commit submodule docs changes before committing any root submodule pointer update.

## Verification Notes
- Verify the runbook contains no plaintext key examples beyond placeholder environment variables and no instruction to paste secrets into support channels.
- Verify the runbook names the required OpenRouter metadata fields: `limitUsd`, `expiresAt`, `usageUsd`, `limitRemainingUsd`, and `disabled`.
- Verify the top-up command documents `POST /tenants/:id/openrouter/topup` and states that it does not rotate keys or require a restart.
- Verify the dashboard proxy table preserves `missing_token`, `unauthorized`, `tenant_not_found`, `edgeos_lookup_failed: ...`, and `dashboard_unreachable: ...`.
- Verify the runbook says Claude-account dashboard connection is not a supported hosted workaround.
- Verify README links the runbook, includes the top-up API row, and lists the new doc in `## Layout`.
- Verify Quickstart links to `./OPENROUTER_WORKSPACE_TRIAGE.md` from the troubleshooting table.
- Verify Markdown whitespace is clean with `git diff --check`.

## Performance Considerations
This plan changes Markdown only. It does not add runtime code, network calls, database queries, or background work. The runbook intentionally recommends in-place OpenRouter top-up instead of tenant restart/reprovision to avoid historically fragile and slower recovery paths.

## Migration Notes
No schema, data, or runtime migration is required. If applied inside the `packages/edge-city/agentvillage-controlplane` submodule, the submodule commit must be created before the root repository records the updated submodule pointer.

## Pattern References
- `packages/edge-city/agentvillage-controlplane/README.md:5-7` — top-level documentation links near Quickstart.
- `packages/edge-city/agentvillage-controlplane/README.md:44-80` — compact API table convention.
- `packages/edge-city/agentvillage-controlplane/README.md:89-94` — docs layout registry convention.
- `packages/edge-city/agentvillage-controlplane/docs/QUICKSTART.md:79-87` — troubleshooting table convention.
- `packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md:1-174` — target runbook structure and operational table conventions.

## Developer Context
- Discover: Foundational intent — “For this AgentVillage bug report, what problem are we solving and who is blocked by it?” Answer: Incident triage.
- Discover: Hosted provider framing — “From the probe I inferred that hosted AgentVillage/Hermes should be treated as OpenRouter-first for this triage: config defaults to `openrouter`, provisioning requires an `openrouterApiKey`, and no Claude fallback is wired here (`packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:200`, `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:170`). Keep that framing?” Answer: Keep OpenRouter frame.
- Discover: Rate-limit workaround path — “From the probe I inferred that the immediate rate-limit workaround is operational top-up/usage inspection of the scoped OpenRouter key, because tenant keys default to a dollar limit and there is a top-up API (`packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:11`, `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1692`). Keep that as the likely workaround requirement?” Answer: Keep top-up path.
- Discover: Workspace access focus — “From the probe I inferred that ‘workspace isn’t accessible’ likely needs dashboard/proxy auth triage first: missing token returns `missing_token`, bad auth returns 401, and unreachable dashboard returns `dashboard_unreachable` (`packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:310`, `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:330`). Keep that as an acceptance focus?” Answer: Keep proxy triage.
- Discover: Scope — “What should this discovery scope produce for the AgentVillage bug report?” Answer: Triage + workaround.
- Discover: Required triage information — “For the triage/workaround scope, what information must the operator be able to check before replying to the user?” Answer: Usage + access.
- Discover: Explicit non-goal — “Which related fixes should be explicitly out of scope for this FRD?” Answer: No provider fallback.
- Discover: First implementation shape — “Where should the workaround live first: low-risk operator procedure or productized diagnostics?” Answer: Operator runbook.
- Discover: Success definition — “What should count as success for this triage/workaround work?” Answer: Actionable diagnosis.
- Blueprint checkpoint: “Control-plane detail/top-up supports full UUID lookup while short-id resolution exists only in the dashboard proxy. Should follow-up research/design treat short-id lookup as a code gap or keep the runbook's list-and-filter workaround as sufficient?” Answer: Runbook workaround is sufficient for this docs-first scope.
- Blueprint design checkpoint: “Design: AgentVillage OpenRouter/workspace triage runbook... Ready to proceed to decomposition?” Answer: Proceed.
- Blueprint decomposition checkpoint: “3 slices for AgentVillage OpenRouter/workspace triage... Approve decomposition?” Answer: Approve.

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9._

_Coverage reviewer emitted no uncovered verification-intent findings._

| source | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| --- | --- | --- | --- | --- | --- | --- | --- |
| code | Phase 1 | <n/a> | blocker | actionability | Automated verification uses `grep -F "POST \"$CP_URL/tenants/$TENANT_ID/openrouter/topup\""` so the shell expands `$CP_URL` and `$TENANT_ID`, causing the grep to miss the literal documented command when those env vars are unset or different. | Change the verification command to single-quote the pattern or escape the `$` characters. | applied: changed Phase 1 success criterion to single-quote a literal `/tenants/$TENANT_ID/openrouter/topup` grep pattern. |
| code | Phase 1 §1 (OPENROUTER_WORKSPACE_TRIAGE.md) | packages/edge-city/agentvillage-controlplane/control-plane/src/index.js:139-143 | concern | code-quality | The idempotency lookup command interpolates `$IDEMPOTENCY_KEY` directly into `/tenants/by-idempotency/$IDEMPOTENCY_KEY`, but the route only accepts a single URL path segment, so keys containing `/`, `?`, `#`, or spaces will not resolve correctly. | URL-encode `IDEMPOTENCY_KEY` before placing it in the path. | applied: updated Phase 1 runbook command to derive `IDEMPOTENCY_KEY_ENCODED` with `encodeURIComponent(...)` before calling `/tenants/by-idempotency/...`. |

## Plan History
- Phase 1: Operator runbook — approved as generated
- Phase 2: README integration — approved as generated
- Phase 3: Quickstart troubleshooting handoff — approved as generated

## References
- `.rpiv/artifacts/research/2026-06-10_13-38-04_agentvillage-openrouter-workspace-triage.md` — source research artifact.
- `.rpiv/artifacts/discover/2026-06-10_13-24-25_agentvillage-openrouter-workspace-triage.md` — source FRD.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js`
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js`
- `packages/edge-city/agentvillage-controlplane/control-plane/src/index.js`
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js`
- `packages/edge-city/agentvillage-controlplane/control-plane/container/boot/start-tenant.sh`
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js`
- `packages/edge-city/agentvillage-controlplane/README.md`
- `packages/edge-city/agentvillage-controlplane/docs/QUICKSTART.md`
