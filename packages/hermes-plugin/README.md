# Index Network Hermes Plugin

The Index plugin connects Hermes to Index over plain HTTPS, authenticated with an agent API key.

## Connect

```bash
hermes plugins install indexnetwork/hermes-plugin
```

Connect to Index by opening the **Index** dashboard and choosing **log in with browser** — the same `/cli-auth` handshake the Index CLI and Mac app use. The handshake mints a CLI owner key, then the plugin registers or reuses the Hermes agent, mints an agent-bound token, and persists that token as `INDEX_API_KEY` in `~/.hermes/.env`. The CLI key is revoked after bootstrap. **Sign out** clears the local key. On a headless host the dashboard shows the login link to open elsewhere.

Manual override: set an agent API key yourself instead of using the browser flow:

```bash
export INDEX_API_KEY=<your Index agent API key>
```

Optional overrides: `INDEX_API_URL` and `INDEX_MCP_URL` (default to production endpoints). Browser login pairs with the configured API environment (`INDEX_APP_BASE_URL` wins, else derived from `INDEX_API_URL`).

`GET /agents/me` needs the agent-bound token, not the CLI owner key. The agent token can be revoked from web settings.

There is no pickup/claim — a negotiation stays `working` until it pauses or resolves. `index_respond_negotiation` forwards one authored turn to MCP's `respond_to_negotiation`, which routes it through `NegotiationGraph` apply. It accepts only `outreach`, `counter`, `question`, or `needs_principal`/`ready_for_verdict` pauses; it cannot accept, decline, withdraw, or resolve a negotiation.

## Modes and capability boundary

`full` (the default) registers the normal Index tool/dashboard surface. `negotiator` registers exactly two handlers:

1. `index_agent_me`
2. `index_respond_negotiation`

The negotiator is a restricted scheduled-execution surface. Its response uses the same authenticated MCP turn contract as other external agents. `INDEX_PLUGIN_MODE=negotiator` is fail-closed for unknown non-empty values. It has no dashboard, broad MCP wrappers, hook, command, or orchestrator skill.

## Development

Build generated desktop output only through its script:

```bash
cd packages/hermes-plugin
bun run build:desktop
python3 tests/smoke.py
python3 tests/gateway.py
```

`plugin.yaml` is the static package capability union; package registration applies the runtime mode boundary. Do not edit `desktop/dist/plugin.js` manually.
