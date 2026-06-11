---
date: 2026-06-10T19:01:28+0300
author: Yankı Ekin Yüksel
commit: 3ab9385916
branch: dev
repository: index
topic: "Premise Source Tracking & Cascade Retraction"
tags: [intent, frd, premise, provenance, user-socials, enrichment, profile]
status: ready
last_updated: 2026-06-10T19:01:28+0300
last_updated_by: Yankı Ekin Yüksel
---

# FRD: Premise Source Tracking & Cascade Retraction

## Summary

Premises currently carry a `provenance.source` enum and an optional `provenance.sourceId` string, but the social-URL enrichment path and the chat-orchestrator tool path never populate `sourceId`. This feature wires source tracking into the social-URL enrichment path so that when a user corrects a wrong social URL, all premises derived from that enrichment run are automatically retracted and fresh enrichment is enqueued.

## Problem & Intent

When a wrong social URL is accepted (e.g. the GitHub URL is incorrect), there is no way to identify or remove the premises that were generated from it. The user says "that github url is wrong" but the system has no record of which premises came from which social URL — so stale, incorrect beliefs persist in the profile. The fix requires: (1) consistent `sourceId` population in the enrichment path, and (2) a cascade retraction triggered when a social URL is updated or removed.

## Goals

- Tag every premise created by the social-URL enrichment flow with `source: 'integration'` and `sourceId: <user_social.id>`.
- When `UserService.setSocials` is called (social URL update or removal), retract all `integration`-sourced premises for that user and automatically re-enqueue enrichment.
- Add `getPremisesBySource(userId, source)` to `ChatDatabaseAdapter` so the retraction can identify the affected premises.
- Populate `provenanceSourceId` in `profile.graph.ts`'s `decomposePremisesNode` so newly created premises carry the social record FK.

## Non-Goals

- Per-social-URL surgical retraction (retract only premises tagged with a specific social ID) — deferred. Current scope is "retract all `integration` premises for the user."
- Tracking `sourceId` for chat-orchestrator-created premises (`create_premise` tool) — chat input stays as `source: 'explicit'` with no `sourceId`.
- Restructuring the enrichment scrape to run per-social-URL independently — deferred.
- A new `PremiseDatabaseAdapter` class — premise methods remain in `ChatDatabaseAdapter` for now.

## Functional Requirements

1. The system SHALL populate `provenance.source = 'integration'` and `provenance.sourceId = <user_social.id>` for every premise created inside `profile.graph.ts`'s `decomposePremisesNode` when that decomposition was triggered by social-URL enrichment.
2. The `ChatDatabaseAdapter` SHALL expose a `getPremisesBySource(userId: string, source: string): Promise<Array<{ id: string }>>` method that queries the `premises` table filtering on `provenance->>'source'`.
3. `UserService.setSocials` SHALL, after persisting the new social set, call `getPremisesBySource(userId, 'integration')`, retract each returned premise (set `status = 'RETRACTED'`, `retractedAt = now()`), and then enqueue enrichment for the user.
4. `PremiseEvents.onRetracted` SHALL be emitted for each retracted premise so existing cascade logic (opportunity stalling) fires correctly.
5. The retraction + re-enrich trigger SHALL be idempotent — calling `setSocials` when no integration premises exist completes without error.

## Non-Functional Requirements

- **Performance**: `getPremisesBySource` reads from a JSONB column (`provenance->>'source'`). A GIN index or partial index on `(user_id)` filtering by source value should be evaluated; the call is on the write path of `setSocials` so must not block for more than ~100ms.
- **Security**: `setSocials` is already auth-gated at the controller level. The retraction acts on the same `userId`, so no new permission surface is added.
- **UX / Accessibility**: No direct UI change. The user's profile will reflect correct premises after the re-enrichment job completes (async — same timing as normal enrichment).
- **Reliability**: Retraction is synchronous inside `setSocials`; if it fails, the error propagates and the social-URL update is still rolled back by the service caller. Re-enrichment is enqueued asynchronously — a failed enqueue should log and not surface as a hard error to the caller.

## Constraints & Assumptions

- `profile.graph.ts` today scrapes all social URLs in a single batch. It is assumed that the graph can be told which social IDs were active during the scrape and can pass one (or the primary) ID as `provenanceSourceId` to the premise graph invocation.
- The `EnrichmentQueue` already handles profile enrichment from social URLs — `setSocials` will enqueue a job there after retraction.
- Existing premises created before this feature ships will have `source: 'explicit'` even if they were enrichment-derived. These will NOT be retracted by this feature (they lack the `integration` tag). A backfill is out of scope.
- `setUserSocials` in `ChatDatabaseAdapter` is a delete-then-reinsert transaction that loses the old social IDs. The retraction must query premises BEFORE or DURING the social update, while the old IDs are still knowable. In practice, querying by `source = 'integration'` (not by specific `sourceId`) makes this ordering moot.

## Acceptance Criteria

- [ ] Creating premises via the social-URL enrichment path (`profile.graph.ts` decompose node) produces rows in `premises` where `provenance->>'source' = 'integration'` and `provenance->>'sourceId'` is a non-null `user_socials.id`.
- [ ] Calling `UserService.setSocials(userId, newSocials)` when the user has existing `integration`-sourced premises results in all those premises having `status = 'RETRACTED'` and `retracted_at` set, verified by `SELECT * FROM premises WHERE user_id = $1 AND provenance->>'source' = 'integration'`.
- [ ] After `setSocials` completes, an enrichment job for the user exists in the enrichment queue (verifiable via Bull Board or `enrichmentQueue.queue.getJobs(['waiting', 'active'])`).
- [ ] `UserService.setSocials(userId, [])` with no existing integration premises completes without error and enqueues enrichment.
- [ ] `PremiseEvents.onRetracted` is emitted once per retracted premise; the `premise_cascade` job is created in the premise queue for each (verifiable via queue job list).
- [ ] `getPremisesBySource(userId, 'integration')` returns an empty array for a user with no integration premises and the correct set for a user with them.

## Recommended Approach

Add a `getPremisesBySource` query to `ChatDatabaseAdapter`, extend `UserService.setSocials` to call it and retract + re-enrich after persisting, and thread `provenanceSource: 'integration'` + `provenanceSourceId: <social_id>` through the `decomposePremisesNode` in `profile.graph.ts`. No new schema columns are needed — `PremiseProvenance.sourceId` already exists; the work is consistent population across the enrichment creation path.

## Decisions

### Keep existing provenance shape — just populate it consistently
**Question**: Pre-resolved from codebase evidence — confirmed in Step 4.
**Recommended**: Keep `PremiseProvenance.source + sourceId`, fill them in consistently across creation paths.
**Chosen**: Keep + fill in.
**Rationale**: evidence: `backend/src/schemas/database.schema.ts:305-311` + `packages/protocol/src/premise/premise.graph.ts:131-132` — fields exist but go unpopulated on the enrichment path; confirmed by developer.

### No new `chat` source value in the enum
**Question**: Pre-resolved from codebase evidence — confirmed in Step 4.
**Recommended**: Keep `explicit` for chat-orchestrator input.
**Chosen**: Keep `explicit` for chat input.
**Rationale**: Chat and form-entry are both direct user assertions; no meaningful distinction for the cascade use case. Keeps the enum minimal.

### Social URLs only — other paths out of scope
**Question**: Which creation paths need sourceId populated to unlock the use cases described?
**Recommended**: Social URLs only.
**Chosen**: Social URLs only.
**Rationale**: The cascade-retraction use case is entirely about social URLs; chat-orchestrator premises come from the user directly, so there is no external source to invalidate.

### Retract all integration premises (not per-URL surgical)
**Question**: When a user corrects a social URL, what should the retraction target be?
**Recommended**: Retract all integration premises for the user and re-enrich from scratch.
**Chosen**: Retract all integration premises.
**Rationale**: Simplest correct implementation; profile is rebuilt from the new social set. Per-URL attribution (surgical retraction) deferred to a follow-up.

### Service path owns the cascade — inside `setSocials`
**Question**: Should the retract-then-re-enrich cascade live inside `setSocials` or in a new dedicated method?
**Recommended**: Inside `setSocials`.
**Chosen**: Inside `setSocials`.
**Rationale**: All callers (AuthController, MCP, Telegram gateway) get the cascade automatically; no caller-side changes needed.

### Auto re-enrich after retraction
**Question**: When premises are retracted because a social URL was corrected, should the system automatically re-run enrichment?
**Recommended**: Yes — auto re-enrich after retraction.
**Chosen**: Yes.
**Rationale**: Retraction alone leaves the user with a hollow profile. Re-enrichment ensures the corrected URL set is reflected promptly.

### `sourceId` carries `user_social.id`
**Question**: What should `sourceId` carry for integration-sourced premises?
**Recommended**: `user_social.id`.
**Chosen**: `user_social.id`.
**Rationale**: Future-proofs per-URL surgical retraction; FK to `user_socials` is more reliable than a bare URL string.

### Premise query method stays in `ChatDatabaseAdapter`
**Question**: Should `getPremisesBySource` live in `ChatDatabaseAdapter` or a new `PremiseDatabaseAdapter`?
**Recommended**: `ChatDatabaseAdapter` for now.
**Chosen**: `ChatDatabaseAdapter`.
**Rationale**: Existing premise read/write methods (`updatePremise`, `getExpiredPremises`) already live there; follows the existing pattern without introducing a new class.

## Open Questions

- **JSONB index for `provenance->>'source'`**: A GIN index or expression index on `(user_id, (provenance->>'source'))` may be needed if the `getPremisesBySource` query is slow at scale. Should be evaluated after the initial implementation lands.
- **Multi-social attribution**: When the enrichment scrape uses all social URLs together, which `user_social.id` should be recorded as `sourceId`? Options: primary social, all IDs as JSON array, or the social that most recently changed. Decision deferred — initial implementation can carry the first active social or a known trigger ID.
- **Backfill**: Existing integration-derived premises carry `source: 'explicit'`. A backfill migration to retroactively tag them is out of scope but may be needed before the retraction feature is useful on existing accounts.

## Suggested Follow-ups

- Per-social-URL surgical retraction: restructure `profile.graph.ts` to scrape per-social so each premise is tagged with the exact `user_social.id` — enables retract-only-github without touching LinkedIn premises. (`packages/protocol/src/profile/profile.graph.ts:277-313`)
- Track `conversationId` as `sourceId` for chat-orchestrator-created premises to enable session-level audit or retraction. (`packages/protocol/src/premise/premise.tools.ts:48-83`)
- Consider a `premise_sources` junction table if a premise can legitimately derive from multiple social records simultaneously. (`backend/src/schemas/database.schema.ts:326-343`)

## References

- Free-text input: "premise creation. it needs a source. We need to keep track of how to retrieved that information. It can be a chat with chat orchestrator user input, social urls, etc."
- `backend/src/schemas/database.schema.ts:305-342` — `PremiseProvenance` interface and `premises` table
- `packages/protocol/src/premise/premise.state.ts` — `provenanceSource`, `provenanceSourceId`, `provenanceConfidence` graph state annotations
- `packages/protocol/src/premise/premise.graph.ts:131-132` — current provenance population (falls back to `explicit`, no `sourceId`)
- `packages/protocol/src/profile/profile.graph.ts:777-785` — `decomposePremisesNode` creates premises without provenance context
- `backend/src/events/handlers/question.answer.profile.ts:74-76` — the one path that already correctly sets `provenanceSource` + `provenanceSourceId`
- `backend/src/services/user.service.ts:56-59` — `setSocials` today (no cascade)
- `backend/src/adapters/database.adapter.ts:4501-4531` — `setUserSocials` — delete-then-reinsert transaction
