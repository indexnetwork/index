# Index Network Hermes Dashboard

The dashboard is the optional full-mode UI for the Index Hermes plugin. It is not an authority boundary: production API and MCP calls go through the signed Index Connector, which keeps the dedicated Hermes credential in its own Keychain identity. The dashboard-to-connector boundary is credential-free.

## Connection and status

In full mode the tab displays **Connect to Index**, connection health, expiry, reconnect warning, and recovery-only disconnect status. Browser authorization is started and polled by the connector; the dashboard never receives a credential, PKCE verifier, authorization code, endpoint override, or plaintext owner/Hermes secret. The browser callback is canonical loopback PKCE, and the connector returns only sanitized nonsecret status.

Credentials expire after 30 days and warn in the final seven days. Reconnect is a new browser authorization, not a refresh. A failed or uncertain disconnect remains visibly recovery-only and retries connector-owned revocation; it must not be reported as successful until server revocation and local Keychain cleanup are confirmed.

## Scope

Full mode exposes the normal Index dashboard surface: intent and question work, opportunities, networks, profile context, and bounded conversation SSE. Uploads and streams use the connector's fixed allowlists and bounds. Scheduled negotiation actions are intentionally absent from dashboard flows.

`INDEX_PLUGIN_MODE=negotiator` (and every unknown non-empty mode) exposes no dashboard routes or component. Negotiator mode is restricted to the four registered negotiation handlers and generated negotiator skill; static manifest discovery does not activate this UI.

The dashboard bundle is generated. Build it from the package root with:

```bash
bun run build:desktop
python3 tests/smoke.py
```

Do not edit `dashboard/dist/` or `desktop/dist/` directly.
