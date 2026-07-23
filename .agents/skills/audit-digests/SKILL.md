---
name: audit-digests
description: "Fetch daily digest cards from the agentvillage control-plane and audit them: verify each opportunity belongs to the receiving tenant (ownership / cross-user leaks) AND check overall card quality — broken links, hallucinated content, grammatical/template errors, out-of-order calendar events, and draft-vs-pending status gating. Use when the user asks to audit digests, verify digest ownership, check for cross-user leaks, or asks whether digest cards have problems (bad links, hallucinations, grammar, wrong opportunities)."
---

# Audit Daily Digest Opportunity Ownership

Use this workflow to verify that opportunities embedded in agentvillage daily digest kanban cards actually belong to the tenants (residents) who will receive them.

## Prerequisites

- Railway MCP connected (for control-plane access if API key is unknown)
- Access to the control-plane API (key stored in Railway env vars for the `control-plane` service in the `agentvillage-controlplane` project)
- Access to the Index Network production Neon database (connection string in Railway env vars for the `protocol` service in the `Index` project)

> **Railway MCP gotcha (read before fetching vars):** `railway_list_variables` may fail with `Failed to resolve environment: "<id>" not found` because it carries a stale/cached `environment_id` (e.g. the `Index` project's env id leaking into an `agentvillage-controlplane` call). Fix: call `railway_list_services` with the target project's **own** `environment_id` (the error message lists the valid ones — `agentvillage-controlplane` production is `e4e4b158-...`), then pass both `project_id` + `environment_id` + `service_id` explicitly to `railway_list_variables`. The control-plane key is `CONTROL_PLANE_API_KEY` on the `control-plane` service; the prod DB is `DATABASE_URL` on the `Index/protocol` service.

## Workflow

### Phase 1: Fetch digest cards from the control-plane

1. **Get the control-plane API key** from Railway environment variables:
   - Project: `agentvillage-controlplane` (Railway)
   - Service: `control-plane`
   - Environment: `production`
   - Variable: `CONTROL_PLANE_API_KEY`

2. **Fetch all tenant kanban boards:**
   ```bash
   curl -s -m 120 \
     -H "Authorization: Bearer <CONTROL_PLANE_API_KEY>" \
     "https://control-plane-production-b752.up.railway.app/tenants/kanbans" \
     -o /tmp/kanbans.json
   ```
   This returns all tenants with their kanban tasks. Expect ~2 MB for ~150 tenants.

3. **Extract today's digest cards with opportunity references:**
   Parse the JSON for tasks matching `Morning digest — <YYYY-MM-DD>` in their title. Opportunities are embedded as HTML comments:
   ```
   <!-- digest-opportunity:id=<uuid> -->
   ```
   And "Say hi" links:
   ```
   https://protocol.index.network/c/<code>
   ```
   Save extracted `{email, tenantId, oppIds[], codes[]}` pairs to `/tmp/digest-opps.json`.

### Phase 2: Query the Index Network production database

4. **Get the Neon database URL** from Railway environment variables:
   - Project: `Index` (Railway)
   - Service: `protocol`
   - Variable: `DATABASE_URL`

5. **Look up tenant emails in the `users` table:**
   ```sql
   SELECT id, lower(email) AS email FROM users
   WHERE lower(email) IN (<tenant-emails>);
   ```
   Save to `/tmp/users.tsv`.

6. **Look up opportunities with flattened actor user IDs:**
   ```sql
   SELECT id, status, created_at,
     (SELECT json_agg(a->>'userId') FROM jsonb_array_elements(actors) a) AS actor_user_ids
   FROM opportunities
   WHERE id IN (<opportunity-ids>);
   ```
   Save to `/tmp/opps.tsv`.

7. **Look up connect links to verify link ownership:**
   ```sql
   SELECT cl.code, cl.user_id, u.email, cl.opportunity_id, cl.created_at
   FROM connect_links cl
   JOIN users u ON u.id = cl.user_id
   WHERE cl.code IN (<codes>);
   ```
   Save to `/tmp/links.tsv`.

### Phase 3: Cross-reference and verify ownership

8. **For each digest card, check:**
   - Does the tenant's user ID (from email lookup) appear in the opportunity's `actors[].userId`?
   - Does the connect link's `user_id` match the tenant's user ID?
   - If both match → ✅ OK
   - If the connect link user matches an actor but NOT the tenant → ⚠️ MISMATCH (content was generated for a different user)

9. **Classify results:**
   - **OK**: Recipient is an actor on the opportunity AND the connect link belongs to them
   - **MISMATCH**: Opportunity/link were generated for a different user
   - **MISSING**: Opportunity ID not found in the database

### Phase 4: Multi-day drift analysis (optional, for investigating patterns)

10. **For deeper investigation**, repeat the connect link lookup across ALL digest dates (not just today). Check whether the identity (connect_link.user_id) for a given tenant's board is:
    - **Self-consistent**: Always the tenant's own user
    - **Stably wrong**: Always a different fixed user (suggests static misconfiguration)
    - **Varies daily**: Different wrong user each day (suggests runtime identity mixing)

### Phase 4b: Card-quality checks (grammar, broken links, hallucination, ordering)

Ownership is only one failure mode. To answer "are there *any* problems in the cards?", run these over **all** of today's card bodies (parse `tasks[].body` from the kanban JSON; opportunities are in `<!-- digest-opportunity:id=... -->`, questions in `<!-- digest-question:id=... -->`):

1. **Link health.** Extract every URL. Categorize by host (typically `protocol.index.network/c/<code>` connect links, `index.network/u/<uuid>` profile links, the Edge City schedule host, Luma). Then:
   - Connect links: confirm each `code` exists in `connect_links` and HTTP `302`-redirects (curl `-o /dev/null -w "%{http_code} -> %{redirect_url}"`); flag any expired (`expires_at < now`).
   - Profile links: extract the `/u/<uuid>` UUIDs and confirm **every one is a real `users.id`** — a missing user means a hallucinated/dangling person reference.
   - Sample the event/external links for non-200 / malformed URLs.
2. **Template & grammar scan.** Regex every body for leak/placeholder tells: `\{[a-z_]+\}`, `\{\{`, `\[(NAME|TODO|TBD)\]`, literal `undefined`/`null`/`NaN`, no-reply/silent markers, unfilled markdown links `](\s*)`, and JSON-ish `"key":` leakage. Zero hits = clean; any hit names the offending tenant.
3. **Hallucination / rationale fidelity.** For a sample of digest opportunities, compare the card's "… because …" sentence against the stored `opportunities.interpretation->>'reasoning'`. The card text should paraphrase the stored reasoning, not invent new claims about the person.
4. **Chronological event ordering.** Parse the `- H:MM AM/PM —` event lines per card and check they are non-decreasing in time. A known bug: the digest appends a personalized event to the end of the calendar **without re-sorting**, so the last item (or a couple) lands out of order. Report the share of multi-event cards affected and the dominant out-of-order event title.
5. **Status gating.** Pull `status` for every digest opportunity. Note the pending-vs-draft split — surfacing `draft` (pre-`pending`) opportunities may be unintended; raise it as a delivery-policy question even though ownership can still be correct.

Classify each dimension as clean ✅ or list concrete offenders. Bundle parsing into a small Bun script over `/tmp/kanbans.json` rather than hand-grepping 150+ cards.

### Phase 5: Report

11. **Produce a summary** with:
    - Total tenants / digests today / digests with opportunities
    - OK count vs MISMATCH count
    - Table of mismatches: `recipient email | link issued for | opportunity status`
    - Multi-day drift pattern if analyzed
    - **Card-quality findings** (from Phase 4b): link health, template/grammar scan result, hallucination/rationale check, event-ordering bug rate, pending-vs-draft split — each marked clean ✅ or with concrete offenders
    - Suggested next steps

12. **Save the full report** to `.rpiv/artifacts/research/<date>-daily-digest-opportunity-ownership-audit.md`

## Key schema reference

### Control-plane (Railway Postgres)
- `tenants` — id, email, status
- `deployments` — tenant_id, private_host, admin_token, railway_service_id
- `secrets` — encrypted tenant secrets (indexApiKey, telegramBotToken)

### Index Network (Neon Postgres)
- `users` — id, email, name
- `opportunities` — id, actors (jsonb array of `{userId, role, ...}`), status, confidence
- `connect_links` — code (PK), user_id, opportunity_id, kind, created_at, expires_at
- `apikey` — key (SHA-256 hash), user_id, reference_id, enabled, metadata (jsonb with agentId)

### Opportunity actor model
Each opportunity has an `actors` jsonb array. Each actor has `{userId, networkId, role, ...}`. A digest opportunity is valid for a recipient if their user ID appears in the actors list. The connect link's `userId` is the intended link clicker (the recipient).

## Control-plane API reference

| Method | Path | Purpose |
|---|---|---|
| GET | `/tenants/kanbans` | List all tenants with their kanban boards |
| GET | `/tenants/:id?detail=1` | Detailed tenant info including Index connection status |
| POST | `/tenants/kanbans/archive-today` | Archive today's digest cards |
| POST | `/tenants/kanbans/generate-today` | Regenerate today's digest cards |
| POST | `/tenants/kanbans/send-ready` | Send all ready (unblocked) digest cards |
| POST | `/tenants/update-all` | Push latest code to all pods (git pull + reinstall) |

All endpoints require `Authorization: Bearer <CONTROL_PLANE_API_KEY>`.
