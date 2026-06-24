# Index Network Hermes Dashboard

This directory contains the plugin-local Hermes dashboard tab for the Index Network plugin.

```text
dashboard/manifest.json   # Hermes dashboard plugin manifest
dashboard/dist/index.js   # no-build IIFE bundle registered with the Hermes Plugin SDK
dashboard/dist/style.css  # theme-aware styles scoped to .index-dashboard*
```

## Scope

The dashboard is intentionally static and read-only. It gives Hermes users protocol-aligned guidance for Index Network signals, communities, and autonomous negotiator setup without exposing Python dashboard routes or creating a second Index data contract.

It does **not**:

- mount Python backend routes;
- call live Index MCP or REST APIs;
- claim pending negotiation turns;
- submit negotiation responses;
- run discovery;
- expose raw tool output, internal identifiers, tokens, raw messages, or assistant reasoning.

## Runtime behavior

The tab always registers as `index-network` and renders static protocol-aligned guidance through `dist/index.js` and `dist/style.css`.

Live dashboard routes are deliberately deferred until Hermes exposes a documented route-auth mechanism for this plugin source. When that work is reintroduced, route handlers should live behind explicit authentication and continue reusing the native handlers in `../tools.py`; do not add direct Index MCP or REST client code in the dashboard.

## Verify

From the monorepo root:

```bash
cd packages/hermes-plugin && bun run test
```

For manual Hermes dashboard testing, refresh plugin discovery after installing or changing dashboard files:

```bash
curl http://127.0.0.1:9119/api/dashboard/plugins/rescan
```

Then open `hermes dashboard` and visit the **Index Network** tab. The tab should render static guidance without requiring Python dashboard routes.