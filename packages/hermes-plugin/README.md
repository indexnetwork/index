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

## Development

Build generated desktop output only through its script:

```bash
cd packages/hermes-plugin
bun run build:desktop
python3 tests/smoke.py
python3 tests/gateway.py
```

`plugin.yaml` is the static package capability union. Do not edit `desktop/dist/plugin.js` manually.
