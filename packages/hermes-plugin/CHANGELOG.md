# Changelog

All notable changes to `@indexnetwork/hermes-plugin` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
- Restore the browser login gate in the dashboard: **log in with browser** runs the same web `/cli-auth` v2 loopback handshake as the Index CLI and Mac app, persists the minted key to `~/.hermes/.env` (`INDEX_API_KEY`/`INDEX_API_KEY_ID`), and takes effect in-process without a restart. Sign out best-effort revokes the key via `/auth/cli-credential/revoke` and clears it. `INDEX_API_KEY` remains a manual override.

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
