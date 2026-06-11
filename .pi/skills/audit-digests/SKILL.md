---
name: audit-digests
description: "Fetch daily digest cards from the agentvillage control-plane, extract embedded opportunity references, and verify that each opportunity actually belongs to the tenant who will receive it. Use when the user asks to audit digests, verify digest ownership, check for cross-user leaks in daily briefs, or asks 'do the digest opportunities belong to the right users?'"
---

# Audit Daily Digest Opportunity Ownership

Use this workflow to verify that opportunities embedded in agentvillage daily digest kanban cards actually belong to the tenants (residents) who will receive them.

## Prerequisites

- Railway MCP connected (for control-plane access if API key is unknown)
- Access to the control-plane API (key stored in Railway env vars for the `control-plane` service in the `agentvillage-controlplane` project)
- Access to the Index Network production Neon database (connection string in Railway env vars for the `protocol` service in the `Index` project)

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

### Phase 5: Report

11. **Produce a summary** with:
    - Total tenants / digests today / digests with opportunities
    - OK count vs MISMATCH count
    - Table of mismatches: `recipient email | link issued for | opportunity status`
    - Multi-day drift pattern if analyzed
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
