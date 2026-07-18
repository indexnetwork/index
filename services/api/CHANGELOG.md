# Changelog

All notable changes to the `@indexnetwork/api` service are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this service adheres to [Semantic Versioning](https://semver.org/). Keep this
file updated as part of every release (bump `package.json` and the `[Unreleased]`
section before promoting to `main`).

## [Unreleased]

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
