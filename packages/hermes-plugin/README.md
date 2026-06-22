# Index Network Hermes Plugin

An empty Hermes plugin starter for future Index Network integrations.

This package is intentionally a fill-in-later Hermes plugin, not a generator. It keeps the official Hermes plugin file shape in place so future work can add Index Network MCP-backed tools and a dashboard view without redoing the package scaffold.

## Current status

- `plugin.yaml` declares the plugin.
- `__init__.py` exposes `register(ctx)` and currently registers bundled skills only when they are added.
- `schemas.py` is reserved for future LLM-facing tool schemas.
- `tools.py` is reserved for future JSON-string-returning tool handlers.
- `skills/` is reserved for bundled Hermes skills.
- `dashboard/` is reserved for a future Hermes dashboard extension.

No tools, MCP servers, API keys, cron jobs, hooks, commands, or dashboard tabs are wired yet.

## Fill in later

### MCP-backed tools

1. Add schemas to `schemas.py`.
2. Add handlers to `tools.py`.
3. Import `schemas` and `tools` in `__init__.py`.
4. Register each handler from `register(ctx)` with `ctx.register_tool()`.

### Bundled skills

Add skill files under:

```text
skills/<skill-name>/SKILL.md
```

The existing `_register_skills(ctx)` helper registers them with `ctx.register_skill()`.

### Dashboard view

When the dashboard is implemented, add the Hermes dashboard extension files under `dashboard/`:

```text
dashboard/manifest.json
dashboard/dist/index.js
dashboard/dist/style.css
dashboard/plugin_api.py
```

## Verify

```bash
cd packages/hermes-plugin
bun run test
```
