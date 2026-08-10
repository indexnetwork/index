# Changelog

All notable changes to the `@indexnetwork/api` service are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this service adheres to [Semantic Versioning](https://semver.org/). Keep this
file updated as part of every release (bump `package.json` and the `[Unreleased]`
section before promoting to `main`).

## [Unreleased]

### Added
- Secure standalone Hermes and native Index-owner authorization (API 0.79.0): canonical PKCE loopback consent, one-time codes, hash-only `idxh_`/`idxo_` credential persistence, 30-day expiry without refresh, Keychain-confirmed activation, exact revocation receipts, and legacy plaintext-era revocation/fresh-login migration.
- Dedicated full Hermes audience admission for the six canonical actions, explicit REST/MCP allowlists, and the separate four-handler negotiator boundary. Session-only connected-agent list/pause/revoke controls return nonsecret health, fallback, heartbeat, and expiry views; reconnect requires fresh authorization.

### Security
- Dedicated audiences default-deny account security, credential/permission/agent administration, billing, and unknown routes. Authorization, activation, runtime reconciliation, disconnect, and negotiation mutation use owner locks, exact row/generation identity, idempotent receipts, and compare-and-set behavior.

### Removed
- Remove the onboarding privacy-consent layer (protocol 10.0.0, API 0.77.0).
  The `record_onboarding_privacy_consent` MCP/persona tool, the
  `publicProfileLookup` and `edgeosImport` consent decisions, and the
  `OnboardingPrivacyState` / `PrivacyConsentDecision` / `PrivacyConsentSource`
  types are gone from the API schema/types and the Hermes plugin manifest.
  `preview_user_context` and profile provenance seeds no longer require recorded
  consent; leftover `privacy` values in stored onboarding JSON are ignored.
  Like the network-level flow below, opt-in/opt-out moves to a separate
  enrichment service defined per implementation/application. Public profile
  lookup is also removed from the onboarding preview: the `allowPublicLookup`
  and `edgeosProfileText` enrichment-run input fields are dropped (protocol
  10.0.0 removes the tool parameters and `publicLookup` response block).
- Remove the network-level enrichment consent flow and the `profileEnrichment`
  network permission entirely (API 0.76.0). The `consent_required` policy, the
  `forceHeadlessProvisioningPermissions` consent-safe forcing on invites, CSV
  imports, and master-key enablement, and the `auto`/`disabled` setting itself
  are gone; enabling a master key now forces only `joinPolicy: 'invite_only'`.
  Scoped enrichment jobs require current active membership after user/network
  existence checks and before the active-premise short-circuit. Leftover
  `profileEnrichment` values in stored permissions JSON are ignored. Enrichment
  opt-in/opt-out is planned to
  move to a separate service, defined per implementation/application rather
  than per network.

### Added
- Add the Personal Agent Hermes runtime binding (API 0.78.0): owner-control routes prepare, select, roll back, inspect, and disconnect one generation-fenced local Hermes installation without changing the owner's server-owned Personal Agent identity, memory, policy, consultations, or history. The macOS selector can now durably choose Index or Hermes; a selected Hermes executor receives only negotiation authority plus privacy-minimal structural/closed directives (never raw owner context, memory, or private prose), reports health through a negotiation-specific pickup heartbeat, and falls back to Index through the existing bounded park/claim path when stale or stopped.
- Let an exact selected external negotiator consult its owner through the existing `input_required` Questioner lifecycle. The server independently checks the exact owner, principal, claim, attempt, material binding, deadline, and one-consultation policy, accepts exactly the closed `{reason}` request, derives all disclosure and question copy from server-owned templates, and resumes only the settlement-bound successor after answer, dismissal, or expiry.
- Register `OPPORTUNITY_OWNER_APPROVAL_SECRET` as an optional env var so the documented owner-approval secret is schema-validated.
- Wire the MCP authorization-observability seam at the host boundary (IND-581;
  protocol 7.8.0, API 0.64.0). The composition root now injects a concrete
  `McpAuthorizationObserver` into `createMcpServer` that records each capability
  denial as a structured, secret-free authorization audit log (`info` level, not
  debug instrumentation) via the `mcp` server logger — caller profile, tool,
  reason/reach, required permissions, and opaque principal ids only, never
  credentials or payloads. New DB-free `tests/mcp.permission-refresh.spec.ts`
  drives the real resolver + module metadata cache to prove: permissions and
  agent active/inactive state are freshly resolved across reconnects (granted →
  revoked → deactivated), each transition denies the next schema-valid
  list/call before any chat-DB read or scoped-deps creation; two principals
  sharing the module-level metadata cache never leak each other's inventory or
  capability results; emitted denial telemetry contains only safe
  caller-profile/reason fields (no token/secret/argument payload); and a
  throwing observer never changes the fail-closed decision.

- Prove the IND-599 agent-administration split end-to-end at the MCP transport
  (IND-599; protocol 7.7.0, API 0.63.0). New DB-free `tests/mcp.spec.ts`
  evidence: registered agents list/call only `read_own_agent` (empty input
  schema, forged-target argument never queried, own sanitized record only)
  while every human admin tool is capability-denied before any context-DB read
  or scoped-deps creation; session humans retain the full owned-agent admin
  surface but never `read_own_agent`; enrollment-capable keys advertise exactly
  `['register_agent']` across the whole registry and are denied schema-valid
  representative tools of every access class (authenticated/permission/
  informational/delivery_only/human_only) with zero resource work; plain
  unregistered keys fail closed. Owned-versus-foreign handler matrix proves
  each target-bearing mutation (`update`/`delete`/`grant`/`revoke`) persists
  exactly once for an owned target and never for a foreign one (opaque "not
  found"), `list_agents` queries only the caller's own userId, and transport
  `config` secrets never leak from any agent projection. No API runtime source
  change; version moves with the protocol floor (7.7.0).

- Enforce explicit owner-issued approval for agent-driven opportunity `send`/`accept`/
  `reject` transitions and add the session-only issuance route
  `POST /api/opportunities/:id/owner-approvals` (IND-593; protocol 7.6.0, API 0.62.0).
  The host implements the protocol owner-approval port with HMAC-signed, atomically
  single-use proofs whose challenge state lives in a shared injected async store:
  Redis-backed via atomic Lua scripts in production with opaque hashed keys and
  TTL/retention cleanup, fail-closed (`unavailable`, HTTP 503) when Redis is
  unconfigured/unreachable or the signing secret is missing — there is deliberately
  no process-local fallback, preserving the cross-replica single-use guarantee
  (the in-memory adapter is an injected test double only). Issuance is one-shot
  per challenge (409 on repeat), owner-session-only (API-key/agent callers 403),
  bound entirely server-side (caller body binding/provenance fields are ignored),
  and answers unknown, consumed, or route-mismatched interactions opaquely (404,
  no existence oracle) without minting a proof or consuming the one-shot issuance;
  expired challenges return 410. Direct authenticated owner sessions (REST tool
  API and MCP session auth) traverse the same boundary via trusted server-derived
  provenance attestation; chat/CLI/mediated callers fail closed. Optional
  `OPPORTUNITY_OWNER_APPROVAL_SECRET` rotates the proof secret (falls back to
  `BETTER_AUTH_SECRET`). No DB schema, migration, backfill, data action, or
  deployment configuration change ships with this entry.
- Rename the aggregate agent-activity tool to the canonical `read_activity_summary` on every surface and retire `report_agent_activity` with no alias (IND-605; protocol 7.2.0). MCP authorization admits any activity-domain permission and the typed resolved caller context drives one centralized per-domain projection; signal IDs/titles require `manage:intents`; question counts are meta-network yet inherit the permission of each question's affected domain (`getAgentActivitySummary` now groups pending/answered counts by question mode; conversational and unrecognized modes are human-owner-only); and an optional `networkId` narrows a network agent's opportunity/negotiation aggregates to its bound community inside the adapter queries. Counterparty identities, chats, turns, and transcripts are never returned. The Hermes plugin forwards the new tool as `index_read_activity_summary` (plugin 0.12.0).
- Add post-discovery no-opportunity recovery refinement for exact recipient-owned active intents (IND-506). Both authoritative completion paths enqueue a privacy-minimal job on the existing Questioner worker; a focused service suppresses recovery when canonical exact-trigger actionability exists, reduces safely validated rejected negotiations to a bounded aggregate count, validates every user-visible generated string, and persists at most one ordinary intent question per material fingerprint behind a shared recovery/opportunity-create/opportunity-reactivation advisory lock plus migration `0105`'s all-status expression unique index. Exact-trigger reactivation also serializes with task creation on the negotiation-attempt lock, re-reads the opportunity row, and applies the canonical fresh-task predicate immediately before mutation. Answer and material-edit paths use one deadlock-safe lock order, stale recovery answers are rejected again by owner, lifecycle, and fingerprint at the final locked intent write, REST strips every recovery internal, and pool questions retain independent budget/novelty behavior.
- Add exact negotiation-question admission/read/settlement routing (IND-507): API/DB validation proves the authenticated recipient's exact owned ACTIVE fingerprint-equal signal, assignment, live non-personal membership, opportunity actor binding, network, and purpose-compatible task state. Generation/answer/dismiss/timeout share an advisory → complete stable cohort → provenance lock order. A deterministic settlement outbox in exact task metadata plus exact-task run-existing jobs recovers enqueue failure, worker crash, zero generated/persisted rows, and timeout redelivery without latest-task lookup or duplicate continuation. Scoped/unscoped reads and counts reject stale/legacy/unsafe pending rows; exact answered history survives its own continuation transition. MCP/chat/direct answering now reaches the canonical validated boundary with principal/scope clamps. Migration `0106_add_negotiation_question_provenance_index` is the all-status negotiation idempotency constraint after IND-506's recovery migration.
- Add the flag-gated persisted `onboarding` chat persona boundary for `POST /chat/onboarding/stream` (IND-450): incomplete session-authenticated users are authoritatively routed to the restricted factory, follow-ups inherit stored persona, spoof/mismatch/unknown/completed access fails closed, and flag-off preserves legacy orchestrator behavior. Profile approval now stamps a durable phase marker without dropping privacy JSON, and `complete_onboarding({ intentId })` validates that the exact active owned first signal was created no earlier than a valid profile-confirmation timestamp before recording completion.
- Add canonical owner-and-conversation-scoped `GET /api/agent/actions/proposals/:proposalId` hydration for reporter action cards; confirmation uses the same scope, a five-minute execution lease reclaims interrupted attempts, per-action runtime failures are consumed as safe results, and display responses exclude snapshots while including consumed results (IND-493).
- Add dark-gated `POST /api/agent/actions/confirm` owner confirmation for reporter cleanup-action proposals (IND-490 PR1). Proposals are persisted with owner/snapshot state, confirmations are session-only, sequential, replay-safe, and use existing premise/intent lifecycle paths; `WEB_AGENT_ACTIONS_ENABLED` remains off everywhere.
- Add the dark-gated `reporter` persona and owner-scoped `getAgentActivitySummary` adapter read for the PR1 Agent reporting surface (IND-476). The new `read_activity_summary` tool exposes only reproducible counts, never counterparty identity or transcripts; `WEB_AGENT_SURFACE_ENABLED` is registered and surfaced as `features.agentSurface` without changing Railway configuration.
- Add per-viewer conversation read cursors, server-side unread counts, and `POST /conversations/:id/read` (IND-475; migration `0098`).
- Record viewer-safe match provenance on start-chat DMs and expose intent-scoped `via` summaries for chat signal provenance (IND-475).
- Expose a read-side `warming` state for fresh owned intents until a succeeded discovery run is recorded (IND-473). The state uses the 24-hour creation window and discovery-run JSON intent linkage without schema or pipeline changes.

### Security
- Hermes setup is generation-fenced and fail-closed: agent-bound credentials cannot call owner-control routes, stale generations cannot activate or roll back newer setup, only the exact selected principal can pick up/respond/consult, and disconnect revokes installation credentials before local cleanup. **This branch targets dev/private testing only. Production distribution remains blocked until the Mac owner credential is migrated to Keychain and the plaintext file/directory is removed, Developer ID hardened-runtime signing and notarization are complete, and the credential TTL/revocation checklist is verified.**

### Fixed
- Route creation-time and post-discovery intent refinements through one material-fingerprint-deduplicated service, and stop suppressing ordinary intent-page Personal Agent questions merely because discovery already produced an actionable opportunity. Pool and Questioner-generated intent questions now receive symmetric surfacing opportunities while retaining ownership, active-lifecycle, stale-answer, privacy-copy, and one-question-per-material-version gates.
- Add a privacy-minimal batched opportunity lifecycle read for Personal Agent negotiation narration, exposing current status plus whether the authenticated owner is the persisted human acceptor without inferring an H2H conversation (IND-492).
- Removed the pre-assignment create-event discovery race and added transaction-scoped participant-pair/trigger advisory dedup, same-trigger atomic rechecks, pair-global negotiation claims, and explicit evaluator-vs-persistence zero-output telemetry so separate intent matches persist without starting duplicate active negotiations (IND-495; independently corroborated by IND-494).
- Added batched opportunity-actor intent resolution for intent-pinned `list_negotiations` clamping and explicit scope labeling (IND-483).
- Recover negotiation tasks stuck in `submitted` or `working` with the default-off IND-491 watchdog: a five-minute repeatable sweep uses state-aware age thresholds, fresh reads, guarded cancellation/terminal CAS updates, a three-attempt retry budget, and re-enqueues the existing negotiation kickoff without leaving duplicate live tasks.
- Clear `warming` after the first successful from-intent discovery (IND-482) by recording the idempotent `intents.first_discovery_succeeded_at` stamp (migration `0100`, additive). The async MCP discovery-run path continues to use its succeeded-run row.
- Hardened frame-drift scheduler observability (IND-468): startup now reconciles the stable BullMQ job scheduler non-destructively — reading it first, comparing pattern/timezone/name/template-data/attempts/backoff/removal-retention, reusing materially matching schedulers (including overdue `next` values, which previously risked losing the pending iteration to an `upsertJobScheduler` override), upserting only on missing or materially changed definitions, and logging `schedulerAction: created|reused|updated` with the authoritative next timestamp. Every BullMQ attempt is durably tracked in the new privacy-minimized `frame_drift_execution_attempts` table (migration `0097`, unique on `(job_id, attempt)`, no observation-run FK, no vectors/prompts/user-network IDs/raw errors — only an allowlisted failure category), with idempotent start/terminal recording, started-before-flag-before-measurement ordering, redelivery short-circuiting on existing terminal rows, and tracking failures failing the job so measurement never succeeds untracked. Absent attempt rows are unobserved/unknown, not proof BullMQ never enqueued.

### Added
- feat: answered-questions listing (`GET /questions?status=answered`) for the signal workspace Q&A log (IND-472).
- Default-off `WEB_SIGNAL_AGENT_ENABLED` main-web cutover (IND-449): new session-authenticated ordinary web chats explicitly persist `persona=signal`, scoped Signal sessions use persona-distinct registry keys, follow-ups inherit the stored persona, and legacy orchestrator web sessions remain readable but reject new turns with a typed continuation action. Session-authenticated compatibility routes use authenticated provenance and cannot bypass Signal policy; API-key callers retain orchestrator behavior. Compatibility history is orchestrator-only, dedicated web history includes legacy plus Signal sessions, and proposal confirmation returns committed retries before a cheap membership preflight/embedding, then serializes the exact owner/proposal pair in one transaction as the final concurrency authority, returns racing retries to the same intent, and atomically validates current network membership before its single assignment. A project-JWT-authenticated `POST /auth/cli-credential` endpoint now mints only fixed-name, 90-day credentials with immutable `{client:'cli', protocolVersion:1|2}` metadata, a server-only permission marker, and no agent binding, instead of relying on Better Auth's generic create route. Better Auth API-key session promotion is disabled so generic management remains browser-cookie-only, while `POST /auth/cli-credential/revoke` accepts an active CLI `x-api-key` only and deletes an exact same-owner server-issued CLI target after verifying both its row ID and raw-secret hash. Signal's newly allowlisted `create_intent_index` now routes direct, no-prompts, and evaluated writes through one transaction that locks and rechecks the owned unarchived intent, undeleted network, and current accepted membership before preserving the scored assignment metadata. A temporary CLI-v1 Bearer bridge activates only after JWT failure and only for enabled, unexpired keys tagged `{client:'cli', protocolVersion:1}`; it records API-key provenance with no agent binding, never applies to query tokens/default/agent/v2 keys, and leaves ordinary JWTs on the web/Signal surface. Persona spoofing/unknown values fail closed while Telegram, MCP, CLI, and direct-tool orchestrator behavior remains unchanged. Frontend message-metadata writes are session-only; API-key-capable chat, Telegram, MCP, and direct-tool paths are unchanged.
- Lens C evidence segments now carry answeredBy-verified owner answers
  (IND-465 slice 2, wiring the `owner_answer` evidence family the extractor
  already supports). AUTHORITATIVE SOURCE is the questions table only: a new
  `getAnsweredNegotiationQuestionsForOpportunity` questioner-adapter query
  (delegated through `ChatDatabaseAdapter`) returns answers whose
  `answer.answeredBy` equals the segment recipient, restricted to the
  negotiation-family detection modes bound to an opportunityId
  (`negotiation`, `negotiation_inflight`), `detection.sourceType =
  'opportunity'`, `detection.sourceId = opportunityId`, subject-actor
  scoping, and capture-time intent-fingerprint equality when a fingerprint
  is present (absence tolerated — the segment-level task fingerprint guard
  covers intent drift). Every constraint is enforced in SQL AND re-checked
  in the projection; `opportunity.metadata.userAnswers` stays banned as an
  evidence source (no `answeredBy` authority, counterparty-visible, and
  expiry writes synthetic disclosure text). Segments set `ownerAnswers`
  only when non-empty; question text, detection payloads, and other users'
  IDs are never projected, and telemetry stays aggregate-only.
  `shared_message` remains impossible-by-construction (no per-message
  consent primitive; deferred to IND-467).

### Fixed
- Serialized exact-version negotiation-task creation and taskless compensation on shared opportunity advisory/row locks, and added expected-status compare-and-set reactivation, so continuation recovery cannot race a late task insert or overwrite concurrent lifecycle changes (IND-470).
- Normalized blank and null-like opportunity actor intents before uptake lookups and added the idempotent, order-preserving `0096_normalize_opportunity_actor_intents` data migration, which removes malformed `intent` keys while leaving unaffected rows and all other actor data unchanged. The Railway-dev audit scope was 7,690 affected opportunities, requiring explicit release review before rollout (IND-469).
- Restored unscoped asynchronous MCP discovery by wiring discovery-run workers to real network and membership graphs instead of no-op placeholders (IND-466).
- Lens C shadow network binding is now derived from capture-time negotiation
  task metadata instead of `opportunity.context.networkId` (IND-465 slice 1,
  unblocking the IND-433 NO-GO where the context field was empty on all
  evidence-bearing rows). All derivation rules fail closed: only structurally
  valid tasks (capture-time intentSnapshots required) contribute; exactly one
  distinct non-empty task networkId binds an opportunity; zero or disagreeing
  values skip it; a present-but-different context networkId skips it
  (contamination guard — context never overrides tasks). Segment building
  still enforces pass-network equality per task, so sibling tasks recorded
  under another network stay excluded. The Lens-C-local pool selection now
  also includes terminal statuses (`stalled`/`accepted`/`rejected`/`expired`)
  — evidence lives on decided negotiations — via a dedicated
  `exactEvidencePoolWhere` predicate; the shared Lens A live-pool selection
  is untouched. Shadow telemetry gains aggregate-only counters
  (`skippedNoTaskNetwork`, `skippedNetworkDisagreement`,
  `skippedContextMismatch`, `terminalStatusIncluded`) — counts only, never
  IDs or text. No backfill, no creation-flow changes, no new flags;
  `NEGOTIATION_EVIDENCE_QUESTIONS_MODE` semantics unchanged.

### Added
- Aggregate question-funnel telemetry endpoint `GET /debug/questions/funnel` (IND-439 visibility-audit slice): whole-funnel counts grouped by (detection mode, status, expired-past-TTL) with per-group created/expiry date bounds, plus the caller's canonical pending splits. Aggregate-only by construction — the adapter projection carries counts and timestamps only, never question text, payloads, answers, evidence, or other users' IDs. Gated by the existing DebugGuard + AuthGuard wiring.
- Default-off visit-triggered pool mining (`POOL_QUESTIONS_VISIT_TRIGGER`, IND-439 visibility-audit slice): when an intent owner's intent-scoped pending-questions fetch finds no live pending `pool_discovery` question, a debounced BullMQ job (one per caller+intent per 6h via deduplication ids — no new tables) re-mines the intent's pool through the exact shared discovery-completion hook with a new `intent_visit` trigger source. All existing gates apply unchanged (POOL_QUESTIONS_MODE, QUESTIONER_ENABLED, ≥5 pool floor, VoI threshold, ≤1 pool / ≤3 total pending per intent, fingerprint/Jaccard freshness, push budgets); expired rows are never resurrected and the 7-day TTL is untouched. Ships dark — unset/off is a strict no-op.
- Default-off Lens B outcome feedback capture (IND-434): verified explicit human
  owner accept/reject actions are recorded as idempotent, append-only events
  scoped to the recipient's OWN intent, written atomically inside the winning
  owner-action transition (rollback → no event; commit → exactly one). Capture
  is gated on session-authenticated provenance, a presentation-approved cached
  recipient summary, one unique non-introducer counterpart, and an exact or
  unambiguous recipient-owned actor intent. Agent/API-key, ambiguous multiparty,
  and raw-evaluator-only actions never become preferences. The transaction
  share-locks and revalidates the intent revision immediately before insertion;
  shadow mining repeats ownership, lifecycle, fingerprint, and event-integrity
  checks before running and emits redacted, threshold-safe aggregate telemetry
  only. Outcome history is retained across routine intent/opportunity deletion
  (no cascading source foreign keys); only user deletion erases it.
