# Index Network Hermes Plugin

Hermes-native plugin for Index Network. It follows the official Hermes plugin layout from [Build a Hermes Plugin](https://hermes-agent.nousresearch.com/docs/guides/build-a-hermes-plugin):

```text
plugin.yaml   # manifest: tools, hooks, env requirements
__init__.py   # register(ctx): schemas -> handlers, hooks, commands, plugin skills
schemas.py    # LLM-facing tool schemas
tools.py      # JSON-string-returning tool handlers
```

## Current status

The plugin provides these native Hermes tools:

- `index_read_intents` — calls the canonical Index MCP `read_intents` tool using `INDEX_API_KEY` with argument validation.
- `index_<mcp_tool_name>` — generated pass-through wrappers for the rest of the Index MCP surface, including `index_read_docs`, `index_create_intent`, `index_read_networks`, `index_discover_opportunities`, `index_get_discovery_run`, and `index_list_opportunities`.
- `index_agent_me` — calls `GET /api/agents/me` to return the authenticated personal Index agent for the configured key.
- `index_pickup_negotiation` — calls the personal-agent pickup endpoint to poll and claim one pending negotiation turn.
- `index_respond_negotiation` — submits an autonomous personal-agent negotiation response with action, message, reasoning, and suggested roles.

It also bundles generated, namespaced Hermes plugin skills, an orchestrator hint hook, a slash command, and a static read-only dashboard tab:

- `skills/index-orchestrator/SKILL.md` — signal/intent review and discovery preparation guidance for Hermes.
- `skills/index-negotiator/SKILL.md` — autonomous personal-agent negotiation guidance for scheduled Hermes runs.
- `pre_llm_call` hook — nudges Hermes to load `skill_view("index-network:index-orchestrator")` for clear Index/signal/intent/opportunity prompts.
- `/index` command — returns the same skill-loading hint explicitly.
- `dashboard/` — Hermes dashboard tab with static read-only guidance for Index signals, protocol usage, and autonomous negotiator setup.

## Install / enable in Hermes

Install the public plugin with Hermes:

```bash
hermes plugins install indexnetwork/hermes-plugin
```

The manifest declares `requires_env: INDEX_API_KEY`, so `hermes plugins install` prompts for it and saves it to Hermes' `.env`. Use an Index agent-bound API key when running autonomous negotiation tools.

For local development, a Hermes plugin directory must be installed under `~/.hermes/plugins/<plugin-name>/` or a one-level category path. Copy or symlink this directory:

```bash
mkdir -p ~/.hermes/plugins
ln -s /path/to/index/packages/hermes-plugin ~/.hermes/plugins/index-network
hermes plugins enable index-network
```

You can also set the key manually:

```bash
export INDEX_API_KEY="..."
```

Optional environment variables:

- `INDEX_MCP_URL` — defaults to `https://protocol.index.network/mcp`.
- `INDEX_API_URL` — defaults to `https://protocol.index.network/api`.
- `INDEX_MCP_TIMEOUT_SECONDS` — defaults to `30` and is used for both MCP and API requests.
- `INDEX_TELEGRAM_USERNAME` — forwarded as `x-index-telegram-username` when present.

## Tool contract

Handlers intentionally follow Hermes' plugin rules:

- signature: `def handler(args: dict, **kwargs) -> str`
- always return a JSON string
- catch exceptions and return JSON error payloads
- accept `**kwargs` for forward compatibility

### `index_read_intents`

Accepts:

```json
{
  "networkId": "optional Index/network UUID",
  "userId": "optional user UUID",
  "limit": 20,
  "page": 1
}
```

With no arguments, it returns the authenticated caller's own active intents as seen through the scoped Index MCP server.

### `index_<mcp_tool_name>` forwarded wrappers

The plugin registers Hermes wrappers for each canonical Index MCP tool that does not already have a dedicated wrapper. Examples:

- `index_read_docs({"topic":"mcp_agent_guide"})`
- `index_create_intent({"description":"...","autoApprove":true})`
- `index_read_networks({})`
- `index_discover_opportunities({"searchQuery":"..."})`
- `index_get_discovery_run({"discoveryRunId":"..."})`
- `index_list_opportunities({})`

Wrapper names are formed by prefixing the MCP tool name with `index_`; arguments are passed through unchanged to the underlying MCP tool. Tool responses are decoded from the MCP envelope and returned as JSON strings to Hermes.

### `index_agent_me`

Accepts no arguments:

```json
{}
```

Returns the authenticated personal agent identity for the configured `INDEX_API_KEY`.

### `index_pickup_negotiation`

Accepts:

```json
{
  "agentId": "optional personal agent UUID"
}
```

If `agentId` is omitted, the handler resolves it with `/api/agents/me`. A 204/no-work pickup returns:

```json
{ "success": true, "pending": false }
```

A claimed turn returns `pending: true` plus the backend negotiation payload.

### `index_respond_negotiation`

Accepts:

```json
{
  "agentId": "optional personal agent UUID",
  "negotiationId": "required negotiation UUID from pickup",
  "action": "propose | accept | reject | counter | question",
  "message": "required for counter/question; optional but useful for other actions",
  "reasoning": "required private rationale",
  "suggestedRoles": {
    "ownUser": "agent | patient | peer",
    "otherUser": "agent | patient | peer"
  }
}
```

The handler sends the backend body shape expected by the personal-agent negotiation endpoint:

```json
{
  "action": "accept",
  "message": "...",
  "assessment": {
    "reasoning": "...",
    "suggestedRoles": {
      "ownUser": "agent",
      "otherUser": "patient"
    }
  }
}
```

## Autonomous negotiation setup

Hermes can run as the user's personal Index negotiator by invoking the bundled `index-network:index-negotiator` skill on a schedule through Hermes' gateway/cron mechanism.

A minimal scheduled prompt should instruct Hermes to load the negotiator skill and run one autonomous polling pass, for example:

```text
Use skill_view("index-network:index-negotiator") and run one scheduled autonomous Index negotiation pass.
```

The skill's scheduled-run contract is:

1. call `index_pickup_negotiation()`
2. if `pending=false`, respond exactly `[SILENT]`
3. inspect returned context/opportunity/turn history/deadline when a turn is pending
4. choose one cautious action
5. call `index_respond_negotiation(...)`
6. report only the tool-confirmed submission

Run the Hermes gateway/cron often enough to keep the personal-agent heartbeat fresh. A 1 minute interval is recommended. The Index dispatcher falls back to the system negotiator when no personal agent has polled recently, so a slow or stopped cron may cause Hermes to miss turns even though the plugin is installed.

## Hook and command behavior

`__init__.py` registers a defensive `pre_llm_call` hook. When the user message clearly mentions Index Network, signals, intents, opportunities, or discovery, the hook injects a short hint telling Hermes to load `skill_view("index-network:index-orchestrator")`. The hook does not run tools by itself.

The `/index` command returns the same hint for explicit activation. Plugin skills are namespaced, so refer to them as `index-network:index-orchestrator` and `index-network:index-negotiator`.

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

The plugin ships a plugin-local Hermes dashboard tab under `dashboard/`:

```text
dashboard/manifest.json
dashboard/dist/index.js
dashboard/dist/style.css
```

The tab appears as **Index Network** in Hermes and is read-only. It summarizes protocol guidance for signals and communities, explains autonomous negotiator setup, and never calls live Index APIs or the pickup/respond negotiation tools from dashboard UI.

This slice intentionally ships the dashboard as static-only. Python dashboard backend routes are deferred until Hermes route authentication is documented for this plugin source; any future live route design should reuse `tools.py` for Index authentication, scoped MCP forwarding, timeouts, and response decoding instead of creating a second client.

## Verify

From the monorepo root:

```bash
bun run build:skills
bun test scripts/tests/build-skills.spec.ts
cd packages/hermes-plugin && bun run test
```

For manual dashboard checks, run `curl http://127.0.0.1:9119/api/dashboard/plugins/rescan` or restart `hermes dashboard`, then open the **Index Network** tab. The tab should render static guidance without requiring `/api/plugins/index-network/*` backend routes.

For Hermes discovery debugging:

```bash
HERMES_PLUGINS_DEBUG=1 hermes plugins list
hermes logs --level WARNING | grep -i plugin
```
