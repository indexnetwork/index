---
template_version: 1
date: 2026-06-20T01:02:16+03:00
author: Yanek Yuk
commit: 1fb525e7309523c9d9ee54b2329027f5e98621fd
branch: yanki/edg-53-fix-intent-count-consistency
repository: index
topic: "Validation of Intent count consistency across surfaces"
status: ready
verdict: pass
parent: ".rpiv/artifacts/plans/2026-06-19_19-57-03_intent-count-consistency.md"
tags: [validation, intent, count, pagination, mcp, scoped-key, edge-city, premises, user-context, networks]
last_updated: 2026-06-20T01:02:16+03:00
---

## Validation Report: Intent count consistency across surfaces

### Implementation Status

- ✓ Phase 1: Shared canonical intent predicate — Fully implemented
- ✓ Phase 2: /library count + status badge — Fully implemented
- ✓ Phase 3: /networks overview backend — Fully implemented
- ✓ Phase 4: /networks overview frontend — Fully implemented
- ✓ Phase 5: Control-plane Hermes intent count — Fully implemented
- ✓ Phase 6: Hermes skill dead-filter cleanup — Fully implemented

### Automated Verification Results

**Phase 1 — Shared canonical intent predicate**
- ✓ Parity spec passes: `cd backend && bun test src/adapters/tests/database.adapter.spec.ts` — all 3 EDG-53 parity tests pass (96 pass / 2 fail; the 2 failures are `getProfile`/`saveProfile`, unrelated to intent counting and documented pre-existing on the stashed baseline).
- ✓ Both adapter classes route through the shared predicate: `grep -c "activeOwnIntentsWhere(userId)" backend/src/adapters/database.adapter.ts` → 4 (≥ 4).
- ✓ List path uses the shared list builder: `grep -c "ownIntentsListWhere(userId" …` → 1 (≥ 1).
- ✓ Dedup preserved: `grep -cE "selectDistinctOn\(\[(schema\.)?intents\.id\]" …` → 2 (≥ 2).

**Phase 2 — /library count + status badge**
- ✓ Badge driven by the true total: `grep -c "intentTotal" frontend/src/app/library/page.tsx` → 3 (≥ 3) AND `grep -c "({intents.length})" …` → 0.
- ✓ StatusBadge is conditional: `grep -c "StatusBadge" frontend/src/components/IntentList.tsx` → 2 (≥ 2).
- ✓ status plumbed into the list type: `grep -c "status?: string" frontend/src/components/IntentList.tsx` → 2 (≥ 1).

**Phase 3 — /networks overview backend**
- ✓ Route ordering: `@Get('/:id/overview')` at L889 precedes `@Get('/:id')` at L1019 (param route cannot swallow the overview path).
- ✓ Service composes exactly 3 reads: `getMyIntentsInNetwork` + `adapter.getNetworkPremisesForMember` + `adapter.getUserContext` (network.service.ts:383–385).
- ✓ Premise query honesty: `getNetworkPremisesForMember` body contains 0 `embedding`/`limit(` references (no embedding gate, no limit cap).

**Phase 4 — /networks overview frontend**
- ✓ Service method calls the overview endpoint: `grep -c "getNetworkOverview\|networks/${networkId}/overview" frontend/src/services/networks.ts` → 2 (≥ 2).
- ✓ Panel renders all three sections: My Intents / My Premises / Your Context all present (2 occurrences each — JSX comment + `<p>` label).
- ✓ Panel no longer calls the old single-purpose fetch: `grep -c "getMyIndexIntents" frontend/src/components/NetworkOverviewPanel.tsx` → 0.

**Phase 5 — Control-plane Hermes intent count**
- ✓ Intent fetch exported + imported: `fetchIndexIntentCount` → 2 in `index-network.js` AND 2 in `tenants.js`.
- ✓ Sourced from MCP totalCount, not REST: `read_intents\|data.totalCount\|parsed.data` → 3 AND `/api/intents\|/intents/list` → 0.
- ✓ Degrades to null (no throw into caller): `return null` count in `fetchIndexIntentCount` → 5 (≥ 4).
- ✓ Both control-plane JS files pass `node --check`.

**Phase 6 — Hermes skill dead-filter cleanup**
- ✓ Dead status filter removed: `grep -c 'i.status === "active"' …/summarize-negotiations.ts` → 0.
- ✓ Signal pipeline otherwise intact: `grep -c "return intents" …` → 1 (≥ 1); defensive `status?` DTO field retained.

**Type checks**
- ✓ Backend `bunx tsc --noEmit -p tsconfig.json` — exit 0, 0 errors; all four touched backend files clean.
- ✓ Frontend `bunx tsc --noEmit -p tsconfig.json` — 60 errors total, identical to the stashed pre-change baseline (60 before and after). `library/page.tsx` and `IntentList.tsx` are clean; the only touched-file diagnostics (`NetworkOverviewPanel.tsx:4` `Network` import, `networks.ts:3` `../types` import) are pre-existing module-resolution errors on lines this change never modified.
- ✓ No regressions detected.

### Code Review Findings

#### Matches Plan:

- backend/src/adapters/database.adapter.ts — module-level `activeOwnIntentsWhere` / `ownIntentsListWhere` helpers added before `IntentDatabaseAdapter`; both `IntentDatabaseAdapter` and `ChatDatabaseAdapter` route `getActiveIntents` / `getActiveIntentsAcrossIndexes` / list predicate through them (4 helper call-sites; `selectDistinctOn` dedup intact).
- backend/src/adapters/database.adapter.ts — `getNetworkPremisesForMember(networkId, userId)`: `premiseNetworks ⋈ premises` filtered by `networkId + userId + status='ACTIVE' + deletedAt IS NULL`, no embedding gate, no limit cap.
- backend/src/services/network.service.ts:383–385 — `getNetworkOverview` runs the 3 reads via `Promise.all`, current-user scoped, members-only (delegates to `getMyIntentsInNetwork`).
- backend/src/controllers/network.controller.ts:889 — `@Get('/:id/overview')` declared before `@Get('/:id')` (L1019) with `RateLimit('read')` + `AuthOrApiKeyGuard` + `assertAgentNetworkScope`.
- frontend/src/app/library/page.tsx — page-loop accumulates all pages, `intentTotal` from `pagination.totalCount` drives the tab badge (no `intents.length`); `status` plumbed into `LibrarySourceIntent`.
- frontend/src/components/IntentList.tsx — `StatusBadge` renders only when `status` present and non-ACTIVE; `status?` added to `BaseIntent`.
- frontend/src/services/networks.ts + NetworkOverviewPanel.tsx — `getNetworkOverview` client method; panel fetches once and renders My Intents / My Premises / Your Context.
- packages/edge-city/agentvillage-controlplane/control-plane/src/index-network.js — `postMcpMessage` (SSE+JSON) + `fetchIndexIntentCount` (initialize → `read_intents {limit:1}` → `data.totalCount`), null on any failure; exported. tenants.js wires `stats.intents` inside the `stats.index.connected` block.
- packages/edge-city/agentvillage/skills/index-network/scripts/summarize-negotiations.ts — no-op `.filter((i) => !i.status || i.status === "active")` removed from `buildMcpSignalFetcher`; DTO `status?` field retained.

#### Deviations from Plan:

- None. Implementation is a faithful realization of the plan. (Two plan-text annotations were recorded during implementation as non-deviations: Phase 1 §4's dedup grep pattern was a literal-string miscount — the substantive 2-occurrence invariant holds via the corrected regex; Phase 4's section-count criterion expected `3` but returns `6` because each section name appears twice as comment + label — all three sections render.)

#### Pattern Conformance:

- ✓ Adapter predicate consolidation, controller guard/scope wiring, and the frontend service-client shape follow the existing `database.adapter.ts` / `network.controller.ts` / `services/networks.ts` conventions cited in the plan's Pattern References.
- ✓ Control-plane `fetchIndexIntentCount` mirrors `fetchIndexOpportunityCount`'s try/catch → `null` degradation and the skill's `postMcpMessage` SSE client.
- Minor observation: the frontend `whitespace-pre-wrap` "Your Context" block and the dashed empty-state for premises introduce new presentational markup not literally specified — acceptable variation, not a deviation (consistent with the existing IntentList empty-state styling).

#### Potential Issues:

- Edge-City delivery is out-of-tree: Phases 5 and 6 live under git submodules (`packages/edge-city/agentvillage`, `…/agentvillage-controlplane`, both showing `m` in `git status`). They must land via PRs against the canonical Edge-City repos with monorepo submodule-pointer bumps — they are NOT carried by a normal merge of this branch. Not a code defect; a release-mechanics gate.

### Manual Testing Required:

1. Phase 1 — cross-surface count consistency:
   - [ ] For a user with intents spanning multiple networks, `/library`, unscoped MCP `read_intents`, and a network-scoped key report mutually consistent counts (scoped ≤ unscoped, equal when all intents are reachable).
2. Phase 2 — /library:
   - [ ] For a user with >100 intents, the Intents tab badge shows the full DB count and every intent renders (no 100-row truncation).
   - [ ] A non-ACTIVE intent shows a status badge; ACTIVE intents show none.
3. Phase 3/4 — /networks overview:
   - [ ] Member payload shows intents + ACTIVE premises (true count) + per-network user_context; the three sections render with correct premise count.
   - [ ] Empty-premise / null-context states render without error.
   - [ ] Non-member / access-denied returns 403.
4. Phase 5 — control-plane stats:
   - [ ] A live tenant's stats payload shows `intents` as a number matching the scoped MCP `read_intents` totalCount (no longer `null`).
   - [ ] A tenant with a missing/disconnected key, or a failing MCP call, shows `intents: null` without erroring the stats endpoint.
   - [ ] The reported count includes the member's personal-index intents (scoped clamp's `[boundNetwork, personalIndex]` personal leg survives — regression guard, precedent `eff9e02c32`).
5. Phase 6 — Hermes signal fetch:
   - [ ] For a `read_intents` fixture whose items carry no `status` (current graph output), the emitted signal list (ids + summaries) is identical before and after the change.

### Recommendations:

- Ready to commit — implementation is complete and all automated criteria pass.
- Before finishing the branch: open the two Edge-City PRs (agentvillage skill, agentvillage-controlplane) and bump the monorepo submodule pointers, since a plain merge will not carry Phases 5–6.
- Work through the Manual Testing checklist against a live tenant / dev environment before promoting beyond `dev`.
