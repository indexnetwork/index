# Changelog


## 0.41.1

### Fixed
- Opening Discover while another Hermes view is already showing. The host
  renders the page inside the workspace pane, so a focused session tile (or
  `hermes://open/index-network` while that tile is up) left the dashboard
  behind it until restart. Discover now fronts a workspace tab when the pane
  is covered.

## 0.41.0

### Changed
- **Hermes now runs the Index negotiator instead of reimplementing it.** The
  plugin previously carried its own copy of the negotiation logic — an inbox
  state machine in SQLite, work IDs and turn fencing in `negotiation.py`, and a
  generated `SKILL.md` that reproduced the canonical prompts — driven by the
  Hermes agent loop through six native tools. That copy has been deleted. The
  negotiator is now `@indexnetwork/agent`, the same package the hosted Index
  runtime executes, running as a supervised Bun process
  (`runtime/dist/negotiator.js`). Prompts, tools, policies, the state machine,
  the question flow, and the persistence model are whatever that package does;
  none of them are described here any more.
- Hermes's role is execution, not negotiation. It supplies the model — one
  tool-capable completion per call through the host's `auxiliary_client.call_llm`,
  so provider choice, credentials, and fallback stay with Hermes — plus the
  owner's conversation and this machine. **Bun is now required** to run the
  personal agent.
- Owner input is handed to the negotiator and reported consumed, so Hermes no
  longer reasons about a message that belongs to a focused signal, and can no
  longer answer on the owner's behalf. A refused or undeliverable message falls
  through to ordinary Hermes conversation instead of being swallowed.
- Negotiation state moved out of `principal.sqlite3`, which now holds only which
  account and agent this machine negotiates for. The inbox, H2A transcript,
  questions, and match progress are the agent package's own checkpoints, one JSON
  file per signal under `$HERMES_HOME/index-network/negotiator/`. **Existing
  in-flight negotiation state does not migrate**; matches are re-read from Index
  and reconsidered from scratch.
- Questions from this negotiator are delivered only to the bound Hermes
  conversation. An entry Hermes could not deliver stays undelivered and is
  offered again, rather than being recorded as sent.

### Removed
- Native tools `index_list_negotiations`, `index_read_negotiation`,
  `index_submit_turn`, `index_request_principal_input`,
  `index_read_principal_inbox`, and `index_review_principal_inbox`. The
  negotiator no longer reaches Index through Hermes tools.
- Hooks `pre_tool_call`, `transform_llm_output`, and `post_llm_call`, and the
  `personal-agent` plugin skill. The event platform no longer opens a Hermes chat
  per signal, so there is no session to scope, filter, or render output for.

## 0.40.0

### Changed
- **Choosing Hermes as your negotiator now starts it.** Previously that choice
  only claimed the Index slot, which stopped the hosted negotiator without
  putting anything in its place: turns sat unanswered until the personal agent
  was separately enabled from a private gateway conversation. Selecting Hermes
  in **Settings → Advanced** now also writes this machine's binding, so the
  event reader follows `/events` and takes turns within a few seconds. Choosing
  the hosted Index negotiator, or another registered agent, stops it.
- Background turns no longer need an owner conversation. A machine selected
  from the dashboard has none, so questions and updates stay in the private
  inbox until `index_configure_personal_agent` supplies one from a private
  gateway conversation, which now overlays the existing binding rather than
  refusing it. Owner replies still come only from that conversation.

## 0.39.0

### Added
- An **Advanced** menu in the dashboard's Settings panel, holding two owner
  controls that were previously only reachable from the web app: **Settings**,
  which chooses the agent that negotiates for you, and **Negotiations**, which
  lists the exchanges still open. Both are optional and sit outside sign-in.
- Dashboard REST bridge for them: `GET`/`POST /agents`,
  `PATCH /agents/:id { handleNegotiations }`, and `GET /negotiations`. Picking
  Hermes registers it first when it has no agent record yet; picking the hosted
  Index negotiator releases the binding, which is how the API reads that choice.

### Fixed
- One environment for sign-in and for requests. The API origin is now resolved in
  a single place, and derived from `INDEX_APP_BASE_URL` when `INDEX_API_URL` is
  absent (`dev.index.network` -> `protocol.dev.index.network`). An env carrying
  only the web origin previously approved a device code on dev and redeemed it on
  production, which answers 404, so browser sign-in failed after the handshake
  succeeded. Hosts outside `index.network` are left alone.
- Device sign-in reports why it failed — endpoint, status, and the server's own
  description — instead of collapsing every cause into "please try again".

## 0.38.0

### Added
- Native personal-agent negotiation using Hermes's configured model, tools, and
  skills. Work is woken by the owner's Index event stream: the plugin registers an
  `index` gateway platform that follows `GET /events` and opens one bounded run,
  in a chat of its own, for the signal a frame names. Frames arriving together for
  one signal collapse into a single run, and every reconnection reconciles against
  `GET /negotiations`, so a frame missed while the gateway was down costs nothing.
- A durable private inbox with stable questions, scoped native owner replies,
  context revisions, and one submission attempt per match in each native run.
- Shared instruction assets generated from `packages/agent`, and an atomic executor
  check on turn submissions (requires Index API 0.117.0).

### Operating requirements
- Enable the personal agent from a private Hermes gateway conversation and keep
  the gateway running. CLI/Desktop-only sessions retain the general Index tools.
- Requires a Hermes with `register_platform` (checked at `63279301bc`).
- Human connection approval remains separate from A2A agreement.

## 0.37.0

- Call the Index REST API directly over HTTPS instead of shelling out to
  `index tool call`. Every plugin function maps to a resource: signals through
  `/intents` (plus `/intents/:id/networks` for community links), communities
  through `/networks` with a `/network-requests` fallback when creation is
  staff-gated, opportunities through `/opportunities`, profile research through
  `/enrichment`, and guidance through `/docs`. `index_create_network_membership`
  is `index_join_network`; `index_search_intents` and `index_scrape_url` are
  gone. The dashboard relays the user event stream from `/events`.

## 0.36.0

- Invoke Index tools through CLI 0.24.0 with explicit API origin, JSON output, and environment session credentials. Preserve dashboard, upload, and streaming HTTP operations.
- `INDEX_API_URL` now takes the bare origin, without `/api`, matching the CLI. Update custom overrides when upgrading.
- Require the matching CLI on the Hermes process PATH. Removed Index MCP configuration no longer applies.

All notable changes to `@indexnetwork/hermes-plugin` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed
- Hermes plugin install scan: reword docs and env-file paths so community
  install no longer trips a HIGH finding.
- Browser login redeem no longer 404s when `INDEX_API_URL` still includes a
  trailing `/api` (the pre-0.36 form). The origin is normalized before
  `/api` is appended, matching the transport used after sign-in.

### Changed
- **BREAKING: one realtime relay instead of two.** The `/notifications/stream`
  SSE proxy and the `/notifications/socket` WebSocket relay are removed; the
  user's whole event stream — messages and opportunity frames alike — arrives
  over `/conversations/stream` and `/conversations/socket`, following the API's
  merge of the two upstream streams. Desktop OS notifications listen on that one
  socket and suppress own sends only for messages. The `/notifications/snapshot`
  proxy is removed with the upstream endpoint, so OS alerts are realtime-only;
  the 60-second timer now only refreshes the signed-in identity that own-send
  suppression needs. Requires an API at 0.113.0 or newer.
- **BREAKING: the plugin authenticates with `INDEX_SESSION_TOKEN`, not
  `INDEX_API_KEY`.** Browser login now redeems the device code returned by
  `/cli-auth` for this device's own session and persists that, sending it as
  `Authorization: Bearer`. Sign-out revokes the session server-side instead of
  only clearing the local file, so it takes effect immediately. An
  `INDEX_API_KEY` left by an older install is removed on the next login or
  sign-out; re-run **log in with browser**.
- **BREAKING: `INDEX_API_KEY` is your account key, not an agent-bound token.**
  Browser login persists exactly what `/cli-auth` mints and stops there: the
  CLI→agent promotion (`dashboard/agent_bootstrap.py`) is deleted, so login no
  longer registers a "Hermes" agent, mints a per-agent token or revokes the key
  it just stored. `GET /auth/login/status` drops `negotiatorReady`.
  `index_agent_me` returns the agent you selected as your negotiator in the web
  app; select one there, or it answers with a 404. Requires an API at 0.110.0 or
  newer.
- **BREAKING: sign-out is local.** `POST /auth/logout` clears `INDEX_API_KEY`
  from the Hermes env file and the process, and no longer calls
  `/auth/keys/revoke-self`, which the API deleted. The key stays live until it
  is removed in Index web settings.
- Network picture upload forwards to `POST /storage/network-images`, following
  the Index API's rename of that route from `/storage/index-images`. Requires an
  API at 0.107.0 or newer.

### Removed
- **The `hasMasterKey` network field.** The dashboard no longer forwards it and
  the network detail always shows visibility and the invitation link, matching
  the web app now that master-key signup is gone.

### Removed
- **The forwarders for deleted Index tools:** `confirm_opportunity_delivery`,
  the four premise tools, and `read_activity_summary`. `research_profile` is
  unchanged.
- **The `index-orchestrator` skill**, plus the `pre_llm_call` hint hook and
  `/index` command that existed only to load it.

### Removed
- **The negotiator mode and its tools.** `INDEX_PLUGIN_MODE`, `_mode.py`, the
  `index-negotiator` skill, `index_respond_negotiation`, and the forwarded
  `list_negotiations` / `get_negotiation` / `respond_to_negotiation` MCP
  wrappers are gone: Index no longer exposes a negotiation turn surface. The
  dashboard is always mounted and its `/mode` endpoint is removed.

### Removed
- Delete `tests/`. No source or tool-contract change.

### Breaking
- **`index_respond_negotiation` submits the MCP authored-turn contract.** It
  now requires `negotiationId` plus exactly one continuing verb
  (`outreach`/`counter`/`question`) or authored pause
  (`needs_principal`/`ready_for_verdict`) and forwards it to MCP
  `respond_to_negotiation`. The retired no-argument refusal and the earlier
  `{ agentId, action }` vocabulary are removed. Terminal `accept`, `decline`,
  and `withdraw` are not accepted; recommend an exit with
  `ready_for_verdict` + `recommendation: reject`.

## [0.25.0] - 2026-08-23

### Breaking
- **Negotiation-graph rewrite (protocol #1494).** `index_pickup_negotiation`
  and `index_consult_owner` are removed outright — a negotiation is never
  claimed into a distinct state any more (it just stays `working` until it
  pauses or resolves), so there is nothing left to poll for or consult
  about. `index_respond_negotiation` is the only negotiation tool left; its
  shape changes to `{ agentId, negotiationId, action }` — no `roleAlignment`.
  `action` is a new closed six-value vocabulary (`outreach`, `counter`,
  `question`, `ask_principal`, `recommend_pending`, `recommend_reject`)
  replacing the old `accept`/`decline`/`request_time`/`continue` set; there
  is no accept, decline, or withdraw any more — a negotiator that wants out
  submits `recommend_reject` and lets the owner's own agent act on it.
- The conversation-SSE wake listener no longer polls a pickup heartbeat on
  keepalive or piggybacks a tick off the desktop inbox list — there is no
  server-side "poll for anything pending" endpoint left. It only starts a
  Hermes turn for a negotiation id it actually observes on an SSE message
  event; there is no periodic catch-up behind it any more (a known,
  accepted gap — see `negotiation_wake.py`'s docstring).
- **Known gap, not fixable from this package alone:** the negotiation
  `/respond` route still requires a server-issued run-bound capability
  header for the dedicated Hermes credential audience, and pickup was the
  only thing that ever issued one. `index_respond_negotiation` calls will
  be rejected with 401 end to end until services/api adds a replacement
  issuance path.

## [0.24.0] - 2026-08-17
### Added
- Pending pickup injects one Hermes chat turn so the model can reply with `index_respond_to_negotiation` and a real shared message. Empty pickup stays a seat heartbeat. Gateway injection needs `plugins.entries.index-network.allow_gateway_injection`.

### Changed
- Browser login treats the `/cli-auth` CLI key as bootstrap only: after the handshake the plugin reuses or registers the Hermes agent, mints an agent-bound token into `INDEX_API_KEY`, and revokes the CLI key. Login still succeeds if minting fails so Discover can keep the owner key.

## [0.23.0] - 2026-08-14
### Added
- Conversation SSE wake for ordinary agent keys: `negotiation_wake` listens to `GET /conversations/stream`, stamps negotiation pickup on keepalive (~15s) and non-own negotiation messages, and runs one conservative consult/respond pass when a turn is pending. Desktop reuses the existing 15s inbox poll tick (no second scheduler).

## [0.22.1] - 2026-08-13
### Changed
- Rename the Hermes sidebar entry from Index to Discover.

## [0.22.0] - 2026-08-13
### Added
- Restore the browser login gate in the dashboard: **log in with browser** runs the same web `/cli-auth` v2 loopback handshake as the Index CLI and Mac app, persists the minted key to the Hermes env file (`INDEX_API_KEY`/`INDEX_API_KEY_ID`), and takes effect in-process without a restart. Sign out best-effort revokes the key via `/auth/cli-credential/revoke` and clears it. `INDEX_API_KEY` remains a manual override.

## [0.21.0] - 2026-08-13
### Removed
- **Breaking:** the signed Index Connector transport, PKCE loopback authorization, dedicated `idxh_` Keychain credential, plaintext-scrub migration, and recovery-only disconnect machinery are all removed. Connector-based installs stop authenticating and must reconfigure.

### Changed
- The plugin authenticates with a single `INDEX_API_KEY` environment variable (an ordinary agent API key created in Index web settings). `INDEX_API_URL`/`INDEX_MCP_URL` remain optional endpoint overrides. The dashboard login screen now explains the API-key setup instead of opening a browser flow.

## [0.20.0] - 2026-08-12
### Added
- Secure standalone macOS connection (0.20.0): production Hermes uses the signed Index Connector, canonical PKCE loopback approval, a dedicated Keychain-only `idxh_` identity, and fixed production endpoints rather than persisted plugin credentials. Full mode receives the exact six canonical actions while negotiator mode remains the four-handler, server-fenced execution surface.
- Connector status, bounded upload/SSE forwarding, seven-day expiry warning, forced secure relogin migration, recovery-only disconnect, and owner pause/revoke/reconnect controls. The Index macOS app is optional.

### Security
- Production connector trust verifies fixed paths, ownership/modes, CMS release metadata, code-signing identity, hash, protocol, and build environment; source-only development transport is double-gated and excluded from packages. Credentials expire at 30 days with no refresh; uncertain revocation retains only nonsecret recovery evidence.

## [0.19.0] - 2026-08-07

### Added
- Add the Personal Agent Hermes negotiation runtime. Index macOS can configure one local installation with the owned one-minute `Index Personal Agent Negotiator` schedule while the Personal Agent's stable identity, memory, policy, consultations, and history remain server-authoritative across Hermes execution and Index fallback; those private stores are not copied into Hermes.
- Add `index_consult_owner` for server-authorized, privacy-minimal owner consultation. A scheduled pass may make at most one consultation or response and receives only server-provided structural facts, closed directives, and message-free speaker/action history—never raw owner context or memory, private consultation prose, evaluator/actor prose, or shared-message prose.
- Add strict `INDEX_PLUGIN_MODE=negotiator`. Restricted mode registers only identity, negotiation pickup, response, consultation, and the generated negotiator skill; broad MCP wrappers, hooks, commands, the orchestrator skill, and dashboard routes/components remain disabled.

### Security
- Restrict the owned cron job at execution time to the exact `index-network` toolset and `index-network:index-negotiator` skill; shell, browser, HTTP, MCP, core, other-plugin, and global tools are unavailable even if untrusted pickup prose requests them.
- Replace free-form owner consultation prose with the server's closed four-value `{reason}` contract.
- Treat every pickup prose field as untrusted, keep owner-private context and credentials out of outward messages, and fail closed for every unknown non-empty plugin mode. Index validates the exact selected agent credential and all submitted actions; a stale or stopped Hermes heartbeat is covered by bounded Index fallback.
