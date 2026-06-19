---
date: 2026-06-19T19:57:03+0300
author: Yanek Yuk
commit: 1fb525e730
branch: yanki/edg-53-fix-intent-count-consistency
repository: index
topic: "Intent count consistency across surfaces"
tags: [plan, intent, count, pagination, mcp, scoped-key, edge-city, premises, user-context, networks]
status: ready
parent: .rpiv/artifacts/research/2026-06-19_19-16-39_intent-count-consistency.md
phase_count: 6
phases:
  - { n: 1, title: Shared canonical intent predicate }
  - { n: 2, title: /library count + status badge }
  - { n: 3, title: /networks overview backend }
  - { n: 4, title: /networks overview frontend }
  - { n: 5, title: Control-plane Hermes intent count }
  - { n: 6, title: Hermes skill dead-filter cleanup }
unresolved_phase_count: 0
last_updated: 2026-06-19T19:57:03+0300
last_updated_by: Yanek Yuk
---

# Intent Count Consistency Across Surfaces — Implementation Plan

## Overview

Every surface that reports "a user's intents" (`/library`, `/networks`, MCP tools, the Hermes/AgentVillage sidecar) shares one canonical ownership predicate — `userId = ? AND archivedAt IS NULL` — but they diverge today through a frontend rendering bug (`/library` shows a 100-capped page length, not the true total), a missing fetch (Hermes hard-codes `intents: null`), and duplicated query code that can drift. This plan routes each surface to the correct canonical query, consolidates the duplicated predicate into one shared where-builder, fixes the `/library` total + status rendering, adds the missing Hermes count sourced from the MCP scoped view, and surfaces premises + per-network `user_context` on the `/networks` overview tab. No new filter semantics are introduced — the divergence is structural (which query) and presentational (what's rendered), not logical.

## Requirements

- One canonical intent definition (`userId + archivedAt IS NULL`, no status filter) shared across REST and MCP adapter surfaces.
- `/library` shows the true intent total (not a capped page length), each intent's network assignments (already working), and its status when applicable.
- `/networks` overview tab shows the current member's intents, premises assigned to that network, and their per-network `user_context`.
- Hermes/AgentVillage reports an intent count that reflects exactly what its scoped API key is authorized to see (the MCP scoped view), or degrades gracefully (`null`) on failure.
- No surface silently truncates or mislabels counts.

## Current State Analysis

The divergence is **not** caused by differing filter logic. All five "own intents" queries key off `userId + archivedAt IS NULL`; the `intentStatusEnum` is selected in projections but never appears in any WHERE clause. The real divergence vector is `getActiveIntentsAcrossIndexes`, which adds `innerJoin(intentNetworks)` + `selectDistinctOn([intents.id])` — legitimately yielding a network-reachable subset for scoped MCP keys (the FRD's accepted "scoped view is canonical for Hermes").

### Key Discoveries

- **Canonical predicate, two copies:** `IntentDatabaseAdapter` (REST) and `ChatDatabaseAdapter` (MCP) hold byte-identical `getActiveIntents` (`database.adapter.ts:310` ↔ `:1003`), `getActiveIntentsAcrossIndexes` (`:817` ↔ `:2238`), and `listIntents`-style predicates. `listIntents` (`:512`) builds `eq(userId)` + archived toggle + optional `sourceType`, with a parallel `count()` over the same `where` (`:550`).
- **`/library` bug is frontend-only:** the server ships `pagination.totalCount` (`intent.service.ts:114`, `intent.controller.ts:52`) and per-intent `status` (`:47` via `...r`). The page fetches with a generic type that omits `pagination` (`library/page.tsx:103`), so `totalCount` is type-dropped; the badge renders `intents.length` capped at 100 (`page.tsx:222-224`). `status` is absent from `LibrarySourceIntent` (`page.tsx:15-26`) and `BaseIntent` (`IntentList.tsx:31-47`). Network chips already flow + render (`attachIntentNetworks` → `NetworkMembership`).
- **`/networks` overview serves intents only:** `GET /networks/:id/my-intents` (`network.controller.ts:867` → `network.service.ts:368` → `getNetworkIntentsForMember` `:2198`), user-filtered at `network.service.ts:371`. Premises and `user_context` have no HTTP endpoint. Reusable read patterns exist: `getUserContext(userId, networkId)` (`database.adapter.ts:296`), and the premise+premiseNetworks status/deletedAt filter pattern (`:5601` — but it's embedding-gated + limit-40, so a dedicated count+list query is needed).
- **Hermes never fetches:** control-plane `emptyStats().intents = null` (`tenants.js:311`); `getTenantStats` fetches only opportunities inside `if (stats.index.connected)` (`tenants.js:502`). The control-plane has only a REST client (`indexFetch`, `index-network.js:7`) — no MCP client. The Hermes skill `summarize-negotiations.ts:309` re-filters `!i.status || i.status === "active"` against a graph read that never emits `status` (`intent.graph.ts:713-718`) — a dead no-op.
- **MCP scoped count source:** no-arg `read_intents` under a network-bound key routes through `getActiveIntentsAcrossIndexes` (`intent.tools.ts:165` → `intent.graph.ts:697`); when `limit` is passed the response carries `data.totalCount` = full pre-pagination count (`intent.tools.ts:188-191`).

## Desired End State

```ts
// Backend — both adapter classes route through ONE predicate (no drift):
// database.adapter.ts (module scope)
activeOwnIntentsWhere(userId)        // → and(eq(userId), isNull(archivedAt))
ownIntentsListWhere(userId, opts)    // → adds archived toggle + sourceType

// /library — true total, status plumbed:
const res = await api.post<IntentListResponse>('/intents/list', { page: 1, limit: 100 });
res.pagination.totalCount   // → real count, drives the tab badge
intent.status               // → 'ACTIVE' | 'PAUSED' | ... ; badge shown only when !== 'ACTIVE'

// /networks overview — one fetch, three sections:
const overview = await indexesService.getNetworkOverview(networkId);
overview.intents       // current member's intents in this network
overview.premises      // current member's ACTIVE premises assigned to this network
overview.userContext   // the member's per-network user_context text (or null)

// Hermes/control-plane — scoped count via MCP:
stats.intents = await fetchIndexIntentCount(indexApiKey, INDEX_MCP_URL); // data.totalCount | null
```

## What We're NOT Doing

- **No status-enum filtering semantics.** `intents.status` stays selected-but-never-filtered; we render it conditionally but do not introduce status-based counting or active/paused query branches (research Open Question — separate decision).
- **No multi-network inflation audit** of other community-browse paths (`database.adapter.ts` browse reads) — deferred per research Open Questions.
- **No intent↔network reconcile / backfill changes** (PR #970 territory) — the per-network overview reads the existing `intentNetworks` / `premiseNetworks` assignment source as-is.
- **No changes to the MCP scope clamp** (`computeAgentIndexScope`, `applyNetworkScopeToContext`) — existing behavior is correct; we consume it, not modify it.
- **No REST `/intents/list` total for Hermes** — explicitly rejected; it would count the unscoped owner set and disagree with the scoped view.

## Decisions

### Canonical predicate consolidation (shared where-builder)
**Decision:** Extract module-level helpers in `database.adapter.ts` — `activeOwnIntentsWhere(userId)` returning `and(eq(intents.userId, userId), isNull(intents.archivedAt))`, and `ownIntentsListWhere(userId, { archived, sourceType })` for the paginated list — and route both `IntentDatabaseAdapter` and `ChatDatabaseAdapter` methods through them. Keep the helper to the **WHERE predicate only** (not the full query) to minimize blast radius on the risky MCP scope path. Evidence: byte-identical copies at `database.adapter.ts:310`↔`:1003`, `:817`↔`:2238`, `:512` list conditions. Inherited from research checkpoint ("extract a shared canonical predicate").

### Hermes count source: MCP, not REST
**Decision:** Source the Hermes count from MCP `read_intents` `data.totalCount`, requiring a new JSON-RPC client in the control-plane. Only the MCP path (→ `getActiveIntentsAcrossIndexes`) yields the canonical scoped count; REST would count the unscoped owner set. Modeled after `summarize-negotiations.ts:45` (`postMcpMessage`, handles SSE + JSON). Inherited from research checkpoint.

### /networks overview: one new endpoint, current-user scope
**Decision:** Add `GET /networks/:id/overview` returning `{ intents, premises, userContext }`, current-user scoped (mirrors the existing "My Intents" user-filter at `network.service.ts:371`; `user_context` is inherently per-user). Leave `/my-intents` untouched. Premises via a NEW dedicated count+list query (no embedding gate, no limit cap). Inherited from checkpoint.

### /library status badge: conditional render
**Decision:** Plumb `status` through `LibrarySourceIntent`/`BaseIntent` and render a badge only when `status !== 'ACTIVE'`. Shows nothing today (enum is vestigial/always ACTIVE) but future-proofs without visual noise — matches the FRD's "if applicable". Inherited from checkpoint.

## Phase 1: Shared canonical intent predicate

### Overview
Foundation: extract one shared WHERE-builder for the canonical own-intents predicate and route both adapter classes through it, with a parity test proving they agree. Depends on nothing; can run in parallel with Phase 2.

### Changes Required:

#### 1. backend/src/adapters/database.adapter.ts
**File**: backend/src/adapters/database.adapter.ts
**Changes**: MODIFY — add module-level `activeOwnIntentsWhere` / `ownIntentsListWhere` helpers; route both adapter classes' `getActiveIntents`, `getActiveIntentsAcrossIndexes`, and `listIntents` predicates through them.

Add these two helpers at module scope, immediately before `export class IntentDatabaseAdapter` (currently line 292). `intents` is destructured from `schema` at line 187 (`schema.intents === intents`); `SourceType` is module-scoped at line 105; `and/eq/isNull/isNotNull/inArray/desc` are imported at line 6.

```ts
/**
 * Canonical "active own intents" WHERE predicate: a row the user owns that has
 * not been archived. No status filter — `intents.status` is vestigial (selected
 * but never filtered). Both the REST (IntentDatabaseAdapter) and MCP
 * (ChatDatabaseAdapter) surfaces route through this so their counts cannot
 * drift between them. See EDG-53.
 */
function activeOwnIntentsWhere(userId: string) {
  return and(
    eq(schema.intents.userId, userId),
    isNull(schema.intents.archivedAt),
  );
}

/**
 * Canonical predicate for the paginated own-intents list: ownership + an
 * archived toggle (archived rows when `archived` is true, active rows
 * otherwise) + an optional sourceType narrow. Shares the ownership/active spine
 * with {@link activeOwnIntentsWhere} so list `count()` totals and graph reads
 * agree for the same identity. See EDG-53.
 */
function ownIntentsListWhere(
  userId: string,
  options: { archived: boolean; sourceType?: string },
) {
  const conditions = [
    eq(schema.intents.userId, userId),
    options.archived
      ? isNotNull(schema.intents.archivedAt)
      : isNull(schema.intents.archivedAt),
  ];
  const validSourceTypes: SourceType[] = ['file', 'integration', 'link', 'discovery_form', 'enrichment'];
  if (options.sourceType && validSourceTypes.includes(options.sourceType as SourceType)) {
    conditions.push(eq(schema.intents.sourceType, options.sourceType as SourceType));
  }
  return and(...conditions);
}
```

Route `IntentDatabaseAdapter.getActiveIntents` (line 310) AND `ChatDatabaseAdapter.getActiveIntents` (line 993) — both hold the identical inline predicate today — through the helper. The `.where(and(eq(schema.intents.userId, userId), isNull(schema.intents.archivedAt)))` block in each becomes:

```ts
        .from(schema.intents)
        .where(activeOwnIntentsWhere(userId))
        .orderBy(desc(schema.intents.createdAt));
```

In `IntentDatabaseAdapter.listIntents` (line 512), keep the existing `const offset = (options.page - 1) * options.limit;` line (line 514) and replace ONLY the `const conditions` / `validSourceTypes` / `const where = and(...conditions);` block (lines ~515-528) with the shared list builder — do not re-declare `offset`:

```ts
    const where = ownIntentsListWhere(userId, { archived: options.archived, sourceType: options.sourceType });
```

In `IntentDatabaseAdapter.getActiveIntentsAcrossIndexes` (line 817), the `.where(...)` becomes (note: `schema.intentNetworks`, `selectDistinctOn` + `innerJoin` unchanged):

```ts
        .where(
          and(
            activeOwnIntentsWhere(userId),
            inArray(schema.intentNetworks.networkId, indexIds),
          ),
        )
```

In `ChatDatabaseAdapter.getActiveIntentsAcrossIndexes` (line 2238), the same, but the query uses bare destructured `intentNetworks`:

```ts
        .where(
          and(
            activeOwnIntentsWhere(userId),
            inArray(intentNetworks.networkId, indexIds),
          ),
        )
```

#### 2. backend/src/adapters/tests/database.adapter.spec.ts
**File**: backend/src/adapters/tests/database.adapter.spec.ts
**Changes**: MODIFY — extend the existing adapter integration spec (it already builds the DB fixture and instantiates both adapters at lines 92/148) with a parity `describe` block asserting REST and MCP surfaces return identical counts/ids for the same identity/scope. (Supersedes the originally-planned standalone `backend/tests/intent-predicate-parity.spec.ts`, which would have duplicated the fixture harness.)

Append after the `describe('ChatDatabaseAdapter', ...)` block:

```ts
// ═══════════════════════════════════════════════════════════════════════════════
// Intent predicate parity (EDG-53)
// ═══════════════════════════════════════════════════════════════════════════════
describe('Intent predicate parity (EDG-53)', () => {
  const intentAdapter = new IntentDatabaseAdapter();
  const chatAdapter = new ChatDatabaseAdapter();

  it('getActiveIntents agrees across REST and MCP adapters', async () => {
    const rest = await intentAdapter.getActiveIntents(fixture.userAId);
    const mcp = await chatAdapter.getActiveIntents(fixture.userAId);
    expect(mcp.length).toBe(rest.length);
    expect(new Set(mcp.map((i) => i.id))).toEqual(new Set(rest.map((i) => i.id)));
  });

  it('getActiveIntentsAcrossIndexes agrees across REST and MCP adapters', async () => {
    const rest = await intentAdapter.getActiveIntentsAcrossIndexes(fixture.userAId, [fixture.networkId]);
    const mcp = await chatAdapter.getActiveIntentsAcrossIndexes(fixture.userAId, [fixture.networkId]);
    expect(mcp.length).toBe(rest.length);
    expect(new Set(mcp.map((i) => i.id))).toEqual(new Set(rest.map((i) => i.id)));
  });

  it('listIntents total equals unscoped getActiveIntents count', async () => {
    const active = await intentAdapter.getActiveIntents(fixture.userAId);
    const { total } = await intentAdapter.listIntents(fixture.userAId, { page: 1, limit: 100, archived: false });
    expect(total).toBe(active.length);
  });
});
```

### Success Criteria:

#### Automated Verification:
- [x] Parity spec passes: `cd backend && bun test src/adapters/tests/database.adapter.spec.ts` — all 3 EDG-53 parity tests pass (the 2 pre-existing `getProfile`/`saveProfile` failures predate this change; confirmed on stashed baseline).
- [x] Both adapter classes route through the shared predicate: `grep -c "activeOwnIntentsWhere(userId)" backend/src/adapters/database.adapter.ts` returns >= 4 — returned 4.
- [x] List path uses the shared list builder: `grep -c "ownIntentsListWhere(userId" backend/src/adapters/database.adapter.ts` returns >= 1 — returned 1.
- [x] Dedup preserved: both `selectDistinctOn([schema.intents.id]` (line 845) and `selectDistinctOn([intents.id]` (line 2260) intact (>= 2). NOTE: the literal grep pattern as written returns 0 because the code reads `], {` not `])` — substantive criterion (2 occurrences) verified via `grep -nE "selectDistinctOn\(\[(schema\.)?intents\.id\]"`.

#### Manual Verification:
- [ ] For a test user with intents spanning multiple networks, `/library`, unscoped MCP `read_intents`, and a network-scoped key report mutually consistent counts (scoped ≤ unscoped, equal when all intents are reachable).

## Phase 2: /library count + status badge

### Overview
Render the true intent total and a conditional status badge on `/library`, plumbing fields the backend already ships. Depends on nothing; parallel with Phase 1.

### Changes Required:

#### 1. frontend/src/components/IntentList.tsx
**File**: frontend/src/components/IntentList.tsx
**Changes**: MODIFY — add `status` to `BaseIntent`; render a `StatusBadge` (modeled on `NetworkMembership`) only when `status` is present and not `'ACTIVE'`.

Add to the `BaseIntent` interface, after the `networks?` field (~line 47):
```tsx
  /**
   * Lifecycle status (ACTIVE|PAUSED|FULFILLED|EXPIRED). A badge renders only for
   * non-default (non-ACTIVE) values; undefined or ACTIVE renders nothing — the
   * enum is vestigial today, so this is forward-looking. See EDG-53.
   */
  status?: string;
```

Add the badge component after `NetworkMembership` (~line 100):
```tsx
/**
 * Renders an intent's lifecycle status as a badge, but only when it is a
 * non-default value. ACTIVE (the schema default) and undefined render nothing,
 * so today this is invisible and purely forward-looking. See EDG-53.
 */
function StatusBadge({ status }: { status?: string }) {
  if (!status || status.toUpperCase() === 'ACTIVE') return null;
  return (
    <span className="flex items-center gap-1 text-xs text-purple-700 font-ibm-plex-mono px-2 py-0.5 rounded-full bg-purple-50 border border-purple-100 capitalize">
      {status.toLowerCase()}
    </span>
  );
}
```

Render it right after the network chips in the badges row (~line 213):
```tsx
                  <NetworkMembership networks={intent.networks} createdAt={intent.createdAt} />
                  <StatusBadge status={intent.status} />
```

#### 2. frontend/src/app/library/page.tsx
**File**: frontend/src/app/library/page.tsx
**Changes**: MODIFY — type the `/intents/list` response with `pagination`, loop all pages to show every intent, store the true `intentTotal`, add `status` to `LibrarySourceIntent`, drive the tab badge from the true total.

Add `status` to `LibrarySourceIntent` (~line 25):
```tsx
  status?: string;
```

Add a response type near the other type declarations (~line 27):
```tsx
type IntentListResponse = {
  intents?: LibrarySourceIntent[];
  pagination?: { current: number; total: number; count: number; totalCount: number };
};
```

Add total state beside the intents state (~line 89):
```tsx
  const [intentTotal, setIntentTotal] = useState(0);
```

Replace the body of `loadIntents` (the current single `api.post<{ intents?: LibrarySourceIntent[] }>(...)` fetch) with a page-loop that accumulates all pages and captures the true total. `pagination.total` is the page count; `pagination.totalCount` is the true row count:
```tsx
  const loadIntents = useCallback(async () => {
    try {
      setLoadingIntents(true);
      const all: LibrarySourceIntent[] = [];
      let page = 1;
      let totalCount = 0;
      let totalPages = 1;
      const MAX_PAGES = 50; // safety cap (50 * 100 = 5000 intents)
      do {
        const res = await api.post<IntentListResponse>('/intents/list', { page, limit: 100 });
        all.push(...(res.intents ?? []));
        totalCount = res.pagination?.totalCount ?? all.length;
        totalPages = res.pagination?.total ?? 1;
        page += 1;
      } while (page <= totalPages && page <= MAX_PAGES);
      setIntents(all.map(i => ({
        ...i,
        sourceType: i.sourceType ?? 'file',
        sourceId: i.sourceId ?? '',
        sourceName: i.sourceName ?? '',
        sourceValue: i.sourceValue ?? null,
        sourceMeta: i.sourceMeta ?? null,
      })));
      setIntentTotal(totalCount);
    } catch {
      setIntents([]);
      setIntentTotal(0);
    } finally {
      setLoadingIntents(false);
    }
  }, [api]);
```

Change the Intents tab badge to show the true total instead of `intents.length` (~line 222):
```tsx
              Intents
              {intentTotal > 0 && (
                <span className="ml-2 text-xs text-gray-500">({intentTotal})</span>
              )}
```

### Success Criteria:

#### Automated Verification:
- [x] Badge driven by the true total, not page length: `grep -c "intentTotal" frontend/src/app/library/page.tsx` returns >= 3 AND `grep -c "({intents.length})" frontend/src/app/library/page.tsx` returns 0 — returned 3 and 0. Frontend tsc baseline unchanged (60 before and after; no errors in touched files).
- [x] StatusBadge is conditional: `grep -c "StatusBadge" frontend/src/components/IntentList.tsx` returns >= 2 — returned 2.
- [x] status plumbed into the list type: `grep -c "status?: string" frontend/src/components/IntentList.tsx` returns >= 1 — returned 2.

#### Manual Verification:
- [ ] For a user with >100 intents, the `/library` Intents tab badge shows the full DB count and every intent renders in the list (no 100-row truncation).
- [ ] An intent whose status is non-ACTIVE shows a status badge; ACTIVE intents show none.

## Phase 3: /networks overview backend

### Overview
Add a dedicated per-network premise count+list query and a new `GET /networks/:id/overview` endpoint returning `{ intents, premises, userContext }`, current-user scoped. Depends on Phase 1 (same adapter file — sequential).

### Changes Required:

#### 1. backend/src/adapters/database.adapter.ts
**File**: backend/src/adapters/database.adapter.ts
**Changes**: MODIFY — add `getNetworkPremisesForMember(networkId, userId)` to `ChatDatabaseAdapter`, joining `premiseNetworks ⋈ premises` filtered by `networkId + userId + status='ACTIVE' + deletedAt IS NULL` (no embedding gate, no limit cap). The single-`networkId` filter + the `premise_networks` PK `(premiseId, networkId)` guarantee ≤ 1 row per premise, so no `selectDistinctOn` is needed.

Add after `getNetworkIntentsForMember` (~line 2235), inside `ChatDatabaseAdapter`:
```ts
  /**
   * List the current member's ACTIVE premises assigned to a network, for the
   * /networks overview tab. Unlike getPremisesForUserInNetworks (tuned for
   * similarity search — embedding-gated, capped at 40), this is an honest
   * list+count: no embedding gate, no limit. Soft-deleted premises excluded.
   * Current-user scoped. See EDG-53.
   */
  async getNetworkPremisesForMember(networkId: string, userId: string): Promise<Array<{
    id: string;
    text: string;
    summary: string | null;
    createdAt: Date;
  }>> {
    const rows = await db
      .select({
        id: schema.premises.id,
        assertion: schema.premises.assertion,
        createdAt: schema.premises.createdAt,
      })
      .from(schema.premiseNetworks)
      .innerJoin(schema.premises, eq(schema.premiseNetworks.premiseId, schema.premises.id))
      .where(and(
        eq(schema.premiseNetworks.networkId, networkId),
        eq(schema.premises.userId, userId),
        eq(schema.premises.status, 'ACTIVE'),
        isNull(schema.premises.deletedAt),
      ))
      .orderBy(desc(schema.premises.createdAt));

    return rows.map((r) => {
      const assertion = r.assertion as { text?: string; summary?: string } | null;
      return {
        id: r.id,
        text: assertion?.text ?? '',
        summary: assertion?.summary ?? null,
        createdAt: r.createdAt,
      };
    });
  }
```

#### 2. backend/src/services/network.service.ts
**File**: backend/src/services/network.service.ts
**Changes**: MODIFY — add `getNetworkOverview(networkId, userId)` composing intents (existing membership-gated read), premises (new query), and the per-network user_context via `Promise.all`.

Add after `getMyIntentsInNetwork` (~line 372):
```ts
  /**
   * Compose the /networks overview payload for the current member: their intents
   * in the network, their ACTIVE premises assigned to it, and their per-network
   * user_context. Members only — getMyIntentsInNetwork throws if not a member.
   * See EDG-53.
   */
  async getNetworkOverview(networkId: string, userId: string) {
    logger.verbose('[NetworkService] Getting network overview', { networkId, userId });
    const [intents, premises, userContext] = await Promise.all([
      this.getMyIntentsInNetwork(networkId, userId),
      this.adapter.getNetworkPremisesForMember(networkId, userId),
      this.adapter.getUserContext(userId, networkId),
    ]);
    return {
      intents,
      premises,
      userContext: userContext ? { text: userContext.text, generatedAt: userContext.generatedAt } : null,
    };
  }
```

#### 3. backend/src/controllers/network.controller.ts
**File**: backend/src/controllers/network.controller.ts
**Changes**: MODIFY — add `GET /:id/overview` (members only, scope-asserted), mirroring `getMyIntents`. Place before `GET /:id` to avoid route collision.

Add after `getMyIntents` (~line 883):
```ts
  /**
   * Get the current user's overview for a network: their intents, premises, and
   * per-network user_context. Members only.
   * IMPORTANT: This must come before GET /:id to avoid route collision.
   */
  @Get('/:id/overview')
  @UseGuards(RateLimit('read'), AuthOrApiKeyGuard)
  async getOverview(req: Request, user: AuthenticatedUser, params: Record<string, string>) {
    try {
      await assertAgentNetworkScope(req, params.id);
      const overview = await networkService.getNetworkOverview(params.id, user.id);
      logger.verbose('Network overview retrieved', { networkId: params.id, userId: user.id, intents: overview.intents.length, premises: overview.premises.length });
      return Response.json(overview);
    } catch (err: unknown) {
      const msg = errorMessage(err);
      if (msg.includes('Access denied') || msg.includes('Not a member')) {
        return Response.json({ error: msg }, { status: 403 });
      }
      throw err;
    }
  }
```

### Success Criteria:

#### Automated Verification:
- [x] Premise query has no embedding gate or limit cap: `grep -A20 "async getNetworkPremisesForMember" backend/src/adapters/database.adapter.ts | grep -c "embedding\|limit("` returns 0 — returned 0.
- [x] Route registered before `/:id`: `grep -n "@Get('/:id/overview')\|@Get('/:id')" backend/src/controllers/network.controller.ts` lists `/:id/overview` at a lower line number than `/:id` — `/:id/overview` at L889, `/:id` at L1019.
- [x] Service composes all three reads: `grep -A8 "async getNetworkOverview" backend/src/services/network.service.ts | grep -c "getMyIntentsInNetwork\|getNetworkPremisesForMember\|getUserContext"` returns 3 — returned 3.
- [x] Backend lints: `cd backend && bun run lint` — 0 errors (62 pre-existing warnings, none in touched files). Backend `tsc --noEmit` also clean (0 errors).

#### Manual Verification:
- [ ] `GET /networks/:id/overview` as a member returns `{ intents, premises, userContext }`; premises count matches the member's ACTIVE premises assigned to that network.
- [ ] A non-member receives 403.
- [ ] A member with no per-network context row gets `userContext: null` (not an error).

## Phase 4: /networks overview frontend

### Overview
Add the `getNetworkOverview` service method and render premises + user_context sections in the overview panel. Depends on Phase 3 (needs the endpoint).

### Changes Required:

#### 1. frontend/src/services/networks.ts
**File**: frontend/src/services/networks.ts
**Changes**: MODIFY — add `getNetworkOverview(networkId)` calling `GET /networks/:id/overview`, mirroring `getMyIndexIntents`.

Insert after the `getMyIndexIntents` method (after its `return response.intents || [];\n  },` and before the `// Remove member intent` comment, ~line 320):
```ts
  // Get current user's overview for a network: intents, premises, user_context (EDG-53)
  getNetworkOverview: async (networkId: string): Promise<{
    intents: Array<{ id: string; payload: string; summary?: string | null; createdAt: string; userId: string; userName: string }>;
    premises: Array<{ id: string; text: string; summary: string | null; createdAt: string }>;
    userContext: { text: string; generatedAt: string } | null;
  }> => {
    const response = await api.get<{
      intents: Array<{ id: string; payload: string; summary?: string | null; createdAt: string; userId: string; userName: string }>;
      premises: Array<{ id: string; text: string; summary: string | null; createdAt: string }>;
      userContext: { text: string; generatedAt: string } | null;
    }>(`/networks/${networkId}/overview`);
    return {
      intents: response.intents || [],
      premises: response.premises || [],
      userContext: response.userContext ?? null,
    };
  },
```

#### 2. frontend/src/components/NetworkOverviewPanel.tsx
**File**: frontend/src/components/NetworkOverviewPanel.tsx
**Changes**: MODIFY — fetch overview once, add premises + userContext state, render My Intents (existing), My Premises, and Your Context sections with true counts.

Add state after `const [intentsLoading, setIntentsLoading] = useState(true);` (~line 46):
```tsx
  const [premises, setPremises] = useState<{ id: string; text: string; summary: string | null; createdAt: string }[]>([]);
  const [userContext, setUserContext] = useState<{ text: string; generatedAt: string } | null>(null);
```

Replace the load `useEffect` (lines ~49-60, currently loads `getMyIndexIntents`) with:
```tsx
  useEffect(() => {
    const loadOverview = async () => {
      try {
        const overview = await indexesService.getNetworkOverview(index.id);
        setIntents(overview.intents);
        setPremises(overview.premises);
        setUserContext(overview.userContext);
      } catch (err) {
        console.error('Error loading network overview:', err);
      } finally {
        setIntentsLoading(false);
      }
    };
    loadOverview();
  }, [index.id, indexesService]);
```

Insert two new sections between the end of the My Intents `</div>` and the closing `</div>` of the `space-y-8` wrapper (after the `IntentList` block):
```tsx
        {/* My Premises */}
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono">
              My Premises
            </p>
            {!intentsLoading && (
              <span className="text-xs text-gray-400">{premises.length} premise{premises.length !== 1 ? 's' : ''}</span>
            )}
          </div>
          {intentsLoading ? null : premises.length === 0 ? (
            <div className="text-sm text-gray-500 font-ibm-plex-mono py-12 text-center border border-dashed border-gray-200 rounded-lg">
              <p>No premises assigned to this network yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {premises.map((p) => (
                <div key={p.id} className="p-4 rounded-lg border border-gray-200 bg-white">
                  <p className="text-sm text-gray-900 leading-relaxed">
                    {(p.summary && p.summary.trim().length > 0 ? p.summary : p.text).trim()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Your Context */}
        {userContext && userContext.text.trim().length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider font-ibm-plex-mono mb-4">
              Your Context
            </p>
            <div className="p-4 rounded-lg border border-gray-200 bg-gray-50">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{userContext.text}</p>
            </div>
          </div>
        )}
```

### Success Criteria:

#### Automated Verification:
- [x] Service method calls the overview endpoint: `grep -c "networks/\${networkId}/overview\|getNetworkOverview" frontend/src/services/networks.ts` returns >= 2 — returned 2.
- [x] Panel renders all three sections: `grep -c "My Intents\|My Premises\|Your Context" frontend/src/components/NetworkOverviewPanel.tsx` returns 3 — returned 6 (each section name appears twice: JSX comment + `<p>` label; plan's expected `3` undercounted the comments). All three distinct section names confirmed present (2 each). Intent satisfied: all three sections render.
- [x] Panel no longer calls the old single-purpose fetch: `grep -c "getMyIndexIntents" frontend/src/components/NetworkOverviewPanel.tsx` returns 0 — returned 0. Frontend tsc baseline unchanged (60 before and after; the 2 errors in touched files are pre-existing import-resolution errors on lines not modified by this phase).

#### Manual Verification:
- [ ] Opening a network's overview tab shows My Intents, My Premises (with a count matching the member's ACTIVE premises in that network), and Your Context (when present).
- [ ] A member with no premises sees the "No premises assigned" empty state; a member with no context sees no Your Context section.

## Phase 5: Control-plane Hermes intent count

### Overview
Add an MCP JSON-RPC client + `fetchIndexIntentCount` to the control-plane and wire it into `getTenantStats`. Depends on nothing; parallel (separate codebase).

### Changes Required:

#### 1. packages/edge-city/agentvillage-controlplane/control-plane/src/index-network.js
**File**: packages/edge-city/agentvillage-controlplane/control-plane/src/index-network.js
**Changes**: MODIFY — add a minimal `postMcpMessage` JSON-RPC client (SSE + JSON) and `fetchIndexIntentCount(apiKey, mcpUrl)` reading `data.totalCount`; export it. Submodule note: lands via a PR against `Edge-City/agentvillage-controlplane`, then the monorepo pointer is bumped.

Add after `INDEX_LOOKUP_TIMEOUT_MS` (~line 5):
```js
const INDEX_MCP_URL = (process.env.INDEX_MCP_URL || 'https://protocol.index.network/mcp').replace(/\/$/, '');
```

Add before `module.exports` (stateless client modeled on the Hermes skill's `postMcpMessage`; `read_intents { limit: 1 }` returns `{ success, data: { totalCount } }`; the scoped key clamps the read to `[boundNetwork, personalIndex]`, so `totalCount` is exactly what the agent may see):
```js
async function postMcpMessage(mcpUrl, apiKey, body) {
  const res = await fetch(mcpUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'x-api-key': apiKey,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(INDEX_LOOKUP_TIMEOUT_MS),
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`MCP HTTP ${res.status}`);
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('text/event-stream')) {
    const text = await res.text();
    let response = null;
    for (const line of text.split('\n')) {
      const dataLine = line.startsWith('data: ') ? line.slice(6) : line.startsWith('data:') ? line.slice(5) : null;
      if (dataLine !== null) {
        try {
          const msg = JSON.parse(dataLine);
          if ('result' in msg || 'error' in msg) response = msg;
        } catch { /* skip non-JSON SSE lines */ }
      }
    }
    if (response) return response;
    throw new Error('no JSON-RPC response in MCP SSE stream');
  }
  return res.json();
}

/**
 * Fetch the tenant's canonical scoped intent count via MCP read_intents. The
 * scoped API key clamps the read to [boundNetwork, personalIndex], so totalCount
 * is exactly what the agent is authorized to see (EDG-53). Best-effort: returns
 * null on any failure so getTenantStats degrades like the opportunity count.
 */
async function fetchIndexIntentCount(apiKey, mcpUrl = INDEX_MCP_URL) {
  try {
    const init = await postMcpMessage(mcpUrl, apiKey, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'agentvillage-controlplane', version: '1.0.0' },
      },
    });
    if (init.error) return null;
    const toolResp = await postMcpMessage(mcpUrl, apiKey, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'read_intents', arguments: { limit: 1 } },
    });
    if (toolResp.error) return null;
    const result = toolResp.result || {};
    const content = Array.isArray(result.content) ? result.content : [];
    const textPart = content.find((c) => c && c.type === 'text');
    if (!textPart || !textPart.text) return null;
    const parsed = JSON.parse(textPart.text);
    if (parsed && parsed.success === false) return null;
    const total = parsed && parsed.data ? parsed.data.totalCount : undefined;
    return typeof total === 'number' ? total : null;
  } catch {
    return null;
  }
}
```

Update the export:
```js
module.exports = { checkIndexConnection, fetchIndexOpportunityCount, fetchIndexIntentCount };
```

#### 2. packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js
**File**: packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js
**Changes**: MODIFY — import `fetchIndexIntentCount` and set `stats.intents` after the opportunity fetch inside the `stats.index.connected` block (fills the hard-coded `intents: null` slot at `emptyStats()`).

Update the import (line 13):
```js
const { checkIndexConnection, fetchIndexOpportunityCount, fetchIndexIntentCount } = require('./index-network');
```

In `getTenantStats`, add the intent fetch after the opportunity fetch:
```js
      stats.index = await checkIndexConnection(indexApiKey);
      if (stats.index.connected) {
        stats.opportunities = await fetchIndexOpportunityCount(indexApiKey);
        stats.intents = await fetchIndexIntentCount(indexApiKey, INDEX_MCP_URL);
      }
```

### Success Criteria:

#### Automated Verification:
- [x] Intent fetch exported + imported: `grep -c "fetchIndexIntentCount" packages/edge-city/agentvillage-controlplane/control-plane/src/index-network.js` returns >= 2 AND `grep -c "fetchIndexIntentCount" packages/edge-city/agentvillage-controlplane/control-plane/src/tenants.js` returns >= 2 — both returned 2.
- [x] Sourced from MCP totalCount, not REST: `grep -c "read_intents\|data.totalCount\|parsed.data" …/index-network.js` returns >= 2 AND `grep -c "/api/intents\|/intents/list" …/index-network.js` returns 0 — returned 3 and 0.
- [x] Degrades to null (no throw into caller): `grep -A30 "async function fetchIndexIntentCount" …/index-network.js | grep -c "return null"` returns >= 4 — returned 5. Both JS files pass `node --check`.

#### Manual Verification:
- [ ] For a live tenant, the control-plane stats payload shows `intents` as a number matching the tenant's scoped MCP `read_intents` totalCount (no longer `null`).
- [ ] A tenant whose Index key is missing/disconnected, or whose MCP call fails, shows `intents: null` without erroring the stats endpoint.
- [ ] The reported `intents` count for a member with intents in BOTH the bound network and their personal index includes the personal-index intents — the scoped clamp's `[boundNetwork, personalIndex]` personal leg is not dropped (regression guard, precedent `eff9e02c32`).

## Phase 6: Hermes skill dead-filter cleanup

### Overview
Remove the dead `status === "active"` re-filter from the Hermes signal fetcher (the graph never emits `status`). Depends on nothing; parallel (separate codebase).

### Changes Required:

#### 1. packages/edge-city/agentvillage/skills/index-network/scripts/summarize-negotiations.ts
**File**: packages/edge-city/agentvillage/skills/index-network/scripts/summarize-negotiations.ts
**Changes**: MODIFY — drop the no-op `.filter((i) => !i.status || i.status === "active")` in `buildMcpSignalFetcher`. Submodule note: lands via a PR against `Edge-City/agentvillage`, then the monorepo pointer is bumped.

The return in `buildMcpSignalFetcher` (~lines 310-313) becomes (filter line removed):
```ts
    return intents
      .map((i) => ({ id: i.id ?? "", summary: (i.summary || i.description || "").trim() }))
      .filter((s) => s.summary.length > 0);
```
(The local `IntentListResponse` item `status?` field is left in place as a defensive, now-unread DTO field.)

### Success Criteria:

#### Automated Verification:
- [x] Dead status filter removed: `grep -c 'i.status === "active"' …/summarize-negotiations.ts` returns 0 — returned 0.
- [x] Signal pipeline otherwise intact: `grep -c "return intents" …/summarize-negotiations.ts` returns >= 1 — returned 1. Defensive `status?` DTO field left in place (grep count 1). The only change is removal of the no-op `.filter` line from the map chain; remaining tsc diagnostics are pre-existing target/module config artifacts (Set iteration / `import.meta`), unrelated to this edit.

#### Manual Verification:
- [ ] Behavior-preserving: for a `read_intents` fixture whose items carry no `status` field (current graph output), the emitted signal list (ids + summaries) is identical before and after the change — the filter was a no-op pass-through.

## Ordering Constraints

- **Phase 1 → Phase 3**: both edit `database.adapter.ts`; run sequentially to avoid conflicts (Phase 3's premise query is logically independent but shares the file).
- **Phase 3 → Phase 4**: frontend overview consumes the new endpoint.
- **Phases 1, 2, 5, 6 are mutually independent** and may run in parallel (2 = frontend, 5/6 = separate edge-city codebases).
- Recommended order: 1 → 2 → 3 → 4 → 5 → 6.

## Verification Notes

- **Predicate parity (Phase 1):** both adapter classes must return identical counts for the same identity/scope after consolidation — assert in the parity spec. Precedent: count divergence is the core bug.
- **No `.length`/`slice()` for totals (Phase 2):** the `/library` badge must come from `pagination.totalCount`, never the rendered page length. Precedent: PR #937 success criterion + the `/library` bug itself.
- **Dedup load-bearing:** `getActiveIntentsAcrossIndexes` keeps `selectDistinctOn([intents.id])`; the new premise query must likewise avoid multi-network row inflation (premise rows are not network-joined more than once per premise — verify the join doesn't duplicate).
- **Scope still includes personal index:** the MCP-sourced Hermes count flows through the existing clamp `[boundNetwork, personalIndex]`; do not regress it. Precedent: `eff9e02c32` over-clamp dropped the personal index.
- **Graceful degradation (Phase 5):** `fetchIndexIntentCount` returns `null` on any failure (HTTP, parse, timeout) — never throws into `getTenantStats`. Mirror `fetchIndexOpportunityCount`'s try/catch.
- **No silent drop (Phase 6):** removing the dead filter must not change emitted signals (the filter was a no-op today) — verify the signal list is identical before/after for a fixture with no `status`.
- **Premise count honesty (Phase 3):** the new query must NOT inherit the `embedding IS NOT NULL` gate or `limit 40` cap from `getPremisesForUserInNetworks`.

## Performance Considerations

- The new premise query is a single indexed join (`premise_networks_network_id_idx`, `database.schema.ts:343`) — comparable to the existing intents-in-network read.
- The control-plane MCP call adds one round-trip per tenant in `getTenantStats`, alongside the existing opportunity REST call — bounded by `INDEX_LOOKUP_TIMEOUT_MS` and gated behind `stats.index.connected`.
- `/networks/:id/overview` issues three reads (intents, premises, context) in one handler; run them with `Promise.all`.

## Migration Notes

Not applicable — no schema changes. All tables (`intents`, `intent_networks`, `premises`, `premise_networks`, `user_contexts`) already exist.

## Pattern References

- `backend/src/adapters/database.adapter.ts:512-552` — `listIntents` shared `where` + parallel `count()` (consolidation template).
- `backend/src/adapters/database.adapter.ts:5601-5635` — premise+premiseNetworks status/deletedAt filter (adapt, drop embedding/limit gates).
- `backend/src/adapters/database.adapter.ts:296-308` — `getUserContext(userId, networkId)` per-network selector.
- `backend/src/controllers/network.controller.ts:867-883` + `network.service.ts:368-372` — members-only scoped endpoint template.
- `frontend/src/components/IntentList.tsx:53-99` — `NetworkMembership` conditional-badge pattern (model the StatusBadge on it).
- `packages/edge-city/agentvillage/skills/index-network/scripts/summarize-negotiations.ts:45-86` — `postMcpMessage` SSE+JSON client (model the control-plane client on it).
- `packages/edge-city/agentvillage-controlplane/control-plane/src/index-network.js:54-66` — `fetchIndexOpportunityCount` try/catch+`null` degradation (mirror for intents).

## Developer Context

**Q (research checkpoint — Hermes count source):** REST `/intents/list` total or MCP `read_intents` totalCount for `fetchIndexIntentCount`?
A: MCP `read_intents` `data.totalCount` — only the MCP path yields the canonical scoped count.

**Q (research checkpoint — premise query):** Reuse embedding-gated, limit-40 `getPremisesForUserInNetworks` (`database.adapter.ts:5601`) or a new query?
A: New dedicated count+list query — `premiseNetworks ⋈ premises` filtered by `networkId + status='ACTIVE' + deletedAt IS NULL`, no embedding/limit gate.

**Q (research checkpoint — adapter dedup):** Consolidate the byte-identical adapter classes, leave + test, or defer?
A: Extract a shared canonical predicate so "one canonical definition" is one code path (`database.adapter.ts:817` vs `:2238`).

**Q (blueprint checkpoint — /networks endpoint shape):** New endpoint vs extend `/my-intents` vs two endpoints?
A: New `GET /networks/:id/overview` returning `{ intents, premises, userContext }`, one round-trip, `/my-intents` untouched.

**Q (blueprint checkpoint — overview scope):** Current user's premises+context vs all members'?
A: Current user's — mirrors the "My Intents" user-filter (`network.service.ts:371`); user_context is inherently per-user.

**Q (blueprint checkpoint — status badge):** Conditional (only if not ACTIVE), always, or skip?
A: Conditional — render only when `status !== 'ACTIVE'` (vestigial enum, `database.schema.ts:562`).

**Step 8 review note:** the first artifact-code-reviewer run terminated mid-walk (subprocess error after verifying all Phase 1-6 anchors, before emitting its table); it was re-dispatched fresh and completed. Both reviewers' concerns were triaged (applied) at Step 9.

## Plan Review (Step 8)

_Independent post-finalization review by artifact-code-reviewer and artifact-coverage-reviewer subagents. Findings triaged at Step 9. The first artifact-code-reviewer run terminated mid-walk (subprocess error after anchor verification); it was re-dispatched fresh and completed — the row below is from the successful re-run._

| source   | plan-loc | codebase-loc | severity | dimension | finding | recommendation | resolution |
| -------- | -------- | ------------ | -------- | --------- | ------- | -------------- | ---------- |
| code     | Phase 1 §1 (listIntents) | backend/src/adapters/database.adapter.ts:514 | concern | code-quality | The `listIntents` replacement snippet re-includes `const offset = (options.page - 1) * options.limit;`, but the prose scopes the replacement to the `conditions`/`validSourceTypes`/`where` block which starts *after* the existing `offset` at line 514 — applying verbatim would duplicate `const offset` (SyntaxError). | Drop `const offset` from the replacement snippet; scope the swap to the `conditions`→`where` block only. | applied: Phase 1 §1 snippet now drops the `const offset` line and scopes the swap to lines ~515-528 (offset retained). |
| coverage | ## Verification Notes §4 | <n/a> | concern | verification-coverage | Note "the MCP-sourced Hermes count flows through the existing clamp `[boundNetwork, personalIndex]`; do not regress it" has no success-criterion: Phase 5 Manual only asserts the count equals scoped MCP `totalCount` (self-referential to the clamp), and Phase 1 Manual tests scoped≤unscoped, not the personal-index leg. | Add a Phase 5 Manual Verification bullet asserting the reported `intents` count includes the member's personal-index intents, confirming the clamp's personal-index leg survives end-to-end. | applied: added Phase 5 Manual Verification bullet asserting the personal-index leg of the clamp is not dropped (precedent eff9e02c32). |

## Plan History

- Phase 1: Shared canonical intent predicate — approved as generated (parity test extends existing database.adapter.spec.ts instead of a new file)
- Phase 2: /library count + status badge — approved as generated (page-loop added to show all intents, not just the first 100)
- Phase 3: /networks overview backend — approved as generated
- Phase 4: /networks overview frontend — approved as generated
- Phase 5: Control-plane Hermes intent count — approved as generated (lands via Edge-City/agentvillage-controlplane PR + submodule pointer bump)
- Phase 6: Hermes skill dead-filter cleanup — approved as generated (behavior-preservation success criteria added per slice-verifier warning; lands via Edge-City/agentvillage PR)

## References

- Research: `.rpiv/artifacts/research/2026-06-19_19-16-39_intent-count-consistency.md`
- FRD: `.rpiv/artifacts/discover/2026-06-19_18-59-29_intent-count-consistency.md`
- Direct precedent: `.rpiv/artifacts/plans/2026-06-12_00-07-14_pr-937-brief-questions-remediation.md` (scope clamp + SQL-side limit + scopeRestriction + loud failure)
- Linear: EDG-53
