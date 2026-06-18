---
name: debug-negotiation-summary-silent
description: Diagnose why the Edge/AgentVillage afternoon negotiation-summary cron "triggered but sent no Telegram message" on a tenant sidecar. Use when a user manually triggered the negotiation summary and nothing arrived. Walks the dedup-by-design check (heartbeat-state reportedCompletedIds), a non-mutating sidecar probe of the data script, and rules out OpenRouter/Telegram/index-MCP causes. The usual cause is correct anti-spam dedup, not a bug.
---

# debug-negotiation-summary-silent

The negotiation-summary cron (`Edge — negotiation summary`, ~14:00 staggered, delivered via `--deliver telegram`) is **silent by design** when there's nothing *new* to report. A user who manually re-triggers it after a previous successful run will usually get **no message** — and that is correct, not broken.

The script is `skills/index-network/scripts/summarize-negotiations.ts` (in the `Edge-City/agentvillage` submodule). It buckets negotiations into `needsAttention` (active + your turn), `waiting` (active + their turn), `newlyResolved` (completed, updated ≤7d, **not already reported**), and emits `[SILENT]` when all three are empty. Completed negotiations already announced are tracked in `memory/heartbeat-state.json` → `negotiationSummary.reportedCompletedIds`, so the same concluded thread is never re-sent.

## First: rule out the scary causes (control-plane, read-only)

Get control-plane creds from its Railway vars (`CONTROL_PLANE_API_KEY`, domain `control-plane-production-b752.up.railway.app`) — see `railway-mcp-edge-city` for the snake_case IDs. Then for the tenant (look up by email):

```bash
CP="https://control-plane-production-b752.up.railway.app"; KEY="<CONTROL_PLANE_API_KEY>"
curl -sf "$CP/tenants" -H "Authorization: Bearer $KEY" | jq -r '(.tenants//.results//.)[]|[.id,.email]|@tsv' | grep <email>
curl -sf "$CP/tenants/<tenantId>?detail=1" -H "Authorization: Bearer $KEY" | jq '{status,sidecarReady,gatewayReady,telegramUserId,approvedTelegramUsers,openrouter}'
```

Healthy tenant = `status:"live"`, `sidecarReady/gatewayReady:true`, `openrouter.disabled:false` with credit, Telegram user id present in `approvedTelegramUsers`. If those are green, it is **not** a deploy/credits/Telegram-config failure.

> Railway deploy logs for these sidecars are unreliable for this: the stream only shows gateway/process noise and is often frozen hours behind; the cron session stdout is **not** surfaced. Don't try to confirm the run from `railway_get_logs` — probe the script directly instead.

## Then: probe + reset on the sidecar (decisive)

The Railway MCP has **no exec/file tool**, and pool sidecars (`hermes-pool-<hex>`) have only an internal domain. So the user (or anyone with the Railway CLI) must shell in. Find the tenant's sidecar via `railwayServiceId` in the `?detail=1` payload.

```bash
railway ssh        # agentvillage-controlplane → production → hermes-pool-<hex>
cd /opt/data

# 1. What does the cron actually see? Throwaway state = no dedup, no mutation:
bun skills/index-network/scripts/summarize-negotiations.ts --state-file /tmp/probe.json; echo
#   [SILENT]  -> nothing to report (dedup, or index-MCP fetch failed) — data side
#   {JSON...} -> data is fine; problem is delivery or the trigger ran a DIFFERENT cron

# 2. Confirm the real dedup state:
jq '.negotiationSummary.reportedCompletedIds' memory/heartbeat-state.json

# 3. To force a re-render of an already-reported (connected) thread, clear ONLY that list:
jq '.negotiationSummary.reportedCompletedIds = []' memory/heartbeat-state.json > /tmp/h.json \
  && mv /tmp/h.json memory/heartbeat-state.json
```

Then **re-trigger** and the summary lands (verified: clearing the list re-qualifies a connected thread as `newlyResolved`). Emptying the array (vs deleting the file) preserves sibling state like the digest dedup.

## Gotchas

- **Wrong cron**: the tenant dashboard "Generate" button triggers the **morning digest**, NOT the negotiation summary. Confirm how the user triggered — if it's the dashboard, that alone explains the missing negotiation summary.
- **Timing**: the cron composes via an LLM session then delivers; allow 1–2 min before declaring it silent.
- **`[SILENT]` is success**, not an error — both an empty bucket set and an index-MCP fetch failure produce it (the script swallows fetch errors → `silent: "mcp-fetch-failed"`).
- Don't run the script against the real `memory/heartbeat-state.json` for a probe — it persists `reportedCompletedIds` and re-arms the dedup. Use a `/tmp` state file.

See also: `railway-mcp-edge-city` (sidecar IDs + the snake_case gotcha), `audit-digests` (digest card quality).
