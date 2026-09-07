# Index Network Hermes Plugin

The Index plugin connects Hermes to Index over plain HTTPS, authenticated with this device's own Index session.

## Connect

```bash
hermes plugins install indexnetwork/hermes-plugin
```

Connect to Index by opening the **Index** dashboard and choosing **log in with browser** — the same `/cli-auth` handshake the Index CLI and Mac app use. The web page runs the device authorization grant against your browser session and returns a short-lived device code, which the plugin exchanges for its own session token and persists as `INDEX_SESSION_TOKEN` in `~/.hermes/.env`. There is no approval prompt. **Sign out** revokes that session server-side and clears the local file. On a headless host the dashboard shows the login link to open elsewhere.

Optional overrides: `INDEX_API_URL` and `INDEX_MCP_URL` (default to production endpoints). Browser login pairs with the configured API environment (`INDEX_APP_BASE_URL` wins, else derived from `INDEX_API_URL`).

The session authenticates you, not an agent. `GET /agents/me` returns the agent you selected as your negotiator in the web app; pick one there before expecting an answer.

## Development

Build generated desktop output only through its script:

```bash
cd packages/hermes-plugin
bun run build:desktop
python3 tests/smoke.py
python3 tests/gateway.py
```

`plugin.yaml` is the static package capability union. Do not edit `desktop/dist/plugin.js` manually.
