# EdgeClaw Skills — Cross-Platform Plugin Manifests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add platform manifests and a README to `packages/edgeclaw/skills/` so `Edge-City/edgeclaw-skills` is installable as a standalone plugin on Claude Code, Codex, and OpenClaw.

**Architecture:** Pure file additions — six new files at the skills root. No changes to existing skill content, no code, no tests. Each manifest declares the plugin name, description, version, MCP server config, and optional API key config schema in the format each platform expects.

**Tech Stack:** JSON (manifests), Markdown (README)

**Spec:** `docs/superpowers/specs/2026-05-21-edgeclaw-skills-publishable-plugin-design.md`

---

### Task 1: Claude Code plugin manifest

**Files:**
- Create: `packages/edgeclaw/skills/.claude-plugin/plugin.json`

- [ ] **Step 1: Create the `.claude-plugin/` directory and `plugin.json`**

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

- [ ] **Step 2: Verify the file is valid JSON**

Run: `cat packages/edgeclaw/skills/.claude-plugin/plugin.json | python3 -m json.tool > /dev/null && echo "valid" || echo "invalid"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/.claude-plugin/plugin.json
git commit -m "feat(edgeclaw-skills): add Claude Code plugin manifest"
```

---

### Task 2: Claude Code marketplace listing

**Files:**
- Create: `packages/edgeclaw/skills/.claude-plugin/marketplace.json`

- [ ] **Step 1: Create `marketplace.json`**

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

- [ ] **Step 2: Verify valid JSON**

Run: `cat packages/edgeclaw/skills/.claude-plugin/marketplace.json | python3 -m json.tool > /dev/null && echo "valid" || echo "invalid"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/.claude-plugin/marketplace.json
git commit -m "feat(edgeclaw-skills): add Claude Code marketplace listing"
```

---

### Task 3: Shared MCP server declarations

**Files:**
- Create: `packages/edgeclaw/skills/mcp.json`

- [ ] **Step 1: Create `mcp.json`**

```json
{
  "index": {
    "type": "http",
    "url": "https://protocol.index.network/mcp"
  }
}
```

- [ ] **Step 2: Verify valid JSON**

Run: `cat packages/edgeclaw/skills/mcp.json | python3 -m json.tool > /dev/null && echo "valid" || echo "invalid"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/mcp.json
git commit -m "feat(edgeclaw-skills): add shared MCP server declarations"
```

---

### Task 4: Codex plugin manifest

**Files:**
- Create: `packages/edgeclaw/skills/.codex-plugin/plugin.json`

- [ ] **Step 1: Create the `.codex-plugin/` directory and `plugin.json`**

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

- [ ] **Step 2: Verify valid JSON**

Run: `cat packages/edgeclaw/skills/.codex-plugin/plugin.json | python3 -m json.tool > /dev/null && echo "valid" || echo "invalid"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/.codex-plugin/plugin.json
git commit -m "feat(edgeclaw-skills): add Codex plugin manifest"
```

---

### Task 5: OpenClaw plugin manifest

**Files:**
- Create: `packages/edgeclaw/skills/openclaw.plugin.json`

- [ ] **Step 1: Create `openclaw.plugin.json`**

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

- [ ] **Step 2: Verify valid JSON**

Run: `cat packages/edgeclaw/skills/openclaw.plugin.json | python3 -m json.tool > /dev/null && echo "valid" || echo "invalid"`
Expected: `valid`

- [ ] **Step 3: Commit**

```bash
git add packages/edgeclaw/skills/openclaw.plugin.json
git commit -m "feat(edgeclaw-skills): add OpenClaw plugin manifest"
```

---

### Task 6: README

**Files:**
- Create: `packages/edgeclaw/skills/README.md`

- [ ] **Step 1: Write `README.md`**

```markdown
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
claude plugin install edgeclaw
```

Or from GitHub directly:

```bash
claude plugin install --from github Edge-City/edgeclaw-skills
```

### Codex

```bash
codex plugin install Edge-City/edgeclaw-skills
```

### OpenClaw

```bash
openclaw plugins install Edge-City/edgeclaw-skills
```

For the batteries-included OpenClaw experience (workspace, installer, cron jobs, onboarding), use the full [EdgeClaw](https://github.com/Edge-City/edgeclaw) package instead.

## API keys

### Index Network

The `index-network` skill requires an Index Network MCP server connection. On Claude Code and Codex, the plugin manifest declares the MCP endpoint automatically. You need an API key — obtain one at [edgecity.live/agentvillage](https://edgecity.live/agentvillage) or from your community admin.

### EdgeOS

The `edgeos` skill requires two environment variables:

- `EDGEOS_BEARER_TOKEN` — human session JWT, obtained via the EdgeOS email-OTP onboarding flow.
- `EDGEOS_API_KEY` — long-lived `eos_live_...` automation key, obtained via the same flow.

Both are optional. Without them the agent still loads; EdgeOS recipes will prompt for the missing token on first use. See the `edge-esmeralda` skill's section 2 for the full onboarding flow.

## Contributing

Each skill lives in its own directory with a `SKILL.md` entry point. Edit the markdown directly. The `edge-esmeralda/references/` files are auto-refreshed by CI every 15 minutes — don't edit those by hand.

Bump `version` in the relevant `SKILL.md` frontmatter on content changes (patch for tweaks, minor for new sections, major for breaking cross-skill contract changes). Bump the manifest versions in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, and `openclaw.plugin.json` together when any skill changes.

## License

MIT
```

- [ ] **Step 2: Commit**

```bash
git add packages/edgeclaw/skills/README.md
git commit -m "feat(edgeclaw-skills): add README with install instructions"
```

---

### Task 7: Remove `.gitkeep` and final verification

**Files:**
- Delete: `packages/edgeclaw/skills/.gitkeep`

- [ ] **Step 1: Remove `.gitkeep`**

The directory now has real content, so `.gitkeep` is unnecessary.

```bash
rm packages/edgeclaw/skills/.gitkeep
```

- [ ] **Step 2: Verify the complete file layout**

Run: `find packages/edgeclaw/skills -maxdepth 2 -type f | grep -v node_modules | grep -v bun.lock | grep -v references/ | sort`

Expected output should include all new files:
```
packages/edgeclaw/skills/.claude-plugin/marketplace.json
packages/edgeclaw/skills/.claude-plugin/plugin.json
packages/edgeclaw/skills/.codex-plugin/plugin.json
packages/edgeclaw/skills/README.md
packages/edgeclaw/skills/edge-esmeralda/CLAUDE.md
packages/edgeclaw/skills/edge-esmeralda/SKILL.md
packages/edgeclaw/skills/edge-esmeralda/.gitignore
packages/edgeclaw/skills/edge-esmeralda/package.json
packages/edgeclaw/skills/edge-esmeralda/tsconfig.json
packages/edgeclaw/skills/edgeos/.env.example
packages/edgeclaw/skills/edgeos/SKILL.md
packages/edgeclaw/skills/index-network/SKILL.md
packages/edgeclaw/skills/index-network/bootstrap.md
packages/edgeclaw/skills/index-network/exemplars.md
packages/edgeclaw/skills/index-network/heartbeat.md
packages/edgeclaw/skills/index-network/tools.md
packages/edgeclaw/skills/mcp.json
packages/edgeclaw/skills/openclaw.plugin.json
```

- [ ] **Step 3: Verify all JSON files parse cleanly**

Run: `for f in packages/edgeclaw/skills/.claude-plugin/plugin.json packages/edgeclaw/skills/.claude-plugin/marketplace.json packages/edgeclaw/skills/.codex-plugin/plugin.json packages/edgeclaw/skills/openclaw.plugin.json packages/edgeclaw/skills/mcp.json; do echo -n "$f: "; python3 -m json.tool "$f" > /dev/null 2>&1 && echo "ok" || echo "INVALID"; done`

Expected: all `ok`

- [ ] **Step 4: Verify version consistency across manifests**

Run: `grep -h '"version"' packages/edgeclaw/skills/.claude-plugin/plugin.json packages/edgeclaw/skills/.claude-plugin/marketplace.json packages/edgeclaw/skills/.codex-plugin/plugin.json packages/edgeclaw/skills/openclaw.plugin.json | sort -u`

Expected: all lines show `"version": "1.0.0"`

- [ ] **Step 5: Commit**

```bash
git rm packages/edgeclaw/skills/.gitkeep
git commit -m "chore(edgeclaw-skills): remove .gitkeep, directory has real content"
```
