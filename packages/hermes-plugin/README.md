# Index Network Hermes Plugin

Hermes-native plugin for Index Network. It follows the official Hermes plugin layout from [Build a Hermes Plugin](https://hermes-agent.nousresearch.com/docs/guides/build-a-hermes-plugin):

```text
plugin.yaml   # manifest: tools, hooks, env requirements
__init__.py   # register(ctx): schemas -> handlers, plugin skills
schemas.py    # LLM-facing tool schemas
tools.py      # JSON-string-returning tool handlers
```

## Current status

The plugin now provides one native Hermes tool:

- `index_read_intents` — calls the canonical Index MCP `read_intents` tool using `INDEX_API_KEY`.

It also bundles generated, namespaced Hermes plugin skills and keeps a dashboard placeholder:

- `skills/index-orchestrator/SKILL.md` — signal/intents review and discovery preparation guidance for Hermes.
- `skills/index-negotiator/SKILL.md` — negotiation review/action workflow guidance for Hermes when full Index negotiation tools are available.
- `dashboard/` — reserved for a future dashboard extension.

No hooks, slash commands, CLI commands, cron jobs, or dashboard tabs are wired yet.

## Install / enable in Hermes

A Hermes plugin directory must be installed under `~/.hermes/plugins/<plugin-name>/` or a one-level category path. For local testing, copy or symlink this directory:

```bash
mkdir -p ~/.hermes/plugins
ln -s /path/to/index/packages/hermes-plugin ~/.hermes/plugins/index-network
hermes plugins enable index-network
```

The manifest declares `requires_env: INDEX_API_KEY`, so `hermes plugins install` can prompt for it and save it to Hermes' `.env`. You can also set it manually:

```bash
export INDEX_API_KEY="..."
```

Optional environment variables:

- `INDEX_MCP_URL` — defaults to `https://protocol.index.network/mcp`.
- `INDEX_MCP_TIMEOUT_SECONDS` — defaults to `30`.
- `INDEX_TELEGRAM_USERNAME` — forwarded as `x-index-telegram-username` when present.

## Tool contract

Handlers intentionally follow Hermes' plugin rules:

- signature: `def handler(args: dict, **kwargs) -> str`
- always return a JSON string
- catch exceptions and return JSON error payloads
- accept `**kwargs` for forward compatibility

`index_read_intents` accepts:

```json
{
  "networkId": "optional Index/network UUID",
  "userId": "optional user UUID",
  "limit": 20,
  "page": 1
}
```

With no arguments, it returns the authenticated caller's own active intents as seen through the scoped Index MCP server.

## Bundled skills

The committed Hermes plugin skills are generated from templates in the monorepo:

```text
packages/protocol/skills/hermes-plugin/<skill-name>.template.md
        ↓ bun run build:skills
packages/hermes-plugin/skills/<skill-name>/SKILL.md
```

Do not edit generated `SKILL.md` files directly. Edit the templates and run `bun run build:skills` from the monorepo root.

`__init__.py` registers each skill directory with `ctx.register_skill()`, so Hermes can load them as `index-network:<skill-name>`. Do not copy plugin skills into `~/.hermes/skills`; Hermes plugin skills are namespaced and read-only.

## Dashboard view

When dashboard work starts, add the Hermes dashboard files under `dashboard/`:

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

For Hermes discovery debugging:

```bash
HERMES_PLUGINS_DEBUG=1 hermes plugins list
hermes logs --level WARNING | grep -i plugin
```
