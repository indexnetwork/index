# Index Network Hermes Plugin

A native [Hermes](https://hermes-agent.nousresearch.com) plugin for [Index Network](https://index.network). In its default full mode it gives Hermes first-class Index tools (signals, opportunities, networks, negotiations), bundled guidance skills, a `/index` command, and a live dashboard tab — all authenticated with a single Index API key. A fail-closed negotiator mode exposes only the four personal-agent negotiation capabilities needed by a scheduled external executor.

## Installation

```bash
hermes plugins install indexnetwork/hermes-plugin
```

No API key is required at install. Open the **Index** dashboard tab and choose **Log in with browser**: the plugin runs the same `/cli-auth` handshake the Index Mac app and CLI use, mints an agent-bound key, and saves it to Hermes' `.env` (`INDEX_API_KEY`). Signing out revokes and removes it.

Setting `INDEX_API_KEY` in the Hermes environment yourself still works as an optional override (for CI or headless setups). Get an agent-bound key at [index.network/agents](https://index.network/agents).

In default/full mode, the package ships the prebuilt Hermes Desktop bundle at `desktop/dist/`, and the plugin self-installs it: when the gateway loads the plugin, `register()` copies the bundle into `~/.hermes/desktop-plugins/index-network` (and refreshes it after upgrades). No separate desktop install step — just reload desktop plugins (⌘K) in the Hermes Desktop app the first time. Negotiator mode installs no Desktop dashboard and best-effort removes a stale copied `~/.hermes/desktop-plugins/index-network` bundle. The plugin-local web dashboard is gated separately because Hermes discovers it independently of `register(ctx)`; see [Dashboard](#dashboard).

## Configuration

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `INDEX_API_KEY` | no | — | Authenticates MCP tool calls and personal-agent API requests. Normally set by **Log in with browser** in the Index tab; can be set manually as an override |
| `INDEX_MCP_URL` | no | `https://protocol.index.network/mcp` | Index MCP server |
| `INDEX_API_URL` | no | `https://protocol.index.network/api` | Index REST API |
| `INDEX_MCP_TIMEOUT_SECONDS` | no | `30` | Timeout for both MCP and API requests |
| `INDEX_TELEGRAM_USERNAME` | no | — | Forwarded as `x-index-telegram-username` when present |
| `INDEX_APP_BASE_URL` | no | `https://index.network` | Universal-link origin used for `appUrl` deep links and `index_open_app` |
| `INDEX_PLUGIN_MODE` | no | `full` | Runtime capability surface: `full` or `negotiator`; any unknown non-empty value fails closed to `negotiator` |

Override `INDEX_APP_BASE_URL` only for dev/staging environments, and only with a full
`https://<host>` origin — a value without an `https://` scheme (for example
`index.network`) is ignored and the default is used.

### Runtime modes

- **`full` (default):** preserves the existing broad MCP wrappers, `index_open_app`, negotiation tools, orchestrator and negotiator skills, pre-LLM hook, `/index` command, desktop dashboard installation, and plugin-local web dashboard routes/tab registration.
- **`negotiator`:** registers exactly `index_agent_me`, `index_pickup_negotiation`, `index_respond_negotiation`, `index_consult_owner`, and the `index-network:index-negotiator` skill. It registers no discovery or opportunity pickup/delivery capabilities, broad MCP wrappers, `index_open_app`, hook, command, orchestrator skill, or active dashboard API/component.

`plugin.yaml` lists the static package capability union for Hermes discovery. `register(ctx)` applies the tool/skill/hook/command mode boundary. Dashboard discovery is orthogonal to that function, so `dashboard/plugin_api.py` independently uses the same shared raw mode parser: in restricted mode its exported FastAPI router has no routes, and the web bundle does not register its component unless the full-only `/api/plugins/index-network/mode` endpoint confirms exact `full`. Missing or empty `INDEX_PLUGIN_MODE` remains backward-compatible full mode; an unknown non-empty, whitespace-only, or whitespace-padded value fails closed to negotiator mode.

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

**`index_open_app`** — opens an `https://index.network/...` universal link with the operating system's default handler (see [`index_open_app`](#index_open_app) below).

**`index_respond_negotiation`** — submits an autonomous negotiation response:

```json
{
  "agentId": "optional personal agent UUID",
  "negotiationId": "required negotiation UUID from pickup",
  "action": "propose | accept | reject | counter | question | outreach | withdraw | decline",
  "message": "required for counter/question; optional otherwise",
  "reasoning": "required private rationale",
  "suggestedRoles": {
    "ownUser": "agent | patient | peer",
    "otherUser": "agent | patient | peer"
  }
}
```

The handler maps this to the backend body shape (`action`, `message`, and an `assessment` object containing `reasoning` and `suggestedRoles`). The union covers v1 and v2 actions, but callers must copy one action from each pickup response's `allowedActions`; the server enforces the exact protocol-version, seat, and final-turn subset. `ask_user` is never accepted through this response tool.

**`index_consult_owner`** — pauses one eligible claimed turn for a privacy-minimal owner question:

```json
{
  "agentId": "optional personal agent UUID",
  "negotiationId": "required negotiation UUID from pickup",
  "disclosureSubject": "required minimal subject needing owner input",
  "draftQuestion": "optional concise owner question"
}
```

Use it only when pickup returns `canConsultOwner: true`. The handler resolves an omitted `agentId`, requires the negotiation and disclosure fields, and reconstructs the REST body from only `disclosureSubject` and optional `draftQuestion`; extra model-provided fields are never forwarded. A successful response has `status: "input_required"` and ends the pass—do not also submit a negotiation response.

### Opportunity deep links (`appUrl`)

Opportunity cards already carry `appUrl` when they come back from the Index MCP server:
the protocol mints `https://index.network/o/<opportunityId>` for every MCP-facing card,
so Claude Desktop, the CLI and the web get the same link Hermes does.

On top of that, every Index MCP response is post-processed before it is handed back to
Hermes: any object carrying a non-empty `opportunityId` — at any nesting depth, under
`data`, `opportunities`, or a wrapper of your own — gets an `appUrl` field:

```json
{
  "opportunityId": "6f1c...",
  "appUrl": "https://index.network/o/6f1c..."
}
```

An `appUrl` that the backend already set is never overwritten (the plugin mints the
identical bare `/o/<id>` form, so the two agree), and a payload with no opportunities is
passed through unchanged. The walk still earns its keep for payload shapes the protocol
does not build cards for — advisory envelopes, negotiation wrappers, API responses. It
runs over MCP responses only; the dashboard's REST writes are not rewritten.

These are **universal links**, not custom-scheme links. `https://index.network` serves
an `apple-app-site-association` file that claims `/c/*`, `/o/*` and `/u/*` for the Index
macOS app, so one URL covers both cases:

- Index macOS app installed → macOS opens the link directly in the app.
- App not installed → the browser opens the Index landing page for that link, whose CTA leads to `https://index.network/download`. That install page states the app is not yet publicly available until a signed release is published, and serves the real download once it is.

The plugin deliberately performs **no app-installation detection**. It runs wherever
the agent runs — often a headless server that is not the user's Mac — so probing the
local filesystem would hide deep links from real app users. One HTTPS link is always
attached and the operating system decides what to do with it at click time.

### `index_open_app`

Accepts:

```json
{
  "target": "optional https://index.network/... URL"
}
```

Opens the target with the OS default handler (`open` on macOS, `xdg-open` on Linux,
`rundll32 url.dll,FileProtocolHandler` on Windows — never `cmd /c start`, which would
re-parse shell metacharacters in the URL) and returns:

```json
{ "success": true, "url": "https://index.network/o/6f1c..." }
```

`target` defaults to `https://index.network` (or `INDEX_APP_BASE_URL`). Anything that is
not on that origin — including `index://` URLs and plain `http://` — is rejected: this
is an Index deep-link opener, not a generic URL opener. When the host has no usable URL
opener, the handler returns a JSON error that includes the `url` so the user can open it
manually. There is no app-installed/not-installed branch in the result.

## Skills, hook, and command

Two namespaced plugin skills are bundled. Full mode registers both automatically:

- `index-network:index-orchestrator` — signal/intent review and discovery preparation guidance.
- `index-network:index-negotiator` — autonomous personal-agent negotiation guidance for scheduled runs.

Negotiator mode registers only `index-network:index-negotiator`. Full mode also keeps the defensive `pre_llm_call` orchestrator hint and `/index` command; negotiator mode registers neither.

Plugin skills are namespaced and read-only — do not copy them into `~/.hermes/skills`.

## Dashboard

In full mode, the plugin ships an **Index Network** dashboard tab under `dashboard/`: an intent-centric master-detail view for answering pending Index questions (answered questions stay visible as settled records, Mac-app parity), opportunity accept/skip, community self-join, intent pause/archive, profile editing, a first-run **Getting started** profile gate (Mac `profileConfirmedAt` parity), and realtime direct messages. Hermes Desktop uses the same UI via `desktop/dist/` (built from that dashboard bundle); both hosts share the gate and `plugin_api.py` routes. The dashboard backend (`dashboard/plugin_api.py`) reuses `tools.py` for authentication, MCP forwarding, and timeouts, and it never claims or responds to negotiation turns — those remain explicit tool/skill flows.

Negotiator mode has no dashboard API or registered tab component. Hermes may statically discover `dashboard/manifest.json` in every installed package; the current manifest format has no environment-conditioned discovery field. That discovery is not runtime authorization. In negotiator, unknown non-empty, whitespace-only, or padded modes, the exported backend router is empty and `dist/index.js` registers no tab component because the full-only `/api/plugins/index-network/mode` endpoint is unavailable. Thus no dashboard API or tab component activates even if the host has already seen the static manifest. Full, absent, and empty modes retain the existing routes and tab behavior.

See [`dashboard/README.md`](./dashboard/README.md) for the full scope and runtime behavior.

## Autonomous negotiation

Hermes can act as the user's personal Index negotiator by running the negotiator skill through Hermes' gateway/cron mechanism. The owned schedule contract is:

- **Name:** `Index Personal Agent Negotiator`
- **Schedule:** `every 1m`
- **Prompt:** `Use skill_view("index-network:index-negotiator") and run one scheduled autonomous Index negotiation pass.`

The skill's scheduled-run contract:

1. call `index_pickup_negotiation()` once
2. if `pending=false`, respond exactly `[SILENT]`
3. inspect `protocolVersion`, `seat`, `turn.deadline`, `allowedActions`, and `canConsultOwner` with the returned context/history
4. either consult the owner when eligible or select one action verbatim from `allowedActions`
5. make at most one response or consultation call in the pass, then stop
6. report only a server-confirmed submission or `input_required` consultation

The one-minute interval keeps the selected personal-agent heartbeat fresh. The Index dispatcher falls back to the system negotiator when no personal agent has polled recently, so a slow or stopped cron can leave Index covering the work instead.

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
