# User Contexts + Discovery Parity

**Related:** [EDG-18 — Import Edge City users, and review opportunity distribution](https://linear.app/edge-city/issue/EDG-18/import-edge-city-users-and-review-opportunity-distribution)
**Date:** 2026-05-27

## Problem

194 users were CSV-imported into the Edge City network. The import pipeline generated profiles (193/194 have narratives + attributes) but created zero premises, zero embeddings, and zero opportunities for any imported user.

Two root causes:

1. **Missing premise graph injection.** `ProfileQueue.invokeProfileGraph()` creates `ProfileGraphFactory` without the premise graph dependency. The profile graph falls back to the legacy path (direct LLM generation) instead of decomposing enriched input into premises. Without premises, users have no embeddings and are invisible to discovery.

2. **Profile-only discovery lost the intent search path when Path B was removed.** On May 25, the old `searchWithProfileEmbedding` (Path B) was removed. That method searched **two** corpora — profiles and intents — using a single profile embedding vector. It was replaced by premise-to-premise discovery, which searches only the premise corpus. The profile→intent cross-search was deleted with no premise-based equivalent, leaving a gap: users with premises but no intents cannot be matched against other users' intents.

## Historical context

### What Path B did (removed in `d7e7178`)

The old profile-only discovery path used `searchWithProfileEmbedding()`, which ran two parallel searches:

```
searchWithProfileEmbedding(profileVector):
  → searchProfilesByProfileEmbedding()  — profile embedding vs profile HyDE embeddings (cosine)
  → searchIntentsByProfileEmbedding()   — profile embedding vs intent embeddings (cosine)
  → mergeAndRankCandidates()            — dedup by user, boost multi-match, rank by score
```

One dense profile vector searched both profiles and intents. Fast (no LLM calls), broad recall. The `mergeAndRankCandidates` function boosted users found via multiple matches (+0.1 per additional match, capped at 1.0).

### What replaced it

- `searchIntentsByProfileEmbedding` → **deleted, no replacement.** This is the gap.
- `searchProfilesByProfileEmbedding` → replaced by `runPremiseDiscovery()` (premise-to-premise cosine similarity via `searchPremisesBySimilarity`). Premises are the decomposed, atomic equivalent of what profile embeddings represented as a single vector.

### What the HyDE path already covers

The intent-triggered and query-triggered paths use `searchWithHydeEmbeddings`, which already searches both intents and premises for every lens:

```
searchWithHydeEmbeddings(lensEmbeddings):
  → searchIntentsForHyde()    — HyDE embedding vs intent embeddings
  → searchPremisesForHyde()   — HyDE embedding vs premise embeddings
  → mergeAndRankCandidates()
```

The corpus hint from the LensInferrer routes limit allocation (preferred corpus gets full limit, others get half). `profiles` hints are remapped to `premises` (line 163 of embedder adapter: `le.corpus === 'profiles' ? 'premises' : le.corpus`).

### The parity gap

| Search path | Old system | Current system | Status |
|---|---|---|---|
| Profile → profiles | `searchProfilesByProfileEmbedding` | `runPremiseDiscovery` (premise→premise) | Replaced |
| Profile → intents | `searchIntentsByProfileEmbedding` | *(nothing)* | **Missing** |
| Intent/query → intents | `searchWithHydeEmbeddings` | `searchWithHydeEmbeddings` | Unchanged |
| Intent/query → premises | *(didn't exist)* | `searchWithHydeEmbeddings` + `runPremiseDiscovery` | Improved |

The new **user context** strategy fills the missing row. Instead of searching intents with raw premise embeddings (which mixes granularity levels — atomic assertions vs. rich intent descriptions), we synthesize a network-scoped context from all premises and use its embedding to search intents. This is the direct successor to the old profile embedding, but derived from premises and scoped per network.

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

### Phase 2: User Contexts

**Goal:** Restore the profile→intent cross-search that was lost when Path B was removed. Instead of using raw premise embeddings against intents (mismatched granularity), synthesize a **user context** — a network-scoped representation of who the user is, derived from all their premises and the network's purpose. This is the direct successor to the old profile embedding that `searchIntentsByProfileEmbedding` used.

#### What a user context is

A user context is a focused narrative paragraph that captures a user's identity through the lens of a specific network. The old system had one global profile embedding per user. User contexts are scoped per `(userId, networkId)` — the same user produces different contexts for different networks, because each network has a different purpose and different premises matter more or less.

#### Generation

**Cold start** (no existing context for this user+network):
1. Load ALL user premises (no filtering — the user's full identity)
2. Load the network's `prompt` field (its purpose/description)
3. LLM call: all premises + network prompt → focused context paragraph
4. Generate embedding from the context text
5. Store in `user_contexts` table

**Incremental update** (existing context + a premise change):
1. Load the current context text
2. Receive the delta from the premise event:
   - `added`: new premise text
   - `updated`: old text → new text
   - `retracted` / `expired`: removed premise text
3. LLM call: current context + change type + premise content + network prompt → updated context paragraph
4. Regenerate embedding
5. Update `user_contexts` row

The incremental path preserves nuance from the existing context rather than regenerating from scratch on every change. The LLM knows what changed and integrates or removes that specific information.

**Batching:** When multiple premise changes happen in quick succession (e.g., during initial enrichment where 10-20 premises are created at once), queue the deltas and debounce — collect all changes within a short window, then apply them as a single batch update.

#### Storage

New `user_contexts` table:

| Column | Type | Description |
|---|---|---|
| `id` | `uuid` | Primary key |
| `userId` | `uuid` | FK → users |
| `networkId` | `uuid` | FK → networks |
| `text` | `text` | The synthesized context paragraph |
| `embedding` | `vector(2000)` | Embedding of the context text |
| `premiseHash` | `text` | Hash of premise IDs + updated timestamps |
| `generatedAt` | `timestamp` | When the context was last generated/updated |

Unique constraint on `(userId, networkId)`. The `premiseHash` acts as a consistency check — if the hash doesn't match the current premise state (e.g., events were missed during downtime), a full cold-start regeneration kicks in as a fallback.

#### Cache invalidation

Premise events (`PremiseEvents.onCreated/onUpdated/onRetracted/onExpired`) trigger incremental context updates for every network the user belongs to. Network prompt changes also trigger regeneration for all members of that network.

#### Database method: `searchIntentsByContextEmbedding`

**Interface addition** on `OpportunityGraphDatabase` (`packages/protocol/src/shared/interfaces/database.interface.ts`):

```typescript
searchIntentsByContextEmbedding(params: {
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
- Filter: `intents.status = 'ACTIVE'`, `intents.embedding IS NOT NULL`, `intents.user_id != excludeUserId`, `users.deletedAt IS NULL`
- Default `minScore`: 0.30 (same as existing premise similarity and HyDE thresholds)
- SQL pattern mirrors the existing `searchPremisesBySimilarity` and the deleted `searchIntentsByProfileEmbedding`

### Phase 3: Wire context-to-intent into discovery

**Goal:** Add the `context-to-intent` strategy to the discovery node, restoring the cross-entity matching that Path B provided.

#### Search strategies after this change

| Strategy | Source | Target corpus | When available |
|---|---|---|---|
| `premise-to-premise` | User's premise embeddings | Premises | User has premises (existing) |
| `context-to-intent` | User context embedding | Intents | User has a context for this network (**new**) |
| `hyde-to-*` | HyDE embeddings from intent/query | Intents + Premises | Intent text or search query exists (existing) |

#### Execution flow

The discovery node's profile-source path currently only runs `runPremiseDiscovery()`. After this change, it also loads the user's context embedding for each network in scope and runs `searchIntentsByContextEmbedding` alongside premise-to-premise:

```
discoveryNode (profile-source path):
  1. sourcePremises[] — already loaded in prep node
  2. userContexts[] — load from user_contexts for each network in scope
  3. Run in parallel:
     a. premise-to-premise (existing runPremiseDiscovery)
     b. context-to-intent (searchIntentsByContextEmbedding for each network's context)
  4. Merge + dedup:
     - Key: candidateUserId + networkId + entityId
     - Keep highest similarity per key
     - Track matched strategies in matchedStrategies[]
     - Multi-strategy boost: +0.05 per additional strategy (capped at 1.0)
  5. Return unified candidate pool → evaluation node
```

The intent-source and query-source paths remain unchanged — they already use HyDE to search both intents and premises.

#### What changes in the opportunity graph

- The prep node loads user contexts alongside premises
- The discovery node adds `context-to-intent` when contexts are available
- The `discoverySource` field on `CandidateMatch` gains a `'context-to-intent'` value
- The direct-connection fast path (when `targetUserId` is set) remains unchanged

#### Deduplication and ranking

When the same candidate is found via multiple strategies:
- Keep the match with the highest similarity score
- Store all strategies in `matchedStrategies: string[]`
- Apply multi-strategy boost (+0.05 per additional strategy, capped at 1.0) — mirrors the old `mergeAndRankCandidates` lens bonus

#### Trace instrumentation

Each strategy emits a trace entry:
```
{ node: "strategy", detail: "context-to-intent → 12 candidate(s) in 45ms" }
```

The merged result emits a summary:
```
{ node: "discovery", detail: "2 strategies → 28 raw, 19 after dedup" }
```

### Phase 4: Backfill and verification

1. Deploy Phases 1-3 to the dev environment
2. Run `bun run maintenance:backfill-premises -- --network fee18edc-1e60-4b13-b8c8-20e6f6ed1acb` to create premises for all 207 Edge City members
3. After premise backfill, generate user contexts for all members (cold start — each user's premises + Edge City network prompt)
4. The enrichment completion callback triggers `FromProfileJob` for each user → discovery runs with both premise-to-premise and context-to-intent strategies
5. Verify in the dev DB:
   - All 207 members have premises with embeddings
   - All 207 members have a user context for the Edge City network
   - New opportunities exist between imported users and existing members (especially those with active intents: Seref 6, Vicky 5, Timour 3, Yankı 3, Cooper 2, Seren 1)
   - Context-to-intent matches restore the cross-entity discovery that Path B provided
   - Trace entries in Railway logs show both strategies executing
6. Review opportunity quality — check that context-to-intent matches are semantically meaningful, not just high-cosine noise. Compare against the old Path B behavior: the old system found ~81 opportunities on this network; the new system should match or exceed that count with comparable quality.

### Parity table after implementation

| Search path | Old system | New system | Status |
|---|---|---|---|
| Profile → profiles | `searchProfilesByProfileEmbedding` | `runPremiseDiscovery` (premise→premise) | Replaced |
| Profile → intents | `searchIntentsByProfileEmbedding` | `searchIntentsByContextEmbedding` (context→intent) | **Restored** |
| Intent/query → intents | `searchWithHydeEmbeddings` | `searchWithHydeEmbeddings` | Unchanged |
| Intent/query → premises | *(didn't exist)* | `searchWithHydeEmbeddings` + `runPremiseDiscovery` | Improved |

## Files affected

| File | Change |
|---|---|
| `backend/src/queues/profile.queue.ts` | Rename → `enrichment.queue.ts`, inject premise graph |
| `backend/src/main.ts` | Update queue imports and references |
| `backend/src/schemas/database.schema.ts` | Add `user_contexts` table |
| `packages/protocol/src/shared/interfaces/database.interface.ts` | Add `searchIntentsByContextEmbedding` to `OpportunityGraphDatabase` |
| `backend/src/adapters/database.adapter.ts` | Implement `searchIntentsByContextEmbedding`, add user context CRUD |
| `packages/protocol/src/opportunity/opportunity.graph.ts` | Add context-to-intent strategy to discovery node |
| `packages/protocol/src/opportunity/opportunity.state.ts` | Update `CandidateMatch` type (add `matchedStrategies`) |
| `backend/src/events/premise.event.ts` | Add listener to trigger user context regeneration |
| `backend/src/cli/maintenance/backfill-premises.ts` | New backfill script (premises + user contexts) |

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `DISCOVERY_CONTEXT_TO_INTENT` | `1` | Enable context → intent similarity search |
