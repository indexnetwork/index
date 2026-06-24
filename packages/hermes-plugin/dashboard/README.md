# Index Network Hermes Dashboard

This directory contains the plugin-local Hermes dashboard tab for the Index Network plugin.

```text
dashboard/manifest.json   # Hermes dashboard plugin manifest
dashboard/dist/index.js   # no-build IIFE bundle registered with the Hermes Plugin SDK
dashboard/dist/style.css  # theme-aware styles scoped to .index-dashboard*
dashboard/plugin_api.py   # FastAPI routes mounted by Hermes dashboard
```

## Scope

The dashboard is live and write-enabled for pending-question answers. It shows the authenticated Index user's:

- pending questions, with answer submission;
- intents;
- opportunities;
- negotiation activity summary;
- joined networks.

The backend route reuses `../tools.py` rather than creating a second Index client. That keeps `INDEX_API_KEY`, `INDEX_MCP_URL`, timeout handling, Telegram forwarding, MCP response decoding, and network-scoped agent visibility in one place.

The dashboard's only write is submitting an answer to an existing pending question owned by the authenticated user/API-key principal.

It does **not**:

- claim pending negotiation turns;
- submit negotiation responses;
- run discovery;
- create, update, or delete other Index records;
- expose raw tool envelopes, tokens, raw messages, or assistant reasoning.

## Runtime behavior

The tab registers as `index-network` and fetches `/api/plugins/index-network/summary` through `SDK.fetchJSON`, so Hermes dashboard session authentication is handled by the host. The summary endpoint calls existing Index tools for pending questions, intents, intent-network assignments, opportunities, negotiation activity counts, and networks, then returns dashboard-safe data. Question answers are submitted to `/api/plugins/index-network/questions/:id/answer`; the plugin backend validates the small answer payload and forwards it to Index's `/api/questions/:id/answer` endpoint with the configured `INDEX_API_KEY`. Negotiations are intentionally aggregated instead of listed because this dashboard does not render conversation threads.

## Verify

From the monorepo root:

```bash
cd packages/hermes-plugin && bun run test
```

For manual Hermes dashboard testing, restart `hermes dashboard` after changing `plugin_api.py` (backend routes are mounted at dashboard startup). For asset-only changes, refresh plugin discovery:

```bash
curl http://127.0.0.1:9119/api/dashboard/plugins/rescan
```

Then open `hermes dashboard` and visit the **Index Network** tab.
