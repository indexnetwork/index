# Index Network Hermes Dashboard

The dashboard is the optional full-mode UI for the Index Hermes plugin. It is not an authority boundary: API and MCP calls go through the plugin's Python transport, which holds the `INDEX_API_KEY` agent credential in the Hermes process environment. The dashboard-to-transport boundary is credential-free: the browser JavaScript never receives the API key.

## Connection and status

In full mode the tab displays connection status. When no `INDEX_API_KEY` is configured, the login screen explains how to create an agent API key in Index web settings and set it in the Hermes environment. Revoke the key from web settings to disconnect permanently.

## Scope

Full mode exposes the normal Index dashboard surface: intent and question work, opportunities, networks, profile context, and bounded conversation SSE. Scheduled negotiation actions are intentionally absent from dashboard flows.

`INDEX_PLUGIN_MODE=negotiator` (and every unknown non-empty mode) exposes no dashboard routes or component. Negotiator mode is restricted to the four registered negotiation handlers and generated negotiator skill; static manifest discovery does not activate this UI.

The dashboard bundle is generated. Build it from the package root with:

```bash
bun run build:desktop
python3 tests/smoke.py
```

Do not edit `dashboard/dist/` or `desktop/dist/` directly.
