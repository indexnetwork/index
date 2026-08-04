# Dev AASA configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable the correct Apple App Site Association app ID on the Railway dev frontend and prove it is publicly valid.

**Architecture:** This is an infrastructure-only change: Railway provides `APPLE_TEAM_ID` to the existing `apps/web/server.ts` AASA route. The variable update restarts the dev frontend; external HTTP verification and startup logs provide the acceptance evidence.

**Tech Stack:** Railway frontend service, Railway MCP, HTTPS, `curl`, `jq`.

## Global Constraints

- Change only Railway project `Index` (`5a1f986c-e0fb-4e5f-a78b-0c58ed1b0e10`), service `frontend` (`aa371189-1215-490d-a363-baf45e8128d8`), environment `dev` (`455d1280-79d1-4a8d-b2ff-0f4bbecdc9ca`).
- Set `APPLE_TEAM_ID` to exactly `LMQ3XNXLAD`.
- Do not mutate Railway `main`; its deployed revision lacks the AASA route, so production requires the later web release.
- A valid dev response must be HTTP 200, unredirected JSON whose sole app ID is `LMQ3XNXLAD.network.index.system6`.
- If deployment or validation fails, stop before any production action and inspect frontend logs.

---

### Task 1: Configure the dev frontend

**Files:**
- Modify: Railway dev `frontend` service variables (no repository file changes)

**Interfaces:**
- Consumes: Railway IDs and `APPLE_TEAM_ID` value from Global Constraints.
- Produces: A variable-triggered frontend deployment containing `APPLE_TEAM_ID=LMQ3XNXLAD`.

- [ ] **Step 1: Confirm the target service's current variables**

Call `railway_list_variables` with:

```json
{
  "project_id": "5a1f986c-e0fb-4e5f-a78b-0c58ed1b0e10",
  "environment_id": "455d1280-79d1-4a8d-b2ff-0f4bbecdc9ca",
  "service_id": "aa371189-1215-490d-a363-baf45e8128d8"
}
```

Expected: `RAILWAY_ENVIRONMENT_NAME=dev` and `RAILWAY_SERVICE_NAME=frontend`.

- [ ] **Step 2: Set the sole required variable**

Call `railway_set_variables` with:

```json
{
  "project_id": "5a1f986c-e0fb-4e5f-a78b-0c58ed1b0e10",
  "environment_id": "455d1280-79d1-4a8d-b2ff-0f4bbecdc9ca",
  "service_id": "aa371189-1215-490d-a363-baf45e8128d8",
  "variables": {"APPLE_TEAM_ID": "LMQ3XNXLAD"}
}
```

Expected: Railway accepts the update and starts a frontend deployment.

- [ ] **Step 3: Verify the exact value is present**

Repeat the `railway_list_variables` call from Step 1.

Expected: `APPLE_TEAM_ID=LMQ3XNXLAD` is returned with the dev frontend variables.

### Task 2: Verify the public AASA endpoint

**Files:**
- Modify: none

**Interfaces:**
- Consumes: successful dev frontend deployment from Task 1.
- Produces: evidence that Apple can retrieve the intended AASA document.

- [ ] **Step 1: Wait for the latest deployment to succeed**

Call `railway_list_deployments` with:

```json
{
  "project_id": "5a1f986c-e0fb-4e5f-a78b-0c58ed1b0e10",
  "environment_id": "455d1280-79d1-4a8d-b2ff-0f4bbecdc9ca",
  "service_id": "aa371189-1215-490d-a363-baf45e8128d8",
  "limit": 1
}
```

Expected: the newest deployment status is `SUCCESS`. If it is `FAILED` or `CRASHED`, retrieve frontend deploy logs and stop.

- [ ] **Step 2: Assert the public AASA transport and payload**

Run:

```bash
curl -sS -D /tmp/dev-aasa.headers https://dev.index.network/.well-known/apple-app-site-association -o /tmp/dev-aasa.json
awk 'NR == 1 || tolower($0) ~ /^content-type:/' /tmp/dev-aasa.headers
jq -e '.applinks.details[0].appIDs == ["LMQ3XNXLAD.network.index.system6"]' /tmp/dev-aasa.json
```

Expected: `HTTP/2 200`, `Content-Type: application/json`, and `true`. The command does not follow redirects, so a 3xx response fails validation.

- [ ] **Step 3: Confirm the startup warning is absent**

Call `railway_get_logs` for the same dev frontend service and deployment, requesting deployment logs.

Expected: no log line contains `APPLE_TEAM_ID is not set`; any present log confirms the released AASA behavior is not active and blocks promotion.

- [ ] **Step 4: Record production follow-up**

Keep Railway `main` unchanged until the production web release carries the AASA route. At that release, repeat Tasks 1–3 against environment `main` (`14d759e9-ce00-4c26-855c-9a0a7f15bc65`) and `https://index.network` before signing/notarization handoff testing.
