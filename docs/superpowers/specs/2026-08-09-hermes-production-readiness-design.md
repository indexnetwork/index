# Hermes Production Readiness Design

**Date:** 2026-08-09

**Status:** Approved design

**Foundation:** PR #1348 (`docs/hermes-personal-agent-runtime`)

**Target:** Production-ready macOS direct distribution through stacked pull requests

## Summary

Hermes must be fully capable of using Index Network on macOS without requiring the Index macOS app. The app remains an optional owner-control surface, not a runtime dependency.

A user connects Hermes directly from its Index dashboard. A browser-based approval flow issues a dedicated, agent-bound credential with all normal Index capabilities but no account-security authority. A signed Universal 2 native component, **Index Connector**, stores that credential in macOS Keychain and performs Index requests for Hermes. The raw credential is never persisted in Hermes files or returned to the Hermes plugin.

The existing Index macOS app also migrates its owner credential from plaintext Application Support storage to Keychain. Existing plaintext installations require a fresh secure login and server-side revocation before local runtime activity resumes.

Production distribution uses Developer ID signing, Hardened Runtime, Apple notarization, stapled manual-install DMGs, required production HTTPS endpoints, and protected release automation. Because this is direct distribution rather than a Mac App Store release, App Sandbox is intentionally not a requirement.

## Product Decisions

- Index macOS is optional; Hermes can connect, operate, reconnect, and disconnect directly.
- Initial production support is macOS only.
- Hermes receives all normal Index product capabilities. The durable permission row stores the six canonical actions: `manage:identity`, `manage:premises`, `manage:intents`, `manage:networks`, `manage:opportunities`, and `manage:negotiations`. Profile behavior is covered by identity plus premises; contact behavior is exposed only through tools mapped onto the canonical model. Retired `manage:profile` and `manage:contacts` actions are never persisted.
- Hermes cannot manage owner login, account security, billing, account deletion, credentials, permissions, or other agents.
- Credentials expire after 30 days. Hermes warns seven days before expiry and requires browser reconnection for rotation.
- If the credential expires or runtime health becomes stale, Index immediately handles negotiations.
- Existing plaintext credentials are not silently migrated. Users complete a fresh browser login and old credentials are revoked.
- macOS 13 is the minimum supported version for production Hermes integration.
- Production artifacts are Universal 2 and support Apple Silicon and Intel Macs.
- Updates are manually installed from signed, notarized, checksummed DMGs.
- Production API and web URLs are required release inputs; release builds have no localhost fallback.
- Work ships as security-first stacked PRs rather than expanding PR #1348.

## Goals

1. Let Hermes use Index Network independently of the Index macOS app.
2. Remove owner and Hermes credentials from plaintext local storage.
3. Preserve the Personal Agent's stable server-side identity, memory, policy, history, runtime binding, and fallback behavior.
4. Give Hermes broad normal-product capability without owner-security authority.
5. Make setup, migration, rotation, logout, disconnect, and revocation fail closed and recoverable.
6. Prove transaction, migration, expiry, and rollback behavior against real PostgreSQL.
7. Produce reproducible, signed, notarized Universal 2 macOS artifacts through protected release automation.

## Non-Goals

- Mac App Store distribution.
- App Sandbox support.
- Linux or Windows secure credential integration.
- Automatic credential refresh beyond the existing 30-day lifecycle.
- Automatic app updates or Sparkle integration.
- Defending against root, kernel compromise, or a fully compromised macOS user account.
- Giving Hermes owner-security or credential-administration authority.
- Public production rollout inside these code changes; release credentials and rollout approval remain organization-controlled inputs.

## User Experience

### Standalone Hermes connection

1. The Hermes Index dashboard shows **Connect to Index**.
2. Hermes invokes Index Connector, which generates a PKCE verifier, a one-time state value, and a loopback callback listener.
3. The user's browser opens the Index authorization page.
4. The user signs in and sees the exact requested normal-product capabilities.
5. Approval revokes prior credentials for the same Hermes installation and returns a one-time authorization code to the connector.
6. Index Connector exchanges the code directly with the API and stores the returned credential in Keychain.
7. The connector verifies it can read and use the Keychain item, confirms setup to the server, and only then enables Hermes activity.
8. Hermes shows the connected account, expiry date, runtime health, and disconnect control.

The Index macOS app is not involved in this flow.

### Independent operation

Hermes tools and dashboard routes call Index Connector through a versioned JSON request protocol. The connector performs the corresponding HTTPS request or MCP call and returns a sanitized response. It never returns the raw credential.

The full Hermes mode exposes the normal Index tool and dashboard capability set. The scheduled negotiator mode remains restricted to pickup, heartbeat, respond, and consultation, with the existing closed action contracts and server-side runtime authority checks.

### Owner control

The Index website gains a connected-agents page that shows:

- Hermes installation name and stable identifier;
- granted capabilities;
- connection and negotiation-runtime health;
- last heartbeat and credential expiry;
- pause, reconnect, and revoke controls.

The Index macOS app may present the same controls when installed, but it calls the same server APIs and is not authoritative by itself.

### Expiry

Hermes warns beginning seven days before credential expiry. Reconnection repeats browser approval and rotates the credential. There is no silent refresh token.

If expiry occurs, the connector rejects further calls, the server rejects the expired credential, scheduled Hermes activity stops, and Index fallback owns negotiations. Non-negotiation tools return a stable reconnect-required response.

## Architecture

### Index Connector

Index Connector is a signed, notarized Universal 2 native executable distributed with the Hermes plugin release and with the optional Index macOS app release.

Responsibilities:

- run browser authorization with PKCE and exact callback/state validation;
- store, read, rotate, and delete Hermes credentials through Security.framework;
- expose a versioned JSON stdin/stdout protocol to the Hermes plugin;
- forward allowlisted MCP and REST operations using the Keychain credential;
- enforce endpoint, method, body-size, timeout, and response-size limits;
- redact credentials and sensitive transport metadata from output and logs;
- report account, installation, capability, health, and expiry metadata;
- perform confirmed disconnect and retain non-secret recovery state when uncertain.

The connector never accepts a caller-supplied server URL in production. Production endpoints are embedded as signed build inputs. Development builds may use explicit local endpoints and are visibly marked non-production.

### Hermes plugin transport

The plugin replaces direct `INDEX_API_KEY` HTTP/MCP use with a transport abstraction:

- production macOS transport: signed Index Connector;
- explicit CI/headless test transport: environment credential, disabled from production packages unless a development build marker is present;
- negotiator and full modes retain their existing tool-registration boundaries.

All existing dashboard and tool operations migrate through this transport. Production startup fails closed if the connector is missing, unsigned, signed by the wrong team, wrong architecture, incompatible by protocol version, or configured with non-production endpoints.

The plugin verifies the connector's code signature, Team ID, embedded release identity, protocol version, file ownership, non-symlink path, and expected SHA-256 from signed release metadata before use.

### Connector launch attestation

macOS does not provide `fexecve` or `execveat`, and its synthetic `/dev/fd/N` vnode cannot activate a Mach-O image. The plugin therefore must not treat `/dev/fd/N` execution as a descriptor-bound verify/execute primitive.

For the one-shot connector protocol, the plugin stages the verified bundle in a private random directory and launches its ordinary executable pathname with `POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_START_SUSPENDED`. Before the child can execute user code or receive request bytes, the plugin derives the child's dynamic `SecCode` from its PID and requires all of the following:

- validity against the locally pinned designated requirement;
- exact Team ID `LMQ3XNXLAD`;
- exact bundle ID `network.index.connector`;
- a loaded architecture CDHash that is present in the architecture-aware CDHash set from the already statically verified connector release;
- consistency with the statically verified release SHA-256 and signed CMS metadata.

The expected identity comes only from local immutable build pins plus signed release metadata. CMS-provided Team ID, bundle ID, or designated requirement values never override the local pins.

Any spawn, dynamic-code lookup, validity, identity, or CDHash failure kills and reaps the still-suspended child. The plugin closes all pipe ends and returns a stable sanitized failure. Only after every check passes does it send `SIGCONT` and begin the bounded stdin write and response deadline. `POSIX_SPAWN_CLOEXEC_DEFAULT` remains mandatory; removing it would leak unrelated descriptors from the multithreaded host and would not create descriptor-based executable activation.

Authenticated XPC or `SMAppService` is an allowed future hardening path, but is not required for this one-shot protocol while suspended dynamic attestation is enforced.

### Keychain layout

Use separate generic-password items:

- Index macOS owner credential: app-only service/account identity;
- standalone Hermes credential: connector-only service/account identity, keyed by server environment and installation ID.

Items use data-protection Keychain and an accessibility class that supports autonomous operation after user login while remaining unavailable before first unlock. The owner item trusts only the signed Index app identity. The Hermes item trusts only the signed Index Connector identity. The two items do not use a shared Keychain access group and neither component can read the other's credential.

Non-secret installation IDs, setup generations, operation journals, expiry timestamps, and UI state remain in Application Support with descriptor-safe atomic persistence. Secret values never enter those records.

### Local trust boundary

The design protects credentials against plaintext files, backups of live configuration, accidental logging, WebKit storage, command-line arguments, and unrelated applications reading Keychain items.

Index Connector does not return the raw credential. A process controlling the same macOS account and able to drive the approved Hermes installation may still request actions through Hermes. Server scopes, policy, generation fencing, audit logs, and owner revocation bound that risk. Root, kernel compromise, and total user-account compromise are outside scope.

## Server Authorization

### Browser authorization flow

Add a first-party Hermes authorization flow with:

- authenticated owner browser session;
- PKCE S256;
- single-use random state and authorization code;
- strict loopback redirect admission;
- short expiration;
- exact installation ID and requested capability set;
- owner-visible consent copy;
- replay receipt and transactional consumption.

The authorization code is not a credential. Only Index Connector can exchange it with the in-memory PKCE verifier.

### Credential identity

Standalone Hermes credentials use an `idxh_` secret prefix and a dedicated `hermes_agent_credentials` table that older API binaries do not query. Therefore a rollback binary cannot reinterpret them as generic Better Auth API keys. They carry server-enforced identity metadata:

- dedicated audience, distinct from owner and generic legacy keys;
- owner user ID;
- Personal Agent ID;
- Hermes installation ID;
- setup generation;
- exact granted capability set;
- database credential row ID;
- issued-at and matching database/metadata expiration.

Authentication defaults deny. The audience may access only the approved MCP capability surface and explicitly enumerated Personal Agent REST routes. Account, credential, permission, billing, and owner-security routes reject it regardless of requested scope.

### Runtime behavior

Negotiation mutations continue to enforce:

- selected executor;
- exact agent and installation;
- setup generation;
- credential row identity and expiry;
- expected negotiation speaker;
- one-shot capability and one mutation per pass;
- atomic response effects and replayable outboxes;
- bounded stale-heartbeat fallback to Index.

Broad normal-product capability does not weaken the stricter scheduled-negotiation execution mode.

## Migration

### Standalone Hermes plaintext migration

On detecting `INDEX_API_KEY` or related owned keys in `~/.hermes/.env`:

1. Pause Index-owned Hermes scheduling and stop using the plaintext credential.
2. Persist only the installation ID, legacy key ID when present, and a non-secret `secure_relogin_required` migration record.
3. Remove all owned credential/configuration keys from `.env` using the existing descriptor-safe writer and verify absence.
4. Require browser authorization.
5. In the owner-authorized server transaction, select Index fallback, revoke prior Hermes credentials for the installation, and issue a pending replacement generation with no runtime authority.
6. Store and verify the pending credential in Keychain.
7. Activate the new generation only after Keychain verification and plaintext-cleanup postconditions both pass.
8. Resume Hermes.

If plaintext cleanup fails, browser authorization and replacement issuance do not begin. If Keychain storage or verification fails, the old server credential is already revoked and the pending replacement remains disabled. Recovery retries without exposing the Keychain value.

### Index macOS owner credential migration

On detecting `credential.json`:

1. Stop treating the plaintext credential as an authenticated session.
2. Preserve only its key ID as non-secret revocation evidence, then scrub the raw value from process memory.
3. Delete `credential.json` and verify absence before allowing login.
4. Require fresh browser login.
5. Revoke the legacy key ID in the owner-authorized issuance transaction before minting the replacement.
6. Store the new owner credential in Keychain and verify retrieval before establishing the app session.

Do not delete the Application Support parent directory because it also contains non-secret Hermes installation and recovery records. If the machine is offline after local deletion, the app stays signed out and retains the non-secret key ID until a later browser login revokes it.

### Logout and disconnect

Logout/disconnect ordering is:

1. stop local scheduling and connector activity;
2. verify local Hermes activity is paused;
3. revoke the server credential and generation;
4. confirm the server response and verify the credential no longer authenticates;
5. delete the Keychain item;
6. scrub owned local configuration and installation wiring;
7. clear recovery evidence only after all postconditions pass.

When offline, local activity stops immediately, but the encrypted Keychain credential and non-secret recovery record remain solely so server revocation can retry. The connector enters a recovery-only mode that rejects every operation except status and server revocation. The UI shows **revocation pending** and does not claim logout is complete.

## Failure Handling

- Any state, PKCE, callback, static or dynamic code signature, CDHash, Team ID, bundle ID, protocol-version, endpoint, or generation mismatch fails closed.
- Keychain write must be followed by a read/identity verification before activation.
- Keychain deletion occurs only after confirmed server revocation.
- Server issuance, activation, rotation, rollback, and disconnect remain transactionally generation-fenced.
- Connector crashes never cause Index fallback to wait beyond the existing heartbeat bound.
- Malformed connector requests and oversized payloads return stable sanitized errors.
- Connector request bytes are not written until the suspended child passes dynamic code attestation. Attestation failure kills and reaps the child before it runs user code.
- Connector and plugin logs contain operation names and opaque correlation IDs, never credentials, authorization codes, PKCE verifiers, consultation prose, owner memory, or model-authored outbound text.
- Production Web Inspector is disabled. The macOS app replaces JavaScript credential injection with a native allowlisted request bridge, so owner credentials never enter JavaScript.

### Launch-attestation verification

Native macOS CI proves:

- a statically verified expected connector is dynamically attested, resumed, and receives input;
- replacing the staged pathname with a differently signed executable before spawn is detected from the loaded child's dynamic identity, the suspended child is killed and reaped, and its user code never creates a sentinel;
- an unrelated parent descriptor is absent in the child under `POSIX_SPAWN_CLOEXEC_DEFAULT`;
- timeout, signal, pipe, dynamic-code lookup, and kill/reap failures converge without a live child or leaked request data;
- architecture-aware CDHash admission works for Apple Silicon and Intel slices of the Universal 2 release on available runners.

## Database and Operational Assurance

### Real PostgreSQL CI

Add a dedicated disposable PostgreSQL service job with `TEST_DATABASE_SAFE=1`. It runs the guarded database suites against a database created for that job only and proves:

- simultaneous prepare/select/activate/rollback/disconnect for the same owner;
- independence for different owners;
- credential rotation, expiry, and revocation;
- exact generation and row-identity fencing;
- response/continuation fault injection and replay;
- one-shot capability consumption;
- outbox durability and deadline preservation;
- migration upgrade behavior.

The guard remains fail closed outside the dedicated job.

### Migration preflight

Before production rollout, automation checks:

- all non-null API-key metadata is valid JSON;
- no duplicate selected runtime executors exist;
- migration duration and lock behavior on a production-sized disposable clone;
- all new indexes and constraints are valid;
- the previous production binary rejects the `idxh_` credential because it has no row in the legacy API-key table and cannot treat the dedicated audience as a generic credential.

Rollback is forward-fix-first after credentials are issued. The emergency rollback runbook first pauses Hermes globally and bulk-revokes all dedicated Hermes credentials before restoring an older server.

### Observability

Add metrics and alerts for:

- authorization starts, completions, expirations, and replay rejection;
- credentials expiring within seven days and expired credentials;
- rotations, revocations, and pending revocations;
- stale selected Hermes runtimes and Index fallbacks;
- connector/API authorization failures by stable reason;
- runtime-operation conflict and server-error rates;
- advisory-lock wait time;
- pending response outboxes and replay attempts.

Metrics must not include credential data, owner memory, consultation content, or negotiation transcript prose.

## Production Distribution

### Build outputs

Produce:

- a signed/notarized Universal 2 Index macOS app DMG;
- a signed/notarized Universal 2 Index Connector artifact for standalone Hermes installation;
- SHA-256 checksums and signed release metadata binding version, commit, Team ID, endpoints, architectures, and connector protocol version.

### Protected release workflow

A tag/manual protected workflow requires organization-controlled Developer ID, provisioning, and notary credentials. It:

1. checks version monotonicity and clean source provenance;
2. requires HTTPS production API/web URLs and rejects localhost/dev values;
3. builds optimized arm64 and x86_64 slices and combines them as Universal 2;
4. verifies minimum macOS 13 deployment targets;
5. disables Web Inspector and development overrides;
6. signs nested code and top-level artifacts with the expected Team ID and Hardened Runtime;
7. verifies entitlements and rejects App Sandbox or debug entitlements not in the direct-distribution profile;
8. submits to Apple notarization and waits for success;
9. staples and validates every distributed artifact;
10. packages DMGs/archives after stapling;
11. runs `codesign`, `spctl`, architecture, endpoint, signature, and checksum checks on the final packaged content;
12. uploads immutable artifacts and updates the first-party download metadata only after every gate passes.

Pull-request CI performs unsigned/ad-hoc compile and contract checks without release secrets. It must never claim that an unsigned artifact is production-ready.

### Clean-account acceptance

Before public rollout, a signed candidate is tested on a clean macOS 13+ account with quarantine preserved:

- install standalone connector and optional app;
- connect Hermes through browser authorization;
- exercise every normal capability family;
- run negotiation pickup/respond/consultation and fallback;
- close or omit the Index app and confirm Hermes remains functional;
- rotate near expiry;
- disconnect and verify immediate revocation;
- migrate from a plaintext test installation;
- verify no secret appears in files, logs, arguments, WebKit storage, crash reports, or temporary artifacts;
- verify removal and reinstall.

## Stacked Pull Requests

### PR 1 — Secure standalone Hermes connection

- Index Connector native target and signed release contract;
- Keychain-backed standalone Hermes and Index-app credentials, including real Security.framework migration/failure tests;
- direct browser authorization and consent;
- full normal-product capability boundary;
- plugin transport migration away from production `INDEX_API_KEY`;
- website connection/revocation controls;
- forced secure re-login migrations;
- confirmed logout/disconnect semantics;
- macOS 13+ native integration and security tests.

### PR 2 — Backend production assurance

- disposable-PostgreSQL CI job and guarded race/fault suites;
- migration preflight and compatibility checks;
- expiry/fallback/revocation observability;
- emergency pause and bulk-revocation tooling;
- deployment, rollback, and smoke-test runbooks.

### PR 3 — macOS production release

- Universal 2 optimized builds;
- required production endpoint injection;
- production Web Inspector/debug disabling;
- Developer ID/Hardened Runtime signing contract;
- notarization, post-stapling packaging, checksums, and signed metadata;
- standalone connector and optional app DMGs;
- first-party download publication gate;
- clean-account acceptance checklist and evidence template.

Each PR is independently reviewed and check-green before the next is rebased onto it. PR #1348 remains the unchanged functional foundation.

## Acceptance Criteria

The production-hardening stack is code-ready when:

- Hermes connects and uses all normal Index capabilities on macOS without Index macOS installed or running;
- no production Hermes or owner credential is persisted outside Keychain;
- production Hermes does not receive or print the raw server credential;
- account-security operations remain unreachable to Hermes credentials;
- the previous production API binary rejects every `idxh_` credential as unknown;
- migration revokes plaintext-era credentials and requires fresh login;
- expiry, disconnect, logout, and uncertain failures stop Hermes and preserve Index fallback;
- real PostgreSQL race, fault, migration, and continuation suites pass in dedicated CI;
- rollback/bulk-revocation tooling and operational alerts exist;
- release automation can produce only Universal 2, production-endpoint, Developer ID signed, Hardened Runtime, notarized, stapled, checksummed artifacts;
- all three stacked PRs pass independent security, correctness, integration, and release reviews;
- no production deployment or merge occurs without explicit authorization.
