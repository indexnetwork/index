# EdgeClaw

The Agent Village experience for **Edge Esmeralda 2026** (May 30 – Jun 27, Healdsburg, CA).

EdgeClaw is the public skills package and onboarding scripts that an OpenClaw agent (whether running via InstaClaw or self-hosted) loads to participate in the Edge Esmeralda Agent Village. It's a multi-backend package: ambient discovery and intent negotiation through Index Network, knowledge graph through Geo, calendar and directory through EdgeOS. EdgeClaw defines what an agent knows, how it authenticates with each backend, and how it interacts with attendees.

## What you get

Today, capabilities come from **Index Network** (ambient discovery + intent negotiation). **Geo** (knowledge graph) and **EdgeOS** (calendar + directory) are also in scope. Once installed, EdgeClaw:

- **Runs onboarding** the first time you message it (greet → profile lookup → community discovery → first signal → `complete_onboarding` → silent capture of your platform handle).
- **Sends a morning digest at 08:00 host-local time** with the connections worth your attention and the asks where you can help.
- **Surfaces ambient discoveries twice daily at 14:00 and 20:00 host-local** — selective per pass: max 3 direct (you're a party) + 3 introducer (you'd make the intro), quality-bar gated. Anything skipped lands in tomorrow's digest.
- **Notifies you when someone accepts** a connection on your behalf.
- **Curates memory** every few days — distills daily notes into long-term `MEMORY.md`.

EdgeClaw never names the plumbing in chat. You see EdgeClaw and (when relevant) your community.

## Architecture

EdgeClaw plugs into the EdgeOS portal (the identity + spine), with InstaClaw as the recommended runtime for non-technical attendees. Backends the agent calls: Geo (knowledge graph), Index (negotiation + ambient discovery), and EdgeOS APIs (calendar, directory).

See the project hub for the full diagram and decisions.

## What's here

- `workspace/IDENTITY.md` — what an EdgeClaw agent knows about itself and the village
- `workspace/` — backend-agnostic agent core (identity, voice, community context, generic operating rules)
- `skills/` — per-backend skill bundles registered with OpenClaw via per-bundle `SKILL.md`. Mirrors `Edge-City/edgeclaw-skills` as a subtree; today this hosts:
  - `skills/index-network/` — Index Network MCP procedural knowledge (onboarding ritual, voice exemplars, cron prompts, heartbeat tasks)
  - `skills/edge-esmeralda/` — EdgeOS calendar + attendee directory + curated wiki/website/newsletter references (vendored from `Edge-City/edgeclaw-skills`; refreshed by upstream CI)
- `onboarding/` — intent-capture flow for new agents (1 to 2 questions during setup)
- `install/` — bootstrap scripts for plugging EdgeClaw into a runtime

## Getting an agent connected

Two paths:

**1. I'm new to agents.** Sign up at `edgecity.live/agentvillage` and pick "Set one up for me." InstaClaw provisions a hosted agent with EdgeClaw preinstalled. ~5 minutes.

**2. I'm self-hosting OpenClaw.** Set up a clean OpenClaw installation, then run the EdgeClaw installer from a clone of this repo.

## Integration API

The integration API is for **InstaClaw** and **EdgeOS** — the two systems that provision agents on behalf of attendees. End users do not call this directly.

### Authentication

All requests use the experiment network's **master key** as a bearer token:

```
x-api-key: <masterKey>
```

The master key is issued once when the experiment network is created in the Index Network dashboard and is never re-shown. It is **server-side only** — never expose it in the EdgeOS portal frontend, user-visible config, the public repo, or attendee-facing copy-paste.

The master key can be **rotated** from the integrations tab of the network's settings page in the Index Network dashboard. Rotation issues a new plaintext key (shown once) and emails it to every owner of the network; the previous key is invalidated immediately. Use this when the key is lost or to revoke an existing one.

### POST /api/networks/:id/signup

Provisions (or re-provisions) an attendee's Index Network account and returns an API key bound to a network-scoped agent. No email is sent — the caller is responsible for delivering the key to the attendee.

**Request**

```
POST https://protocol.index.network/api/networks/<NETWORK_ID>/signup
Content-Type: application/json
x-api-key: <masterKey>
```

**Body** (`email` is the only required field):

```json
{
  "email": "alice@example.com",
  "name": "Alice Example",
  "bio": "Independent researcher on coordination problems.",
  "location": "Healdsburg, CA",
  "socials": [
    { "label": "telegram", "value": "@alice" },
    { "label": "twitter",  "value": "alice_eg" }
  ]
}
```

| Field | Required | Max | Notes |
|---|---|---|---|
| `email` | yes | — | Lowercased + trimmed. |
| `name` | no | 200 chars | Overwrites stored name when present. |
| `bio` | no | 2000 chars | |
| `location` | no | 200 chars | |
| `socials` | no | 32 entries | Open vocabulary — any string labels (`telegram`, `twitter`, `github`, `farcaster`, …). Upserted by label. |

**Response**

```json
{
  "user":   { "id": "<uuid>", "email": "alice@example.com" },
  "apiKey": "ix_...",
  "mcpServer": {
    "name":    "index",
    "url":     "https://protocol.index.network/mcp",
    "headers": { "x-api-key": "ix_..." }
  }
}
```

HTTP `201` if the user was newly created; `200` if they already existed.

`mcpServer` is the standard MCP server config object that OpenClaw reads on startup.

**Idempotency**

Every call with the same email returns the same user but a **fresh API key** — the previous key is revoked. Store the key returned by the latest call. If the integrator retries before delivering the key to the attendee, the retried call's key supersedes the earlier one.

**Errors**

| Code | Reason |
|---|---|
| 400 | Missing or invalid email; oversized field; malformed `socials` array. |
| 401 | Missing `x-api-key` header. |
| 403 | Master key invalid; network not in experiment mode; network deleted. |

### What InstaClaw does after signup

1. Runs the EdgeClaw installer with the returned `apiKey`: `bun install/install.ts <apiKey>` (or equivalent in the hosted runtime).
2. In a follow-up step, captures the attendee's Telegram handle and binds it to their agent transport — this is entirely InstaClaw-owned and happens outside this endpoint.

### What EdgeOS does after signup

Displays the returned `mcpServer` object to the attendee as a copyable config snippet. The attendee pastes it into their agent's MCP servers config (or runs `bun install/install.ts <apiKey>` from a clone of this repo).

## Prerequisites

- [OpenClaw](https://openclaw.dev) installed and configured (`openclaw onboard --mode local` or `openclaw setup`).
- An API key for the Index protocol. Generate one on your agents page at [index.network](https://index.network) (or your community-branded node).
- [Bun](https://bun.sh) — the installer is a Bun script (Node 20+ also works if you swap the shebang).

## Install

From a clone of this repo:

```bash
bun install/install.ts <YOUR_API_KEY>
# or
API_KEY=<YOUR_API_KEY> bun install/install.ts
```

To target the dev environment (keys generated on `dev.index.network`), pass `--dev`:

```bash
bun install/install.ts <YOUR_DEV_API_KEY> --dev
```

Or override the MCP URL explicitly via `INDEX_MCP_URL=…`. Without either, the installer points at `https://protocol.index.network/mcp` (production).

The installer:

1. Writes `mcp.servers.index` in `~/.openclaw/openclaw.json`, pointed at `https://protocol.index.network/mcp` with your API key in `x-api-key`.
2. Sets `channels.telegram.streaming.mode = off` so OpenClaw doesn't dump per-tool status drafts into your chat.
3. Copies the workspace markdown bundle into `~/.openclaw/workspace/`. `USER.md` is preserved on re-install (it holds your lived notes from `BOOTSTRAP.md`); pass `--wipe-user` to overwrite `USER.md` and delete the agent-curated `MEMORY.md`, OpenClaw's `workspace-state.json` first-run marker, and the local onboarding/welcome/cron-preference markers under `memory/` so the next session re-onboards from scratch.
4. Copies backend skill bundles from `skills/` into `~/.openclaw/workspace/skills/` so OpenClaw registers them as workspace skills.
5. Installs three cron jobs: daily digest (`0 8 * * *`), ambient discovery afternoon (`0 14 * * *`), ambient discovery evening (`0 20 * * *`).
6. Restarts the gateway so all config changes take effect.

Send any message in your chat to bring EdgeClaw online. EdgeClaw has two independent onboarding gates that run at session start:

- **Index Network onboarding** — gated on the server-side `onboardingComplete` flag returned by `read_user_profiles()`. Owned by `skills/index-network/bootstrap.md`. If `false`, the six-step ritual runs (greet → create profile → capture intent → capture handle → `complete_onboarding()` → populate `USER.md` → welcome).
- **EdgeClaw onboarding** — gated on the local marker `memory/edgeclaw-state.json` (`edgeclawOnboardingCompletedAt`). Owned by `workspace/BOOTSTRAP.md`. Today's only step is the schedule-preferences dialog (which crons you want firing). It runs after the active skill bootstraps complete.

The two states are decoupled. A user can be onboarded to Index Network from another surface (CLI, web) and still need EdgeClaw's schedule dialog. Conversely, an admin resetting `onboardingComplete` server-side re-triggers only the Index ritual, not the schedule prompt. Wiping local state via `install/install.ts --wipe-user` resets the EdgeClaw side without touching Index's flag.

## Reset

To tear down EdgeClaw and start fresh (leaves Telegram token, OpenRouter key, and gateway config untouched):

```bash
bun install/reset.ts
```

Then re-install:

```bash
bun install/install.ts <YOUR_API_KEY>
```

Pass `--wipe-user` to also remove `USER.md`, `MEMORY.md`, the `.openclaw/` first-run marker, the entire `memory/` directory (including `edgeclaw-state.json`, `welcome-state.json`, and daily notes), and all agent sessions under `~/.openclaw/agents/main/sessions/` — so the next message spawns a brand new session against a freshly-bootstrapped workspace:

```bash
bun install/reset.ts --wipe-user
```

## How it runs

Time-sensitive work (the daily digest) runs as an **OpenClaw cron job**, not a heartbeat task — cron has its own scheduler and runs in isolated sessions with `--light-context` so each tick is cheap. The cron jobs are installed by `install/install.ts` and restart with the gateway.

The remaining ambient/accepted/freshness/memory work stays on the heartbeat tick because 30-minute latency is acceptable for those flows.

## Workspace layout

| File | Purpose |
| --- | --- |
| `BOOTSTRAP.md` | EdgeClaw's session-start dispatcher. Runs each active skill's `bootstrap.md` (gated on that skill's backend state) and then EdgeClaw's own onboarding step (gated on `memory/edgeclaw-state.json`). **Not** deleted at the end of onboarding — re-runs whenever the local marker is wiped. |
| `AGENTS.md` | Cross-backend operating instructions: session startup, memory, surfacing-opportunities quality bar, cron-schedule trigger, generic red lines, group-chat rules. Per-backend voice exemplars and ritual steps live in the relevant skill. |
| `SCHEDULE.md` | Cron toggle + reschedule sub-dialog. Used from `BOOTSTRAP.md` during onboarding and any time the user later asks to enable, disable, or move a cron. Operates directly on OpenClaw's cron list (`openclaw cron list/enable/disable/edit`); no separate preferences file. |
| `COMMUNITY.md` | Edge Esmeralda context — dates, attendee count, programming format, design principles. The agent reads this when composing welcomes and digests. |
| `SOUL.md` | Voice, banned vocabulary, "never name the plumbing", boundaries, continuity. |
| `IDENTITY.md` | EdgeClaw identity — role, context, tone. |
| `USER.md` | Lived notebook — populated by the active skill's bootstrap ritual from the user's onboarding answers. |
| `TOOLS.md` | Cross-backend rules: channel formatting (Discord/WhatsApp/Telegram), URL preservation, Local files index. Per-backend tool families live in the relevant skill. |
| `HEARTBEAT.md` | Generic heartbeat tick rules + the cross-backend `memory-curation` task. Backend-specific tasks live in each active skill's `heartbeat.md`. |
| `skills/index-network/SKILL.md` | Index Network skill bundle entry point. Registered with OpenClaw on install; gates on `mcp.servers.index`. Body points at the bundle's sibling reference files. |
| `skills/edge-esmeralda/SKILL.md` | Edge Esmeralda data skill: EdgeOS events + attendee directory + curated wiki/website/newsletter references. Loaded by OpenClaw alongside index-network. Vendored from `Edge-City/edgeclaw-skills`. |

## Auth

Skills in this repo are public. Each backend gates access with its own per-user credential, wired in by the matching per-backend installer:

- **Index Network (today's wired backend)** — per-user API key returned by `POST /api/networks/:id/signup` (see [Integration API: Authentication](#authentication) above). `install/install_index.ts` writes it into `mcp.servers.index` as the `x-api-key` header.
- **EdgeOS** — per-user token issued via OTP through the EdgeOS portal. Lands in `install/install_edgeos.ts` once that backend is wired.
- **Geo** — per-user credential, mechanism TBD. Lands in `install/install_geo.ts` once that backend is wired.

The skill files describe HOW to call each backend's APIs; the per-backend credential is what unlocks them.

## Contributing

Maintained by the Edge City and YoursTruly teams. Direct push access is limited to project collaborators; PRs from the community are welcome and will be reviewed.

## Project links

- Edge Esmeralda 2026: https://edgeesmeralda.com
- Substack post: https://edgeesmeralda2026.substack.com/p/the-agent-village-experiment-at-edge

## License

MIT. See [LICENSE](LICENSE).
