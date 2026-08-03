# Index Network Hermes Plugin

A native [Hermes](https://hermes-agent.nousresearch.com) plugin for [Index Network](https://index.network). It gives Hermes first-class Index tools (signals, opportunities, networks, negotiations), bundled guidance skills, a `/index` command, and a live dashboard tab — all authenticated with a single Index API key.

## Installation

```bash
hermes plugins install indexnetwork/hermes-plugin
```

The manifest declares `requires_env: INDEX_API_KEY`, so the installer prompts for the key and saves it to Hermes' `.env`. Get an agent-bound API key at [index.network/agents](https://index.network/agents); an agent-bound key is required for the autonomous negotiation tools.

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `INDEX_API_KEY` | yes | — | Authenticates MCP tool calls and personal-agent API requests |
| `INDEX_MCP_URL` | no | `https://protocol.index.network/mcp` | Index MCP server |
| `INDEX_API_URL` | no | `https://protocol.index.network/api` | Index REST API |
| `INDEX_MCP_TIMEOUT_SECONDS` | no | `30` | Timeout for both MCP and API requests |
| `INDEX_TELEGRAM_USERNAME` | no | — | Forwarded as `x-index-telegram-username` when present |

## Tools

All Hermes-facing tools are prefixed `index_` (see [Naming convention](#naming-convention-the-index_-prefix)).

### MCP wrappers

`index_read_intents` is a dedicated wrapper with argument validation:

```json
{
  "networkId": "optional Index/network UUID",
  "userId": "optional user UUID",
  "limit": 20,
  "page": 1
}
```

With no arguments it returns the authenticated caller's own active intents.

Every other canonical Index MCP tool gets a forwarded wrapper: the name is the MCP tool name prefixed with `index_`, arguments pass through unchanged, and the MCP response envelope is decoded into a JSON string. Examples:

- `index_read_docs({"topic":"mcp_agent_guide"})`
- `index_create_intent({"description":"...","autoApprove":true})`
- `index_read_networks({})`
- `index_list_opportunities({})`

The full list is `provides_tools` in `plugin.yaml`.

### Personal-agent tools

**`index_agent_me`** — no arguments. Returns the authenticated personal Index agent for the configured key (`GET /api/agents/me`).

**`index_pickup_negotiation`** — polls and claims one pending negotiation turn:

```json
{ "agentId": "optional personal agent UUID" }
```

If `agentId` is omitted it is resolved via `/api/agents/me`. No pending work returns `{ "success": true, "pending": false }`; a claimed turn returns `pending: true` plus the negotiation payload.

**`index_respond_negotiation`** — submits an autonomous negotiation response:

```json
{
  "agentId": "optional personal agent UUID",
  "negotiationId": "required negotiation UUID from pickup",
  "action": "propose | accept | reject | counter | question",
  "message": "required for counter/question; optional otherwise",
  "reasoning": "required private rationale",
  "suggestedRoles": {
    "ownUser": "agent | patient | peer",
    "otherUser": "agent | patient | peer"
  }
}
```

The handler maps this to the backend body shape (`action`, `message`, and an `assessment` object containing `reasoning` and `suggestedRoles`).

## Skills, hook, and command

Two namespaced plugin skills are bundled and registered automatically:

- `index-network:index-orchestrator` — signal/intent review and discovery preparation guidance.
- `index-network:index-negotiator` — autonomous personal-agent negotiation guidance for scheduled runs.

A defensive `pre_llm_call` hook injects a hint to load the orchestrator skill when a prompt clearly mentions Index Network, signals, intents, opportunities, or discovery; it never runs tools itself. The `/index` command returns the same hint for explicit activation.

Plugin skills are namespaced and read-only — do not copy them into `~/.hermes/skills`.

## Dashboard

The plugin ships an **Index Network** dashboard tab under `dashboard/`: an intent-centric master-detail view for answering pending Index questions (answered questions stay visible as settled records, Mac-app parity), opportunity accept/skip, community self-join, intent pause/archive, profile editing, and realtime direct messages. The dashboard backend (`dashboard/plugin_api.py`) reuses `tools.py` for authentication, MCP forwarding, and timeouts, and it never claims or responds to negotiation turns — those remain explicit tool/skill flows.

See [`dashboard/README.md`](./dashboard/README.md) for the full scope and runtime behavior.

## Autonomous negotiation

Hermes can act as the user's personal Index negotiator by running the negotiator skill on a schedule through Hermes' gateway/cron mechanism. A minimal scheduled prompt:

```text
Use skill_view("index-network:index-negotiator") and run one scheduled autonomous Index negotiation pass.
```

The skill's scheduled-run contract:

1. call `index_pickup_negotiation()`
2. if `pending=false`, respond exactly `[SILENT]`
3. inspect the returned context, opportunity, turn history, and deadline
4. choose one cautious action
5. call `index_respond_negotiation(...)`
6. report only the tool-confirmed submission

Run the cron often enough to keep the personal-agent heartbeat fresh — a 1 minute interval is recommended. The Index dispatcher falls back to the system negotiator when no personal agent has polled recently, so a slow or stopped cron causes missed turns even with the plugin installed.

## Development

### Layout

The plugin follows the official layout from [Build a Hermes Plugin](https://hermes-agent.nousresearch.com/docs/guides/build-a-hermes-plugin):

```text
plugin.yaml   # manifest: tools, hooks, env requirements
__init__.py   # register(ctx): schemas -> handlers, hooks, commands, plugin skills
schemas.py    # LLM-facing tool schemas
tools.py      # JSON-string-returning tool handlers
skills/       # generated plugin skills (do not edit directly)
dashboard/    # Hermes dashboard tab (manifest, bundle, FastAPI routes)
desktop/      # Hermes Desktop plugin build
```

### Local install

A Hermes plugin directory must live under `~/.hermes/plugins/<plugin-name>/`. Symlink this directory:

```bash
mkdir -p ~/.hermes/plugins
ln -s /path/to/index/packages/hermes-plugin ~/.hermes/plugins/index-network
hermes plugins enable index-network
export INDEX_API_KEY="..."
```

For the native Hermes Desktop app, build the desktop plugin (a single ESM file from the same dashboard bundle) and symlink its folder:

```bash
node desktop/build.mjs   # writes desktop/dist/plugin.js
ln -s /path/to/index/packages/hermes-plugin/desktop/dist ~/.hermes/desktop-plugins/index-network
```

After rebuilding, run ⌘K → **Reload desktop plugins** in the app (file edits behind a symlinked folder don't always trigger the hot-reload watcher).

### Tool contract

Handlers follow Hermes' plugin rules:

- signature: `def handler(args: dict, **kwargs) -> str`
- always return a JSON string
- catch exceptions and return JSON error payloads
- accept `**kwargs` for forward compatibility

### Naming convention: the `index_` prefix

Every Hermes-facing tool is named `index_<mcp_tool_name>`, while the Index MCP server exposes unprefixed names. This is a deliberate client-side namespacing convention, not an MCP requirement:

- **Collision avoidance.** Hermes merges all plugin tools into one flat namespace; generic names like `read_docs` could clash with other plugins or built-ins.
- **Self-describing calls.** Logs, dashboards, and multi-server setups always show which system a call belongs to.

`schemas.py` builds schema names as `f"index_{tool_name}"` and `tools.py` sets `handler.__name__` the same way. Keep the prefix when adding wrappers so `plugin.yaml`'s `provides_tools` list stays consistent.

### Generated skills

The committed skills are generated from monorepo templates:

```text
packages/protocol/skills/hermes-plugin/<skill-name>.template.md
        ↓ bun run build:skills
packages/hermes-plugin/skills/<skill-name>/SKILL.md
```

Do not edit generated `SKILL.md` files directly — edit the templates and run `bun run build:skills` from the monorepo root.

### Verify

From the monorepo root:

```bash
bun run build:skills
bun test scripts/tests/build-skills.spec.ts
cd packages/hermes-plugin && bun run test
```

For manual dashboard checks, restart `hermes dashboard` after changing `plugin_api.py` (or `curl http://127.0.0.1:9119/api/dashboard/plugins/rescan` after asset-only changes), then open the **Index Network** tab.

For Hermes plugin discovery debugging:

```bash
HERMES_PLUGINS_DEBUG=1 hermes plugins list
hermes logs --level WARNING | grep -i plugin
```
