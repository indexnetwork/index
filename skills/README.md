# Agentvillage Skills

Agent skills for **Edge Esmeralda 2026** (May 30 – Jun 27, Healdsburg, CA). Shipped with [agentvillage](../README.md); also installable on Claude Code, OpenClaw, and other MCP hosts.

## What you get

Three skill bundles that give your agent Edge Esmeralda knowledge and live API access:

- **edge-esmeralda** — popup constants (popup id, week dates, themes), attendee directory field semantics, curated wiki/website/newsletter knowledge base, and the onboarding pointer for obtaining EdgeOS tokens.
- **edgeos** — backend-generic EdgeOS API recipes: events, RSVPs, venues, attendee directory, and your own profile lookup.
- **index-network** — Index Network discovery: onboarding ritual, opportunity surfacing, voice exemplars, cron prompts for welcome/digest/ambient flows, and heartbeat tasks.

The skills cross-reference each other. `edge-esmeralda` supplies the popup id that `edgeos` recipes need. `index-network` handles discovery and intent-based matching. Install all three together.

## Install

### Environment variables

All hosts read credentials from environment variables. Set these before installing or add them to your shell profile (`~/.zshrc`, `~/.bashrc`) to persist across sessions:


| Variable              | Source                                                                                               | Required |
| --------------------- | ---------------------------------------------------------------------------------------------------- | -------- |
| `INDEX_API_KEY`       | Index Network signup (BYOA page or [agent-ee26.edgecity.live](https://agent-ee26.edgecity.live/)) | Yes      |
| `EDGEOS_BEARER_TOKEN` | EdgeOS email-OTP onboarding flow                                                                     | Optional |
| `EDGEOS_API_KEY`      | EdgeOS email-OTP onboarding flow (`eos_live_...` key)                                                | Optional |


`INDEX_API_KEY` is required for the Index Network MCP server. The EdgeOS tokens are optional — without them the agent still loads; EdgeOS recipes will prompt for the missing token on first use.

### BYOA flow

If you authenticated through the EdgeOS portal (https://agent-ee26.edgecity.live/), the page provides your credentials and per-host install commands with the keys pre-filled. Copy and run them in your terminal.

### Claude Code

```bash
export INDEX_API_KEY=<YOUR_API_KEY>
export EDGEOS_BEARER_TOKEN=<YOUR_TOKEN>
export EDGEOS_API_KEY=<YOUR_KEY>
claude plugin marketplace add Edge-City/agentvillage-skills
claude plugin install agentvillage@agentvillage-skills
```

The plugin manifest declares the Index Network MCP endpoint and resolves `INDEX_API_KEY` from the environment at runtime. No interactive prompt.

### OpenClaw

```bash
openclaw plugins install agentvillage --marketplace Edge-City/agentvillage-skills
openclaw config set mcp.servers.index '{"url":"https://protocol.index.network/mcp","transport":"streamable-http","headers":{"x-api-key":"<YOUR_API_KEY>"}}'
openclaw config set env.vars.EDGEOS_BEARER_TOKEN '<YOUR_TOKEN>'
openclaw config set env.vars.EDGEOS_API_KEY '<YOUR_KEY>'
openclaw gateway restart
```

OpenClaw persists credentials in `~/.openclaw/openclaw.json` — no shell profile changes needed.

### Hermes (skills only)

```bash
hermes skills install Edge-City/agentvillage/skills/edge-esmeralda --force
hermes skills install Edge-City/agentvillage/skills/edgeos --force
hermes skills install Edge-City/agentvillage/skills/index-network --force
```

Add to `~/.hermes/.env`:

```bash
INDEX_API_KEY=<YOUR_API_KEY>
EDGEOS_BEARER_TOKEN=<YOUR_TOKEN>
EDGEOS_API_KEY=<YOUR_KEY>
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
# optional: --edgeos-api-key ... --edgeos-bearer-token ...
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

Set `EDGEOS_BEARER_TOKEN` and `EDGEOS_API_KEY` in your agent's environment if it supports EdgeOS recipes.

For Hermes with workspace + installer, use [agentvillage](https://github.com/Edge-City/agentvillage). For OpenClaw, use [agentvillage](https://github.com/Edge-City/agentvillage).

## Contributing

Each skill lives in its own directory with a `SKILL.md` entry point. Edit the markdown directly. The `edge-esmeralda/references/` files are auto-refreshed by CI every 15 minutes — don't edit those by hand.

Bump `version` in the relevant `SKILL.md` frontmatter on content changes (patch for tweaks, minor for new sections, major for breaking cross-skill contract changes). Bump the manifest versions in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, and `openclaw.plugin.json` together when any skill changes.

## License

MIT