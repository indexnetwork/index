---
date: 2026-06-19T19:16:39+0300
author: Yanek Yuk
commit: 1fb525e730
branch: yanki/edg-53-fix-intent-count-consistency
repository: index
topic: "Intent count consistency across surfaces"
tags: [research, codebase, intent, count, pagination, mcp, scoped-key, edge-city, premises, user-context, networks]
status: ready
last_updated: 2026-06-19T19:16:39+0300
last_updated_by: Yanek Yuk
---

# Research: Intent count consistency across surfaces

## Research Question
Users see different intent counts depending on where they look — `/library`, `/networks`, the MCP tools, the Hermes/AgentVillage sidecar, and the backend each compute "a user's intents" differently, and Hermes never fetches it at all (EDG-53). Ground the FRD's three deferred open questions in codebase reality before design: (1) the exact canonical intent filter set; (2) what "premises" and "user_context" map to for the `/networks` overview tab; (3) how the AgentVillage/Hermes scoped API key resolves to intent scoping at the backend/MCP boundary.

## Summary

The divergence is **not** caused by differing filter logic — it is caused by **which query each surface chooses** and **one frontend rendering bug**.

- **Canonical filter set (settled):** Every "a user's intents" query keys off `userId = ? AND archivedAt IS NULL` only. The `intentStatusEnum` (`database.schema.ts:10`, values `ACTIVE/PAUSED/FULFILLED/EXPIRED`; column at `:562`) is *selected* in projections but **never appears in any WHERE clause** anywhere in the codebase. The canonical definition is therefore `userId + archivedAt IS NULL`, with no status filter. The FRD's deferred "also exclude PAUSED/FULFILLED/EXPIRED?" question resolves to **no** — that enum is dead as a filter today.
- **The real divergence vector:** `getActiveIntentsAcrossIndexes` (`database.adapter.ts:817`/`:2238`) adds `innerJoin(intentNetworks)` + `inArray(networkId, indexIds)` + `selectDistinctOn([intents.id])`. This **excludes** intents not assigned to any reachable network and **dedups** multi-network membership. So for the same identity, the scoped MCP count is **≤** the `listIntents` total — equal only when every active intent is assigned within the reachable index set. This is legitimate and matches the FRD's "scoped-key view IS the canonical count for Hermes" decision.
- **`/library` is a frontend-only bug:** the server already computes and ships `pagination.totalCount` (`intent.service.ts:114`, `intent.controller.ts:46-53`). The page discards it via a narrow type cast (`library/page.tsx:103`) and renders `intents.length` of a 100-capped page (`:223`). `status` likewise reaches JSON but is dropped frontend-side (absent from `LibrarySourceIntent`/`BaseIntent`). Network assignments **already** flow end-to-end and render (`attachIntentNetworks` → `NetworkMembership` chips).
- **Hermes:** the control-plane hard-codes `intents: null` (`tenants.js:311`) and never fetches. The `summarize-negotiations.ts:309` `status === "active"` re-filter is **dead/fragile code** — the intent graph never emits a `status` field, so today it is a no-op pass-through; were status ever emitted, the lowercase compare against the uppercase enum would silently drop everything.
- **`/networks` overview:** intents are already served (`GET /networks/:id/my-intents`). Premises and the per-network `user_context` row have **no HTTP endpoint** today — two new reads. The adapter query *patterns* exist and are reusable.

## Detailed Findings

### Canonical intent filter set (FRD Open Question 1)

All five "own intents" queries share the base predicate `userId = ? AND archivedAt IS NULL`; none filter `status`:

- **`listIntents`** (`database.adapter.ts:512`) — reference impl. Conditions built at `:519-528`: `eq(userId)` + (`isNull`/`isNotNull(archivedAt)` by `options.archived`) + optional `sourceType`. Parallel `count()` over the **same `where`** at `:550`. `status` is in the row projection (`:539`) but never in `where`.
- **`getActiveIntents`** (`database.adapter.ts:310`) — WHERE `eq(userId) + isNull(archivedAt)` (`:319-324`). Matches canonical exactly.
- **`getActiveIntentsAcrossIndexes`** (`database.adapter.ts:817`) — `selectDistinctOn([intents.id])` + `innerJoin(intentNetworks)` + WHERE `eq(userId) + isNull(archivedAt) + inArray(networkId, indexIds)` (`:821-839`); early-returns `[]` when `indexIds.length === 0` (`:819`). **Only** query that diverges structurally.
- **`getIntentsInIndexForMember`** (`database.adapter.ts:438`) — single-network narrow: `eq(intentNetworks.networkId, networkId) + eq(userId) + isNull(archivedAt)` (`:495-501`). No dedup needed (one network).
- **`searchOwnIntents`** (`database.adapter.ts:1016`) — canonical predicate + `ILIKE` text search (`:1028-1034`), escaped at `:1022`.

Status enum dead-as-a-filter confirmed: `intentStatusEnum` at `database.schema.ts:10`, column `status` default `'ACTIVE'` at `:562`. Grep across the codebase finds no `eq(intents.status, ...)` / `intents.status` in any WHERE.

### Duplicate adapter classes (consolidation target)

Two singletons back the two surfaces; methods are **byte-for-byte identical copies**, not a shared impl:

- `IntentDatabaseAdapter` (class `database.adapter.ts:292`, singleton `:6824`) — backs the **REST** surface. `intent.service.ts:30` sets `this.adapter = intentDatabaseAdapter`.
- `ChatDatabaseAdapter` (class `database.adapter.ts:934`, singleton `:6820`) — backs the **MCP** surface via `scopedDepsFactory.create` (`mcp.controller.ts:655-663`), with `protocolDeps.database = chatDatabaseAdapter` (`mcp.controller.ts:86`). `createUserDatabase` (`:6894`) / `createSystemDatabase` (`:7059`) bind its methods.
- The two `getActiveIntentsAcrossIndexes` (`:821-839` vs `:2241-2257`), the two `getActiveIntents` (`:319-324` vs `:1003-1008`), and the two `getIntentsInIndexForMember` (`:438` vs `:1041`) have identical filter logic. The only behavioral divergence: `IntentDatabaseAdapter.getIntentsInIndexForMember` selects `relevancyScore` (`:495,:503`) while the `ChatDatabaseAdapter` copy omits it (`:1045-1050`) — affects shape, not count.
- `createSystemDatabase`'s `getActiveIntentsAcrossIndexes` wrapper adds two guards: caller-only `if (userId !== authUserId) throw` (`:7134-7136`) and scope filter `indexIds.filter(id => indexScope.includes(id))` (`:7138`).

**Decision:** extract a shared canonical predicate/where-builder so both classes route through one definition (see Developer Context).

### `/library` count + per-intent rendering (FRD reqs 2-3)

Server already ships the correct total; the frontend drops it:

- Adapter `listIntents` returns `{ rows, total }` where `total` is the unbounded `count()` (`database.adapter.ts:530-552`).
- Service clamps `limit` to **max 100** (`intent.service.ts:96`) and returns `pagination: { current, total: ceil(total/limit) /*pages*/, count: rows.length, totalCount: total }` (`:106-113`). Note `pagination.total` = page count, `pagination.totalCount` = true row count.
- Controller `POST /intents/list` (`intent.controller.ts:28`) serializes `pagination: result.pagination` verbatim (`:52`), re-mapping only date fields (`:47-51`). **`totalCount` is alive on the wire.**
- Frontend bug: `api.post<{ intents?: LibrarySourceIntent[] }>('/intents/list', { page: 1, limit: 100 })` (`library/page.tsx:103`) — the generic `T` has no `pagination` field, so `totalCount` is type-dropped. Badge renders `intents.length` (`:223`), capped at 100. The typed paginated path `createIntentsService.getIntents` (`services/intents.ts:6-16`, returns `PaginatedResponse<Intent>`) exists but is **not used** for listing here.
- Per-intent **networks already flow + render**: `IntentListRow.networks` (`database.adapter.ts:166`) via `attachIntentNetworks` (`:564-583`, filters `isNull(networks.deletedAt)`) → controller `...r` (`intent.controller.ts:47`) → `LibrarySourceIntent.networks` (`page.tsx:25`) → `BaseIntent.networks` (`IntentList.tsx:46`) → `NetworkMembership` chips/grace-spinner/"Not in any network" (`IntentList.tsx:53-99,213`). No backend work needed.
- Per-intent **status**: backend supplies it (`IntentListRow.status` `:153`, selected `:534`, passes controller `...r`) but frontend drops it — `status` is absent from `LibrarySourceIntent` (`page.tsx:15-26`) and `BaseIntent` (`IntentList.tsx:31-47`); no status renderer exists. **Frontend-only** work.

### Scoped API key → intent scoping (FRD Open Question 3)

The clamp chain for a network-bound Hermes key:

1. `resolveApiKeyUserId` (`principal.ts:41-48`) resolves `userId`, fail-closed when `userId !== referenceId` (`:45`). MCP path: `mcp.controller.ts:319`, with agent-key both-columns guard at `:315-317`.
2. `resolveAgentNetworkScopeById` (`agent-scope.guard.ts:42-58`) → single bound `scopeId` or null; throws on conflicting scopes (`:50-54`). Carried into identity at `mcp.controller.ts:523-528`.
3. `computeAgentIndexScope` (`mcp.server.ts:210-220`): when `networkScopeId` set, filters `userNetworks` to `m.networkId === networkScopeId || m.isPersonal === true` → `[boundNetwork, personalIndex]`.
4. `applyNetworkScopeToContext` (`mcp.server.ts:236-262`, called `:563`): sets `context.networkId = networkScopeId` and `context.indexScope = computeAgentIndexScope(...)` (`:248`), *before* the membership check (`:250`) so a missing bound network safely collapses to personal-only. Guard `if (context.networkId) return` (`:241`) lets a user-driven chat scope take precedence.
5. Scoped DBs built from `context.indexScope` (`mcp.server.ts:608-609`).

**No-arg `read_intents` under scope** → `context.networkId` set + `context.indexScope = [bound, personal]`.

### MCP read_intents routing (which query backs the scoped count)

- Handler (`intent.tools.ts:75`) builds `graphInput`; no-arg scoped path hits the branch at `:165-167` (`context.indexScope.length > 0 && context.networkId`) → sets `graphInput.indexScope` only (NOT `networkId`/`queryUserId`).
- Graph `queryNode` (`intent.graph.ts:689-718`) matches `!queryUserId && !networkId && indexScope.length > 0` → calls `getActiveIntentsAcrossIndexes(userId, indexScope)` (`:697`). Other routes (`getNetworkIntentsForMember` `:742`, global `getActiveIntents` `:811`) are not taken.
- `totalCount` = `result.readResult.intents.length` (full pre-pagination set) at `intent.tools.ts:188-191` when `limit` is passed.
- **Consequence:** scoped MCP count is "distinct active intents reachable within `[bound, personal]`" — ≤ the `listIntents` total. `selectDistinctOn` prevents inflation from multi-network membership; the `innerJoin` is what makes it potentially smaller (orphaned/unassigned intents excluded).

### Edge-city / Hermes intent fetch (FRD req 6)

- Opportunity mirror to imitate structurally: `fetchIndexOpportunityCount` (`index-network.js:54-64`) — REST `GET /api/opportunities?limit=200` via `indexFetch` (`:7-13`, `x-api-key`, `INDEX_API_BASE` default `https://protocol.index.network`), client-filters `status === 'draft'|'pending'`.
- Wiring slot: `emptyStats().intents = null` (`tenants.js:311`); `getTenantStats` fetches opportunities only when `stats.index.connected` (`tenants.js:494-509`, call at `:502`). A new `fetchIndexIntentCount` is imported at `:13` and called right after `:502`, populating the existing `intents` slot. Per-tenant key via `getTenantIndexApiKey` (`:354-369`, decrypts `secrets.indexApiKey`). MCP endpoint default `INDEX_MCP_URL = https://protocol.index.network/mcp` (`tenants.js:16`).
- **Transport decision (see Developer Context):** source the MCP `read_intents` `totalCount`, NOT a REST `/intents/list` total — only the MCP path yields the canonical *scoped* count. A REST call would count the owner's full unscoped active set and disagree with the scoped Hermes view.
- Hermes skill re-filter: `summarize-negotiations.ts:294` calls `read_intents { limit: 20 }`; `:302-312` re-filters `!i.status || i.status === "active"` (local type `status?: string` at `:153`). The graph read mappings emit only `{ id, description, summary, createdAt }` (`intent.graph.ts:713-718,761,798,825-829`) — **no `status`** — so `!i.status` is always true and everything passes. The filter is dead and should be **removed**; if a total is wanted, read `data.totalCount` (not the 20-item page array). **Submodule note:** `packages/edge-city/agentvillage/` was checked out and readable.

### `/networks` overview data model (FRD Open Question 2 + req 4)

- Current panel renders intents only: `NetworkOverviewPanel.tsx:49-60` calls `indexesService.getMyIndexIntents(index.id)` (`services/networks.ts:303-319` → `GET /networks/:id/my-intents`), badge `intents.length` at `:91`. Backend: `network.controller.ts:867-883` → `network.service.ts:368-372` (`getMyIntentsInNetwork`, re-filters to `userId` at `:371`) → adapter `getNetworkIntentsForMember` (`database.adapter.ts:2198-2236`, `intentNetworks ⋈ intents ⋈ users` filtered `networkId + archivedAt IS NULL` at `:2223`).
- **Premises** = `premises` table (`database.schema.ts:316-334`; `premiseStatusEnum` ACTIVE/RETRACTED/EXPIRED at `:17`, `status` `:324`, soft-delete `deletedAt` `:332`), joined to networks via `premiseNetworks` (`:335-344`). Domain: "composable identity assertions… the source of truth" (`docs/domain/identity-and-context.md:40-44`).
- **user_context** = `user_contexts` table (`database.schema.ts:346-378`): `networkId IS NULL` is the single global identity row (partial unique `user_contexts_user_global_uniq` `:366-368`); concrete `networkId` = per-network row (partial unique `user_contexts_user_network_uniq` `:362-364`). Domain: "synthesized representation of a user, derived from their premises" (`docs/domain/identity-and-context.md:31-36`).
- **Reusable read patterns:** per-network context = `getUserContext(userId, networkId)` predicate `eq(userContexts.networkId, networkId)` (`database.adapter.ts:296-308`, mirror `:4435-4454`). Per-network premises pattern at `database.adapter.ts:5601-5635` (`getPremisesForUserInNetworks`) — BUT it gates `embedding IS NOT NULL` (`:5634`) and caps at `limit 40`, so it would undercount.
- **New work:** intents already served; **premises + user_context are two new reads** (no controller exposes them today). Per the decision below, premises get a **new dedicated count+list query** (no embedding/limit gate).

## Code References
- `backend/src/adapters/database.adapter.ts:512-553` — `listIntents` (canonical list + `count()` total at `:550`)
- `backend/src/adapters/database.adapter.ts:310-328` — `getActiveIntents` (canonical predicate)
- `backend/src/adapters/database.adapter.ts:817-844` / `:2238-2257` — `getActiveIntentsAcrossIndexes` (dedup + network-join; duplicate copies)
- `backend/src/adapters/database.adapter.ts:564-583` — `attachIntentNetworks` (per-intent networks, filters deleted networks)
- `backend/src/adapters/database.adapter.ts:149-167` — `IntentListRow` (carries `status` `:153`, `networks` `:166`)
- `backend/src/adapters/database.adapter.ts:296-308` — `getUserContext(userId, networkId)` per-network/global selector
- `backend/src/adapters/database.adapter.ts:5601-5635` — `getPremisesForUserInNetworks` (embedding-gated, limit 40 — do NOT reuse for count)
- `backend/src/adapters/database.adapter.ts:6820,6824,6894,7059,7126-7139` — singleton wiring + MCP scoped-db factories
- `backend/src/services/intent.service.ts:86-118` — limit clamp `:96`, `totalCount` `:114`
- `backend/src/controllers/intent.controller.ts:28-53` — `POST /intents/list`, pagination on wire `:52`
- `backend/src/schemas/database.schema.ts:10,562` — `intentStatusEnum` (dead as filter); `:316-344` premises/premiseNetworks; `:346-378` user_contexts
- `backend/src/lib/apikey/principal.ts:41-48` — `resolveApiKeyUserId` fail-closed
- `backend/src/guards/agent-scope.guard.ts:42-58` — `resolveAgentNetworkScopeById`
- `backend/src/services/network.service.ts:368-372`; `backend/src/controllers/network.controller.ts:867-883` — `/networks/:id/my-intents`
- `packages/protocol/src/mcp/mcp.server.ts:210-262,563,608-609` — `computeAgentIndexScope`, `applyNetworkScopeToContext`, scoped-db build
- `packages/protocol/src/intent/intent.tools.ts:75,152-191` — read-mode branching, `:165` scoped branch, `:188-191` totalCount
- `packages/protocol/src/intent/intent.graph.ts:689-718,742,811,825-829` — query routing + read mappings (no `status`)
- `frontend/src/app/library/page.tsx:15-26,100-116,222-224` — `LibrarySourceIntent` (no `status`), fetch dropping totalCount, badge
- `frontend/src/services/intents.ts:6-16` — `getIntents` typed paginated path (unused on library)
- `frontend/src/components/IntentList.tsx:31-47,53-99,213` — `BaseIntent` (no status), `NetworkMembership` renderer
- `frontend/src/components/NetworkOverviewPanel.tsx:19,36-60,82-100` — overview panel (intents only)
- `frontend/src/services/networks.ts:303-319` — `getMyIndexIntents`
- `packages/edge-city/agentvillage-controlplane/control-plane/src/index-network.js:7-13,54-66` — `indexFetch`, `fetchIndexOpportunityCount`
- `packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js:13,16,306-331,494-509` — imports, `INDEX_MCP_URL`, `emptyStats` (intents:null `:311`), wiring `:502`
- `packages/edge-city/agentvillage/skills/index-network/scripts/summarize-negotiations.ts:153,289-312` — dead `status === "active"` re-filter `:309`
- `docs/domain/identity-and-context.md:31-44` — premises / user_context concepts

## Integration Points

### Inbound References (who reads "a user's intents")
- `frontend/src/app/library/page.tsx:103` — `POST /intents/list` (REST, full unscoped set; renders `.length` bug)
- `frontend/src/components/NetworkOverviewPanel.tsx:51` — `GET /networks/:id/my-intents` (per-network, user-filtered)
- MCP `read_intents` (`intent.tools.ts:75`) — chat/CLI/Hermes; scoped path → `getActiveIntentsAcrossIndexes`
- `packages/edge-city/.../summarize-negotiations.ts:294` — Hermes skill, MCP `read_intents { limit: 20 }`
- `tenants.js:502` (target) — control-plane stats; currently `intents: null` (`:311`)

### Outbound Dependencies
- All surfaces → `database.adapter.ts` intent queries (two adapter classes)
- MCP scoped reads → `mcp.server.ts` clamp chain → `context.indexScope`
- Edge-city → Index REST (`/api/*`) and MCP (`/mcp`) via `x-api-key`

### Infrastructure Wiring
- `mcp.controller.ts:86,655-663` — `chatDatabaseAdapter` injected; `scopedDepsFactory.create`
- `intent.service.ts:30` — `intentDatabaseAdapter` for REST
- `agent-scope.guard.ts` — agent network-scope resolution; `principal.ts` — API-key principal
- `tenants.js:13,16` — control-plane imports + `INDEX_MCP_URL`/`INDEX_API_BASE`

## Architecture Insights
- **Consistency = same query per scope, not one global integer.** Unscoped reads (REST `/library`, unscoped `read_intents` → `getActiveIntents`) share the `userId + archivedAt IS NULL` predicate and already agree. A network-scoped key legitimately sees a subset (`getActiveIntentsAcrossIndexes`). The FRD's acceptance criterion "all surfaces agree for the same identity/scope" is structurally satisfiable by routing each surface to the right query — the bugs are rendering (`/library`) and absence (Hermes), not filter drift.
- **`selectDistinctOn` is load-bearing.** It is the only thing preventing multi-network membership from inflating the scoped count. Any new per-network count query must preserve dedup semantics (or count distinct intent ids).
- **Status enum is vestigial.** Treat `userId + archivedAt IS NULL` as canonical and do not introduce status filtering without an explicit separate decision (see FRD Suggested Follow-ups).
- **Clamp is context-derived, never caller-supplied.** The `read_pending_questions` hardening (PR #937) is the template: clamp behind `Boolean(context.networkId)`, push limits SQL-side, return a `scopeRestriction` payload, fail loud.
- **Premise/user_context reuse caution.** The existing per-network premise read is tuned for similarity search (embedding-gated, limited); a faithful count needs a dedicated query.

## Precedents & Lessons
6 similar past changes analyzed.

### Precedent: Network-scope clamping for agent/MCP keys ⚠️ riskiest area
**Commit(s)**: `3cf0e888ec`, `d795a39162`, `561602989a`, `96d4853c02`, `a071cdb45d` (2026-05-07, PRs #736/#785/#790); `423ec825a8` (2026-05-19); `d2113c2bd7` (2026-05-20)
**Blast radius**: ~7 layers — `agent-scope.guard.ts`, `intent/network/opportunity.controller.ts`, `mcp.controller.ts`, `mcp.server.ts` (`computeAgentIndexScope`, `applyNetworkScopeToContext`), `tool.helpers.ts` (`resolveChatContext`), `auth.interface.ts`
**Follow-up fixes**:
- `f0a72b22c0` — guard registered but **not actually firing** (scope silently unenforced)
- `12cc85834f` — fail-**open** mixed-scope hole found 3+ weeks later
- `eff9e02c32` — over-clamp **dropped the personal index** from scoped reads
- `9a8c123867`/`efd85caeef`/`65a411715c`/`3ff55a4b39`/`106e6dfc93` — 3-4 Copilot review rounds
**Takeaway**: For the Hermes scoped-key count, write explicit tests that enforcement *fires*, *fails closed*, and *still includes the personal index*.

### Precedent: Scope-aware intent reads (the canonical-query seam)
**Commit(s)**: `302a8054c1` "add getActiveIntentsAcrossIndexes" (2026-05-19); `b298890fc2` "indexScope branch to intent read graph" (2026-05-19, with `intent.graph.scoped.spec.ts`)
**Blast radius**: 2 layers — `database.adapter.ts`, `intent.graph.ts`
**Takeaway**: This is the function being consolidated onto; multi-network inflation is the classic divergence bug and the `selectDistinctOn` dedup is load-bearing.

### Precedent: `read_pending_questions` hardening (DIRECT ANALOG)
**Commit(s)**: `6a4956394c` (2026-06-12, PR #937)
**Lessons from docs** (`.rpiv/artifacts/plans/2026-06-12_00-07-14_pr-937-brief-questions-remediation.md`):
- Clamp must be **context-derived**, never caller-supplied (`Boolean(context.networkId)`)
- Push `limit` **SQL-side**, never `slice()`/`.length` of a page (explicit success criterion)
- Return a **`scopeRestriction`** payload so scoped callers know results are clamped
- **Defense-in-depth** re-filter in the tool even though the host clamps SQL-side
- **Loud failure** (`source: "unavailable"` + reason), never silent
**Takeaway**: Copy this shape verbatim for the Hermes scoped count + `/library` totalCount.

### Precedent: Surface network membership on intents
**Commit(s)**: `64fc5170c1` (2026-06-15, PR #971) — introduced `attachIntentNetworks`, touched `library/page.tsx` + `IntentList.tsx`
**Takeaway**: Most recent touch of the exact files EDG-53 extends; "honest toast" naming signals prior care about not misrepresenting state.

### Precedent: Intent-network orphaning / join-time reconcile
**Commit(s)**: `3df8a49a9e`/`973122b5a6`/`1c14685a80` (2026-06-15, #970); `88ed1b5f39` "personal index holds all intents by default" (#972)
**Lessons from docs** (`.rpiv/artifacts/designs/intent-network-orphaning-fix.md`): intents drift out of network assignment; needed backfill CLI + reconcile job + orphan metric.
**Takeaway**: The `/networks` per-network count must read from the same reconciled assignment source, or it re-diverges from `/library`.

### Precedent: Earlier intent-listing pagination
**Commit(s)**: `5e923ebc1f` (2026-02-02) feature; `cfadf4a6fb` (2026-02-13) "paginate no-index member intent listing" fix 11 days later
**Takeaway**: Pagination + count separation is a recurring stumbling block here.

### Composite Lessons
- **Scope enforcement repeatedly fails open/silently** (`f0a72b22c0`, `12cc85834f`, `eff9e02c32`) — add tests that enforcement fires, fails closed, and keeps the personal index.
- **Totals must come from SQL `count()` over the shared `where`, never `.length`/`slice()` of a page** — the `/library` bug and a PR #937 success criterion.
- **Clamps must be context-derived with a defense-in-depth re-filter and a `scopeRestriction` payload** (`6a4956394c`).
- **Dedup is load-bearing for multi-network counts** (`selectDistinctOn([intents.id])`).
- **Intent↔network assignment drifts** (#970) — per-network counts must use the reconciled source.
- **Cross-layer scope work attracts 3-4 Copilot review rounds** — write scope/clamp tests up front.

## Historical Context (from `.rpiv/artifacts/`)
- `.rpiv/artifacts/discover/2026-06-19_18-59-29_intent-count-consistency.md` — the EDG-53 FRD this research grounds
- `.rpiv/artifacts/plans/2026-06-12_00-07-14_pr-937-brief-questions-remediation.md` — direct analog: scope clamp + SQL-side limit + scopeRestriction + loud failure
- `.rpiv/artifacts/designs/intent-network-orphaning-fix.md` — intent↔network assignment drift, reconcile job + backfill

## Developer Context

**Q (discover: Primary pain is user-facing trust): What's the actual pain — who notices the inconsistent counts and what goes wrong?**
A: User-facing trust / confusion — end users see different counts across surfaces, eroding trust; goal is one consistent number (and list) everywhere.

**Q (discover: Deliverable is full per-surface listing + consistency): Reconcile the integer only, or properly surface the underlying data per surface?**
A: Full listing + consistency across all surfaces including Hermes, with the explicit note that AgentVillage/Hermes uses a scoped API key.

**Q (discover: Scoped-key view is the canonical count for Hermes): How should the scoped API key affect the canonical count?**
A: The count Hermes reports must reflect exactly what the scoped key is authorized to see; consistency means surfaces agree for the same identity/scope.

**Q (discover: `/library` shows all intents + assignments + status): What should `/library` display?**
A: Library shows all intents, their assignments to networks, and their status (if applicable).

**Q (discover: `/networks` overview shows intents + premises + user_context): What does the ticket's "/networks should list proper intents and counts" refer to?**
A: Network overview tab should show intents and premises assigned to that network, and also the user_context.

**Q (discover: Canonical filter definition — deferred): What is the single canonical intent definition?**
A: Deferred to research. **Resolved here:** `userId + archivedAt IS NULL`, no status filter — `intents.status` (`database.schema.ts:562`) is never used in any WHERE clause; the scoped variants add network-join + `selectDistinctOn` dedup, not a different active/ownership rule.

**Q (`tenants.js:311` + `intent.graph.ts:697`): Should `fetchIndexIntentCount` source the REST `/intents/list` total or the MCP `read_intents` totalCount?**
A: **MCP `read_intents` totalCount.** Only the MCP path (→ `getActiveIntentsAcrossIndexes`) yields the canonical *scoped* count; REST would count the owner's full unscoped active set and disagree with the scoped Hermes view.

**Q (`database.adapter.ts:5601-5635`): Reuse the embedding-gated, limit-40 `getPremisesForUserInNetworks` for the `/networks` premise count, or a new query?**
A: **New dedicated count+list query** — join `premiseNetworks ⋈ premises` filtered by `networkId + status='ACTIVE' + deletedAt IS NULL`, no embedding gate, no limit cap, so the badge reflects the true count (honors the "no silent truncation" NFR).

**Q (`database.adapter.ts:817` vs `:2238`): The two adapter classes hold byte-identical intent queries — consolidate, leave + test, or defer?**
A: **Extract a shared canonical predicate** so "one canonical definition" is literally one code path across both classes. (Mitigate the MCP-scope-path risk with the count-consistency tests the precedents demand.)

## Related Research
- None prior. This is the first research artifact for EDG-53; it grounds the discover FRD above.

## Open Questions
- How the AgentVillage/Hermes scoped API key resolves to intent scoping at the backend/MCP boundary — **resolved** (see "Scoped API key → intent scoping"): bound network + personal index via `computeAgentIndexScope`/`applyNetworkScopeToContext`, routed to `getActiveIntentsAcrossIndexes`.
- The intent `status` enum (`ACTIVE/PAUSED/FULFILLED/EXPIRED`) is selected but never filtered (`database.schema.ts:10,562`). If status-based counting is ever desired, it is a separate decision — out of scope for EDG-53.
- `getActiveIntentsAcrossIndexes` dedups via `selectDistinctOn([intents.id])` while other community-browse paths may not (`database.adapter.ts:817-841`) — worth auditing for multi-network inflation independent of this ticket.
- Whether the `/networks` overview premises/user_context should show the **current user's** data (mirroring the "My Intents" user-filter at `network.service.ts:371`, and inherent for user_context) vs all members' — assumed current-user; confirm during design.
