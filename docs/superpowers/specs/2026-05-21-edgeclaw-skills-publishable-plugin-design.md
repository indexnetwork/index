# EdgeClaw Skills — Cross-Platform Publishable Plugin Design

**Date:** 2026-05-21
**Status:** Approved
**Owner:** Yankı

## Context

`packages/edgeclaw/skills/` is a subtree that syncs to `Edge-City/edgeclaw-skills`. It contains three skill bundles extracted in the prior design (2026-05-15):

- **`edge-esmeralda/`** — popup-specific knowledge layer (constants, attendee field guide, wiki/website/newsletter references, onboarding pointer). Includes a Bun indexer script that CI runs every 15 minutes to refresh `references/*.md`.
- **`edgeos/`** — backend-generic EdgeOS API recipes (events, RSVPs, venues, attendee directory, own profile). Requires `EDGEOS_BEARER_TOKEN` and `EDGEOS_API_KEY` env vars.
- **`index-network/`** — Index Network MCP procedural knowledge (onboarding ritual, voice exemplars, cron prompts, heartbeat tasks). Requires `mcp.servers.index`.

Each bundle has a `SKILL.md` with YAML frontmatter (`name`, `description`, `version`, `author`, `tags`, and optional `metadata.openclaw.requires`). The content is platform-neutral markdown.

The full `edgeclaw` package (`packages/edgeclaw/`, synced to `indexnetwork/edgeclaw` → fork of `Edge-City/edgeclaw`) is the batteries-included OpenClaw agent: installer + workspace + skills subtree + cron infrastructure. `edgeclaw-skills` is the lightweight knowledge layer that any agent platform can consume.

## Goal

Make `Edge-City/edgeclaw-skills` installable as a standalone plugin on **Claude Code**, **Codex**, and **OpenClaw** by adding platform-specific manifest files. No changes to existing skill content.

## Design

### File additions

All new files live at the `edgeclaw-skills/` root (= `packages/edgeclaw/skills/`):

| File | Purpose |
|---|---|
| `.claude-plugin/plugin.json` | Claude Code plugin manifest — name, description, version, MCP server declaration, config schema |
| `.claude-plugin/marketplace.json` | Claude Code marketplace listing metadata |
| `.codex-plugin/plugin.json` | Codex plugin manifest — equivalent fields plus `interface` block |
| `openclaw.plugin.json` | OpenClaw lightweight plugin manifest — skills path, config schema |
| `mcp.json` | Shared MCP server declarations (Index Network endpoint), referenced by Codex manifest |
| `README.md` | User-facing install instructions per platform, what you get, how to get API keys |

### Manifest contents

#### `.claude-plugin/plugin.json`

```json
{
  "name": "edgeclaw",
  "description": "Edge Esmeralda 2026 — popup knowledge, EdgeOS calendar & directory, and Index Network discovery skills for the Agent Village.",
  "version": "1.0.0",
  "author": {
    "name": "Edge City",
    "url": "https://edgecity.live"
  },
  "mcpServers": {
    "index": {
      "type": "http",
      "url": "https://protocol.index.network/mcp"
    }
  },
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": {
        "type": "string",
        "description": "Index Network API key. Obtain one at edgecity.live/agentvillage or from your community admin."
      }
    }
  }
}
```

#### `.claude-plugin/marketplace.json`

```json
{
  "$schema": "https://anthropic.com/claude-code/marketplace.schema.json",
  "name": "edgeclaw-skills",
  "metadata": {
    "description": "Edge Esmeralda 2026 Agent Village skills — popup knowledge, EdgeOS APIs, and Index Network discovery."
  },
  "owner": {
    "name": "Edge City",
    "url": "https://edgecity.live"
  },
  "plugins": [
    {
      "name": "edgeclaw",
      "description": "Edge Esmeralda 2026 — popup knowledge, EdgeOS calendar & directory, and Index Network discovery.",
      "version": "1.0.0",
      "author": {
        "name": "Edge City",
        "url": "https://edgecity.live"
      },
      "source": "./",
      "category": "productivity",
      "homepage": "https://edgecity.live",
      "tags": ["edge-city", "edge-esmeralda", "popup-village", "community", "discovery"]
    }
  ]
}
```

#### `.codex-plugin/plugin.json`

```json
{
  "name": "edgeclaw",
  "version": "1.0.0",
  "description": "Edge Esmeralda 2026 — popup knowledge, EdgeOS calendar & directory, and Index Network discovery.",
  "author": {
    "name": "Edge City",
    "url": "https://edgecity.live"
  },
  "homepage": "https://edgecity.live",
  "repository": "https://github.com/Edge-City/edgeclaw-skills",
  "license": "MIT",
  "keywords": ["edge-city", "edge-esmeralda", "popup-village", "community", "discovery"],
  "mcpServers": "./mcp.json",
  "interface": {
    "displayName": "EdgeClaw Skills",
    "shortDescription": "Edge Esmeralda popup knowledge, calendar, directory, and discovery.",
    "developerName": "Edge City",
    "category": "Productivity",
    "capabilities": ["MCP", "Skills"],
    "websiteURL": "https://edgecity.live",
    "brandColor": "#1a1a2e"
  }
}
```

#### `openclaw.plugin.json`

Lightweight — no activation hooks, no negotiation poller, no cron installer. Those stay in the full `edgeclaw` package.

```json
{
  "id": "edgeclaw-skills",
  "name": "EdgeClaw Skills",
  "description": "Edge Esmeralda 2026 skills — popup knowledge, EdgeOS calendar & directory, and Index Network discovery.",
  "version": "1.0.0",
  "skills": ["."],
  "configSchema": {
    "type": "object",
    "properties": {
      "apiKey": {
        "type": "string",
        "description": "Index Network API key for MCP authentication."
      }
    }
  }
}
```

#### `mcp.json`

```json
{
  "index": {
    "type": "http",
    "url": "https://protocol.index.network/mcp"
  }
}
```

### What stays unchanged

- All existing `SKILL.md` files, frontmatter, and supporting files.
- The `edge-esmeralda/package.json` (private, indexer-only — plugin runtimes ignore it).
- The `edge-esmeralda/` indexer infrastructure (`scripts/`, `tsconfig.json`).
- SKILL.md frontmatter with custom fields (`name`, `version`, `author`, `tags`, `metadata.openclaw.requires`) — Claude Code ignores unknown keys; OpenClaw reads `metadata.openclaw.requires`.

### Subtree implications

The subtree boundary is `packages/edgeclaw/skills/` → `Edge-City/edgeclaw-skills`. New files added at the skills root (`.claude-plugin/`, `.codex-plugin/`, `openclaw.plugin.json`, `mcp.json`, `README.md`) will be pushed to the `edgeclaw-skills` repo by the existing subtree sync workflow. No changes to the sync mechanism needed.

The full `edgeclaw` package (`packages/edgeclaw/`) continues to sync to `indexnetwork/edgeclaw` (fork of `Edge-City/edgeclaw`). It already includes `skills/` in its `package.json#files` array, so the new manifests inside `skills/` are automatically included. The edgeclaw installer copies skills into `~/.openclaw/workspace/skills/` — the plugin manifests are inert files once copied there.

### Install paths

| Platform | Command |
|---|---|
| Claude Code | `claude plugin install edgeclaw` (marketplace) or `claude plugin install --from github Edge-City/edgeclaw-skills` |
| Codex | `codex plugin install Edge-City/edgeclaw-skills` |
| OpenClaw | `openclaw plugins install Edge-City/edgeclaw-skills` |

### Version strategy

All manifests share the same version (`1.0.0` at launch). Bump all manifests together on changes. The individual `SKILL.md` files keep their own `version` field in frontmatter for per-skill granularity.

### README.md

User-facing documentation covering:
1. What you get (three skills, one-line description of each)
2. Install instructions per platform
3. How to obtain API keys (Index Network, EdgeOS tokens)
4. Pointer to full `edgeclaw` package for the batteries-included OpenClaw experience
5. Pointer to the skill files for content contributors

## Non-goals

- ChatGPT support (fundamentally different architecture — OpenAPI actions, not skill files)
- Runtime code in edgeclaw-skills (no pollers, no installers, no cron setup)
- Changes to existing SKILL.md content or frontmatter
