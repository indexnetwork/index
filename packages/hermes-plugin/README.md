# Index Network Hermes Plugin

The Index plugin connects Hermes to Index over plain HTTPS, authenticated with an agent API key.

## Connect

```bash
hermes plugins install indexnetwork/hermes-plugin
```

Connect to Index by opening the **Index** dashboard and choosing **log in with browser** — the same `/cli-auth` handshake the Index CLI and Mac app use. It mints a 90-day CLI API key and persists it as `INDEX_API_KEY` in `~/.hermes/.env`; **Sign out** revokes it and clears the file. On a headless host the dashboard shows the login link to open elsewhere.

Manual override: set the key yourself instead of using the browser flow:

```bash
export INDEX_API_KEY=<your Index API key>
```

Optional overrides: `INDEX_API_URL` and `INDEX_MCP_URL` (default to production endpoints). Browser login pairs with the configured API environment (`INDEX_APP_BASE_URL` wins, else derived from `INDEX_API_URL`).

The key is an ordinary Index API key: it can be revoked at any time from web settings, and it expires per its configured lifetime.

## Modes and capability boundary

`full` (the default) registers the normal Index tool/dashboard surface. `negotiator` registers exactly four handlers:

1. `index_agent_me`
2. `index_pickup_negotiation`
3. `index_respond_negotiation`
4. `index_consult_owner`

The negotiator is a separate server-enforced scheduled-execution boundary: pickup/respond/consult require the selected agent and native hidden one-shot run authority with closed action contracts. `INDEX_PLUGIN_MODE=negotiator` is fail-closed for unknown non-empty values. It has no dashboard, broad MCP wrappers, hook, command, or orchestrator skill.

## Development

Build generated desktop output only through its script:

```bash
cd packages/hermes-plugin
bun run build:desktop
python3 tests/smoke.py
python3 tests/gateway.py
```

`plugin.yaml` is the static package capability union; package registration applies the runtime mode boundary. Do not edit `desktop/dist/plugin.js` manually.
