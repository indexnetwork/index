# Index Network Hermes Dashboard

This directory contains the plugin-local Hermes dashboard tab for the Index Network plugin.

```text
dashboard/manifest.json   # Hermes dashboard plugin manifest
dashboard/dist/index.js   # no-build IIFE bundle registered with the Hermes Plugin SDK
dashboard/dist/style.css  # theme-aware styles scoped to .index-dashboard*
dashboard/plugin_api.py   # FastAPI routes mounted by Hermes dashboard
```

## Scope

The dashboard is intent-centric and write-enabled for pending-question answers. A segmented control switches between three views:

- **Intents** — a master-detail layout. The left list shows each intent with a derived status and its opportunity/question counts, plus a pinned **General** entry for questions not tied to any intent. The right detail pane shows the selected intent's pending questions (with answer submission) above its opportunity **radar** (surfaced people grouped into a ready/negotiating/accepted/expired status strip).
- **Negotiations** — a flat list of every opportunity currently in negotiation (status `pending`/`negotiating`/`stalled`) across all intents, each card subtitled with its originating intent.
- **Networks** — the authenticated user's joined and owned networks.

View and selected intent are mirrored into the URL hash (`#intent=<id>`, `#intent=general`, `#view=negotiations`, `#view=networks`) so browser Back/Forward navigate between intents; everything loads from a single `/summary` call, so switching intents is client-side.

The backend route reuses `../tools.py` rather than creating a second Index client. That keeps `INDEX_API_KEY`, `INDEX_MCP_URL`, timeout handling, Telegram forwarding, MCP response decoding, and network-scoped agent visibility in one place.

The dashboard's only write is submitting an answer to an existing pending question owned by the authenticated user/API-key principal.

It does **not**:

- claim pending negotiation turns;
- submit negotiation responses;
- run discovery;
- create, update, or delete other Index records;
- expose raw tool envelopes, tokens, raw messages, or assistant reasoning.

## Runtime behavior

The tab registers as `index-network` and fetches `/api/plugins/index-network/summary` through `SDK.fetchJSON`, so Hermes dashboard session authentication is handled by the host. The summary endpoint reads intents via the MCP `read_intents` tool, opportunities via the REST `GET /opportunities` endpoint (whose raw rows carry the intent linkage MCP opportunity cards omit — `actors[].intent` / `detection.triggeredBy`), pending questions via MCP `read_pending_questions`, and networks via MCP `read_networks` / `read_network_memberships`. It then groups questions and opportunities under their intent (intent-mode questions by `sourceId`; negotiation questions joined through the opportunity map; enrichment/discovery questions into the General bucket) and returns dashboard-safe `intents`, `general`, `negotiations`, `networks`, and `totals`. Question answers are submitted to `/api/plugins/index-network/questions/:id/answer`; the plugin backend validates the small answer payload and forwards it to Index's `/api/questions/:id/answer` endpoint with the configured `INDEX_API_KEY`. Negotiation conversation threads are not rendered — only the per-signal radar status counts.

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
