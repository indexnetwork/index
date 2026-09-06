# Index Network Hermes Plugin

The Index plugin connects Hermes to Index over plain HTTPS, authenticated with your Index API key.

## Connect

```bash
hermes plugins install indexnetwork/hermes-plugin
```

Connect to Index by opening the **Index** dashboard and choosing **log in with browser** — the same `/cli-auth` handshake the Index CLI and Mac app use. The handshake mints an API key for your account and persists it as `INDEX_API_KEY` in `~/.hermes/.env`. **Sign out** revokes that key and clears it. On a headless host the dashboard shows the login link to open elsewhere.

Manual override: set a key from web settings instead of using the browser flow:

```bash
export INDEX_API_KEY=<your Index API key>
```

Optional overrides: `INDEX_API_URL` and `INDEX_MCP_URL` (default to production endpoints). Browser login pairs with the configured API environment (`INDEX_APP_BASE_URL` wins, else derived from `INDEX_API_URL`).

The key authenticates you, not an agent. `GET /agents/me` returns the agent you selected as your negotiator in the web app; pick one there before expecting an answer.

## Development

Build generated desktop output only through its script:

```bash
cd packages/hermes-plugin
bun run build:desktop
python3 tests/smoke.py
python3 tests/gateway.py
```

`plugin.yaml` is the static package capability union. Do not edit `desktop/dist/plugin.js` manually.
