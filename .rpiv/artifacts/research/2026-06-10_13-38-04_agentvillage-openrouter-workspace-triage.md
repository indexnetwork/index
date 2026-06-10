---
date: 2026-06-10T13:38:04+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "AgentVillage OpenRouter and workspace access triage"
tags: [research, codebase, agentvillage, control-plane, openrouter, dashboard-proxy]
status: ready
last_updated: 2026-06-10T13:38:04+0300
last_updated_by: Yankı Ekin Yüksel
---

# Research: AgentVillage OpenRouter and workspace access triage

## Research Question
Verify the AgentVillage OpenRouter/workspace triage FRD against live control-plane, sidecar, dashboard-proxy, and documentation surfaces. Determine whether the docs-first operator runbook is grounded in existing behavior and what follow-up gaps remain.

## Summary
The current codebase supports the docs-first runbook: hosted tenant provisioning creates a scoped OpenRouter key, stores only key metadata on the tenant, injects the plaintext key into the tenant runtime during provisioning, exposes tenant detail with budget metadata, and provides an in-place top-up route. Dashboard/workspace access is a separate flow through `dashboard-proxy/index.js`, with distinct errors for missing token, invalid token, unknown tenant, EdgeOS lookup failure, and private dashboard reachability. Workspace health is not equivalent to OpenRouter budget health: `sidecarReady`, `gatewayReady`, dashboard-derived stats, and proxy reachability each represent different parts of the tenant runtime. The only notable mismatch is that control-plane tenant detail/top-up require a full tenant UUID; short IDs are resolved by the dashboard proxy and can be resolved operationally by listing/filtering tenants, which the developer confirmed is sufficient for this docs-first scope.

## Detailed Findings

### OpenRouter key lifecycle and secret boundary
- `packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:9-12` defines the tenant key policy from `OPENROUTER_KEY_LIMIT_USD` and `OPENROUTER_KEY_EXPIRE_DAYS`, defaulting to `$10` and `90` days.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:46-63` creates a scoped OpenRouter key through the management API and returns both plaintext `apiKey` and metadata `hash`, `limitUsd`, and `expiresAt`.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1570-1617` assigns a pool tenant and creates a tenant-named OpenRouter key (`hermes-${tenantId}`); failures revert the pool slot before rethrowing.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1618-1636` persists encrypted tenant secrets separately from OpenRouter metadata, then stores `openrouter_key_hash`, `openrouter_limit_usd`, and `openrouter_expires_at` on the tenant.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:65-83` and `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1655-1661` carry the plaintext OpenRouter key only into the sidecar provision body as `openrouterApiKey`.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:150-180` validates `openrouterApiKey` during `/provision` and writes it to tenant `.env` as `OPENROUTER_API_KEY`.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:186-209` also places `OPENROUTER_API_KEY` into process env and the spawned tenant boot process.

### OpenRouter budget inspection and top-up
- `packages/edge-city/agentvillage-controlplane/control-plane/src/index.js:147-150` parses `GET /tenants/:id?detail=1`, and `packages/edge-city/agentvillage-controlplane/control-plane/src/index.js:336-343` dispatches detail requests to `getTenantDetail()`.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:275-285` loads tenant and deployment state by full tenant UUID, including `openrouter_key_hash`, `openrouter_limit_usd`, `openrouter_expires_at`, `private_host`, `admin_token`, and `api_server_key`.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1157-1167` initializes `tenant.openrouter` from DB-backed `limitUsd` and `expiresAt`.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1170-1179` enriches live tenants with `usageUsd`, `limitRemainingUsd`, and `disabled` from `getKey(row.openrouter_key_hash)`, suppressing lookup failures so those live metadata fields are absent rather than fabricated.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:76-84` reads or patches a scoped key by hash through the OpenRouter management API.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/index.js:165-168` and `packages/edge-city/agentvillage-controlplane/control-plane/src/index.js:398-400` expose `POST /tenants/:id/openrouter/topup`.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1692-1712` validates positive `amountUsd`, reads the existing key, patches its limit to `before.limit + amount`, updates only `openrouter_limit_usd`, and returns `limitUsd`, `usageUsd`, `limitRemainingUsd`, and `disabled`.
- The top-up path does not rotate keys, expose plaintext OpenRouter keys, call `/provision`, or restart/redeploy the tenant (`packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1692-1712`).

### Hosted Hermes provider configuration
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:199-201` defaults generated Hermes config to provider `openrouter` and model `google/gemini-3.5-flash` unless `HERMES_PROVIDER` or `HERMES_MODEL` override them.
- `packages/edge-city/agentvillage-controlplane/control-plane/.env.example:15-16` documents those same hosted defaults.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:213-237` emits model, Telegram, dashboard analytics, and Index MCP config into `config.yaml`.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:178-195` writes `OPENROUTER_API_KEY` and `config.yaml` during provisioning.
- This supports the runbook’s participant guidance: hosted Hermes is OpenRouter-first in this path, and connecting Hermes to a Claude account through the dashboard is not an expected provider-limit workaround.

### Dashboard proxy authentication and error classification
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:87-99` resolves full tenant UUIDs directly and 8-character short IDs by querying live tenants with deployments; ambiguous or missing short IDs fail resolution.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:110-122` extracts tenant identity from the path prefix first and then from the tenant cookie.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:59-70` extracts tokens in priority order: bearer header, `?token=`, then dashboard token cookie.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:178-186` looks up a live deployment with `private_host` and `api_server_key`.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:189-202` authorizes by tenant API server key first, then EdgeOS bearer token validation.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:142-174` validates EdgeOS tokens against `${EDGEOS_API_BASE}/humans/me`, returning `unauthorized` for 401/403 and `edgeos_lookup_failed:*` for service failures.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:301-310` returns `tenant_not_found` before auth if no tenant resolves, then `missing_token` if no token source exists.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:317-320` propagates authorization errors while clearing stale cookies on cookie-backed 401s.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:323-330` exchanges successful query-token links for cookies, then proxies to the private dashboard; private dashboard connection failures become `dashboard_unreachable:*`.

### Workspace health signals
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:559-573` builds tenant detail from DB state, formatted tenant health, optional dashboard token, and dashboard-derived stats.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1121-1138` initializes `sidecarReady`/`gatewayReady`, calls sidecar `/status` only for live tenants with `private_host` and `admin_token`, treats `provisioned: true` as `sidecarReady`, and treats missing `gatewayReady` as ready for backward compatibility.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:23-37` computes provisioned state from a marker or existing config plus a real tenant secret.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:39-51` computes `gatewayReady` by scanning processes for `gateway run`, so it does not prove the dashboard is reachable.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:136-137` reports `/status` as `{ ok, provisioned, gatewayReady }`.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/boot/start-tenant.sh:31-41` prepares the Hermes home, backgrounds `hermes dashboard` on port `9119`, then execs `hermes gateway run` in the foreground.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:507-510` fetches dashboard sessions and cron jobs from `private_host:9119`, but detail stats degrade to empty results when these calls fail.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:611-620` and `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:624-633` explicitly return `dashboard_unreachable` from Kanban/digest helpers when dashboard calls fail.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:263-269` and `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:327-330` show actual user workspace access depends on reaching `private_host:9119` after tenant and token authorization.

### Runbook grounding
- `packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md:1` adds the operator runbook.
- `packages/edge-city/agentvillage-controlplane/README.md:7` links the runbook, and `packages/edge-city/agentvillage-controlplane/README.md:60` documents `POST /tenants/:id/openrouter/topup`.
- `packages/edge-city/agentvillage-controlplane/docs/QUICKSTART.md:85` routes OpenRouter rate-limit and dashboard/workspace inaccessible reports to the runbook.
- `packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md:14-20` requires control-plane bearer auth and warns against exposing plaintext OpenRouter keys, Telegram tokens, Index API keys, EdgeOS bearer tokens, or tenant API server keys.
- `packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md:33-62` identifies tenants by full UUID directly or by listing/filtering for email, Telegram bot username, or short ID.
- `packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md:70-99` names the required OpenRouter fields and maps missing live metadata to management-key/queryability investigation.
- `packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md:106-124` documents top-up and the expected response fields.
- `packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md:145-150` maps dashboard proxy errors to operator actions.
- `packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md:158-163` gives a participant reply template that avoids unsupported Claude-account workaround guidance.

## Code References
- `packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:9-12` — Default scoped OpenRouter key policy.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:46-63` — Create a tenant-scoped OpenRouter key and return plaintext plus metadata.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:76-84` — Read/update OpenRouter keys by hash.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:65-83` — Build tenant sidecar provision body, including `openrouterApiKey`.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:199-237` — Generate hosted Hermes config with OpenRouter defaults.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:275-285` — Load tenant detail by full UUID with OpenRouter/deployment fields.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:559-573` — Assemble tenant detail and dashboard stats.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1121-1180` — Format tenant status, sidecar/gateway health, and OpenRouter budget metadata.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1570-1669` — Assign a pool tenant, create/store OpenRouter metadata, and provision the sidecar.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1692-1712` — Top up a tenant OpenRouter key in place.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/index.js:147-168` — Route matching for tenant detail and OpenRouter top-up.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/index.js:336-343` — Tenant detail handler dispatch.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/index.js:398-400` — Top-up handler dispatch.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:136-180` — Sidecar status and provision-time secret validation/env writing.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:186-209` — Runtime env propagation for `OPENROUTER_API_KEY`.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/boot/start-tenant.sh:31-41` — Dashboard/gateway startup sequence.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:59-70` — Token extraction from header, query, or cookie.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:87-122` — Full UUID/short ID tenant resolution and cookie fallback.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:142-174` — EdgeOS bearer-token validation and error mapping.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:178-202` — Live deployment lookup and API-key/EdgeOS authorization.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:231-247` — Query-token cleanup and cookie exchange.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:301-330` — Request handler error classification and private dashboard proxying.
- `packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md:1-176` — Operator runbook.
- `packages/edge-city/agentvillage-controlplane/README.md:7-60` — Runbook link and top-up API summary.
- `packages/edge-city/agentvillage-controlplane/docs/QUICKSTART.md:85` — Troubleshooting pointer.

## Integration Points

### Inbound References
- `packages/edge-city/agentvillage-controlplane/control-plane/src/index.js:336-343` — Operator `GET /tenants/:id?detail=1` calls `getTenantDetail()`.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/index.js:398-400` — Operator top-up route calls `topupTenantOpenrouter()`.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:295-330` — End-user/operator dashboard requests flow through tenant resolution, token authorization, redirect/cookie exchange, and private dashboard proxying.
- `packages/edge-city/agentvillage-controlplane/docs/QUICKSTART.md:85` — Troubleshooting docs direct rate-limit/workspace reports to the runbook.
- `packages/edge-city/agentvillage-controlplane/README.md:7` — Package README exposes the runbook entry point.

### Outbound Dependencies
- `packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:22-29` — OpenRouter management API calls require `OPENROUTER_MANAGEMENT_KEY`.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1127-1132` — Tenant detail depends on sidecar `/status` over Railway private networking.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1170-1175` — Tenant budget inspection depends on querying OpenRouter key metadata by hash.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:507-510` — Dashboard-derived stats depend on Hermes dashboard APIs.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:147-152` — End-user bearer tokens are validated through EdgeOS `/humans/me`.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:263-269` — Dashboard proxy depends on `private_host:9119`.

### Infrastructure Wiring
- `packages/edge-city/agentvillage-controlplane/control-plane/.env.example:15-16` — Hosted Hermes provider/model defaults are OpenRouter-oriented.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/index.js:201-217` — Non-public control-plane routes require the control-plane API key.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/auth.js:1-14` — Control-plane auth extracts bearer token and compares it to `CONTROL_PLANE_API_KEY`.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:178-195` — Sidecar writes tenant `.env` and `config.yaml` during provisioning.
- `packages/edge-city/agentvillage-controlplane/control-plane/container/boot/start-tenant.sh:37-41` — Dashboard and gateway are separate processes, affecting workspace health interpretation.
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:9-10` — Dashboard proxy cookie names are configurable.

## Architecture Insights
- OpenRouter provider budget and dashboard/workspace access are intentionally separate operational axes. Top-up changes OpenRouter key limits; dashboard accessibility depends on tenant resolution, token validity, and private dashboard reachability.
- The safest operator-facing surface is metadata-only: `openrouter_key_hash`, `limitUsd`, `expiresAt`, `usageUsd`, `limitRemainingUsd`, and `disabled`; plaintext keys should remain confined to provision-time runtime injection.
- The existing top-up route is low-risk for incident response because it patches the same OpenRouter key in place and avoids historically fragile sidecar/tenant restart paths.
- Dashboard proxy error categories are already precise enough for runbook triage; collapsing them into “login failed” would lose the distinction between fresh-link, token, tenant lookup, EdgeOS health, and tenant dashboard health actions.
- `sidecarReady` and `gatewayReady` are useful but partial signals. `gatewayReady` is process-based and does not prove the dashboard port is serving; `dashboard_unreachable` is closer to actual workspace accessibility.
- Control-plane detail/top-up require full UUIDs. Short IDs are a dashboard-proxy URL affordance; for docs-first triage, operators can list/filter to resolve a short ID to a UUID.

## Precedents & Lessons
5 similar past changes analyzed.

### Precedent: Tenant OpenRouter top-up endpoint
**Commit(s)**: `7ffe424eca37a258fdfef40052f0c7b8a1d7efaa` — "Add tenant OpenRouter top-up endpoint" (2026-06-08)
**Blast radius**: 3 files across 2 layers
  control-plane/src/index.js — route wiring
  control-plane/src/openrouter.js — OpenRouter limit support
  control-plane/src/tenants.js — tenant top-up/status response

**Follow-up fixes**:
- None found in submodule history after 2026-06-08.

**Lessons from docs**:
- `.rpiv/artifacts/discover/2026-06-10_13-24-25_agentvillage-openrouter-workspace-triage.md` — top-up should stay operator-controlled and expose usage/limit/disabled metadata without leaking plaintext keys.

**Takeaway**: Reuse the existing top-up/status shape as an operator runbook surface rather than automating recovery.

### Precedent: Dashboard/workspace access via dashboard proxy
**Commit(s)**: `1f575aa1d7a50d6511ae057d445efbe981c84734` — "Add dashboard-proxy service and CI/bootstrap" (2026-05-25)
**Blast radius**: 10 files across 4 layers
  dashboard-proxy/ — proxy/auth service and package/deploy files
  .github/workflows/ and scripts/ — deployment/bootstrap
  control-plane/.env.example and docs/RAILWAY.md — config/docs

**Follow-up fixes**:
- `e66e567742fe969dc518d16f5dbd0f7264fad130` — "Fix tenant prefix detection in proxyPath" (2026-05-28) — proxy path parsing misidentified tenant prefixes.
- `b54435744d2d4bf553ad870afdb058e4908dcc1f` — "Always remove token query param from URL" (2026-06-04) — token cleanup was needed to avoid token exposure in URLs.

**Lessons from docs**:
- `.rpiv/artifacts/discover/2026-06-10_13-24-25_agentvillage-openrouter-workspace-triage.md` — workspace failures should preserve `missing_token`, `unauthorized`, `tenant_not_found`, and `dashboard_unreachable` categories.

**Takeaway**: Preserve exact dashboard-proxy error categories and treat URL parsing/token cleanup as sensitive.

### Precedent: Tenant dashboard endpoints and Hermes helper
**Commit(s)**: `3ef8623f4164253e782e3948ae432465eb553787` — "Add tenant dashboard endpoints and hermes helper" (2026-05-29)
**Blast radius**: 4 files across 2 layers
  control-plane/src/hermes.js — Hermes dashboard helper
  control-plane/src/index.js — dashboard endpoint routes
  control-plane/src/sidecar-runtime.js — sidecar runtime support
  control-plane/src/tenants.js — tenant dashboard access logic

**Follow-up fixes**:
- `d57dc8025e221ff26eb84a2286f133b04d76216a` — "Fix hermes path and command execution in sidecar" (2026-05-29) — Hermes path/command execution assumptions broke.
- `2d111057f560ba83a8cabace8cb0643bcd1e3c24` — "Expose tenant dashboard token and update model" (2026-06-07) — operators needed direct dashboard token/model visibility.

**Lessons from docs**:
- `.rpiv/artifacts/discover/2026-06-10_13-24-25_agentvillage-openrouter-workspace-triage.md` — a known-good dashboard access path is distinct from provider-budget diagnosis.

**Takeaway**: Dashboard triage needs both identity lookup and concrete token/access diagnostics.

### Precedent: Sidecar bootstrap/provisioning for tenants
**Commit(s)**: `5b5ebb987b6fcea9d4048faf724bf373a60f00df` — "Serve bootstrap scripts and sidecar provisioning" (2026-06-02)
**Blast radius**: 8 files across 3 layers
  control-plane/container/ — sidecar and tenant boot scripts
  control-plane/src/ — bootstrap/provisioning APIs
  Dockerfile/package files — runtime packaging

**Follow-up fixes**:
- `506f05023360b1a32a940e4e62cff676c27f1597` — "Supervise tenant gateway across restarts; gate pairing on gateway readiness" (2026-06-03) — readiness was too optimistic.
- `7cde1b4eb8d7134c4080ab18569c20489983524f` — "Gate provisioned/gateway on a real tenant secret, not just config.yaml" (2026-06-03) — config presence was not enough proof of a valid tenant.
- `5177f7849452183677dda7473c4e46ae66a13ad9` — "fix: reinstall crons during tenant updates" (2026-06-04) — updates dropped cron setup.
- `ae5b8bcf538a5223eacd9bc2cfc8427df59530e3` — "fix: restore tenant file ownership after updates" (2026-06-04) — update flow broke file ownership.

**Lessons from docs**:
- `.rpiv/artifacts/discover/2026-06-10_13-24-25_agentvillage-openrouter-workspace-triage.md` — investigate deeper workspace file/cwd issues only after proxy auth succeeds but Hermes still cannot load workspace files.

**Takeaway**: Do not infer workspace health from config files alone, and avoid tenant restarts for simple OpenRouter top-ups.

### Precedent: Initial multi-tenant Hermes control plane with OpenRouter
**Commit(s)**: `cecedd404884e2cb9b8d76f3b83a1da8161bea90` — "Add multi-tenant Hermes control plane for Railway." (2026-05-22)
**Blast radius**: 25 files across 5 layers
  README.md/docs — operator docs
  control-plane/src — OpenRouter-backed tenant control plane
  migrations/db — tenant/OpenRouter persistence
  Railway/sidecar/pairing/deploy files — provisioning and deployment

**Follow-up fixes**:
- `b14e784c47e841b0e95655d17790b11707ee4c33` — "Fix tenant provisioning for Railway Docker images." (2026-05-23) — initial provisioning did not work reliably for Railway Docker images.
- `e963a6b4fc8de1b0491fc486d8fd572bbd2edc3b` — "Force redeploy after tenant start command is set." (2026-05-23) — tenant start command changes needed redeploy.
- `0affdedb1567d820ba69aa540e97126823ce7b74` — "Fix admin tenant list flakiness and duplicate signups." (2026-06-03) — tenant admin/listing/signup paths were flaky.

**Lessons from docs**:
- `.rpiv/artifacts/discover/2026-06-10_13-24-25_agentvillage-openrouter-workspace-triage.md` — hosted AgentVillage/Hermes is OpenRouter-first for this workaround.

**Takeaway**: Keep provider fallback as a separate design scope.

### Composite Lessons
- Separate provider-budget triage from workspace/dashboard access triage; they fail differently and require different operator actions.
- Preserve concrete dashboard-proxy errors instead of using generic login-failure messaging.
- Avoid exposing secrets in docs, logs, and support replies; use metadata-only inspection and top-up.
- Avoid tenant restart/reprovision for simple OpenRouter top-ups because sidecar/provisioning changes have historically caused readiness, cron, and ownership regressions.
- Treat hosted Hermes as OpenRouter-first unless a separate provider-fallback design is opened.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-06-10_13-24-25_agentvillage-openrouter-workspace-triage.md` — FRD for this AgentVillage OpenRouter/workspace triage task.

## Developer Context
**Q (discover: Foundational intent): For this AgentVillage bug report, what problem are we solving and who is blocked by it?**
A: Incident triage.

**Q (discover: Hosted provider framing): From the probe I inferred that hosted AgentVillage/Hermes should be treated as OpenRouter-first for this triage: config defaults to `openrouter`, provisioning requires an `openrouterApiKey`, and no Claude fallback is wired here (`packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:200`, `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:170`). Keep that framing?**
A: Keep OpenRouter frame.

**Q (discover: Rate-limit workaround path): From the probe I inferred that the immediate rate-limit workaround is operational top-up/usage inspection of the scoped OpenRouter key, because tenant keys default to a dollar limit and there is a top-up API (`packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:11`, `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1692`). Keep that as the likely workaround requirement?**
A: Keep top-up path.

**Q (discover: Workspace access focus): From the probe I inferred that “workspace isn’t accessible” likely needs dashboard/proxy auth triage first: missing token returns `missing_token`, bad auth returns 401, and unreachable dashboard returns `dashboard_unreachable` (`packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:310`, `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:330`). Keep that as an acceptance focus?**
A: Keep proxy triage.

**Q (discover: Scope): What should this discovery scope produce for the AgentVillage bug report?**
A: Triage + workaround.

**Q (discover: Required triage information): For the triage/workaround scope, what information must the operator be able to check before replying to the user?**
A: Usage + access.

**Q (discover: Explicit non-goal): Which related fixes should be explicitly out of scope for this FRD?**
A: No provider fallback.

**Q (discover: First implementation shape): Where should the workaround live first: low-risk operator procedure or productized diagnostics?**
A: Operator runbook.

**Q (discover: Success definition): What should count as success for this triage/workaround work?**
A: Actionable diagnosis.

**Q (`control-plane/src/tenants.js:275-285`, `dashboard-proxy/index.js:87-99`): Control-plane detail/top-up supports full UUID lookup while short-id resolution exists only in the dashboard proxy. Should follow-up research/design treat short-id lookup as a code gap or keep the runbook's list-and-filter workaround as sufficient?**
A: Runbook workaround is sufficient for this docs-first scope.

## Related Research
None.

## Open Questions
None.
