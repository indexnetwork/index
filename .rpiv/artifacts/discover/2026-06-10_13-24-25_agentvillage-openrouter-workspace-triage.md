---
date: 2026-06-10T13:24:25+0300
author: Yankı Ekin Yüksel
commit: 2153450f65
branch: main
repository: index
topic: "AgentVillage OpenRouter and workspace access triage"
tags: [intent, frd, agentvillage, hermes, openrouter, dashboard-proxy]
status: ready
last_updated: 2026-06-10T13:24:25+0300
last_updated_by: Yankı Ekin Yüksel
---

# FRD: AgentVillage OpenRouter and workspace access triage

## Summary
AgentVillage needs an operator-first triage and workaround path for reports where Hermes users hit OpenRouter rate limits or cannot access the workspace/dashboard. The initial goal is to diagnose whether the issue is scoped OpenRouter key exhaustion/disablement or dashboard/proxy authentication/access failure, then unblock the participant with an operational top-up or known-good access path.

## Problem & Intent
Bug report:

> Anyone running into rate limiting issues? When I try to log into open router the workspace isnt accessable - is there a good workaround? tried connecting hermes to claude account via dashboard as a workaround but no luck - any tips welcome !

Developer framing selected during discovery: **Incident triage** — mainly diagnose what is happening before deciding whether this is product work, docs, or external-provider support.

## Goals
- Enable an operator to determine whether a report is caused by OpenRouter usage/disabled state, dashboard token/auth/proxy failure, or an unsupported Claude-account workaround.
- Provide a quick, safe workaround path for affected users: inspect scoped OpenRouter key status, top up when appropriate, and give the user a known-good workspace/dashboard access path.
- Make the reply to affected participants clear that hosted Hermes is currently OpenRouter-first and that connecting Hermes to a Claude account is not an expected workaround in this code path.

## Non-Goals
- Do not design or implement Claude/Anthropic fallback, user-owned provider keys, or provider switching in this FRD.
- Do not automate top-ups, key rotation, or provider recovery without operator approval.
- Do not broaden this into full Hermes provider telemetry, tenant boot observability, or end-user self-service UX unless later research shows the runbook cannot unblock users.

## Functional Requirements
1. The operator triage path SHALL identify the affected tenant from the user report using available tenant identifiers such as tenant id, short id, email, Telegram bot, or dashboard URL.
2. The operator triage path SHALL expose or document how to inspect the tenant OpenRouter key's usage, remaining limit, disabled state, configured limit, and expiry.
3. The operator triage path SHALL expose or document the existing top-up operation for a scoped tenant OpenRouter key and the expected response fields after top-up.
4. The operator triage path SHALL distinguish OpenRouter exhaustion/disablement from dashboard/workspace access failures.
5. The operator triage path SHALL map dashboard/proxy access failures to concrete categories, including missing token, unauthorized token, unknown tenant, and unreachable dashboard.
6. The operator response guidance SHALL explicitly state that hosted AgentVillage/Hermes currently uses the OpenRouter path and that attempting to connect Hermes to a Claude account through the dashboard is not a supported workaround.

## Non-Functional Requirements
- **Performance**: No specific runtime constraint; the triage path should be fast enough for live support, ideally requiring only existing control-plane/dashboard checks and no tenant restart when only top-up is needed.
- **Security**: Do not expose plaintext OpenRouter keys, Telegram tokens, Index API keys, EdgeOS bearer tokens, or tenant secrets in docs, logs, or support replies. Top-up remains operator-controlled.
- **UX / Accessibility**: The operator-facing instructions should produce a plain-language participant reply that separates “rate limit/provider budget” from “workspace/dashboard access” so users do not try unsupported Claude-account workarounds.
- **Reliability**: The workaround should rely on existing persisted tenant metadata and the current top-up path; if dashboard access fails, the error category should be preserved rather than collapsed into a generic login failure.

## Constraints & Assumptions
- Hosted Hermes config defaults to `provider: openrouter` and `google/gemini-3.5-flash` unless global environment overrides are set (`packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:200`).
- Tenant provisioning currently requires an `openrouterApiKey` and writes `OPENROUTER_API_KEY` into the tenant environment (`packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:170`, `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:180`).
- Scoped OpenRouter tenant keys default to a dollar limit and expiry controlled by environment variables, defaulting to `$10` and `90` days (`packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:11`).
- Existing tenant top-up extends the same OpenRouter key limit and returns usage/remaining/disabled metadata (`packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1692`).
- Dashboard/workspace access is assumed to flow through the dashboard proxy first; missing token and unreachable dashboard are already represented as concrete errors (`packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:310`, `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:330`).

## Acceptance Criteria
- [ ] An operator runbook or equivalent operator-facing surface exists with a step titled “Identify tenant” that names the accepted inputs: tenant id/short id, email, Telegram bot username, or dashboard URL.
- [ ] The runbook or operator surface includes a step to inspect OpenRouter `usageUsd`, `limitRemainingUsd`, `disabled`, `limitUsd`, and expiry for the tenant; the expected output names those fields exactly.
- [ ] The runbook or operator surface includes a top-up step using the existing tenant OpenRouter top-up operation and states that a successful response includes updated `limitUsd`, `usageUsd`, `limitRemainingUsd`, and `disabled`.
- [ ] The runbook or operator surface includes a dashboard access error table with at least `missing_token`, `unauthorized`, `tenant_not_found`, and `dashboard_unreachable`, plus the operator action for each.
- [ ] The participant reply template says that Claude-account connection through the Hermes dashboard is not currently a supported workaround for hosted AgentVillage/Hermes provider limits.
- [ ] A reviewer can follow the runbook against a test tenant and produce one of these diagnoses: “OpenRouter exhausted/disabled”, “dashboard auth/access issue”, “tenant not found”, “dashboard unreachable”, or “needs deeper investigation”.

## Recommended Approach
Start with an operator runbook grounded in the existing AgentVillage control-plane and dashboard-proxy surfaces: tenant lookup, OpenRouter usage/disabled inspection, existing top-up operation, and dashboard access error classification. Downstream research should verify whether these surfaces are already exposed well enough for operators or whether a small operator-facing diagnostic endpoint/view is required.

## Decisions

### Foundational intent
**Question**: For this AgentVillage bug report, what problem are we solving and who is blocked by it?
**Recommended**: n/a — `intent` question
**Chosen**: Incident triage
**Rationale**: The developer chose to diagnose what is happening before deciding whether this is product work, docs, or external-provider support.

### Hosted provider framing
**Question**: From the probe I inferred that hosted AgentVillage/Hermes should be treated as OpenRouter-first for this triage: config defaults to `openrouter`, provisioning requires an `openrouterApiKey`, and no Claude fallback is wired here (`packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:200`, `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:170`). Keep that framing?
**Recommended**: Keep OpenRouter frame
**Chosen**: Keep OpenRouter frame
**Rationale**: evidence: `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:200` + `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:170` + confirmed.

### Rate-limit workaround path
**Question**: From the probe I inferred that the immediate rate-limit workaround is operational top-up/usage inspection of the scoped OpenRouter key, because tenant keys default to a dollar limit and there is a top-up API (`packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:11`, `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1692`). Keep that as the likely workaround requirement?
**Recommended**: Keep top-up path
**Chosen**: Keep top-up path
**Rationale**: evidence: `packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js:11` + `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:1692` + confirmed.

### Workspace access focus
**Question**: From the probe I inferred that “workspace isn’t accessible” likely needs dashboard/proxy auth triage first: missing token returns `missing_token`, bad auth returns 401, and unreachable dashboard returns `dashboard_unreachable` (`packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:310`, `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:330`). Keep that as an acceptance focus?
**Recommended**: Keep proxy triage
**Chosen**: Keep proxy triage
**Rationale**: evidence: `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:310` + `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js:330` + confirmed.

### Scope
**Question**: What should this discovery scope produce for the AgentVillage bug report?
**Recommended**: Triage + workaround
**Chosen**: Triage + workaround
**Rationale**: This optimizes for unblocking affected users quickly while leaving provider fallback as a later follow-up.

### Required triage information
**Question**: For the triage/workaround scope, what information must the operator be able to check before replying to the user?
**Recommended**: Usage + access
**Chosen**: Usage + access
**Rationale**: The report combines OpenRouter rate limits and workspace accessibility, so the operator needs both OpenRouter status and dashboard/proxy error classification.

### Explicit non-goal
**Question**: Which related fixes should be explicitly out of scope for this FRD?
**Recommended**: No provider fallback
**Chosen**: No provider fallback
**Rationale**: Current hosted provisioning requires OpenRouter; fallback provider design is deeper architecture and secret-management scope than the incident workaround.

### First implementation shape
**Question**: Where should the workaround live first: low-risk operator procedure or productized diagnostics?
**Recommended**: Operator runbook
**Chosen**: Operator runbook
**Rationale**: This optimizes speed and safety by using existing control-plane surfaces before adding new end-user or automated recovery behavior.

### Success definition
**Question**: What should count as success for this triage/workaround work?
**Recommended**: Actionable diagnosis
**Chosen**: Actionable diagnosis
**Rationale**: The desired outcome is that an operator can identify the failure class, top up if needed, and reply with a known-good access path.

## Open Questions
None.

## Suggested Follow-ups
- Design Claude/Anthropic fallback, user-owned provider keys, or provider switching for hosted Hermes if OpenRouter-only operation remains a recurring incident; current provisioning requires OpenRouter (`packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js:170`).
- Consider productized admin diagnostics or end-user self-service messaging if the operator runbook still leaves repeated support load.
- Investigate deeper Hermes workspace file/cwd installation only if dashboard/proxy triage shows users are authenticated but Hermes still cannot load `AGENTS.md` or skills.

## References
- User-provided AgentVillage bug report in chat.
- `packages/edge-city/agentvillage-controlplane/control-plane/src/openrouter.js`
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js`
- `packages/edge-city/agentvillage-controlplane/control-plane/container/sidecar.js`
- `packages/edge-city/agentvillage-controlplane/dashboard-proxy/index.js`
