# Agentvillage Skills

Agent skills for **Edge Esmeralda 2026** (May 30 – Jun 27, Healdsburg, CA). Shipped with [agentvillage](../README.md); also installable on Claude Code, OpenClaw, and other MCP hosts.

## What you get

Four skill bundles that give your agent Edge Esmeralda knowledge and live API access:

- **edge-esmeralda** — popup constants (popup id, week dates, themes), attendee directory field semantics, curated wiki/website/newsletter knowledge base, and the onboarding pointer for obtaining EdgeOS tokens.
- **edgeos** — backend-generic EdgeOS API recipes: events, RSVPs, venues, attendee directory, and your own profile lookup.
- **geo-esmeralda** — Geo knowledge graph access through the Geo CLI package: ontology, fixed graph tools, guarded native read-only queries, and attendee-authored content/photo creation.
- **index-network** — Index Network discovery: onboarding ritual, opportunity surfacing, voice exemplars, cron prompts for welcome/digest flows, and heartbeat tasks.

The skills cross-reference each other. `edge-esmeralda` supplies the popup id that `edgeos` recipes need. `geo-esmeralda` handles Geo knowledge graph-backed knowledge and attendee-authored writes, and `index-network` handles discovery and intent-based matching. Install all four together.

## Host-specific silence

Some background prompts need to complete without sending a chat message. Use the no-reply marker for the host you are running in:

| Host | Silent final reply |
| --- | --- |
| Hermes / Nous Research Hermes | `[SILENT]` |
| OpenClaw | `NO_REPLY` |
| Claude Code | No user-facing text if the host supports a silent turn; otherwise stop without commentary |

Shared skill files use host-neutral language like "reply silently" so the same skill bundle can run on Hermes, OpenClaw, Claude Code, and other MCP hosts.

## Install

### Environment variables

All hosts read credentials from environment variables. Set these before installing or add them to your shell profile (`~/.zshrc`, `~/.bashrc`) to persist across sessions:


| Variable              | Source                                                                                               | Required |
| --------------------- | ---------------------------------------------------------------------------------------------------- | -------- |
| `INDEX_API_KEY`       | Index Network signup (BYOA page or [agent-ee26.edgecity.live](https://agent-ee26.edgecity.live/)) | Yes      |
| `EDGEOS_BEARER_TOKEN` | EdgeOS email-OTP onboarding flow                                                                     | Yes for Geo knowledge graph access and content writes; also used for EdgeOS directory/profile |
| `EDGEOS_API_KEY`      | EdgeOS email-OTP onboarding flow (`eos_live_...` key)                                                | Optional; needed for EdgeOS events, RSVPs, venues |


`INDEX_API_KEY` is required for the Index Network MCP server. `EDGEOS_BEARER_TOKEN` is required for `geo-esmeralda` auth, graph reads, and content writes. `EDGEOS_API_KEY` is only needed for EdgeOS event, RSVP, and venue recipes.

### BYOA flow

If you authenticated through the EdgeOS portal (https://agent-ee26.edgecity.live/), the page provides your credentials and per-host install commands with the keys pre-filled. Copy and run them in your terminal.

### Claude Code

```bash
claude plugin marketplace add Edge-City/agentvillage-skills
claude plugin install agentvillage@agentvillage-skills --config indexApiKey=<YOUR_API_KEY> --config edgeosToken=<YOUR_TOKEN> --config edgeosApiKey=<YOUR_KEY>
```

`--config` values are stored in the plugin's `userConfig`. `indexApiKey` is wired to the Index Network MCP server header. A SessionStart hook exports `EDGEOS_API_KEY` and `EDGEOS_BEARER_TOKEN` into every session via `CLAUDE_ENV_FILE`, so the Geo CLI and edgeos skill's curl recipes work without manual shell exports.

### OpenClaw

```bash
openclaw plugins install agentvillage --marketplace Edge-City/agentvillage-skills
openclaw config set mcp.servers.index '{"url":"https://protocol.index.network/mcp","transport":"streamable-http","headers":{"x-api-key":"<YOUR_API_KEY>"}}'
openclaw config set env.vars.EDGEOS_BEARER_TOKEN '<YOUR_TOKEN>'  # Human session JWT for Geo knowledge graph access and content writes
openclaw config set env.vars.EDGEOS_API_KEY '<YOUR_KEY>'         # Long-lived automation key for events, RSVPs, venues
openclaw gateway restart
```

OpenClaw persists credentials in `~/.openclaw/openclaw.json` — no shell profile changes needed.

### Hermes (skills only)

```bash
hermes skills install Edge-City/agentvillage/skills/edge-esmeralda --force
hermes skills install Edge-City/agentvillage/skills/edgeos --force
hermes skills install Edge-City/agentvillage/skills/geo-esmeralda --force
hermes skills install Edge-City/agentvillage/skills/index-network --force
```

Add to `~/.hermes/.env`:

```bash
INDEX_API_KEY=<YOUR_API_KEY>
EDGEOS_BEARER_TOKEN=<YOUR_TOKEN>   # Human session JWT for Geo knowledge graph access and content writes
EDGEOS_API_KEY=<YOUR_KEY>          # Long-lived automation key for events, RSVPs, venues
TELEGRAM_HOME_CHANNEL=<numeric_chat_id>   # optional, for cron delivery
```

Merge into `~/.hermes/config.yaml` under `mcp_servers.index`:

```yaml
mcp_servers:
  index:
    url: https://protocol.index.network/mcp
    headers:
      x-api-key: <YOUR_API_KEY>
      x-index-surface: telegram
```

For workspace, installer, and cron jobs:

```bash
bun install/install.ts --index-api-key <KEY>
# add --edgeos-bearer-token for Geo knowledge graph access/content writes
# add --edgeos-api-key for EdgeOS event, RSVP, and venue recipes
# re-onboard: add --wipe-user
```

Installs flat under `~/.hermes/` (SOUL.md, AGENTS.md, skills/, `terminal.cwd`) — Hermes defaults, no subfolders.

### Claude Desktop

Add the MCP server to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "index": {
      "url": "https://protocol.index.network/mcp",
      "headers": {
        "x-api-key": "<YOUR_API_KEY>"
      }
    }
  }
}
```

Claude Desktop provides MCP tools only (no skills).

### Codex

Not yet supported. Codex requires plugins in a `plugins/<name>/` subdirectory layout, which this repo doesn't use.

### Other MCP-compatible agents

Configure an HTTP MCP server with the following settings:

```json
{
  "url": "https://protocol.index.network/mcp",
  "headers": { "x-api-key": "<YOUR_API_KEY>" }
}
```

Set `EDGEOS_BEARER_TOKEN` for Geo knowledge graph access and content writes. Set `EDGEOS_API_KEY` as well if the agent supports EdgeOS event, RSVP, or venue recipes.

For Hermes with workspace + installer, use [agentvillage](https://github.com/Edge-City/agentvillage). For OpenClaw, use [agentvillage](https://github.com/Edge-City/agentvillage).

## Contributing

Each skill lives in its own directory with a `SKILL.md` entry point. Edit the markdown directly. The `edge-esmeralda/references/` files are auto-refreshed by CI every 15 minutes — don't edit those by hand.

Bump `version` in the relevant `SKILL.md` frontmatter on content changes (patch for tweaks, minor for new sections, major for breaking cross-skill contract changes). Bump the manifest versions in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, and `openclaw.plugin.json` together when any skill changes.

## License

MIT
