# Index Network Hermes Dashboard

The dashboard is the optional UI for the Index Hermes plugin. It is not an authority boundary: every HTTP API call goes through the plugin's Python transport, which holds the `INDEX_SESSION_TOKEN` credential in the Hermes process environment. The dashboard-to-transport boundary is credential-free: the browser JavaScript never receives the token.

## Connection and status

The tab displays connection status. When no `INDEX_SESSION_TOKEN` is configured, the login screen offers **log in with browser**: `POST /auth/login/start` binds a loopback callback and opens the web `/cli-auth` handshake (returning the URL as a manual link for headless hosts), and the UI polls `GET /auth/login/status`, which exchanges the returned device code for a session token and persists it to the Hermes env file. **Sign out** (`POST /auth/logout`) revokes that session server-side and clears the local file.

## Scope

The dashboard exposes intent work, opportunities, networks, profile context, and bounded conversation SSE.

`dashboard/index.js` is the dashboard JavaScript source. Build the dashboard and desktop bundles from the package root with:

```bash
bun run build:desktop
python3 -m py_compile dashboard/plugin_api.py
```

`bun run build:dashboard` rebuilds only the dashboard bundle. Do not edit generated JavaScript in `dashboard/dist/` or `desktop/dist/` directly. The dashboard uses authoritative `agent.pending`, submits the whole displayed batch, and keeps drafts when a write fails.
