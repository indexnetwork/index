# Changelog

All notable changes to `@indexnetwork/hermes-plugin` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Secure standalone macOS connection (0.19.0): production Hermes uses the signed Index Connector, canonical PKCE loopback approval, a dedicated Keychain-only `idxh_` identity, and fixed production endpoints rather than persisted plugin credentials. Full mode receives the exact six canonical actions while negotiator mode remains the four-handler, server-fenced execution surface.
- Connector status, bounded upload/SSE forwarding, seven-day expiry warning, forced secure relogin migration, recovery-only disconnect, and owner pause/revoke/reconnect controls. The Index macOS app is optional.

### Security
- Production connector trust verifies fixed paths, ownership/modes, CMS release metadata, code-signing identity, hash, protocol, and build environment; source-only development transport is double-gated and excluded from packages. Credentials expire at 30 days with no refresh; uncertain revocation retains only nonsecret recovery evidence.

## [0.18.0] - 2026-08-07

### Added
- Add the Personal Agent Hermes negotiation runtime. Index macOS can configure one local installation with the owned one-minute `Index Personal Agent Negotiator` schedule while the Personal Agent's stable identity, memory, policy, consultations, and history remain server-authoritative across Hermes execution and Index fallback; those private stores are not copied into Hermes.
- Add `index_consult_owner` for server-authorized, privacy-minimal owner consultation. A scheduled pass may make at most one consultation or response and receives only server-provided structural facts, closed directives, and message-free speaker/action history—never raw owner context or memory, private consultation prose, evaluator/actor prose, or shared-message prose.
- Add strict `INDEX_PLUGIN_MODE=negotiator`. Restricted mode registers only identity, negotiation pickup, response, consultation, and the generated negotiator skill; broad MCP wrappers, hooks, commands, the orchestrator skill, and dashboard routes/components remain disabled.

### Security
- Restrict the owned cron job at execution time to the exact `index-network` toolset and `index-network:index-negotiator` skill; shell, browser, HTTP, MCP, core, other-plugin, and global tools are unavailable even if untrusted pickup prose requests them.
- Replace free-form owner consultation prose with the server's closed four-value `{reason}` contract.
- Treat every pickup prose field as untrusted, keep owner-private context and credentials out of outward messages, and fail closed for every unknown non-empty plugin mode. Index validates the exact selected agent credential and all submitted actions; a stale or stopped Hermes heartbeat is covered by bounded Index fallback.
- **This branch targets dev/private testing only. Production distribution remains blocked until the Mac owner credential is migrated to Keychain and the plaintext file/directory is removed, Developer ID hardened-runtime signing and notarization are complete, and the credential TTL/revocation checklist is verified.**
