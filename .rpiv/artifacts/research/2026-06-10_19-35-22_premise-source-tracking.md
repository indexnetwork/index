---
date: 2026-06-10T19:35:22+0300
author: Yankı Ekin Yüksel
commit: 9e7bf43d5e
branch: dev
repository: index
topic: "Premise Source Tracking & Cascade Retraction"
tags: [research, codebase, premise, provenance, user-socials, enrichment, profile-graph, cascade]
status: ready
last_updated: 2026-06-10T19:35:22+0300
last_updated_by: Yankı Ekin Yüksel
---

# Research: Premise Source Tracking & Cascade Retraction

## Research Question

Add `getPremisesBySource` query to `ChatDatabaseAdapter`, extend `UserService.setSocials` to retract
all `integration`-sourced premises and re-enqueue enrichment after persisting, and thread
`provenanceSource: 'integration'` + `provenanceSourceId: <user_social.id>` through the
`decomposePremisesNode` in `profile.graph.ts`. No new schema columns needed —
`PremiseProvenance.sourceId` already exists; the work is consistent population across the
enrichment creation path and a cascade retraction + re-enrich trigger in the social URL update flow.

## Summary

All the schema and state plumbing already exists: `PremiseProvenance.sourceId` is stored in the DB,
`PremiseGraphState` already accepts `provenanceSource`/`provenanceSourceId`/`provenanceConfidence`
annotations (added `68ea501f5e`), and `premise.graph.ts` already reads them at persist time. The gap
is purely **population**: the profile graph's `decomposePremisesNode` calls `premiseGraph.invoke`
without provenance fields, so all enrichment-path premises fall through to `source: 'explicit'`.
Three changes close the loop: (1) add `activeSocialIds` to `ProfileGraphState` and populate it in
`scrapeNode`/`autoGenerateNode`; (2) extend `CompiledPremiseGraph` and use `activeSocialIds` in
`decomposePremisesNode`; (3) extend `UserService.setSocials` with injected deps to retract + re-enrich.
`PremiseEvents.onRetracted` and `EnrichmentQueue.addEnrichUserJob` are already wired and ready.

## Detailed Findings

### Protocol Layer — PremiseGraphState (provenance fields already exist)

- `packages/protocol/src/premise/premise.state.ts:33-43` — `provenanceSource`,
  `provenanceSourceId`, `provenanceConfidence` annotations added by `68ea501f5e`. All three
  default to `undefined` and are passed through to the persist node.
- `packages/protocol/src/premise/premise.graph.ts:124-133` — persist node reads
  `state.provenanceSource ?? 'explicit'` and `state.provenanceSourceId`. If neither is set by
  the caller, the premise is stored as `source: 'explicit'` with no `sourceId`.
- `packages/protocol/src/premise/premise.state.ts:33` — reducer: `(curr, next) => next ?? curr`.
  Passing `provenanceSource: 'integration'` from `decomposePremisesNode` will work cleanly.

### Protocol Layer — CompiledPremiseGraph interface (needs extension)

- `packages/protocol/src/profile/profile.graph.ts:21-30` — local `CompiledPremiseGraph` interface
  declares `invoke(input: { userId, assertionText, tier, operationMode: 'create' })`. It does **not**
  include provenance fields. The interface must be extended with optional
  `provenanceSource?: 'explicit' | 'enrichment' | 'integration' | 'onboarding'` and
  `provenanceSourceId?: string` to allow `decomposePremisesNode` to thread them through.

### Protocol Layer — ProfileGraphState (needs activeSocialIds annotation)

- `packages/protocol/src/profile/profile.state.ts` — the state currently has no `activeSocialIds`
  field. Social records are loaded independently inside `scrapeNode` (line ~277) and
  `autoGenerateNode` (line ~358) but never stored in state; by the time `decomposePremisesNode`
  runs, the IDs are gone.
- Fix: add `activeSocialIds: Annotation<string[]>({ reducer: (_, next) => next ?? [], default: () => [] })`.
  `scrapeNode` and `autoGenerateNode` both call `this.database.getUserSocials(state.userId)` —
  they should write `activeSocialIds: socials.map(s => s.id)` to state alongside their existing
  outputs.
- `decomposePremisesNode` (`profile.graph.ts:777-800`) reads `state.activeSocialIds?.length > 0`
  to decide provenance: if populated → `provenanceSource: 'integration'`,
  `provenanceSourceId: state.activeSocialIds[0]`; otherwise → leave unset (falls back to `explicit`).

### Protocol Layer — decomposePremisesNode call site (the exact change)

- `packages/protocol/src/profile/profile.graph.ts:777` — current invoke call:
  ```
  await invokeWithAbortSignal(this.premiseGraph, {
    userId: state.userId,
    assertionText: p.text,
    tier: p.tier,
    operationMode: 'create',
  });
  ```
  Must become:
  ```
  await invokeWithAbortSignal(this.premiseGraph, {
    userId: state.userId,
    assertionText: p.text,
    tier: p.tier,
    operationMode: 'create',
    ...(state.activeSocialIds?.length
      ? { provenanceSource: 'integration', provenanceSourceId: state.activeSocialIds[0] }
      : {}),
  });
  ```
- `UserDatabaseAdapter.getSocials` (line 6221) already returns `id` on each row, so the IDs are
  available once `getUserSocials` is called in the node.

### Adapter Layer — ChatDatabaseAdapter premise methods

- `backend/src/adapters/database.adapter.ts:3965` — `createPremise`: full JSONB insert including
  `provenance` — already writes `source` and `sourceId` faithfully from the input.
- `backend/src/adapters/database.adapter.ts:4114` — `updatePremise(premiseId, updates)`: generic
  patch method; accepts `status?: 'ACTIVE' | 'RETRACTED' | 'EXPIRED'` and `retractedAt?: Date`.
  This is the retraction call: `updatePremise(id, { status: 'RETRACTED', retractedAt: new Date() })`.
- `backend/src/adapters/database.adapter.ts:4208` — `getExpiredPremises`: uses
  `sql\`(${schema.premises.validity}->>'validUntil')::timestamptz < NOW()\`` — exact JSONB pattern
  to model `getPremisesBySource` after.
- **New method to add**: `getPremisesBySource(userId: string, source: string): Promise<Array<{ id: string }>>`.
  Drizzle query: `where(and(eq(schema.premises.userId, userId), isNull(schema.premises.deletedAt), sql\`(${schema.premises.provenance}->>'source') = ${source}\`))`.
  Return only `{ id }` — callers need no other fields.

### Service Layer — UserService (needs new deps)

- `backend/src/services/user.service.ts:17` — constructor: `constructor(private db = userDatabaseAdapter) {}`.
  Only `UserDatabaseAdapter`. No access to `ChatDatabaseAdapter`, `PremiseEvents`, or `EnrichmentQueue`.
- `backend/src/services/user.service.ts:56-59` — `setSocials`: delegates to `this.db.setSocials(userId, socials)`,
  which internally calls `ProfileDatabaseAdapter.setUserSocials` (delete-then-reinsert transaction,
  `database.adapter.ts:6228`). After this call completes, the old social IDs are gone from the DB.
  Since retraction queries by `source = 'integration'` (not by specific `sourceId`), ordering is
  not a concern — retraction can safely happen after the social update.
- **Chosen injection pattern**: optional constructor deps with defaults (mirrors `PremiseQueueDeps`).
  New interface:
  ```ts
  export interface UserServiceDeps {
    getPremisesBySource: (userId: string, source: string) => Promise<Array<{ id: string }>>;
    retractPremise: (premiseId: string) => Promise<void>;
    emitPremiseRetracted: (premiseId: string, userId: string) => void;
    enqueueEnrichment: (userId: string) => Promise<void>;
  }
  ```
  Default implementations: `chatDatabaseAdapter.getPremisesBySource`, `chatDatabaseAdapter.updatePremise`,
  `PremiseEvents.onRetracted`, `enrichmentQueue.addEnrichUserJob`.
- `export const userService = new UserService()` remains valid with defaults; main.ts needs no changes.

### Events Layer — PremiseEvents.onRetracted (already wired)

- `backend/src/events/premise.event.ts:6` — `onRetracted: (_premiseId, _userId) => {}` — no-op default.
- `backend/src/main.ts:166-171` — wired to enqueue both:
  - `premiseQueue.addCascadeJob({ premiseId, userId, event: 'retracted' })`
    → stalls/expires non-terminal opportunities for the user
  - `premiseQueue.addProfileRegenJob({ userId, trigger: 'premise_retracted' })`
    → rebuilds profile from remaining active premises
- No changes needed. Calling `PremiseEvents.onRetracted(premiseId, userId)` per retracted premise
  triggers the full existing cascade automatically.

### Queue Layer — EnrichmentQueue.addEnrichUserJob (already exists)

- `backend/src/queues/enrichment.queue.ts:97` — `addEnrichUserJob({ userId, reason? })`: enqueues
  `enrich.user` job that invokes the profile graph in `generate` mode — which calls
  `autoGenerateNode` → loads socials → builds enrichment text → `decomposePremisesNode` → creates
  fresh premises. The `reason` field is informational only. Job ID includes timestamp so multiple
  enqueues don't dedup.
- `backend/src/queues/enrichment.queue.ts:65` — singleton `EnrichmentQueue` exists; the correct
  method to call after retraction is `enrichmentQueue.addEnrichUserJob({ userId, reason: 'socials_updated' })`.

### Callers of UserService.setSocials

Three callers all go through `UserService.setSocials`; all get the cascade automatically:
- `backend/src/controllers/auth.controller.ts:108` — profile update endpoint
- `backend/src/gateways/telegram.gateway.ts:218` — Telegram social merge
- `backend/src/controllers/mcp.controller.ts:385` — MCP profile update path (calls
  `chatDatabaseAdapter.setUserSocials` directly, bypasses `UserService` — **needs separate wiring
  or a refactor to route through `UserService`**)

### Gold Standard Template

- `backend/src/events/handlers/question.answer.profile.ts:74-76` — explicit provenance:
  `provenanceSource: 'explicit'`, `provenanceSourceId: input.questionId`, `provenanceConfidence: 0.9`.
  This is the only path that correctly populates all three fields today. Follow this pattern.

## Code References

- `packages/protocol/src/premise/premise.state.ts:33-43` — provenance annotation fields in PremiseGraphState
- `packages/protocol/src/premise/premise.graph.ts:124-133` — persist node reads provenance from state
- `packages/protocol/src/profile/profile.graph.ts:21-30` — `CompiledPremiseGraph` interface (needs extension)
- `packages/protocol/src/profile/profile.graph.ts:277-313` — `scrapeNode`: loads socials, builds objective
- `packages/protocol/src/profile/profile.graph.ts:345-425` — `autoGenerateNode`: loads socials for enrichment
- `packages/protocol/src/profile/profile.graph.ts:720-810` — `decomposePremisesNode`: invoke loop (change site)
- `packages/protocol/src/profile/profile.state.ts` — `ProfileGraphState` (needs `activeSocialIds` annotation)
- `backend/src/adapters/database.adapter.ts:3965-3994` — `createPremise` insert
- `backend/src/adapters/database.adapter.ts:4114-4144` — `updatePremise` generic patch (retraction uses this)
- `backend/src/adapters/database.adapter.ts:4208-4228` — `getExpiredPremises` JSONB query pattern
- `backend/src/adapters/database.adapter.ts:6228-6231` — `UserDatabaseAdapter.setSocials` → delegates to `ProfileDatabaseAdapter`
- `backend/src/services/user.service.ts:17` — `UserService` constructor (needs new deps interface)
- `backend/src/services/user.service.ts:56-59` — `setSocials` (cascade logic goes here, after DB call)
- `backend/src/events/premise.event.ts:1-9` — `PremiseEvents` hooks
- `backend/src/main.ts:166-171` — `PremiseEvents.onRetracted` wiring (already complete)
- `backend/src/queues/enrichment.queue.ts:97` — `addEnrichUserJob` (re-enrich call)
- `backend/src/controllers/mcp.controller.ts:385` — direct `setUserSocials` call (bypasses UserService)
- `backend/src/events/handlers/question.answer.profile.ts:74-76` — gold standard provenance population

## Integration Points

### Inbound References

- `backend/src/controllers/auth.controller.ts:108` — calls `userService.setSocials(user.id, socials)` (gets cascade automatically)
- `backend/src/gateways/telegram.gateway.ts:218` — calls `deps.setUserSocials(userId, merged)` via `userService` (gets cascade automatically)
- `backend/src/controllers/mcp.controller.ts:385` — calls `chatDatabaseAdapter.setUserSocials` **directly**, bypasses `UserService` (needs separate attention)
- `packages/protocol/src/shared/agent/tool.factory.ts:130-131` — `PremiseGraphFactory` receives `ChatDatabaseAdapter` injected as `database` (confirmed fixed by `7928dd8c5d`)

### Outbound Dependencies

- `packages/protocol/src/premise/premise.graph.ts` ← `CompiledPremiseGraph.invoke` called from `decomposePremisesNode`
- `backend/src/adapters/database.adapter.ts` ← `ChatDatabaseAdapter.getPremisesBySource` (new), `updatePremise` (existing)
- `backend/src/events/premise.event.ts` ← `PremiseEvents.onRetracted` (per retracted premise)
- `backend/src/queues/enrichment.queue.ts` ← `enrichmentQueue.addEnrichUserJob` (after all retractions)

### Infrastructure Wiring

- `backend/src/main.ts:166-171` — `PremiseEvents.onRetracted` already wired; no changes needed
- `backend/src/main.ts` — `userService` is imported as a module singleton; no constructor wiring needed if defaults are used

## Architecture Insights

1. **provenance fields were designed for exactly this**: `68ea501f5e` message says "so callers (e.g.
   the backfill script) can specify enrichment provenance instead of the hardcoded explicit/1.0
   defaults." The mechanism was built; the profile graph just never used it.

2. **ProfileGraphState has no social ID slot**: Cross-node data transfer in LangGraph uses state
   annotations. The scrape and auto-generate nodes each call `getUserSocials` independently but
   discard the IDs after building their text. A new `activeSocialIds: string[]` annotation resolves
   this without any structural changes to the graph.

3. **The mcp.controller.ts bypass**: Line 385 calls `chatDatabaseAdapter.setUserSocials` directly,
   not via `UserService`. This path will NOT trigger the retraction cascade unless it's refactored
   to go through `UserService.setSocials` or duplicates the cascade logic. This is the one
   integration gap not covered by the "inside setSocials" decision.

4. **Re-enrich idempotency**: `addEnrichUserJob` uses a timestamp in its `jobId`
   (`enrich.user.${userId}.${Date.now()}`), so it never deduplicates. Calling it when there are no
   integration premises is safe — enrichment just runs and creates fresh premises.

5. **JSONB index**: `getPremisesBySource` filters `(provenance->>'source')` without an index. At
   scale this could be slow. A partial expression index on `(user_id)` where
   `(provenance->>'source') = 'integration'` would help; defer until usage justifies it.

6. **Cascade ordering**: retract-then-re-enrich must be sequential: first `getPremisesBySource` →
   `updatePremise` loop → `PremiseEvents.onRetracted` (per premise) → then `addEnrichUserJob`.
   Emitting `onRetracted` triggers `profile_regen` jobs that rebuild from remaining active premises;
   if re-enrichment runs first it would create new integration premises that could then be retracted
   by a slow retraction loop. Sequential ordering prevents this race.

## Precedents & Lessons

2 similar past changes analyzed.

### Precedent: add provenance override fields to premise graph state

**Commit(s)**: `68ea501f5e` — "feat(protocol): add provenance override fields to premise graph state" (2026-05-25)
**Blast radius**: 3 files
  packages/protocol/src/premise/premise.state.ts — added `provenanceSource`, `provenanceSourceId`, `provenanceConfidence`
  packages/protocol/src/premise/premise.graph.ts — wired fields into persist node
  packages/protocol/src/premise/tests/premise.graph.spec.ts — added override test cases

**Follow-up fixes**: none found

**Takeaway**: The annotation/override pattern is proven and tested; extend it in `ProfileGraphState` with the same approach.

### Precedent: fix ChatDatabaseAdapter injection into PremiseGraphFactory

**Commit(s)**: `7928dd8c5d` — "fix(enrichment): pass ChatDatabaseAdapter to PremiseGraphFactory" (2026-05-28)
**Blast radius**: 1 file
  backend/src/queues/enrichment.queue.ts — switched `ProfileDatabaseAdapter` to `ChatDatabaseAdapter`

**Follow-up fixes**: none found

**Lessons from docs**: `ChatDatabaseAdapter` is the only adapter that implements the full `PremiseGraphDatabase` interface (`createPremise`, `updatePremise`, `assignPremiseToNetwork`, etc.). `ProfileDatabaseAdapter` does not. Always use `ChatDatabaseAdapter` for premise operations.

**Takeaway**: Any new premise method (`getPremisesBySource`) belongs in `ChatDatabaseAdapter`, not `ProfileDatabaseAdapter`.

### Composite Lessons

- Always use `ChatDatabaseAdapter` for premise reads/writes; `ProfileDatabaseAdapter` does not implement the full premise surface (`7928dd8c5d`)
- Provenance overrides via optional state fields work cleanly with the `next ?? curr` reducer pattern; no structural graph changes needed (`68ea501f5e`)

## Historical Context (from `.rpiv/artifacts/`)

- `.rpiv/artifacts/discover/2026-06-10_19-01-28_premise-source-tracking.md` — FRD: feature requirements, decisions, and scope for this change

## Developer Context

**Q (discover: Keep existing provenance shape): Pre-resolved — fields exist but are unpopulated on enrichment path**
A: Keep + fill in consistently across creation paths.

**Q (discover: No new chat source value): Pre-resolved — chat stays as `explicit`**
A: Keep `explicit` for chat-orchestrator input; no enum change needed.

**Q (discover: Social URLs only): Which paths need sourceId populated?**
A: Social URLs only. Chat-orchestrator premises come from the user directly.

**Q (discover: Retract all integration premises): Retraction target**
A: Retract all `source='integration'` premises for the user and re-enrich from scratch.

**Q (discover: Service path owns cascade): Where does cascade live?**
A: Inside `UserService.setSocials`, after the DB call completes.

**Q (discover: Auto re-enrich): Auto re-enrich after retraction?**
A: Yes — call `enrichmentQueue.addEnrichUserJob({ userId, reason: 'socials_updated' })`.

**Q (discover: sourceId carries user_social.id): What should sourceId carry?**
A: `user_social.id` — carried via `activeSocialIds[0]` from `ProfileGraphState`.

**Q (discover: Premise query in ChatDatabaseAdapter): Where should getPremisesBySource live?**
A: `ChatDatabaseAdapter` — follows the established premise-methods pattern.

**Q (`profile.graph.ts:21-30`): `CompiledPremiseGraph` interface omits provenance fields; `ProfileGraphState` has no social ID slot. Which approach?**
A: Extend both — add optional `provenanceSource`/`provenanceSourceId` to `CompiledPremiseGraph.invoke`; add `activeSocialIds: string[]` to `ProfileGraphState`; `scrapeNode`/`autoGenerateNode` populate it; `decomposePremisesNode` reads it.

**Q (`user.service.ts:17`): `UserService` has no access to `ChatDatabaseAdapter`, `PremiseEvents`, or `EnrichmentQueue`. How to wire?**
A: Optional constructor deps with defaults — new `UserServiceDeps` interface, singleton defaults injected via optional constructor parameter.

## Open Questions

- **JSONB index for `provenance->>'source'`**: A GIN index or expression index on `(user_id, (provenance->>'source'))` may be needed if `getPremisesBySource` is slow at scale. Evaluate after initial implementation lands.
- **Multi-social attribution**: When the enrichment scrape uses all social URLs together, `activeSocialIds[0]` records the first social ID. If the user has multiple socials (LinkedIn + GitHub), premises carry the first ID regardless of which social contributed the data. This is "good enough" for the current retraction model (retract all integration premises anyway) but is imprecise for future surgical retraction. Decision deferred.
- **Backfill**: Existing integration-derived premises carry `source: 'explicit'` (pre-feature). These will NOT be retracted. A backfill script analogous to `backfill-premises.ts` would be needed to retroactively tag them before the retraction feature is useful on existing accounts.
- **mcp.controller.ts:385 bypass**: This path calls `chatDatabaseAdapter.setUserSocials` directly and will not trigger the cascade unless routed through `UserService` or separately wired. Needs a decision: refactor to use `UserService`, or duplicate the cascade logic at that call site.
