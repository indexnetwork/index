# EDG-18: Unified Discovery Matrix

**Issue:** [EDG-18 — Import Edge City users, and review opportunity distribution](https://linear.app/edge-city/issue/EDG-18/import-edge-city-users-and-review-opportunity-distribution)
**Date:** 2026-05-27

## Problem

194 users were CSV-imported into the Edge City network. The import pipeline generated profiles (193/194 have narratives + attributes) but created zero premises, zero embeddings, and zero opportunities for any imported user.

Two root causes:

1. **Missing premise graph injection.** `ProfileQueue.invokeProfileGraph()` creates `ProfileGraphFactory` without the premise graph dependency. The profile graph falls back to the legacy path (direct LLM generation) instead of decomposing enriched input into premises. Without premises, users have no embeddings and are invisible to discovery.

2. **Profile-only discovery is limited to premise-to-premise.** Even after fixing the premise graph injection, the `FromProfile` discovery path only runs `runPremiseDiscovery()` — premise embeddings searching the premise corpus. It never searches the intent corpus. Users with premises but no intents can only be discovered by other users who also have premises, missing connections to existing members who have intents.

## Design

### Phase 1: Rename ProfileQueue → EnrichmentQueue + inject premise graph

**Goal:** Fix the immediate bug — ensure premise decomposition runs for all profile enrichments, not just the MCP chat path.

**Changes:**

1. Rename `ProfileQueue` → `EnrichmentQueue`:
   - Rename file: `backend/src/queues/profile.queue.ts` → `backend/src/queues/enrichment.queue.ts`
   - Rename class: `ProfileQueue` → `EnrichmentQueue`
   - Rename singleton export: `profileQueue` → `enrichmentQueue`
   - Update all references in `backend/src/main.ts` and any other importers
   - Rename job types: `profile.enrich` → `enrich.user`, keep `ensure_profile_hyde` as-is (or deprecate)

2. Inject premise graph into `invokeProfileGraph()`:
   - Import `PremiseGraphFactory` from `@indexnetwork/protocol`
   - Import `EmbedderAdapter` from `src/adapters/`
   - Create premise graph: `new PremiseGraphFactory(database as unknown as PremiseGraphDatabase, embedder).createGraph()`
   - Pass as 5th argument to `ProfileGraphFactory` constructor
   - Match the pattern in `backend/src/controllers/mcp.controller.ts:153-154`

3. Add backfill maintenance script (`backend/src/cli/maintenance/backfill-premises.ts`):
   - Query all members of a given network (or all users without premises)
   - Re-enqueue `enrich.user` jobs for each
   - CLI: `bun run maintenance:backfill-premises -- --network <networkId>`

**Verification:** After backfill, all 207 Edge City members should have premises with embeddings. Query: `SELECT COUNT(DISTINCT user_id) FROM premises WHERE user_id IN (SELECT user_id FROM network_members WHERE network_id = '<edge-city-id>')`.

### Phase 2: New database method — `searchIntentsByEmbedding`

**Goal:** Enable direct cosine similarity search of intent embeddings using a raw embedding vector (no HyDE required).

**Interface addition** on `OpportunityGraphDatabase` (`packages/protocol/src/shared/interfaces/database.interface.ts`):

```typescript
searchIntentsByEmbedding(params: {
  embedding: number[];
  networkIds: string[];
  excludeUserId: string;
  limit: number;
  minScore?: number;
}): Promise<Array<{
  intentId: string;
  userId: string;
  networkId: string;
  payload: string;
  summary: string | null;
  similarity: number;
}>>;
```

**Implementation** in `backend/src/adapters/database.adapter.ts`:
- pgvector cosine similarity (`1 - (embedding <=> $1)`) against the `intents` table
- Scoped to intents assigned to the given networks via `intent_networks`
- Filter: `intents.status = 'ACTIVE'`, `intents.embedding IS NOT NULL`, `intents.user_id != excludeUserId`
- Default `minScore`: 0.30 (same as existing HyDE search threshold)
- Mirrors the existing `searchPremisesBySimilarity` pattern

### Phase 3: Unified discovery matrix

**Goal:** Replace the branching discovery logic (profile path vs intent path) with a unified search matrix that runs all applicable strategies in parallel.

#### Search strategies

| Strategy | Source vectors | Target corpus | Method | Env var | Default |
|---|---|---|---|---|---|
| `premise-to-premise` | User's premise embeddings | Premises | `searchPremisesBySimilarity` | `DISCOVERY_PREMISE_TO_PREMISE` | `1` |
| `premise-to-intent` | User's premise embeddings | Intents | `searchIntentsByEmbedding` (new) | `DISCOVERY_PREMISE_TO_INTENT` | `1` |
| `hyde-to-*` | HyDE embeddings from intent/query | Intents + Premises | `searchWithHydeEmbeddings` (lens-routed) | Always on when HyDE available | — |

The HyDE strategies (`hyde-to-intent`, `hyde-to-premise`) are controlled by the LensInferrer's `corpus` field on each lens. The LensInferrer decides which corpus each lens targets based on the search context.

#### Premise fan-out mode

Controlled by `DISCOVERY_PREMISE_SEARCH_MODE` env var:
- `individual` (default) — each premise embedding runs a separate search query. N premises = N searches against each target corpus. Higher recall, captures all facets.
- `aggregate` — pool premise embeddings into a single representative vector (mean of all premise embeddings), then search once per target corpus. Fewer queries, lower recall.

#### Execution flow

The discovery node replaces its current `if (discoverySource === 'profile') / else` branching with:

```
discoveryNode:
  1. Collect source vectors:
     - sourcePremises[] (already loaded in prep node)
     - hydeEmbeddings{} (generated when intent text or search query exists)

  2. Build strategy list:
     - If sourcePremises.length > 0 AND DISCOVERY_PREMISE_TO_PREMISE=1:
         add premise-to-premise strategy
     - If sourcePremises.length > 0 AND DISCOVERY_PREMISE_TO_INTENT=1:
         add premise-to-intent strategy
     - If hydeEmbeddings has entries:
         add hyde strategies (lens-routed, as today)

  3. Execute all strategies in parallel (Promise.all)

  4. Merge + dedup:
     - Key: candidateUserId + networkId + entityId (intentId or premiseId)
     - Keep highest similarity per key
     - Track all matched strategies in matchedStrategies[] on the candidate

  5. Return unified candidate pool → evaluation node
```

#### What changes in graph routing

- The `resolve` node still determines whether a trigger intent exists and loads intent context for the prep node.
- The discovery node no longer branches on `discoverySource`. It checks what source vectors are available and runs all applicable strategies.
- The `discoverySource` field on `CandidateMatch` is replaced with a more specific strategy tag (e.g., `'premise-to-premise'`, `'premise-to-intent'`, `'hyde'`).
- The direct-connection fast path (when `targetUserId` is set) remains unchanged — it bypasses vector search entirely.

#### Deduplication

When the same candidate entity (user + intent/premise + network) is found via multiple strategies:
- Keep the match with the highest similarity score
- Store all strategies that found this candidate in `matchedStrategies: string[]`
- This is useful for evaluation context — a candidate found via both premise-to-premise AND premise-to-intent is a stronger signal

#### Trace instrumentation

Each strategy emits a trace entry:
```
{ node: "strategy", detail: "premise-to-intent → 12 candidate(s) in 45ms" }
```

The merged result emits a summary:
```
{ node: "discovery", detail: "4 strategies → 28 raw, 19 after dedup" }
```

### Phase 4: Backfill and verification

1. Deploy Phases 1-3 to the dev environment
2. Run `bun run maintenance:backfill-premises -- --network fee18edc-1e60-4b13-b8c8-20e6f6ed1acb` to create premises for all 207 Edge City members
3. The enrichment completion callback triggers `FromProfileJob` for each user → unified discovery runs
4. Verify in the dev DB:
   - All 207 members have premises with embeddings
   - New opportunities exist between imported users and existing members (especially those with active intents: Seref 6, Vicky 5, Timour 3, Yankı 3, Cooper 2, Seren 1)
   - Trace entries in Railway logs show all strategies executing
5. Review opportunity quality — check that premise-to-intent matches are semantically meaningful, not just high-cosine noise

## Files affected

| File | Change |
|---|---|
| `backend/src/queues/profile.queue.ts` | Rename → `enrichment.queue.ts`, inject premise graph |
| `backend/src/main.ts` | Update queue imports and references |
| `packages/protocol/src/shared/interfaces/database.interface.ts` | Add `searchIntentsByEmbedding` to `OpportunityGraphDatabase` |
| `backend/src/adapters/database.adapter.ts` | Implement `searchIntentsByEmbedding` |
| `packages/protocol/src/opportunity/opportunity.graph.ts` | Refactor discovery node to unified matrix |
| `packages/protocol/src/opportunity/opportunity.state.ts` | Update `CandidateMatch` type (add `matchedStrategies`) |
| `backend/src/cli/maintenance/backfill-premises.ts` | New backfill script |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DISCOVERY_PREMISE_TO_PREMISE` | `1` | Enable premise → premise similarity search |
| `DISCOVERY_PREMISE_TO_INTENT` | `1` | Enable premise → intent similarity search |
| `DISCOVERY_PREMISE_SEARCH_MODE` | `individual` | `individual` or `aggregate` — how premise embeddings are used for search |
