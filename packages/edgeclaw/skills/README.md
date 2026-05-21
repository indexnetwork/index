# EdgeClaw Skills

Agent skills for **Edge Esmeralda 2026** (May 30 – Jun 27, Healdsburg, CA). Installable as a standalone plugin on Claude Code, Codex, and OpenClaw.

## What you get

Three skill bundles that give your agent Edge Esmeralda knowledge and live API access:

- **edge-esmeralda** — popup constants (popup id, week dates, themes), attendee directory field semantics, curated wiki/website/newsletter knowledge base, and the onboarding pointer for obtaining EdgeOS tokens.
- **edgeos** — backend-generic EdgeOS API recipes: events, RSVPs, venues, attendee directory, and your own profile lookup.
- **index-network** — Index Network discovery: onboarding ritual, opportunity surfacing, voice exemplars, cron prompts for welcome/digest/ambient flows, and heartbeat tasks.

The skills cross-reference each other. `edge-esmeralda` supplies the popup id that `edgeos` recipes need. `index-network` handles discovery and intent-based matching. Install all three together.

## Install

### Claude Code

```bash
claude plugin marketplace add Edge-City/edgeclaw-skills
claude plugin install edgeclaw@edgeclaw-skills
```

### OpenClaw

```bash
openclaw plugins install edgeclaw --marketplace Edge-City/edgeclaw-skills
```

### Codex

Not yet supported. Codex requires plugins in a `plugins/<name>/` subdirectory layout, which this repo doesn't use.

For the batteries-included OpenClaw experience (workspace, installer, cron jobs, onboarding), use the full [EdgeClaw](https://github.com/Edge-City/edgeclaw) package instead.

## API keys

### Index Network

The `index-network` skill requires an Index Network MCP server connection. On Claude Code and Codex, the plugin manifest declares the MCP endpoint automatically. On OpenClaw, use the full [EdgeClaw](https://github.com/Edge-City/edgeclaw) package — its installer registers `mcp.servers.index` for you. You need an API key — obtain one at [edgecity.live/agentvillage](https://edgecity.live/agentvillage) or from your community admin.

### EdgeOS

The `edgeos` skill requires two environment variables:

- `EDGEOS_BEARER_TOKEN` — human session JWT, obtained via the EdgeOS email-OTP onboarding flow.
- `EDGEOS_API_KEY` — long-lived `eos_live_...` automation key, obtained via the same flow.

Both are optional. Without them the agent still loads; EdgeOS recipes will prompt for the missing token on first use. See the `edge-esmeralda` skill's section 2 for the full onboarding flow.

## Contributing

Each skill lives in its own directory with a `SKILL.md` entry point. Edit the markdown directly. The `edge-esmeralda/references/` files are auto-refreshed by CI every 15 minutes — don't edit those by hand.

Bump `version` in the relevant `SKILL.md` frontmatter on content changes (patch for tweaks, minor for new sections, major for breaking cross-skill contract changes). Bump the manifest versions in `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`, and `openclaw.plugin.json` together when any skill changes.

## License

MIT
