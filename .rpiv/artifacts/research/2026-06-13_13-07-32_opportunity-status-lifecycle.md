---
date: 2026-06-13T13:07:32+0300
author: Yankı Ekin Yüksel
commit: bc94ae699a
branch: dev
repository: index
topic: "Opportunity status lifecycle reference"
tags: [research, codebase, opportunity, status, lifecycle, negotiation, premise-cascade, expiry]
status: ready
last_updated: 2026-06-13T13:07:32+0300
last_updated_by: Yankı Ekin Yüksel
---

# Research: Opportunity status lifecycle reference

## Research Question
Document the *existing* opportunity status lifecycle in Index Network as an authoritative, code-traceable reference: all 8 statuses, the ~6 distinct flows, every transition's trigger and the exact `file:line` where each status is written. Critical subtleties to ground: (1) negotiation "accept" → `pending` (agents agree to surface) is **not** human "accept" → `accepted` (a person opens a DM); (2) per-opportunity `opportunities.status` vs per-participant `opportunities.actors` JSONB (`approved`, `actedAt`); (3) terminal vs reactivatable states (`stalled`/`expired` reactivatable via discovery dedup; `rejected` blocked by the MCP tool). Chained from FRD `.rpiv/artifacts/discover/2026-06-13_12-59-43_opportunity-status-lifecycle.md`.

## Summary

The opportunity lifecycle is an **8-value enum** plus a **parallel per-actor state machine** stored in JSONB. The enum (`backend/src/schemas/database.schema.ts:11`) is `latent | draft | negotiating | pending | stalled | accepted | rejected | expired`. Per-participant lifecycle markers — `approved` (introducer-only) and `actedAt` (commit stamp) — live inside `opportunities.actors` and are **not** statuses; they gate visibility/actionability and enforce the self-accept guard independently of `opportunities.status`.

The single highest-value finding is the **accept ambiguity**: agent negotiation `accept` writes status `pending` (negotiation found a viable match; surface it), while the negotiation trace string is the word `"accepted"` — a different concept from the human-accept status `accepted`, which is only written when a person opens/resolves a DM. These get conflated historically (see Precedents).

Lifecycle logic is **split across five layers** — backend service, protocol opportunity graph, protocol negotiation graph, BullMQ queues, and read filters — each of which writes or interprets status. This "split-brain" topology is the dominant drift risk and the reason this reference is worth maintaining. Two confirmed-but-counterintuitive edges: premise cascade demotes `accepted → stalled` (`backend/src/queues/premise.queue.ts:357-359`), and reactivation has **two different targets** (introducer path → `draft`; normal discovery → `initialStatus`).

Read surfaces narrow the canonical 8 in non-uniform ways: default user list shows 5, network list 4, MCP `list_opportunities` 3, home feed 2 (then ACL/actionability filters), frontend type unions omit `negotiating`/`stalled` (and one also omits `draft`), and the CLI documents only 4 filters.

## Detailed Findings

### Canonical data model — status column vs actor JSONB

- The enum `opportunityStatusEnum` defines the only DB-level allowed values: `latent, draft, negotiating, pending, stalled, accepted, rejected, expired` (`backend/src/schemas/database.schema.ts:11`). Protocol-side type mirror: `packages/protocol/src/shared/interfaces/database.interface.ts:482`.
- `OpportunityActor` JSONB shape (`backend/src/schemas/database.schema.ts:402-418`): `approved?: boolean` is introducer-only (`false` until explicit approval, `true` after — `:409-410`); `actedAt?: string` is an ISO stamp set the first time an actor advances state and is used to block that same actor from later `accept` (`:411-418`).
- `opportunities` table columns (`backend/src/schemas/database.schema.ts:442-447`): `actors` JSONB array (`:442`), `status` enum defaulting to `pending` (`:446`), `acceptedBy` nullable user ref set only on accept (`:447`).
- **Lifecycle is not the enum alone.** Some transitions stage through actor-local JSONB before/alongside the status change (introducer approval, send, accept).

### Adapter write classification (which site touches status / actors / acceptedBy)

| Adapter method | `file:line` | status | actors JSONB | acceptedBy |
|---|---|---|---|---|
| `createOpportunity()` | `backend/src/adapters/database.adapter.ts:5001-5010` | sets (`data.status ?? 'pending'` at `:5010`) | sets (`:5006`) | no |
| `updateOpportunityStatus()` | `database.adapter.ts:5172-5188` | sets | no | sets on `accepted` (`:5181-5182`), else clears to null (`:5183-5184`); throws if `accepted` w/o `acceptedBy` (`:5177-5178`) |
| `updateOpportunityActorApproval()` | `database.adapter.ts:5194-5213` | **no** (status unchanged) | sets `actors[].approved` for matching introducer (`:5206-5210`) | no |
| `stampOpportunityActorAction()` | `database.adapter.ts:5224-5258` | sets (`:5246-5249`) | sets `actors[].actedAt` if absent (`:5241-5244`) | sets on `accepted`, else clears (`:5251-5254`) |
| `expireStaleOpportunities()` | `database.adapter.ts:5440-5450` | sets `expired`; excludes `accepted/rejected/expired` (`:5450`) | no | clears |
| `createOpportunityAndExpireIds()` | `database.adapter.ts:5265-5305` | inserts new (`:5282-5289`) + sets `expired` on `expireIds` (`:5298-5303`, status-agnostic) | sets on insert | — |
| `expireOpportunitiesByIntent()` | `database.adapter.ts:5406-5423` | sets `expired` for actor-intent rows not already expired | no | clears |
| `expireOpportunitiesForRemovedMember()` | `database.adapter.ts:5426-5438` | sets `expired` for network rows w/ removed user | no | clears |
| sibling-accept | `database.adapter.ts:5319-5343` (writes `accepted` at `:5339`) | sets `accepted` | — | sets |

### Flow A — Ambient / background discovery (creates `latent`)

- `resolveInitialStatus()` (`packages/protocol/src/opportunity/opportunity.state.ts:144-150`): explicit `options.initialStatus` wins (`:148`); else `orchestrator → negotiating`, everything else → `pending` (`:149`).
- Ambient `OpportunityService.discoverOpportunities()` passes explicit `initialStatus: 'latent'` (`backend/src/services/opportunity.service.ts:789-799`, override at `:791`), so resolution yields `latent`, not the ambient default `pending`.
- Persist node resolves `initialStatus` (`opportunity.graph.ts:2565`) and assigns `status: initialStatus` in three create paths: introduction/manual `:2693`, introducer-discovery `:2840`, normal-discovery `:3022`. Then `persistOpportunities()` (`packages/protocol/src/opportunity/opportunity.persist.ts:52-89`) → adapter insert (`database.adapter.ts:5001-5010`).

### Flow B — Chat / orchestrator draft + send

- Orchestrator default `negotiating` from `resolveInitialStatus()` (`opportunity.state.ts:149`), persisted via the same `status: initialStatus` lines.
- Orchestrator negotiation hook `onCandidateResolved` flips accepted candidates `negotiating → draft` (`opportunity.graph.ts:2095-2120`; flip at `:2120`); only runs for `trigger === 'orchestrator'` (`:2110`); emits the draft-ready card **after** the flip because the frontend keys cards off `status === 'draft'` (`:2115-2119`).
- Send is a separate mutation: MCP `update_opportunity({status:'pending'})` computes `isSend` (`opportunity.tools.ts:2093`) → `operationMode: 'send'` (`:2099`); graph router sends to `sendNode` (`opportunity.graph.ts:3625`, node at `:3360-3402`). Send allows **only** `latent | draft` (`:3376`, error at `:3380`) and stamps `pending` via `stampOpportunityActorAction()` (`:3397-3401`).
- Roles allowed to send (`opportunity.graph.ts:3386-3390`): `introducer`, `peer`, `patient`/`party` only when no introducer.

### Flow C — Negotiation (the accept ambiguity)

- Init writes `negotiating` (`packages/protocol/src/negotiation/negotiation.graph.ts:102-105`).
- Finalize maps the last turn (`negotiation.graph.ts:365-369`): `accept → pending`, `reject → rejected`, anything else → `stalled`. The emitted **trace outcome** for a successful negotiation is the string `"accepted"` (`:375-383`) — distinct from status `accepted`.
- Agent polling path repeats the identical mapping (`backend/src/services/negotiation-polling.service.ts:401-403`; outcome string `"accepted"` at `:395-397`).
- **Negotiation accept (`→ pending`) ≠ human accept (`→ accepted`).** Negotiation accept means "agents agree this is worth surfacing"; the opportunity still needs a human to accept.

### Flow D — Human accept (`→ accepted`, creates/resolves DM)

Three code paths all write status `accepted` via `stampOpportunityActorAction(..., 'accepted', userId)` after resolving a DM first:
- REST `updateOpportunityStatus()` (`backend/src/services/opportunity.service.ts:459-508`): self-accept guard (`:477-480`), DM resolve before flip (`:489`), accepted write (`:501-504`), sibling accept + contact upserts (`:517-540`).
- `startChat()` (`opportunity.service.ts:632-732`): already-accepted idempotent branch (`:644-674`), allowed source `pending|draft|latent` (`:676-682`), self-accept guard (`:691-693`), DM resolve (`:705-714`), accepted write (`:728-732`).
- Graph `updateNode()` (`opportunity.graph.ts:3239-3312`): allows only `accepted|rejected|expired` (`:3253-3255`), self-accept guard (`:3269-3277`), DM resolve (`:3280-3285`), accepted write (`:3288-3293`); `rejected`/`expired` use plain `updateOpportunityStatus()` (`:3294-3300`).
- **Self-accept guard** (the `actedAt` comment at `database.interface.ts:77-84`) enforced canonically in `updateNode` (`opportunity.graph.ts:3269-3277`) and mirrored in service paths (`opportunity.service.ts:477-480`, `:691-693`).

### Flow E — Introducer approval (actor state, then status)

- `approveIntroduction()` (`backend/src/services/opportunity.service.ts:563-604`): requires caller be the `introducer` actor (`:572-574`); flips `approved` via `updateOpportunityActorApproval(..., true)` (`:585-587`) — **status stays `latent`** during this write (adapter touches only `actors`+`updatedAt`, `database.adapter.ts:5211-5213`); then calls `this.updateOpportunityStatus(id, 'pending', userId)` (`:593-594`), routed to `stampOpportunityActorAction()` for `pending` (`:504-505`).
- Visibility/actionability (`packages/protocol/src/opportunity/opportunity.utils.ts`): `canUserSeeOpportunity()` (`:123-143`) is a role+status ACL that does **not** read `approved`; `isActionableForViewer()` (`:164-192`) reads `introducer.approved` (`:174`) — introducer actionable only while `latent && !approved` (`:177-179`); non-introducers actionable on `latent` if no introducer or approved (`:183-186`), and on `pending` (`:188-190`).

### Flow F — Expiry / archive (comprehensive `→ expired` write sites)

Per the developer decision, the transition table documents **every** `→ expired` site, not just the "archive" flow:
1. Graph archive/delete `deleteNode()` — `opportunity.graph.ts:3341` (function `:3320-3347`; actor-authorized, no source-status check).
2. Service explicit terminal flip — `opportunity.service.ts:507-508` (no actor stamp for `rejected`/`expired`).
3. Cron `OpportunityExpirationCron.expireStale()` — `backend/src/queues/opportunity/expiration.queue.ts:11-16`; only `expiresAt <= now` (`:20-21`) and **excludes** `accepted/rejected/expired` (`:22`); runs every 15 min (`:31-32`).
4. Adapter stale helper `expireStaleOpportunities()` — `database.adapter.ts:5440-5450` (same exclusions).
5. Atomic enrichment replacement `createOpportunityAndExpireIds()` — `database.adapter.ts:5298-5303` (status-agnostic on `expireIds`); used by `opportunity.persist.ts:68-72`, fallback loop at `:78-80`.
6. Premise cascade early-stage — `premise.queue.ts:357` (`draft|latent → expired`).
7. Intent archival — `database.adapter.ts:5406-5423`; legacy `ChatDatabaseAdapter.expireOpportunitiesByIntentActor()` `:354-361`.
8. Network member removal — `database.adapter.ts:5426-5438`.
9. CLI/manual script — `backend/src/cli/expire-opportunities.ts:18-36` (write at `:22`).

Cron-expirable source statuses: `latent, draft, negotiating, pending, stalled`. Excluded: `accepted, rejected, expired`.

### Flow G — Premise cascade (machine demotion, incl. `accepted → stalled`)

- Status sets: `IN_PROGRESS_STATUSES = ['pending','negotiating','accepted']` (`premise.queue.ts:45`), `EARLY_STATUSES = ['draft','latent']` (`:48`); union typed (misleadingly) `NonTerminalStatus` (`:52`).
- Cascade fetches only those five (`defaultGetUserOpportunities()` `:296-308`), then `handlePremiseCascade()` (`:338-360`) maps `EARLY → expired` (`:357`), everything else → `stalled` (`:358`); writes via adapter `updateOpportunityStatus()` (`:319` → `database.adapter.ts:5172-5188`, which clears `acceptedBy`).
- Confirmed edges: `draft→expired`, `latent→expired`, `pending→stalled`, `negotiating→stalled`, **`accepted→stalled`** (real because `accepted ∈ IN_PROGRESS_STATUSES`). The FRD flagged `accepted→stalled` as possibly-undesired — documented as a real edge with a ⚠️ annotation per developer decision.

### Reactivation (two different targets — annotate in master)

- Dedup excludes only `draft` from overlap: `DEDUP_SKIP_STATUSES = ['draft']` (`opportunity.graph.ts:2588-2591`).
- **Introducer path**: `expired|stalled → draft` (`opportunity.graph.ts:2735-2741`; write at `:2741`); `expired` requires same introducer, `stalled` reactivated regardless of age (`:2738`); also stale/orphaned `negotiating → draft` (`:2773`) and `latent → draft` upgrade (`:2785`).
- **Normal discovery path**: `expired|stalled → initialStatus` (`opportunity.graph.ts:2907-2911`; write at `:2911`); stale/orphaned `negotiating → initialStatus` (`:2946`); `latent → initialStatus` upgrade when `initialStatus !== 'latent'` (`:2956-2958`).
- `rejected` appears in **no** reactivation branch → terminal at the dedup layer too.

## Code References
- `backend/src/schemas/database.schema.ts:11` — `opportunity_status` enum (8 values)
- `backend/src/schemas/database.schema.ts:402-418` — `OpportunityActor` (`approved`, `actedAt`)
- `backend/src/schemas/database.schema.ts:442-447` — `opportunities` table (`actors`, `status` default `pending`, `acceptedBy`)
- `packages/protocol/src/shared/interfaces/database.interface.ts:482` — protocol `OpportunityStatus` union; `:77-84` actedAt/self-accept comment
- `packages/protocol/src/opportunity/opportunity.state.ts:144-150` — `resolveInitialStatus()`
- `packages/protocol/src/opportunity/opportunity.graph.ts:2565,2693,2840,3022` — initial status resolution + persist writes
- `packages/protocol/src/opportunity/opportunity.graph.ts:2095-2120` — orchestrator `negotiating → draft` flip
- `packages/protocol/src/opportunity/opportunity.graph.ts:2735-2748,2773,2785` — introducer reactivation/upgrade (→ `draft`)
- `packages/protocol/src/opportunity/opportunity.graph.ts:2907-2958` — discovery reactivation/upgrade (→ `initialStatus`)
- `packages/protocol/src/opportunity/opportunity.graph.ts:3239-3312` — `updateNode` (accept/reject/expire + self-accept guard `:3269-3277`)
- `packages/protocol/src/opportunity/opportunity.graph.ts:3320-3347` — `deleteNode` (`→ expired` at `:3341`)
- `packages/protocol/src/opportunity/opportunity.graph.ts:3360-3402` — `sendNode` (`latent|draft → pending`)
- `packages/protocol/src/negotiation/negotiation.graph.ts:102-105` — init `→ negotiating`
- `packages/protocol/src/negotiation/negotiation.graph.ts:365-369` — finalize `accept→pending / reject→rejected / else→stalled`; `:375-383` trace string `"accepted"`
- `backend/src/services/negotiation-polling.service.ts:401-403` — polling finalize (same mapping)
- `backend/src/services/opportunity.service.ts:459-508` — REST `updateOpportunityStatus` (terminal flip `:507-508`)
- `backend/src/services/opportunity.service.ts:563-604` — `approveIntroduction`
- `backend/src/services/opportunity.service.ts:632-732` — `startChat`
- `backend/src/services/opportunity.service.ts:31,41` — `DEFAULT_LIST_STATUSES`, `DEFAULT_NETWORK_LIST_STATUSES`
- `backend/src/services/opportunity.service.ts:789-799` — ambient discovery `initialStatus: 'latent'`
- `backend/src/adapters/database.adapter.ts:5001-5010,5172-5188,5194-5213,5224-5258,5265-5305,5406-5438,5440-5450` — write sites (see table above)
- `backend/src/queues/opportunity/expiration.queue.ts:11-32` — cron expiry
- `backend/src/queues/premise.queue.ts:45-49,296-360` — premise cascade
- `packages/protocol/src/opportunity/opportunity.utils.ts:123-143,164-192` — `canUserSeeOpportunity` / `isActionableForViewer`
- `packages/protocol/src/opportunity/opportunity.tools.ts:186-190,1471-1574,2030-2110` — MCP block set / `list_opportunities` / `update_opportunity`
- `backend/src/cli/expire-opportunities.ts:18-36` — manual stale-expiry script

## Integration Points

### Inbound References (callers / triggers of transitions)
- `backend/src/controllers/opportunity.controller.ts:219-231` — REST PATCH status → service; `:257-270` `start-chat` route → `startChat`
- `packages/protocol/src/opportunity/opportunity.tools.ts:2030-2110` — MCP `update_opportunity`: target schema `pending|accepted|rejected|expired` (`:2045-2050`); blocks source `accepted|rejected|expired|negotiating` (`:2075-2076`); `pending → send` mode, else `update` (`:2093-2101`)
- `packages/cli/src/opportunity.command.ts:67-80,129-164` — CLI accept/reject (→ MCP `update_opportunity`) + list filter passthrough
- `backend/src/queues/opportunity/expiration.queue.ts:31-32` — cron trigger; `backend/src/queues/premise.queue.ts:296-360` — premise cascade worker

### Outbound Dependencies (what transitions call)
- `getOrCreateDM()` — DM resolution required before any `accepted` write (`opportunity.service.ts:489,705-714`; `opportunity.graph.ts:3280-3285`)
- `stampOpportunityActorAction()` / `updateOpportunityActorApproval()` / `updateOpportunityStatus()` — `backend/src/adapters/database.adapter.ts` (see write table)
- sibling-accept + contact upsert side effects — `opportunity.service.ts:517-540,737-758`; adapter `:5319-5343`

### Infrastructure Wiring
- `backend/src/queues/opportunity/expiration.queue.ts` — 15-min cron worker writing `expired`
- `backend/src/queues/premise.queue.ts` — premise cascade + expiry-detection worker
- `packages/protocol/src/opportunity/feed/feed.graph.ts:57,62-76,194-206` — home feed: default `['latent','pending']`, exhaustive `OPPORTUNITY_STATUS_REGISTRY`, then `canUserSeeOpportunity` + `isActionableForViewer` filters

### Read-side projections (canonical 8 narrowed per surface)
| Surface | Coverage | Hidden / projected |
|---|---|---|
| Protocol `OpportunityStatus` | 8/8 | canonical (`database.interface.ts:482`) |
| MCP `update_opportunity` target | 4/8 | target `pending/accepted/rejected/expired`; blocks source `accepted/rejected/expired/negotiating` (`opportunity.tools.ts:2045-2050,2075-2076`) |
| MCP `list_opportunities` | 3/8 | fetches `draft/pending/latent`; `latent` only for introducer viewer (`opportunity.tools.ts:1510-1574`) |
| Backend user default list | 5/8 | `latent/negotiating/pending/stalled/accepted`; hides `draft/rejected/expired` (`opportunity.service.ts:31`) |
| Backend network default list | 4/8 | `negotiating/pending/stalled/accepted`; hides `latent/draft/rejected/expired` (`opportunity.service.ts:41`) |
| Home feed | 2/8 + filters | `latent/pending` then ACL/actionability (`feed.graph.ts:57,194-206`) |
| Frontend `OpportunityListItem.status` | 6/8 | omits `negotiating/stalled` (`frontend/src/services/opportunities.ts:24`) |
| Frontend `OpportunityStatus` | 5/8 | omits `draft/negotiating/stalled` (`frontend/src/services/opportunities.ts:87`) |
| CLI documented filters | 4/8 | documents `pending/accepted/rejected/expired`; colors only those (`packages/cli/src/opportunity.command.ts:13-16`, `packages/cli/src/output/formatters.ts:405-415`) |

## Architecture Insights

- **Two parallel state machines.** `opportunities.status` (global lifecycle) and `opportunities.actors[]` (`approved`, `actedAt`) are independent. Approval and "having acted" are actor-local and must be documented as a separate axis from the enum — they gate visibility/actionability and enforce the self-accept guard.
- **Accept is overloaded.** Negotiation `accept → pending` (agents surface) vs human `accept → accepted` (DM opens). The negotiation **trace string** `"accepted"` adds a third use of the word. The reference must isolate these in their own subsection (FRD FR5).
- **`accepted` is a compound transition, not a flip.** Every `accepted` write is gated on DM resolution first, sets `acceptedBy`, stamps `actedAt`, and triggers sibling-accept + contact upserts. Order matters (DM before status).
- **Terminal is layer-dependent.** `rejected` is terminal everywhere (MCP-blocked + no reactivation branch). `expired`/`stalled` are terminal-stale for read defaults and MCP source-blocking, yet **reactivatable** by discovery dedup — to `draft` (introducer) or `initialStatus` (discovery).
- **Machine paths are the hidden surface.** Cron, premise cascade, intent archival, member removal, and enrichment replacement all write `expired`/`stalled` without going through the service/graph "flow" entry points. The `accepted → stalled` premise demotion is the sharpest example.
- **`acceptedBy` invariant.** Only `accepted` preserves `acceptedBy`; every other status write clears it to null (`database.adapter.ts:5183-5184`).

## Inconsistencies & Drift Risks

Concrete divergences found while tracing (document these in the reference so future readers can detect drift):

1. **Frontend unions disagree with the enum *and* each other.** `OpportunityListItem.status` (`frontend/src/services/opportunities.ts:24`) omits `negotiating`/`stalled` (6/8); `OpportunityStatus` (`:87`) omits `draft`/`negotiating`/`stalled` (5/8). The two frontend types are themselves inconsistent (`:24` keeps `draft`, `:87` drops it). A backend response carrying `negotiating`/`stalled` would not match either type.
2. **CLI documents 4 of 8 filters and colors only 4.** Help text advertises `pending|accepted|rejected|expired` (`packages/cli/src/opportunity.command.ts:13-16`) and `statusColor()` only colors those four (`packages/cli/src/output/formatters.ts:405-415`); but the command passes any `status` string straight to the API unvalidated (`opportunity.command.ts:129-135`), so `latent`/`draft`/`negotiating`/`stalled` render uncolored and undocumented.
3. **The word "accepted" has three meanings.** Status `accepted` (human DM), negotiation **trace outcome** string `"accepted"` (`negotiation.graph.ts:375-383`, `negotiation-polling.service.ts:395-397`), and negotiation `accept` action that actually writes `pending` (`negotiation.graph.ts:365-369`). Terminology collision — the prime conflation risk flagged by precedent `482239c52c`.
4. **`accepted → stalled` premise demotion (possibly-undesired).** `accepted` is in `IN_PROGRESS_STATUSES` (`backend/src/queues/premise.queue.ts:45`), so premise cascade demotes an already-accepted opportunity to `stalled` (`:357-359`) and clears `acceptedBy`. FRD-flagged as behavior worth questioning; documented as a real edge.
5. **Misleading type name `NonTerminalStatus`.** The premise queue's `NonTerminalStatus` union (`premise.queue.ts:52`) includes `accepted`, which is treated as terminal nearly everywhere else (MCP source-block, cron exclusion, no reactivation needed). Name implies `accepted` is non-terminal here.
6. **Reactivation target differs by path.** Same source statuses, two destinations: introducer path `expired|stalled → draft` (`opportunity.graph.ts:2741`) vs normal discovery `expired|stalled → initialStatus` (`:2911`). Also `expired` reactivation requires same-introducer on the introducer path (`:2738`) but not on discovery (`:2908-2911`) — asymmetric guard.
7. **MCP target/source asymmetry.** `update_opportunity` accepts `expired`/`rejected` as *target* statuses (`opportunity.tools.ts:2045-2050`) but blocks them as *source* (`UPDATE_OPPORTUNITY_BLOCKED_STATUSES`, `:186-190`, guard `:2075-2076`). Intentional (terminal once reached) but a one-way valve worth stating explicitly.
8. **Self-accept guard duplicated across 3 sites; adapter trusts caller.** The guard lives in `updateNode` (`opportunity.graph.ts:3269-3277`) and is mirrored in service paths (`opportunity.service.ts:477-480`, `:691-693`); the adapter `stampOpportunityActorAction()` blindly stamps and documents that callers must enforce the guard (`database.interface.ts:1292-1298`). Any new accept path that calls the adapter directly bypasses the guard.
9. **DB column default `pending` is mostly dead.** `opportunities.status` defaults to `pending` (`database.schema.ts:446`) and the adapter insert falls back to `'pending'` (`database.adapter.ts:5010`), but `resolveInitialStatus()` almost always supplies an explicit status; the default only applies on a raw insert with no status — a latent footgun if a new caller forgets to set status.

## Precedents & Lessons
6 similar past changes analyzed (git available).

### Precedent: Add `negotiating` / `stalled` + wire negotiation lifecycle
**Commit(s)**: `fac3231ce5` — "feat(schema): add negotiating to opportunity status enum" (2026-04-09); `5a296457bd` — "feat(negotiation): wire opportunity status lifecycle through agent negotiation" (2026-04-14)
**Blast radius**: 15 files across 6 layers (schema/migration, adapter, controller, service, negotiation queues, protocol graph, tests, shared interfaces)
**Follow-up fixes**:
- `82def34c16` — "negotiate after persist so opportunities flip status" (2026-04-15) — ordering bug
- `482239c52c` — "reorder outcome ladder so timed_out precedes rejected_stalled" (2026-04-19) — terminal classification order
- `3acc3d7db3` — "allow actions on negotiating status; add negotiate diagnostics" (2026-04-22) — actionability omitted `negotiating`
**Takeaway**: Status docs must call out write ordering and the `negotiating` actionability exception — both broke immediately after wiring.

### Precedent: Atomic Start Chat / acceptance path
**Commit(s)**: `b51dc90554` — "feat(opportunity): atomic Start Chat endpoint" (2026-04-17)
**Blast radius**: 5 files across 4 layers
**Follow-up fixes**: `bae79d3f8a` partial-failure safety; `3279d51807` resolve DM before status flip in PATCH accept; `d061cf77d2` guard sibling accept non-blocking; `746502638e` idempotent already-accepted; `a2b8b18b5b` auth guard on idempotent path
**Takeaway**: Document `accepted` as a compound transition (DM, contacts, idempotency, auth, actor metadata) — all drift-prone.

### Precedent: Introducer approval gates negotiation
**Commit(s)**: `831784dace` — "feat(opportunity): add approve_introduction mode" (2026-04-20)
**Follow-up fixes**: `6b41eb534e` multi-introducer safety; `f575f75e8e` wire queueNegotiateExisting + atomic approval; `161761acfe` add `approved` to local actor schema (type drift)
**Takeaway**: Approval is actor-level gating, not a canonical status — show it as a separate axis to prevent drift.

### Precedent: Self-accept guard + actedAt stamping
**Commit(s)**: `a574d55b91` (service-layer) + `342aeee6b3` (protocol updateNode) — both 2026-05-12
**Takeaway**: The same human action exists in both service and graph paths; cite both so guards/stamping don't diverge.

### Precedent: Hide expired/rejected from default list (IND-254) + expired replacement forwarding
**Commit(s)**: `74fca13e16` (2026-06-08); `850b991c59` (2026-06-08)
**Follow-up fixes**: `5592c404ab` make status/statuses filters mutually exclusive; `1c7cf9e87d`/`2a40fe14b9` resolve enriched/expired replacements
**Takeaway**: Read-side defaults are lifecycle semantics — document which statuses are hidden, deliverable, actionable, reactivatable.

### Precedent: Premise cascade + expiry cron
**Commit(s)**: `b658c4a702` cascade worker (2026-05-25); `9b4d92eae4` expiry cron (2026-05-25); `c104a0373b` premise source tracking & cascade retraction (#934, 2026-06-11)
**Takeaway**: Machine-driven queue transitions are easy to miss and can demote `accepted → stalled`; premise cascade deserves its own flow diagram.

### Composite Lessons
- Highest-risk drift is **split-brain lifecycle logic**: service, graph, queues, connect links, and read filters all write or interpret status (`5a296457bd`, `74fca13e16`).
- Negotiation accept `→ pending` vs human accept `→ accepted` get conflated — keep distinct (`482239c52c`, `5a296457bd`).
- Treat actor JSONB (`approved`, `actedAt`) as a parallel state machine, not part of the enum (`161761acfe`, `a574d55b91`).
- Document read semantics, not just writes — list defaults/actionability/visibility have all needed fixes (`74fca13e16`, `5592c404ab`, `3acc3d7db3`).
- Terminal-looking `expired`/`stalled` are reactivatable; `rejected` is not — cite reactivation/replacement paths (`850b991c59`, `1c7cf9e87d`).

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-06-13_12-59-43_opportunity-status-lifecycle.md` — the FRD this research grounds; defines the deliverable (single `docs/design/` reference, 7 Mermaid diagrams, transition table).
- `.rpiv/artifacts/research/2026-06-13-daily-digest-card-quality-audit.md` — found digests surfacing many `draft` opportunities; touches delivery-eligible statuses.
- `.rpiv/artifacts/research/2026-06-13-memory-cron-opportunity-impact-audit.md` — premise growth drove ~3x opportunity growth, many landing in `expired`/`draft`/`rejected`.

## Developer Context

**Q (discover: Content completeness): How complete should the documented reference be?**
A: Full reference — every status (incl. internal `latent`/`draft`/`negotiating`/`stalled`) and all 6 flows including machine-driven cron expiry and premise cascade.

**Q (discover: Document location): Where should the reference live?**
A: `docs/design/` (alongside `protocol-deep-dive.md`).

**Q (discover: Visual format): What rendering approach?**
A: Mermaid `stateDiagram-v2`.

**Q (discover: Diagram layout): How should diagrams be structured?**
A: One master overview diagram + one focused diagram per flow.

**Q (discover: Transition table): Include a written transition table with citations?**
A: Yes — from→to with trigger class + `file:line`.

**Q (discover: Primary intent): What problem / who hits it?**
A: Document the existing lifecycle — it exists in code but lacks a clear visual + written reference for teammates/AI agents (documentation, not redesign).

**Q (`backend/src/adapters/database.adapter.ts:5406-5438`, `expiration.queue.ts:16`, `premise.queue.ts:357`): `→ expired` is written from ~10 sites beyond the single "expiry/archive" flow. How comprehensive should the transition table be?**
A: Document **every** write site (all ~10 `→ expired` sources + all sites for every other status) with `file:line`. Diagrams stay at the 6-flow level; exhaustive machine/cleanup sites live in the table + a "machine/cleanup expiry" subsection.

**Q (`backend/src/queues/premise.queue.ts:357-359`, `packages/protocol/src/opportunity/opportunity.graph.ts:2741` vs `:2911`): How should the master diagram treat the `accepted → stalled` demotion and the two different reactivation targets?**
A: Show all edges in the master diagram, **annotate the odd ones** — flag `accepted → stalled` as a machine demotion and note that reactivation target differs by path (introducer → `draft`, discovery → `initialStatus`) via a labeled ⚠️ sub-note. Faithful to "document as it exists."

## Related Research
- None directly; see Historical Context for adjacent opportunity audits.

## Open Questions
- None deferred. The exact filename slug under `docs/design/` is settled during the writing pass (recommended: `opportunity-status-lifecycle.md`).
- (Carried from FRD as follow-ups, **not** blockers for this documentation deliverable): the frontend status union being narrower than the backend enum (`frontend/src/services/opportunities.ts:24,87`) may be a read-side gap worth a separate check; and whether the `accepted → stalled` premise demotion (`backend/src/queues/premise.queue.ts:354-360`) is desired behavior. Both are documented as-is here, not resolved.
