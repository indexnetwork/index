# Index Network Hermes Dashboard

This directory contains the plugin-local Hermes dashboard tab for the Index Network plugin.

```text
dashboard/manifest.json   # Hermes dashboard plugin manifest
dashboard/dist/index.js   # no-build IIFE bundle registered with the Hermes Plugin SDK
dashboard/dist/style.css  # theme-aware styles scoped to .index-dashboard*
dashboard/plugin_api.py   # FastAPI routes mounted by Hermes dashboard
```

## Scope

The dashboard is intent-centric and write-enabled for pending-question answers, opportunity accept/skip, Discover self-join, intent archival, profile edits, and realtime direct messages. It is a single intent **master-detail** view (no segmented control):

- **Intents** — a master-detail layout. The intent list page is a two-column grid: the left **2/3** is the intents list (each intent with a Mac-app-parity status label — `live`/`paused` (the mac mapper hardcodes matches/pipeline to zero, so real rows never read matched or negotiating), active before paused — and the consolidated pending count; questions or opportunities not tied to any intent are not listed, matching the Mac app), and the right **1/3** is a side column holding a marketing pitch block above a compact **Networks** list (Index-web-style rows: `boring-avatars` bauhaus avatar, title, member count, **Owner**/**Member** badge; rows are static — they do not link out to the web app). The Networks card header has a **Discover** button that opens a modal of publicly joinable communities (from `read_networks` `publicNetworks`), each with a **Join** button wired to MCP `create_network_membership` self-join. Selecting an intent swaps the page for the detail layout. The right detail pane shows the selected intent's pending questions (with answer submission) above its opportunity **radar** (surfaced people grouped into a selectable status strip — **Awaiting you** (pending) / negotiating / accepted / **Missed** (expired), the same four tabs as the Mac app; `latent`/`draft` fold into pending, `stalled` into negotiating, and rejected opportunities are hidden entirely, Mac-app parity). The chips act as filters for the radar list and default to **Awaiting you**; selection resets per intent. Answering or skipping a question flips its card into a settled record immediately (Mac-app parity — hairline frame, muted prompt, "✓ answered" with the given answer quoted under a strong rule, or a faded "dismissed") instead of waiting for the next summary refresh to drop it; a failed write restores the form and shows the error. Answered records are server-backed — the summary reads `GET /questions?status=answered&scopeType=intent&scopeId=…` per intent (the server's canonical intent scope, the exact query the Mac app uses) and carries the results oldest-first as `answeredQuestions` — so both surfaces show the identical record set and order, surviving reloads and including answers given elsewhere; skipped records stay session-local (the questions API does not list dismissed rows). Cards in the **Awaiting you** bucket carry **Accept** and **Pass** buttons in the card's top-right corner (Mac-app `MatchCard` parity — no footer row), wired to MCP `update_opportunity` (`accepted`/`rejected`); accepting opens the resulting conversation in the in-dashboard **Messages** panel (falling back to the Index web chat, `INDEX_WEB_URL`, only if no conversation id is returned). When the uptake guard returns preparatory questions, the dashboard keeps the card pending, shows the question text, and requires explicit confirmation before retrying with the advisory's current question IDs. Already-**accepted** cards carry a single **Open chat ›** button in the same top-right spot that resolves (or creates) the H2H DM with the counterpart via `POST /conversations/dm` (`create_dm`) and opens it in the Messages panel — matching the web app's get-or-create-DM behavior; the external `chatUrl` link remains only as a fallback when no `counterpartUserId` is known. The intent detail header carries a grouped pause/archive pill: the pause segment (amber; green resume while paused) flips the intent's lifecycle optimistically via `PATCH /intents/:id/status`, and the trash segment **archives** via `PATCH /intents/:id/archive` — first click arms it ("sure?", auto-disarms after 4s), second click commits; no native confirm dialog.

Before anything else, the tab checks `GET /auth/status`. When the plugin has no working `INDEX_API_KEY` (missing, or `GET /auth/me` returns 401/403), it renders a **Log in with browser** gate that runs the same `/cli-auth` handshake as the Index Mac app and CLI: `POST /auth/login/start` binds an ephemeral loopback listener and opens `{appUrl}/cli-auth?callback=…&version=2&state=…`; the web app mints a CLI API key and redirects to the callback; the UI polls `GET /auth/login/status` until the backend has persisted the key into `~/.hermes/.env` (`INDEX_API_KEY`, plus `INDEX_API_KEY_ID` for later revoke) and `os.environ`. The `/cli-auth` origin is paired with the active API environment: an explicit `INDEX_APP_BASE_URL` wins, otherwise it is derived from `INDEX_API_URL` by dropping a leading `protocol.` host label (`protocol.dev.index.network` → `dev.index.network`), so a dev/staging-configured plugin signs in against the matching web app instead of minting a prod key that would 401 against the dev API. If the plugin runs on a headless/remote agent host where no browser can open, the start response's `authUrl` is surfaced as a manual link. **Sign out** (in Profile & settings) best-effort revokes the key via `POST /auth/cli-credential/revoke` and clears it from `~/.hermes/.env`, returning to the login gate. Setting `INDEX_API_KEY` manually still works as an override and skips the gate.

On first open, when `users.onboarding.profileConfirmedAt` is missing, the tab gates behind a **Getting started** profile review (Mac-app parity): it runs `POST /enrichment/enrich`, lets the user edit the draft, and confirms via MCP `confirm_user_context` plus `PATCH /auth/profile/update` so the durable marker is set. Hermes Desktop renders the same gate from `desktop/dist/plugin.js` (rebuild with `bun run build:desktop` after dashboard changes; reload desktop plugins and restart the gateway so `plugin_api.py` routes load).

A separate **Profile & settings** panel is reached from an account button in the dashboard header. It mirrors the Index web `/u/` profile and the web settings **Profile Settings** + **Notification Settings** tabs: identity (avatar upload, name, location, intro, socials) and notifications (timezone + email preferences).

A **Messages** panel is reached from a messages button in the dashboard header (and opens automatically when an opportunity is accepted). It lists the caller's conversations, renders the selected thread, and posts new messages. The conversation list shows **only human-to-human (H2H) conversations** — matching the web app's Messages view (`ChatSidebar`), it lists conversations with exactly two `user`-type participants and excludes human-to-agent and agent negotiation threads. It is searchable, sorted by most recent activity, and shows an unread dot + bold title for threads with newer activity than the locally tracked last-read marker (`localStorage["index_msg_read"]`). Message bubbles resolve text from both plain (`type`) and agent (`kind`) parts, including `data.message`/`data.assessment.reasoning`; a message that is a bare agent assessment (reasoning only) renders as a dashed **Internal assessment** bubble. Ownership (right-aligned "mine") matches either the bare `userId` (DMs) or the `agent:<userId>` participant (negotiations). Realtime append is driven by **authoritative streaming**, mirroring the web app's `ConversationContext`: the `/conversations/stream` relay emits `message` frames that are deduped by id, appended to the open thread, and folded into the conversation summaries (a frame for an unknown conversation triggers a list refresh). The connection reconnects with exponential backoff (`5s * 2^n`, capped at 60s, up to 10 attempts). Sends are **optimistic** — the outgoing bubble and summary update render immediately, then reconcile with the server row (deduping if the stream delivered it first) and roll back on failure. There is no interval polling.

The stream is consumed with **`SDK.authedFetch` + a streaming body reader** (parsing `text/event-stream` frames manually), not a raw `EventSource`. This is the key difference from the web app: a browser `EventSource` cannot set the Hermes dashboard session header (`X-Hermes-Session-Token`, injected in loopback mode) and the host does not accept a `?token=` query param on plugin routes, so `EventSource` would fail to authenticate on the default desktop. `authedFetch` applies the same session auth as `SDK.fetchJSON` (header in loopback, cookies in gated mode), while the plugin backend still relays the upstream Redis stream with its own `x-api-key`.

### Native Desktop notification delivery

The generated native plugin uses only authenticated Hermes Plugin SDK transports. `ctx.socket('/notifications/socket')` and `ctx.socket('/conversations/socket')` connect to plugin WebSockets that relay the upstream Index SSE streams; native code does not read session tokens or call raw `window.fetch`. In parallel, `ctx.rest('/notifications/snapshot')` runs immediately and every 60 seconds as persisted fallback for pending questions and actionable latent/pending opportunities. The first successful snapshot establishes a silent baseline; subsequent unseen entities share canonical dedupe keys with realtime events, so a question or opportunity is notified at most once across both paths. Snapshot reconciliation still runs if socket setup is unavailable.

Index notification stream and snapshot endpoints reject network-scoped API keys before subscribing to Redis or reading snapshot state. User-wide notification events do not yet have authoritative per-network provenance, so scoped agents cannot safely consume them. Direct messages are deliberately realtime-only and never reconstructed from the snapshot; own-user and `agent:<userId>` messages are suppressed, and message alerts fail closed until the current identity is known.

Opportunity cards in an intent radar are clickable: selecting one opens the visible counterpart's **read-only** profile (the web `/u/:id` equivalent) in the same panel.

The selected intent is mirrored into the URL hash (`#intent=<id>`) so browser Back/Forward navigate between intents. Boot loads only auth metadata and the intents list via `GET /bootstrap`; selecting an intent triggers lazy fetches for that intent's questions and radar.

The backend route reuses `../tools.py` rather than creating a second Index client. That keeps `INDEX_API_KEY`, `INDEX_MCP_URL`, timeout handling, Telegram forwarding, MCP response decoding, and network-scoped agent visibility in one place.

The dashboard's persisted writes are: submitting an answer to an existing pending question, accepting/skipping an opportunity (MCP `update_opportunity` → `accepted`/`rejected`), self-joining an open community from the Networks **Discover** tab (MCP `create_network_membership`), archiving an intent (`PATCH /intents/:id/archive`), submitting an early-access "create a network" request (`POST /network-requests`, plus `PATCH`/`DELETE` to update or withdraw it), profile edits (`PATCH /auth/profile/update` + avatar upload to `POST /storage/avatars`), and sending direct messages (`POST /conversations/:id/messages`) — all scoped to the authenticated user/API-key principal.

The Profile panel reads what the plugin's `INDEX_API_KEY` can reach (`GET /profile` → identity name/bio/location/context via MCP `read_user_contexts` self-read, avatar/socials via public `GET /users/:id`, and email/timezone/notification preferences via `GET /auth/me`). Since #1077 unified `AuthGuard` to accept `x-api-key`, profile saves (`PATCH /profile` → `PATCH /auth/profile/update`) and avatar uploads (`POST /profile/avatar` → multipart `POST /storage/avatars`) persist for real; only `email` stays read-only (it is not in the profile update schema). The `POST /profile/intro` backend route still exists but the UI no longer exposes intro generation. The read-only counterpart view (`GET /profile/:id`) is backed by the public `GET /users/:id` plus `read_user_contexts(userId)` and is constrained to the current user's visible opportunity counterparts; the counterpart's `userId` is derived from the opportunity's non-introducer actors.

Conversations are served through participant-gated proxy routes: `GET /conversations` (normalized to counterpart summaries), `POST /conversations/dm`, `GET|POST /conversations/:id/messages`, and a `GET /conversations/stream` SSE relay that opens the upstream Redis-pub/sub stream with the plugin `x-api-key` and re-emits frames to the tab.

It does **not**:

- claim pending negotiation turns;
- submit negotiation responses;
- run discovery;
- create networks directly (that stays staff-only on the server; the Networks card's **Create** button submits a reviewed request instead), claim or delete intents, or mutate other Index records beyond the writes listed above (question answers, opportunity accept/skip, Discover self-join, intent archive, network requests, profile edits, and DM messages);
- expose raw tool envelopes, tokens, or assistant reasoning.

## Runtime behavior

Hermes discovers this dashboard manifest and mounts its backend independently of the Python plugin's `register(ctx)`. Runtime authorization is therefore independent too. `plugin_api.py` attaches every route to an internal full router, reads `INDEX_PLUGIN_MODE` through the package's shared raw parser, and exports those routes only for absent, empty, or exact `full`. For `negotiator`, an unknown non-empty value, whitespace-only, or a padded value, its exported router is empty: boot/detail APIs, write routes, realtime relays, assets, and even the mode probe are unavailable. The static manifest can still be discovered because the host manifest format has no conditional environment field, but discovery alone activates neither an API nor a component.

The web bundle first requests the full-only `/api/plugins/index-network/mode` endpoint. It registers the `index-network` component only after receiving exactly `{ "success": true, "mode": "full" }`; a missing/rejected/non-full response leaves the bundle inert. After that gate, calls use `SDK.fetchJSON`, so Hermes dashboard session authentication is handled by the host.

**Boot (`GET /bootstrap`, or the deprecated `/summary` alias):** `GET /auth/me` plus `POST /intents/list` (page 1, limit 100). Intent rows carry `pendingCount` from `pendingQuestionCount + waitingOpportunityCount` only — no embedded questions, opportunities, or status counts.

**Intent drill-down (on selection):** parallel lazy fetches per intent:

- `GET /intents/{id}/questions?status=pending|answered` → proxies to scoped `GET /questions`
- `GET /intents/{id}/radar` → proxies to `GET /opportunities/radar?scopeType=intent&scopeId=…&statuses=latent,pending,negotiating,stalled,accepted,expired`; accepts `presentation=skeleton` for a fast first paint, then a full pass replaces it

**Networks (lazy):** when the Networks column mounts, `GET /networks/home` fetches `GET /networks` and `GET /networks/discovery/public` in parallel.

Auto-refresh re-fetches bootstrap intents and, when an intent is selected, that intent's detail fetches only — not a global fan-out across all intents. Full mode also exposes the authenticated conversation and actionable-notification SSE/WebSocket relays added by the desktop integration.

Question answers are submitted to `/api/plugins/index-network/questions/:id/answer`; the plugin backend validates the small answer payload and forwards it to Index's `/api/questions/:id/answer` endpoint with the configured `INDEX_API_KEY`. Negotiation conversation threads are not rendered — only the per-signal radar status counts (derived client-side from loaded radar items).

## Verify

From the monorepo root:

```bash
cd packages/hermes-plugin && bun run test
```

The smoke command includes Python exported-router cases and JavaScript registration cases for absent, empty, exact `full`, `negotiator`, unknown, whitespace-only, and padded values. For manual Hermes dashboard testing, restart `hermes dashboard` after changing `plugin_api.py` or `INDEX_PLUGIN_MODE` (backend routes are selected and mounted at dashboard startup). For asset-only changes, refresh plugin discovery:

```bash
curl http://127.0.0.1:9119/api/dashboard/plugins/rescan
```

Then open `hermes dashboard` and visit the **Index Network** tab.
