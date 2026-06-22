# Claude Plugin Package

## Responsibility
Static plugin distribution package for Claude Code/Codex-style clients. It ships plugin manifests, MCP endpoint configuration, and generated Index Network skill instructions; it does not implement API-service business logic.

## Dependencies
- **Claude/Codex plugin manifests**: host-specific metadata and capabilities.
- **Remote Index MCP server**: `https://protocol.index.network/mcp` implements tools.
- **Protocol skill templates**: canonical source for generated `skills/**/SKILL.md`.

## Consumers
- **Claude Code users**: install via `/plugin install indexnetwork/claude-plugin`.
- **Codex-style clients**: read `.codex-plugin/plugin.json`, `skills/`, and `mcp.json`.
- **Subtree sync**: publishes `packages/claude-plugin` to external plugin repo.

## Module Structure
```
packages/claude-plugin/
├── package.json, README.md
├── mcp.json                         # plain MCP server config
├── .claude-plugin/plugin.json       # Claude manifest + API key config
├── .claude-plugin/marketplace.json  # marketplace metadata
├── .codex-plugin/plugin.json        # Codex manifest
└── skills/<skill>/SKILL.md          # generated skill outputs
```

## MCP Manifest Pattern
```json
{
  "userConfig": {
    "apiKey": { "type": "string", "sensitive": true }
  },
  "mcpServers": {
    "index-network": {
      "type": "http",
      "url": "https://protocol.index.network/mcp",
      "headers": { "x-api-key": "${user_config.apiKey}" }
    }
  }
}
```

## Generated Skill Template Pattern
```md
---
name: index-orchestrator
description: Use when the user asks about finding people...
---

# Index Network — Orchestrator

{{CORE_GUIDANCE}}

## Setup
On activation, call the relevant MCP read tools.
```

## Boundary Rules
- Do not edit generated `packages/claude-plugin/skills/**/SKILL.md` as the source of truth.
- Keep orchestration guidance in skills; MCP tools remain single-purpose primitives implemented by protocol/API service.
- Do not add repositories/services/controllers/components here; add execution logic in protocol, services/api, or apps/web packages.

<important if="you are updating plugin skills">
1. Edit `packages/protocol/skills/claude-plugin/*.template.md` or `packages/protocol/skills/core-guidance.partial.md`.
2. Run `bun run build:skills`.
3. Commit both canonical templates/partials and generated `packages/claude-plugin/skills/**/SKILL.md`.
4. Run `bun test scripts/tests/build-skills.spec.ts` when template injection behavior changes.
</important>

<important if="you are changing plugin distribution metadata">
1. Update `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`, `mcp.json`, or marketplace metadata as appropriate.
2. Mark secrets in `userConfig` with `sensitive: true`.
3. Bump `packages/claude-plugin/package.json` for package changes.
4. Keep README install/auth instructions aligned.
</important>
