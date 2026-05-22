# InstaClaw — EdgeClaw Install Guide

This is the integration runbook for **InstaClaw**: the runtime that provisions Index Network accounts and installs EdgeClaw on behalf of Edge City attendees. End users do not call this API directly.

The flow has two steps:

1. **Signup per attendee** — call `/api/networks/:id/signup` with the master key. Get back a per-user `apiKey`.
2. **Install EdgeClaw** — clone `Edge-City/edgeclaw` and run the installer with that `apiKey`.

OpenClaw + the attendee's Telegram transport are InstaClaw-owned setup; the EdgeClaw installer just picks up whatever's already there. The installer is safe to run at any point — see the cron-binding note in Step 2 for what changes based on whether Telegram is settled yet.

We're starting on the **dev environment** (`protocol.dev.index.network`). I'll send you the dev experiment network's master key out of band.

> **Heads up on prod cutover.** Dev and production are fully separate deployments with separate user databases and API key stores. Production is **not** a URL swap — each attendee has to be re-provisioned against prod (fresh `/signup` call with the prod master key, fresh per-user `apiKey`, fresh installer run). Plan for cutover to repeat the whole flow for every attendee.

---

## Prerequisites

- **Network ID** for the Edge City experiment network — shared out of band.
- **Master API key** for that network — shared out of band over a secure channel. Server-side only; never expose in client code, logs, or attendee-visible config.
- **Bun** runtime (Node ≥ 20 also works if you swap the shebang on the installer).
- `git` available so InstaClaw can clone the EdgeClaw repo (once, cached — no need to re-clone per attendee).
- For each attendee's runtime: **OpenClaw is already installed and the Telegram bot transport is configured**. The attendee's Telegram chat session — created when they send their first message to the bot — is what the installer reads to bind cron deliveries. See Step 2 for how cron binding behaves before and after that session exists.

---

## Step 1 — Signup per attendee

```
POST https://protocol.dev.index.network/api/networks/<NETWORK_ID>/signup
Content-Type: application/json
x-api-key: <MASTER_KEY>
```

For prod, the host is `https://protocol.index.network` and the master key + network ID are different — but the request/response shape below is identical, so the integration code doesn't change.

**Body** (`email` is the only required field):

```json
{
  "email": "attendee@example.com",
  "name": "Alice Example",
  "bio": "Independent researcher on coordination problems.",
  "location": "Healdsburg, CA",
  "socials": [
    { "label": "telegram", "value": "@alice" },
    { "label": "twitter",  "value": "alice_eg" }
  ]
}
```

| Field | Required | Cap | Notes |
|---|---|---|---|
| `email` | yes | — | Lowercased + trimmed before lookup. |
| `name` | no | 200 chars | Overwrites stored name when present. |
| `bio` | no | 2000 chars | |
| `location` | no | 200 chars | |
| `socials` | no | 32 entries | Open-vocabulary labels (`telegram`, `twitter`, `farcaster`, …). Upserted by label. Each `label` ≤ 64 chars, each `value` ≤ 256 chars. |

**Response** (`201` if newly created, `200` if the user already existed):

```json
{
  "user":   { "id": "<uuid>", "email": "attendee@example.com" },
  "apiKey": "ix_...",
  "mcpServer": {
    "name":    "index",
    "url":     "https://protocol.dev.index.network/mcp",
    "headers": { "x-api-key": "ix_..." }
  }
}
```

You only need `apiKey` for the install step. The `mcpServer` block is provided for runtimes that want to wire MCP config directly without running the installer — InstaClaw can ignore it.

### Idempotency & key rotation

Same email always returns the same user. **A fresh `apiKey` is issued on every call**; the previous key for this user+network pair is revoked. Always store the key from the latest call and discard prior ones. If you retry before delivering the key, the retried key supersedes the earlier one. The underlying agent is reused across calls — no orphan agents accumulate.

### Errors

| Code | Reason |
|---|---|
| `400` | Missing or invalid email; oversized field; malformed `socials` array. |
| `401` | Missing `x-api-key` header. |
| `403` | Master key invalid; network is not an experiment network; network deleted. |
| `500` | Internal error — retry with exponential backoff. |

### Idempotent re-check (without rotating the key)

Calling `/signup` for an email that has already been provisioned **rotates that user's API key** (the previously-deployed key stops authenticating). If you need to verify a user is provisioned without disturbing them — retry logic, health checks, status dashboards — call `/signup/lookup` instead:

```bash
curl -X POST https://protocol.dev.index.network/api/networks/<NETWORK_ID>/signup/lookup \
  -H 'x-api-key: <MASTER_KEY>' \
  -H 'content-type: application/json' \
  -d '{ "email": "attendee@example.com" }'
```

- **200** — user is fully provisioned for this network. Response body is `{ "user": { "id": "...", "email": "..." } }`. No key is returned.
- **409** — user is not fully provisioned (unknown email, missing membership, missing agent, or any soft-deleted state). Fall through to `/signup` to provision.

See the full contract at `docs/specs/api-reference.md` (`POST /api/networks/:id/signup/lookup`).

---

## Step 2 — Install EdgeClaw

Clone the EdgeClaw repo (once, cache it; no need to re-clone per attendee):

```bash
git clone https://github.com/Edge-City/edgeclaw.git
cd edgeclaw
```

Run the installer with the `apiKey` from Step 1. **Pass `--dev` while we're on the dev environment** — it points the installed MCP config at `protocol.dev.index.network`:

```bash
bun install/install.ts --index-api-key <API_KEY> --dev
```

For prod, drop `--dev` (the installer then points at `protocol.index.network`). Note that the `<API_KEY>` must itself be a prod key from a prod `/signup` call — dev keys do not validate against prod.

The installer:

1. Writes `mcp.servers.index` in `~/.openclaw/openclaw.json`, pointed at the MCP URL with the attendee's `apiKey` in `x-api-key`.
2. Disables Telegram progress-draft streaming so OpenClaw doesn't spam per-tool status drafts.
3. Copies the EdgeClaw workspace bundle (prompts, soul, heartbeat, community context) into `~/.openclaw/workspace/`.
4. Copies backend skill bundles from `skills/` into `~/.openclaw/workspace/skills/`.
5. Installs one cron job by default: the morning digest (08:00 host-local). The afternoon (14:00) and evening (20:00) ambient passes are opt-in — the attendee enables them through the schedule dialog at session start.
6. Binds crons to the attendee's Telegram chat, if a session for them already exists.
7. Restarts the OpenClaw gateway so config + crons take effect.

### Cron binding and Telegram sessions

Step 6 above only succeeds if a Telegram chat session exists for the attendee at install time. That session is created automatically when the attendee sends their first message to the Telegram bot — there's no API to pre-create it.

Two valid orderings:

- **Telegram first, then install.** The attendee messages the bot before InstaClaw runs the installer. The installer finds the session and binds crons immediately. Single run.
- **Install first, then re-run.** InstaClaw runs the installer eagerly during provisioning. Everything sets up except cron binding — the installer prints a hint to re-run after the attendee messages. Once they do, InstaClaw re-runs the installer (same command, same args) and crons bind on the second pass.

Re-running the installer is safe by design — `USER.md` (the attendee's lived notes) and existing config are preserved. Pass `--wipe-user` only when you explicitly want to reset it.

After the installer finishes (and crons are bound), the agent is fully live. The welcome message is delivered automatically by EdgeClaw's onboarding ritual on the attendee's first turn.

---

## Operational notes

- **One master key, many attendees.** The same master key is used for every `/signup` call. Per-attendee `apiKey`s come back in the response.
- **No emails are sent.** The signup endpoint never emails the attendee — InstaClaw is the sole delivery channel for the key (and you don't need to surface it to the attendee at all, since you run the installer for them).
- **Dev → prod cutover is a full re-provisioning.** Dev and prod are separate deployments with separate user tables and key stores. There is no shared identity between them. Cutover means: receive the prod master key + prod network ID out of band, then for every attendee, call prod `/signup` to mint a prod `apiKey` and re-run the installer (without `--dev`) using that key. The request/response shape and installer flags are the same — only the credentials and host change, and they have to be re-issued per attendee.
- **`INDEX_MCP_URL` env override** exists for non-standard environments, but you shouldn't need it — `--dev` and the default (production) cover the two cases.

---

## Contact

Reach me on our shared channel for the network ID + dev master key, and for any questions during integration. Send a Telegram message or a chat on the shared channel — I'll respond.
