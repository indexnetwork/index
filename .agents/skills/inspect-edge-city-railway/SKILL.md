---
name: inspect-edge-city-railway
description: Query Railway logs, variables, services, and status for the Edge City control-plane and per-tenant Hermes sidecars via the Railway MCP. Use when debugging agentvillage card/digest generation, OpenRouter credits, or sidecar health and you need Railway data for a project OTHER than the default-linked Index project. Covers the snake_case project_id/environment_id gotcha and the known Edge City IDs.
---

# inspect-edge-city-railway

The Railway MCP is **pinned to one default linked project+environment** (the Index Network
`Index` project). Every tool silently ignores camelCase args and falls back to that default,
so cross-project calls quietly return the wrong project's data.

## The gotcha (this wastes the most time)

- Tool params are **snake_case**: `project_id`, `environment_id`, `service_id` — NOT `projectId`.
  Passing `projectId` is silently ignored → you get Index project data back.
- You must pass **both** `project_id` AND `environment_id` for a non-default project. With only
  `project_id`, the tool tries to reuse the linked env ID and fails:
  `Failed to resolve environment: Environment "<linked-id>" not found`.
- That error message **lists the project's real environments** — read it to get the right
  `environment_id`, then retry. (This is the fastest way to discover an env id.)

## Edge City control-plane IDs (agentvillage)

- workspace `Edge City` = `f4b23113-c71b-481f-83a5-c2ea3dde3b9a`
- project `agentvillage-controlplane` = `a57fc1a2-34fc-4e97-8056-4ea771ffb789`
  - environment `production` = `e4e4b158-701f-4f5a-8231-13e42ef8361f`
  - service `control-plane` = `e35802de-5319-4bc2-8f1f-3f838f934bc9`
  - service `dashboard-proxy` = `269877b6-d8a8-4139-ae28-993e53479d4c`, `Postgres` = `8b7aef42-a78e-4f4b-a262-7e018dbc53a8`
  - per-tenant sidecars = services named `hermes-<8hex>` (non-`hermes-pool-*`); pool slots are unassigned.
- Verify/refresh IDs: `railway_list_services { project_id }` (snake_case!).

## Recipes

List services / get logs / read env (always pass project_id + environment_id):

```
railway_list_services { project_id: "a57fc1a2-..." }
railway_get_logs      { project_id: "a57fc1a2-...", environment_id: "e4e4b158-...",
                        service_id: "e35802de-...", log_type: "deploy", lines: 200, search: "<tenant-id>" }
railway_list_variables{ project_id: "a57fc1a2-...", environment_id: "e4e4b158-...", service_id: "e35802de-..." }
```

## Debugging agentvillage card/digest generation

The dashboard "Generate" button only **queues** the `Edge — digest prepare` cron on the
tenant's Hermes sidecar (returns 202; never waits for the card). The card is produced by an
**OpenRouter-backed LLM session** in that sidecar. So "pressed generate, no card" usually means
the downstream sidecar run failed — not the button.

1. Get control-plane creds from its Railway vars: `CONTROL_PLANE_API_KEY`, public domain
   `RAILWAY_PUBLIC_DOMAIN` (→ `CP_URL`). Then follow the runbook
   `packages/edge-city/agentvillage-controlplane/docs/OPENROUTER_WORKSPACE_TRIAGE.md`:
   - `GET $CP_URL/tenants` → find tenant by email; confirm `status:"live"`, `sidecarReady:true`.
   - `GET $CP_URL/tenants/<id>?detail=1 | jq '.tenant.openrouter'` → check `disabled` /
     `limitRemainingUsd`. A topup raises the scoped key limit but does NOT rotate the key or
     restart the container; if `disabled:true` persists after topup, escalate (don't keep adding spend).
2. For raw failure reasons, pull the **tenant sidecar** logs: find its `hermes-<hex>` service in
   `railway_list_services`, then `railway_get_logs` it. Control-plane logs only show cron
   list/trigger warnings (`cron trigger failed for tenant <id>`), not the LLM/staging-script error.

Note: these env vars contain live secrets — never paste keys into public channels.

See also: `audit-digests` (digest card quality/ownership audit).
