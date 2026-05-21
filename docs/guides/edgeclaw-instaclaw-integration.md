# EdgeClaw — InstaClaw & EdgeOS Integration Guide

For the **InstaClaw** and **EdgeOS** teams — the two systems that provision Index Network accounts and agents on behalf of Edge City attendees. End users do not call this API directly.

For the full request/response contract, see `docs/specs/api-reference.md` (`POST /api/networks/:id/signup`). This guide is the operational walkthrough.

---

## Prerequisites

- The Edge City **experiment network ID**, shared out of band.
- The network's **master API key**, issued once when the network was created in the Index dashboard. Cannot be re-shown — store securely.
- A Bun runtime if you want to run the bundled EdgeClaw installer (`packages/edgeclaw/install/install.ts`). Node ≥ 20 works if you swap the shebang.

---

## One signup call covers everything

```
POST https://protocol.index.network/api/networks/<NETWORK_ID>/signup
Content-Type: application/json
x-api-key: <masterKey>
```

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
| `socials` | no | 32 entries | Open-vocabulary labels (`telegram`, `twitter`, `farcaster`, …). Upserted by label. Each `label` 64 chars, each `value` 256 chars. |

**Response** (`201` if newly created, `200` if existing):

```json
{
  "user":   { "id": "<uuid>", "email": "attendee@example.com" },
  "apiKey": "ix_...",
  "mcpServer": {
    "name":    "index",
    "url":     "https://protocol.index.network/mcp",
    "headers": { "x-api-key": "ix_..." }
  }
}
```

The response contains everything needed to configure the attendee's runtime — no follow-up calls.

### Idempotency & key rotation

Same email always returns the same user. **A fresh API key is issued on every call**; the previous key for this user+network pair is revoked. Always store the key from the latest call and discard prior ones. If you retry before delivering the key to the attendee, the retried key supersedes the earlier one.

The underlying scoped agent is reused across calls — no orphan agents accumulate.

### Errors

| Code | Reason |
|---|---|
| `400` | Missing or invalid email; oversized field; malformed `socials` array. |
| `401` | Missing `x-api-key` header. |
| `403` | Master key invalid; network is not an experiment network; network deleted. |
| `500` | Internal error — retry with backoff. |

### Idempotent re-check (without rotating the key)

Calling `/signup` for an email that has already been provisioned **rotates that user's API key** (the previously-deployed key stops authenticating). If you need to verify a user is provisioned without disturbing them — retry logic, status dashboards, health probes — call `/signup/lookup` instead:

```bash
curl -X POST https://protocol.index.network/api/networks/<NETWORK_ID>/signup/lookup \
  -H 'x-api-key: <MASTER_KEY>' \
  -H 'content-type: application/json' \
  -d '{ "email": "attendee@example.com" }'
```

- **200** — user is fully provisioned for this network. Response body is `{ "user": { "id": "...", "email": "..." } }`. No key is returned.
- **409** — user is not fully provisioned. Fall through to `/signup` to provision.

See `docs/specs/api-reference.md` (`POST /api/networks/:id/signup/lookup`) for the full contract.

---

## InstaClaw flow

InstaClaw owns the runtime, so it should run the EdgeClaw installer end-to-end:

1. Call `POST /api/networks/:id/signup` with the attendee's email (and any profile fields you have).
2. Run the EdgeClaw installer with the returned `apiKey`:
   ```bash
   bun packages/edgeclaw/install/install.ts <apiKey>
   ```
   Or the equivalent in the hosted runtime — the script:
   - Writes the `mcpServer` config (the production `https://protocol.index.network/mcp` URL plus the API key) into the OpenClaw MCP servers config.
   - Disables Telegram progress-draft "tidepooling" so streaming-off is honored from the first gateway start.
   - Copies the EdgeClaw workspace bundle into `~/.openclaw/workspace/`.
   - Installs three crons: morning digest (08:00 host-local), ambient discoveries (14:00 and 20:00).
   - Restarts the gateway so the config and crons take effect.
3. As a separate step (outside this endpoint), capture the attendee's Telegram handle and bind it to their agent transport. That binding is entirely InstaClaw-owned.

After step 2 the agent is online; the welcome message is delivered by `BOOTSTRAP.md` at the end of the first onboarding turn.

---

## EdgeOS flow

EdgeOS does not run a runtime, so it hands the configuration off to the attendee:

1. Call `POST /api/networks/:id/signup` with the attendee's email and profile.
2. Display the returned `mcpServer` object to the attendee as a copyable JSON snippet. Standard MCP-compatible runtimes (Claude Code, OpenClaw, Hermes, …) accept this shape directly under their MCP servers config.
3. Optionally surface the alternate path: the attendee can clone this monorepo and run `bun packages/edgeclaw/install/install.ts <apiKey>` themselves for the full EdgeClaw experience (crons, workspace, gateway tweaks).

The attendee pastes the snippet into their agent and is online.

---

## Operational notes

- **MCP URL** is fixed at `https://protocol.index.network/mcp`. The `--dev` flag on the installer plus `INDEX_MCP_URL` env override exist for local development; production callers should never need them.
- **Re-provisioning**: hitting signup again for the same email is the correct way to rotate a key (e.g. after a leaked token). The previous key is invalidated immediately.
- **Network must be experiment type**: regular networks reject the master-key auth path. If the dashboard shows the network as standard, contact the Index team to flip the flag.

---

## Questions

Contact the Index Network team on the shared channel. Provide the network ID and master API key over a secure channel before the event.
