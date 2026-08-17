# Changelog

All notable changes to `@indexnetwork/hermes-plugin` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
