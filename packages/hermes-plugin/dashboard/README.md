# Index Network Hermes Dashboard

The dashboard is the optional UI for the Index Hermes plugin. It is not an authority boundary: API and MCP calls go through the plugin's Python transport, which holds the `INDEX_SESSION_TOKEN` credential in the Hermes process environment. The dashboard-to-transport boundary is credential-free: the browser JavaScript never receives the token.

## Connection and status

The tab displays connection status. When no `INDEX_SESSION_TOKEN` is configured, the login screen offers **log in with browser**: `POST /auth/login/start` binds a loopback callback and opens the web `/cli-auth` handshake (returning the URL as a manual link for headless hosts), and the UI polls `GET /auth/login/status`, which exchanges the returned device code for a session token and persists it to `~/.hermes/.env`. **Sign out** (`POST /auth/logout`) revokes that session server-side and clears the local file.

## Scope

The dashboard exposes intent work, opportunities, networks, profile context, and bounded conversation SSE.

The dashboard bundle is generated. Build it from the package root with:

```bash
bun run build:desktop
python3 tests/smoke.py
```

Do not edit `dashboard/dist/` or `desktop/dist/` directly.
