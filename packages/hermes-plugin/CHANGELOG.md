# Changelog

All notable changes to `@indexnetwork/hermes-plugin` are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this package adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added
- Add the Personal Agent Hermes negotiation runtime (0.17.0). Index macOS can configure one local installation with the owned one-minute `Index Personal Agent Negotiator` schedule while preserving the same server-authoritative Personal Agent identity, memory, policy, consultations, and history across Hermes execution and Index fallback.
- Add `index_consult_owner` for server-authorized, privacy-minimal owner consultation. A scheduled pass may make at most one consultation or response, and uses only the server-provided protocol version, seat, deadline, allowed actions, consultation eligibility, context, and history.
- Add strict `INDEX_PLUGIN_MODE=negotiator`. Restricted mode registers only identity, negotiation pickup, response, consultation, and the generated negotiator skill; broad MCP wrappers, hooks, commands, the orchestrator skill, and dashboard routes/components remain disabled.

### Security
- Treat every pickup prose field as untrusted, keep owner-private context and credentials out of outward messages, and fail closed for every unknown non-empty plugin mode. Index validates the exact selected agent credential and all submitted actions; a stale or stopped Hermes heartbeat is covered by bounded Index fallback.
- **This branch targets dev/private testing only. Production distribution remains blocked until the Mac owner credential is migrated to Keychain and the plaintext file/directory is removed, hardened runtime and App Sandbox are restored, the app is signed/notarized, and the credential TTL/revocation checklist is verified.**
