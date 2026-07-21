# Changelog

All notable changes to the `@indexnetwork/api` service are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this service adheres to [Semantic Versioning](https://semver.org/). Keep this
file updated as part of every release (bump `package.json` and the `[Unreleased]`
section before promoting to `main`).

## [Unreleased]

### Added
- Add canonical owner-scoped `GET /api/agent/actions/proposals/:proposalId` hydration for reporter action cards; it is session-only, feature-gated, returns display-safe actions without snapshots, and includes consumed results (IND-493).
- Add dark-gated `POST /api/agent/actions/confirm` owner confirmation for reporter cleanup-action proposals (IND-490 PR1). Proposals are persisted with owner/snapshot state, confirmations are session-only, sequential, replay-safe, and use existing premise/intent lifecycle paths; `WEB_AGENT_ACTIONS_ENABLED` remains off everywhere.
- Add the dark-gated `reporter` persona and owner-scoped `getAgentActivitySummary` adapter read for the PR1 Agent reporting surface (IND-476). The new `report_agent_activity` tool exposes only reproducible counts, never counterparty identity or transcripts; `WEB_AGENT_SURFACE_ENABLED` is registered and surfaced as `features.agentSurface` without changing Railway configuration.
- Add per-viewer conversation read cursors, server-side unread counts, and `POST /conversations/:id/read` (IND-475; migration `0098`).
- Record viewer-safe match provenance on start-chat DMs and expose intent-scoped `via` summaries for chat signal provenance (IND-475).
- Expose a read-side `warming` state for fresh owned intents until a succeeded discovery run is recorded (IND-473). The state uses the 24-hour creation window and discovery-run JSON intent linkage without schema or pipeline changes.

### Fixed
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
