# AgentVillage

The Agent Village experience for **Edge Esmeralda 2026** (May 30 – Jun 27, Healdsburg, CA).

AgentVillage is the public skills package and onboarding scripts that an agent (running Hermes, OpenClaw, or Claude) loads to participate in the Edge Esmeralda Agent Village. It's a multi-backend package: discovery and intent negotiation through Index Network, knowledge graph through Geo, calendar and directory through EdgeOS. AgentVillage defines what an agent knows, how it authenticates with each backend, and how it interacts with attendees.

## What you get

Today, capabilities come from **Index Network** (discovery + intent negotiation). **Geo** (knowledge graph) and **EdgeOS** (calendar + directory) are also in scope. Once installed, AgentVillage:

- **Runs privacy-first onboarding** the first time you message it (greet → ask one data-use consent question covering EdgeOS data and public lookup → profile draft → user approval → first signal → silent handle capture → `complete_onboarding`).
- **Sends a morning digest at 08:00 host-local time** with the connections worth your attention and the asks where you can help.
- **Notifies you when someone accepts** a connection on your behalf.
- **Curates memory** every few days — distills daily notes into long-term `MEMORY.md`.

AgentVillage never names the plumbing in chat. You see AgentVillage and (when relevant) your community.

## Architecture

AgentVillage plugs into the EdgeOS portal (the identity + spine), with Portal as the recommended runtime for non-technical attendees. Backends the agent calls: Geo (knowledge graph), Index (negotiation + discovery), and EdgeOS APIs (calendar, directory).

See the project hub for the full diagram and decisions.

## What's here

- `workspace/IDENTITY.md` — what an AgentVillage agent knows about itself and the village
- `workspace/` — backend-agnostic agent core (identity, voice, community context, generic operating rules)
- `skills/` — per-backend skill bundles registered with OpenClaw via per-bundle `SKILL.md`. Mirrors `Edge-City/agentvillage-skills` as a subtree; today this hosts:
  - `skills/index-network/` — Index Network MCP procedural knowledge (onboarding ritual, voice exemplars, cron prompts, heartbeat tasks)
  - `skills/edgeos/` — backend-generic EdgeOS API recipes (events, RSVPs, venues, attendee directory, own profile). Reads `EDGEOS_BEARER_TOKEN` and `EDGEOS_API_KEY` from env; popup id is supplied by the active operator skill.
  - `skills/edge-esmeralda/` — Edge Esmeralda 2026 popup knowledge: popup constants (popup id, week dates, themes), attendee field semantics, the curated wiki/website/newsletter references (vendored from `Edge-City/agentvillage-skills`; refreshed by upstream CI every 15 min), and the onboarding pointer for obtaining EdgeOS tokens.
  - `skills/geo-esmeralda/` — Geo knowledge graph recipes and write guidance for attendee-authored content, relations, ontology, and media.
- `install/` — bootstrap scripts for plugging AgentVillage into a runtime

## Getting an agent connected

Two paths:

**1. I'm new to agents.** Sign up at `https://agent-ee26.edgecity.live/` and pick "Set one up for me." Portal provisions a hosted agent with AgentVillage preinstalled. ~5 minutes.

**2. I'm self-hosting.** Set up Hermes, OpenClaw, or Claude Code, then run the AgentVillage installer from a clone of this repo.

### EdgeOS tokens

Both paths need EdgeOS tokens (`EDGEOS_BEARER_TOKEN` and `EDGEOS_API_KEY`) before the `edgeos` skill can talk to the calendar, directory, or your own profile. Obtain them by completing the email-OTP flow at `<EDGECITY-ONBOARDING-URL>`, then pass them to the installer (`--edgeos-bearer-token`, `--edgeos-api-key`) or, for non-OpenClaw hosts, set them in your host's env config per its conventions. AgentVillage does not run OTP itself.

> **TODO:** Replace `<EDGECITY-ONBOARDING-URL>` with the actual URL once EdgeCity publishes it. Bump `package.json` patch version when done.

## Integration API

The integration API is for **Portal** and **EdgeOS** — the two systems that provision agents on behalf of attendees. End users do not call this directly.

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

### What Portal does after signup

1. Runs the AgentVillage installer with the returned `apiKey`: `bun install/install.ts --index-api-key <apiKey>` (or equivalent in the hosted runtime). If Portal has also fetched an EdgeOS personal access token for the attendee, it passes that on the same line: `bun install/install.ts --index-api-key <apiKey> --edgeos-api-key <eos_live_…> --edgeos-bearer-token <jwt>`.
2. In a follow-up step, captures the attendee's Telegram handle and binds it to their agent transport — this is entirely Portal-owned and happens outside this endpoint.

### What EdgeOS does after signup (BYOA flow)

Displays per-host install commands with the attendee's credentials pre-filled. The attendee copies and runs them in their terminal. EdgeOS also completes the email-OTP flow to obtain `EDGEOS_BEARER_TOKEN` and `EDGEOS_API_KEY`, which are included in the install commands.

**Claude Code:**
```bash
export INDEX_API_KEY=<apiKey>
export EDGEOS_BEARER_TOKEN=<jwt>
export EDGEOS_API_KEY=<eos_live_…>
claude plugin marketplace add Edge-City/agentvillage-skills
claude plugin install agentvillage@agentvillage-skills
```

**OpenClaw:**
```bash
openclaw plugins install agentvillage --marketplace Edge-City/agentvillage-skills
openclaw config set mcp.servers.index '{"url":"https://protocol.index.network/mcp","transport":"streamable-http","headers":{"x-api-key":"<apiKey>"}}'
openclaw config set env.vars.EDGEOS_BEARER_TOKEN '<jwt>'
openclaw config set env.vars.EDGEOS_API_KEY '<eos_live_…>'
openclaw gateway restart
```

**Hermes:**
```bash
hermes skills install Edge-City/agentvillage/skills/edge-esmeralda --force
hermes skills install Edge-City/agentvillage/skills/edgeos --force
hermes skills install Edge-City/agentvillage/skills/index-network --force
hermes config set mcp_servers.index.url 'https://protocol.index.network/mcp'
hermes config set mcp_servers.index.headers.x-api-key '<apiKey>'
hermes config set EDGEOS_BEARER_TOKEN '<jwt>'
hermes config set EDGEOS_API_KEY '<eos_live_…>'
```

**Claude Desktop / other MCP clients:** displays the `mcpServer` JSON with the API key baked in.

See `skills/README.md` for the full per-host reference.

## Prerequisites

- [OpenClaw](https://openclaw.dev) installed and configured (`openclaw onboard --mode local` or `openclaw setup`).
- An API key for the Index protocol. Generate one on your agents page at [index.network](https://index.network) (or your community-branded node).
- [Bun](https://bun.sh) — the installer is a Bun script (Node 20+ also works if you swap the shebang).
- Node 20+ with npm/npx available to run the Geo CLI recipes.
- *(Optional)* EdgeOS tokens, if you want live event/attendee recipes to work without per-query prompting:
  - `EDGEOS_API_KEY` — long-lived `eos_live_…` automation key, minted via the EdgeCity onboarding flow (see the "EdgeOS tokens" section above). Unlocks the calendar/RSVPs/venues recipes in `skills/edgeos/SKILL.md`.
  - `EDGEOS_BEARER_TOKEN` — human session JWT obtained via the same email-OTP flow. Unlocks the directory, own-profile, and OpenAPI-spec recipes.

  Both are optional from AgentVillage's perspective. Without them the agent still runs; EdgeOS recipes will just ask the user for the missing token on first use per the SKILL.md instructions.

## Install

From a clone of this repo:

```bash
bun install/install.ts --index-api-key <YOUR_API_KEY>
```

To target the dev environment (keys generated on `dev.index.network`), pass `--dev`:

```bash
bun install/install.ts --index-api-key <YOUR_DEV_API_KEY> --dev
```

Or override the MCP URL explicitly via `INDEX_MCP_URL=…`. Without either, the installer points at `https://protocol.index.network/mcp` (production).

To wire the optional EdgeOS tokens at the same time, pass them as flags:

```bash
bun install/install.ts \
  --index-api-key <YOUR_API_KEY> \
  --edgeos-api-key eos_live_… \
  --edgeos-bearer-token eyJ…
```

### Overriding the digest cron times

The morning digest runs as two fixed crons — **prepare at `0 2 * * *`** and **send at `0 8 * * *`** (host-local). To install them at different times (a different timezone, a test window, etc.), pass full 5-field cron expressions. A flag wins over the matching env var; an invalid expression is ignored with a warning and the default is kept.

```bash
# via flags
bun install/install.ts --index-api-key <YOUR_API_KEY> \
  --digest-prepare-cron "0 3 * * *" \
  --digest-send-cron    "0 9 * * *"

# or via environment
DIGEST_PREPARE_CRON="0 3 * * *" DIGEST_SEND_CRON="0 9 * * *" \
  bun install/install.ts --index-api-key <YOUR_API_KEY>
```

| Cron | Flag | Env var | Default |
|---|---|---|---|
| Prepare pass | `--digest-prepare-cron "<expr>"` | `DIGEST_PREPARE_CRON` | `0 2 * * *` |
| Send pass | `--digest-send-cron "<expr>"` | `DIGEST_SEND_CRON` | `0 8 * * *` |

The installer writes any tokens it finds into `env.vars.*` in `~/.openclaw/openclaw.json`; on the next gateway start they become process-env on the gateway and inherit into the agent's shell tool, so `curl -H "Authorization: Bearer $EDGEOS_API_KEY"` recipes and Geo CLI commands work without further plumbing.

The installer:

1. Writes `mcp.servers.index` in `~/.openclaw/openclaw.json`, pointed at `https://protocol.index.network/mcp` with your API key in `x-api-key`.
2. If `--edgeos-api-key` and/or `--edgeos-bearer-token` are passed, writes each to `env.vars.<NAME>` so the gateway exposes them to the agent's subprocesses on its next start.
3. Leaves Geo CLI execution to the skill recipes, which run the public package through `npx`.
4. Sets `channels.telegram.streaming.mode = off` so OpenClaw doesn't dump per-tool status drafts into your chat.
5. Copies the workspace markdown bundle into `~/.openclaw/workspace/`. `USER.md` is preserved on re-install (it holds the lived notes the active skill's bootstrap ritual populated for you); pass `--wipe-user` to overwrite `USER.md` and delete the agent-curated `MEMORY.md`, OpenClaw's `workspace-state.json` first-run marker, and the local onboarding/welcome/cron-preference markers under `memory/` so the next session re-onboards from scratch.
6. Copies backend skill bundles from `skills/` into `~/.openclaw/workspace/skills/` so OpenClaw registers them as workspace skills.
7. Installs the two digest cron jobs: a prepare pass (`0 2 * * *`) that composes the morning brief and stages it as an editable Kanban task, and a send pass (`0 8 * * *`) that delivers the staged brief. The end user can't change the schedule from chat, but the installer can override both times via `--digest-prepare-cron` / `--digest-send-cron` (or `DIGEST_PREPARE_CRON` / `DIGEST_SEND_CRON`) — see "Overriding the digest cron times" above.
8. Restarts the gateway so all config changes take effect.

Send any message in your chat to bring AgentVillage online. AgentVillage has two independent onboarding gates that run at session start:

- **Index Network onboarding** — gated on the server-side `onboardingComplete` flag returned by `read_user_profiles()`. Owned by `skills/index-network/bootstrap.md`. If `false`, the privacy-first ritual runs (greet → ask one data-use consent question covering EdgeOS/event profile data and public lookup → draft profile with `preview_user_profile` → show it for approval → save with `confirm_user_profile` → capture first signal → capture handle → `complete_onboarding()` → populate `USER.md`).
- **AgentVillage framing** — owned by `workspace/AGENTS.md` "First-message gates". There is no schedule-preferences dialog; the morning digest runs at a fixed time. The only first-message work beyond the Index ritual is a one-line welcome for returning users on a fresh workspace.

An admin resetting `onboardingComplete` server-side re-triggers the Index ritual. Wiping local state via `install/install.ts --wipe-user` resets local markers without touching Index's flag.

## Reset

To tear down AgentVillage and start fresh (leaves Telegram token, OpenRouter key, and gateway config untouched):

```bash
bun install/reset.ts
```

Then re-install:

```bash
bun install/install.ts --index-api-key <YOUR_API_KEY>
```

Pass `--wipe-user` to also remove `USER.md`, `MEMORY.md`, the `.openclaw/` first-run marker, the entire `memory/` directory (including `agentvillage-state.json`, `welcome-state.json`, and daily notes), and all agent sessions under `~/.openclaw/agents/main/sessions/` — so the next message spawns a brand new session against a freshly-bootstrapped workspace:

```bash
bun install/reset.ts --wipe-user
```

## How it runs

Time-sensitive prompts (the morning digest's prepare pass at 02:00 and send pass at 08:00 — host-local) run as **OpenClaw cron jobs**, not heartbeat tasks. Cron has its own scheduler and runs in isolated sessions with `--light-context` so each tick is cheap. Cron jobs are installed by `install/install.ts` and restart with the gateway. Future per-backend skills can add their own cron prompts the same way.

Accepted-opportunity notifications, freshness audits, memory curation, and any other latency-tolerant background work stay on the heartbeat tick because 30-minute latency is acceptable for those flows.

## Workspace layout

| File | Purpose |
| --- | --- |
| `AGENTS.md` | Canonical session-start instructions plus operating rules. Hosts the dual onboarding gates (skill-side + AgentVillage-side), the cron-schedule trigger, memory contract, opportunity-quality bar, red lines, and group-chat rules. Always injected by OpenClaw. |
| `BOOTSTRAP.md` | OpenClaw convention for the first-run file. AgentVillage ships only a stub pointing to `AGENTS.md` here, because OpenClaw deletes BOOTSTRAP.md after first-run setup — anything stored in it is not durable. |
| `COMMUNITY.md` | Edge Esmeralda context — dates, attendee count, programming format, design principles. The agent reads this when composing welcomes and digests. |
| `SOUL.md` | Voice, banned vocabulary, "never name the plumbing", boundaries, continuity. |
| `IDENTITY.md` | AgentVillage identity — role, context, tone. |
| `USER.md` | Lived notebook — populated by the active skill's bootstrap ritual from the user's onboarding answers. |
| `TOOLS.md` | Cross-backend rules: channel formatting (Discord/WhatsApp/Telegram), URL preservation, Local files index. Per-backend tool families live in the relevant skill. |
| `HEARTBEAT.md` | Generic heartbeat tick rules + the cross-backend `memory-curation` task. Backend-specific tasks live in each active skill's `heartbeat.md`. |
| `skills/index-network/SKILL.md` | Index Network skill bundle entry point. Registered with OpenClaw on install; gates on `mcp.servers.index`. Body points at the bundle's sibling reference files. |
| `skills/edgeos/SKILL.md` | EdgeOS-API skill: events + attendee directory + curated wiki/website/newsletter references. Currently scoped to Edge Esmeralda 2026. Loaded by OpenClaw alongside index-network. Vendored from `Edge-City/agentvillage-skills`. |
| `skills/geo-esmeralda/SKILL.md` | Geo knowledge graph skill: community content, relations, ontology, and attendee-authored writes through the Geo CLI package. |

## Configuration guide

AgentVillage's behaviour is markdown-driven. Almost everything you'd want to change lives in `workspace/` or `skills/<backend>/`. This section maps common customizations to the file that owns them.

**Deploy cycle.** All edits go into this repo. The agent only sees them after `install/install.ts` runs again, since the installer copies `workspace/` and `skills/` into `~/.openclaw/workspace/`. Re-running without `--wipe-user` preserves the attendee's `USER.md`, `MEMORY.md`, and onboarding markers — safe for content/tone edits. Use `--wipe-user` only when you want the next session to re-onboard from scratch. Existing installs must reinstall the package to copy updated privacy-first onboarding markdown into the Hermes/OpenClaw workspace.

### Tone & voice

| You want to… | Edit | Notes |
|---|---|---|
| Tighten or loosen overall voice (more analytical / more playful) | `workspace/SOUL.md` | The "voice" rules apply to every message the agent composes. Voice exemplars in skill bundles inherit from here. |
| Change banned vocabulary (e.g. drop a word, ban a new one) | `workspace/SOUL.md` | Bans propagate to all skill prompts via SOUL.md. |
| Change the canonical look of welcome / digest messages | `skills/index-network/exemplars.md` | These exemplars are the bar the agent imitates. Edit the literal sample messages, not abstract rules. |
| Rename the agent (rebrand for another event) | `workspace/IDENTITY.md` + every `prompts/*.md` and `bootstrap.md` referring to "AgentVillage" | Grep `AgentVillage` under `workspace/` and `skills/`. Also update `COMMUNITY.md` and `package.json` `name` if forking. |
| Add or change emoji conventions | `skills/index-network/exemplars.md` and `skills/index-network/prompts/*.md` | Exemplars set the look; the morning greeting is fixed in `prepare.md` / `send.md`. |

### Content

| You want to… | Edit | Notes |
|---|---|---|
| Update community facts (dates, headcount, venue, programming format) | `workspace/COMMUNITY.md` | This is the only authoritative source the agent reads for community context. Don't duplicate the facts into prompts. |
| Change what the morning digest says or how it's structured | `skills/index-network/prompts/prepare.md` (compose) and `skills/index-network/prompts/send.md` (deliver + fallback) | The morning greeting is fixed in both. Keep the two-section structure in sync between them. |
| Change the one-time welcome message | `skills/index-network/prompts/welcome.md` + `skills/index-network/bootstrap.md` | `welcome.md` is the post-onboarding welcome run; `bootstrap.md` is the onboarding ritual that precedes it. |
| Change the AgentVillage welcome line for returning users on fresh workspaces | `workspace/AGENTS.md` (first-message gates section) | Two branches: when Index gate triggered → "By the way..." opener; when Index gate skipped → full Edge Esmeralda welcome opener. |
| Change the lived-notebook (`USER.md`) template | `skills/index-network/bootstrap.md` | The bootstrap ritual writes `USER.md`. Editing the file in `workspace/` only affects the empty stub copied in by `--wipe-user`. |
| Change how the agent calls EdgeOS APIs (events, attendees, RSVPs, venues, wiki recipes) | `skills/edgeos/SKILL.md` | This is the hand-edited recipe file. The auto-refreshed reference data under `skills/edgeos/references/` is a different surface — see "Backends & skills" below for the don't-edit-this caveat. |

### Behaviour & gates

| You want to… | Edit | Notes |
|---|---|---|
| Add, remove, or reorder operating rules (memory contract, opportunity quality bar, red lines, group-chat rules) | `workspace/AGENTS.md` | This file is always injected by OpenClaw on every session — durable, unlike `BOOTSTRAP.md`. |
| Add a new first-message gate (e.g. another skill needs onboarding) | `workspace/AGENTS.md` "Active skills" section + the new `skills/<name>/bootstrap.md` | Gates loop over the active-skills registry. Add the skill row first, then point its bootstrap at the trigger condition (server flag, local marker, …). |
| Change the returning-user first-message framing | `workspace/AGENTS.md` "First-message gates" | The digest schedule is fixed (set in `install/install_index.ts`) and not adjustable from chat. |
| Change heartbeat tick behaviour (what tasks fire, dedup rules) | `workspace/HEARTBEAT.md` for cross-backend rules; `skills/<backend>/heartbeat.md` for backend-specific tasks | The tick cadence itself (default ~30 min) is an OpenClaw-side setting, configured through `openclaw config` — not a file in this repo. |
| Change how URLs / formatting render per channel (Telegram, WhatsApp, Discord) | `workspace/TOOLS.md` | Cross-backend rule: Telegram is Markdown, not HTML — raw `<…>` tags get escaped. |

### Schedule & cron

The digest runs as a fixed prepare/send pair — **prepare `0 2 * * *`, send `0 8 * * *`** (host-local) — and the end user can't change it from chat. The installer can override either time (see "Overriding the digest cron times" under **Install**).

| You want to… | Edit | Notes |
|---|---|---|
| Override the digest times for one install | `--digest-prepare-cron` / `--digest-send-cron` (or `DIGEST_PREPARE_CRON` / `DIGEST_SEND_CRON`) | Optional, full 5-field cron expressions. Flag wins over env; invalid values fall back to the default. |
| Change the default digest schedule for everyone | `install/install_index.ts` (`DIGEST_CRON_SPECS`) | The installer writes the cron entries from this table. Existing installs pick up changes on the next `install.ts` run. |
| Change a cron prompt without changing the schedule | the matching `skills/index-network/prompts/<name>.md` | The installer references prompt files by name via `DIGEST_CRON_SPECS`; rename only if you also rename there. |

### Backends & skills

| You want to… | Edit | Notes |
|---|---|---|
| Wire a brand-new backend | new `install/install_<name>.ts` (modeled on `install_index.ts` for MCP+cron wiring, `install_edgeos.ts` for env-token wiring, or `install_geo.ts` for CLI runtime guidance) + new `skills/<name>/` bundle with `SKILL.md` + register in `workspace/AGENTS.md` "Active skills" | Add the installer call to `install/install.ts` and include the skill in `EDGE_SKILL_NAMES` so it is copied into the runtime workspace. |
| Extend an existing backend (Index, EdgeOS, Geo) | The matching `install/install_<name>.ts` and `skills/<name>/` bundle | Runtime config (env vars, MCP entries, cron jobs, CLI commands) lives in `install_<name>.ts`; agent-facing instructions live in the skill bundle's `SKILL.md` and siblings. |
| Wire optional env vars an existing backend needs | `install/install_<name>.ts` + the Prerequisites section of this README | The installer writes `env.vars.<NAME>`; the gateway exposes those to the agent's shell tools on next start. `install_edgeos.ts` is the worked example. |
| Change which skills the agent loads | `workspace/AGENTS.md` "Active skills" section | Mark a skill as eager (gates fire at session start) or reactive (only consulted when needed). |
| Update the vendored `edgeos` reference data (events, attendee directory, wiki snapshots) | Don't — it's auto-refreshed from upstream | Upstream CI in `Edge-City/agentvillage-skills` regenerates `skills/edgeos/references/` every 15 minutes; the change propagates through the nested subtree chain. See the monorepo's `CLAUDE.md` for the sync flow. The recipes in `SKILL.md` are hand-edited — see the "Content" section above. |

## Auth

Skills in this repo are public. Each backend gates access with its own per-user credential, wired in by the matching per-backend installer:

- **Index Network (today's wired backend)** — per-user API key returned by `POST /api/networks/:id/signup` (see [Integration API: Authentication](#authentication) above). `install/install_index.ts` writes it into `mcp.servers.index` as the `x-api-key` header.
- **EdgeOS** — per-user tokens issued via OTP through the EdgeOS portal. `install/install_edgeos.ts` writes `EDGEOS_API_KEY` and `EDGEOS_BEARER_TOKEN` into the runtime environment when provided.
- **Geo** — uses the attendee's `EDGEOS_BEARER_TOKEN` and the Geo CLI package. Skill recipes run it through `npx`.

The skill files describe HOW to call each backend's APIs; the per-backend credential is what unlocks them.

## Contributing

Maintained by the Edge City and YoursTruly teams. Direct push access is limited to project collaborators; PRs from the community are welcome and will be reviewed.

## Project links

- Edge Esmeralda 2026: https://edgeesmeralda.com
- Substack post: https://edgeesmeralda2026.substack.com/p/the-agent-village-experiment-at-edge

## License

MIT. See [LICENSE](LICENSE).
