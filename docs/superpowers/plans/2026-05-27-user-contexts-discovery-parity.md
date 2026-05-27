# User Contexts + Discovery Parity — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix premise graph injection in the enrichment queue, add a `user_contexts` table for network-scoped user representations, and wire `context-to-intent` discovery into the opportunity graph to restore the cross-entity matching lost when Path B was removed.

**Architecture:** Three phases: (1) rename ProfileQueue → EnrichmentQueue and inject the premise graph so enrichment produces premises, (2) add `user_contexts` — LLM-synthesized, network-scoped representations cached per (userId, networkId) with incremental updates — plus a `searchIntentsByContextEmbedding` database method, (3) wire the new `context-to-intent` strategy into the opportunity graph's discovery node alongside existing `premise-to-premise`.

**Tech Stack:** TypeScript, Drizzle ORM, PostgreSQL + pgvector, BullMQ, LangGraph, OpenRouter LLM

**Spec:** `docs/superpowers/specs/2026-05-27-edg18-unified-discovery-matrix-design.md`

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `backend/src/queues/enrichment.queue.ts` | Rename from `profile.queue.ts` | Enrichment queue with premise graph injection |
| `backend/src/main.ts` | Modify | Update imports from `profile.queue` → `enrichment.queue` |
| `backend/src/services/contact.service.ts` | Modify | Update import |
| `backend/src/services/integration.service.ts` | Modify | Update import |
| `backend/src/services/experiment.service.ts` | Modify | Update import |
| `backend/src/controllers/queues.controller.ts` | Modify | Update import |
| `backend/src/cli/db-seed.ts` | Modify | Update import |
| `backend/src/cli/backfill-profile-hyde.ts` | Modify | Update import |
| `backend/src/schemas/database.schema.ts` | Modify | Add `userContexts` table |
| `packages/protocol/src/shared/interfaces/database.interface.ts` | Modify | Add `searchIntentsByContextEmbedding` + context CRUD to interfaces |
| `packages/protocol/src/index.ts` | Modify | Export new types if needed |
| `backend/src/adapters/database.adapter.ts` | Modify | Implement `searchIntentsByContextEmbedding` + context CRUD |
| `packages/protocol/src/opportunity/opportunity.state.ts` | Modify | Add `matchedStrategies` to `CandidateMatch`, add `sourceContexts` annotation |
| `packages/protocol/src/opportunity/opportunity.graph.ts` | Modify | Add `context-to-intent` strategy in discovery node |
| `backend/src/events/premise.event.ts` | Modify | No structural change (wiring in main.ts) |
| `backend/src/cli/backfill-premises.ts` | Create | Backfill script for premises + user contexts |

---

### Task 1: Rename ProfileQueue → EnrichmentQueue

**Files:**
- Rename: `backend/src/queues/profile.queue.ts` → `backend/src/queues/enrichment.queue.ts`
- Modify: `backend/src/main.ts`
- Modify: `backend/src/services/contact.service.ts`
- Modify: `backend/src/services/integration.service.ts`
- Modify: `backend/src/services/experiment.service.ts`
- Modify: `backend/src/controllers/queues.controller.ts`
- Modify: `backend/src/cli/db-seed.ts`
- Modify: `backend/src/cli/backfill-profile-hyde.ts`

- [ ] **Step 1: Rename the file**

```bash
git mv backend/src/queues/profile.queue.ts backend/src/queues/enrichment.queue.ts
```

- [ ] **Step 2: Rename class, export, and job type inside `enrichment.queue.ts`**

Replace all occurrences:
- `ProfileQueue` → `EnrichmentQueue`
- `profileQueue` → `enrichmentQueue`
- `ProfileQueueDeps` → `EnrichmentQueueDeps`
- `ProfileJobPayload` → `EnrichmentJobPayload`
- Job name `'profile.enrich'` → `'enrich.user'`
- Job ID prefix `'profile.enrich.'` → `'enrich.user.'`
- Logger name `'ProfileHydeJob'` → `'EnrichmentJob'`
- Logger name `'ProfileQueue'` → `'EnrichmentQueue'`

Keep `QUEUE_NAME = 'profile-hyde-queue'` unchanged (renaming BullMQ queue names requires draining the old queue in Redis — not worth it).

- [ ] **Step 3: Update all importers**

In each of these files, change the import path and identifiers:

`backend/src/main.ts`:
```typescript
// Old:
import { profileQueue } from './queues/profile.queue';
// New:
import { enrichmentQueue } from './queues/enrichment.queue';
```
Then replace all `profileQueue` references with `enrichmentQueue` (lines 109, 114, 209, 554).

`backend/src/services/contact.service.ts`:
```typescript
// Old:
import { profileQueue } from '../queues/profile.queue';
// New:
import { enrichmentQueue } from '../queues/enrichment.queue';
```
Replace `profileQueue.addEnrichUserJob` with `enrichmentQueue.addEnrichUserJob`.

`backend/src/services/integration.service.ts`:
```typescript
// Old:
import { profileQueue } from '../queues/profile.queue';
// New:
import { enrichmentQueue } from '../queues/enrichment.queue';
```
Replace `profileQueue.addEnrichUserJobBulk` with `enrichmentQueue.addEnrichUserJobBulk`.

`backend/src/services/experiment.service.ts`:
```typescript
// Old:
import { profileQueue } from '../queues/profile.queue';
// New:
import { enrichmentQueue } from '../queues/enrichment.queue';
```
Replace `profileQueue.addEnrichUserJob` with `enrichmentQueue.addEnrichUserJob`.

`backend/src/controllers/queues.controller.ts`:
```typescript
// Old:
import { profileQueue } from '../queues/profile.queue';
// New:
import { enrichmentQueue } from '../queues/enrichment.queue';
```
Replace the queue registration reference.

`backend/src/cli/db-seed.ts`:
```typescript
// Old:
import { profileQueue } from '../queues/profile.queue';
// New:
import { enrichmentQueue } from '../queues/enrichment.queue';
```

`backend/src/cli/backfill-profile-hyde.ts`:
```typescript
// Old:
import { profileQueue } from '../queues/profile.queue';
// New:
import { enrichmentQueue } from '../queues/enrichment.queue';
```

- [ ] **Step 4: Verify no remaining references**

```bash
grep -rn "profile\.queue\|profileQueue\|ProfileQueue\|ProfileJobPayload\|ProfileQueueDeps" backend/src/ --include='*.ts' | grep -v node_modules | grep -v '.spec.ts'
```

Expected: no matches outside of test files.

- [ ] **Step 5: Run type check**

```bash
cd backend && bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A backend/src/queues/enrichment.queue.ts backend/src/main.ts backend/src/services/contact.service.ts backend/src/services/integration.service.ts backend/src/services/experiment.service.ts backend/src/controllers/queues.controller.ts backend/src/cli/db-seed.ts backend/src/cli/backfill-profile-hyde.ts
git commit -m "refactor: rename ProfileQueue to EnrichmentQueue"
```

---

### Task 2: Inject premise graph into EnrichmentQueue

**Files:**
- Modify: `backend/src/queues/enrichment.queue.ts:223-229`

- [ ] **Step 1: Add imports for PremiseGraphFactory and EmbedderAdapter**

At the top of `backend/src/queues/enrichment.queue.ts`, add:

```typescript
import { PremiseGraphFactory } from '@indexnetwork/protocol';
import type { PremiseGraphDatabase } from '@indexnetwork/protocol';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
```

- [ ] **Step 2: Update `invokeProfileGraph` to inject premise graph**

Replace the `invokeProfileGraph` method (currently at the end of the class, after `fireEnrichmentComplete`):

```typescript
private async invokeProfileGraph(userId: string, operationMode: 'write' | 'generate') {
  const database = new ProfileDatabaseAdapter();
  const scraper = new ScraperAdapter();
  const embedder = new EmbedderAdapter();
  const premiseGraph = new PremiseGraphFactory(
    database as unknown as PremiseGraphDatabase,
    embedder,
  ).createGraph();
  const factory = new ProfileGraphFactory(database, scraper, { enrichUserProfile }, undefined, premiseGraph);
  const graph = factory.createGraph();
  return graph.invoke({ userId, operationMode });
}
```

This matches the composition pattern in `backend/src/controllers/mcp.controller.ts:153-154`. The 4th argument (`qEnqueue`) is `undefined` since the queue path doesn't need the questioner.

- [ ] **Step 3: Run type check**

```bash
cd backend && bun run tsc --noEmit
```

Expected: no errors. If `ProfileGraphFactory` constructor doesn't accept 5 arguments, check `packages/protocol/src/profile/profile.graph.ts` constructor signature — the 5th argument is `premiseGraph?`.

- [ ] **Step 4: Commit**

```bash
git add backend/src/queues/enrichment.queue.ts
git commit -m "fix: inject premise graph into EnrichmentQueue"
```

---

### Task 3: Add `user_contexts` table to database schema

**Files:**
- Modify: `backend/src/schemas/database.schema.ts`

- [ ] **Step 1: Add the `userContexts` table definition**

Add after the `premiseNetworks` table (after line 317 in the schema file):

```typescript
export const userContexts = pgTable('user_contexts', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  networkId: text('network_id').notNull().references(() => networks.id, { onDelete: 'cascade' }),
  text: text('text').notNull(),
  embedding: vector('embedding', { dimensions: 2000 }),
  premiseHash: text('premise_hash'),
  generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  userNetworkUniq: uniqueIndex('user_contexts_user_network_uniq').on(table.userId, table.networkId),
  embeddingIdx: index('user_contexts_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  userIdIdx: index('user_contexts_user_id_idx').on(table.userId),
  networkIdIdx: index('user_contexts_network_id_idx').on(table.networkId),
}));
```

- [ ] **Step 2: Generate migration**

```bash
cd backend && bun run db:generate
```

- [ ] **Step 3: Rename the migration file**

Find the new migration file in `backend/drizzle/` and rename it:

```bash
# Find the new file (it'll have a random name)
ls -t backend/drizzle/*.sql | head -1
# Rename to follow convention
mv backend/drizzle/XXXX_random_name.sql backend/drizzle/XXXX_add_user_contexts.sql
```

Update the `tag` in `backend/drizzle/meta/_journal.json` to match (without `.sql`).

- [ ] **Step 4: Apply migration locally**

```bash
cd backend && bun run db:migrate
```

- [ ] **Step 5: Verify no further changes**

```bash
cd backend && bun run db:generate
```

Expected: "No schema changes" or empty migration.

- [ ] **Step 6: Commit**

```bash
git add backend/src/schemas/database.schema.ts backend/drizzle/
git commit -m "feat: add user_contexts table for network-scoped user representations"
```

---

### Task 4: Add `searchIntentsByContextEmbedding` and context CRUD to database interface

**Files:**
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts`

- [ ] **Step 1: Add user context methods to the `Database` interface**

Add these methods to the `Database` interface, after `searchPremisesBySimilarity` (after line 1448):

```typescript
// ─── User Context Methods ───

/**
 * Upsert a user context for a specific network.
 * Creates or updates the synthesized context paragraph + embedding.
 */
upsertUserContext(params: {
  userId: string;
  networkId: string;
  text: string;
  embedding: number[];
  premiseHash: string;
}): Promise<{ id: string }>;

/**
 * Get the user context for a specific user+network pair.
 */
getUserContext(userId: string, networkId: string): Promise<{
  id: string;
  text: string;
  embedding: number[];
  premiseHash: string;
  generatedAt: Date;
} | null>;

/**
 * Get user contexts for a user across all their networks.
 */
getUserContexts(userId: string): Promise<Array<{
  id: string;
  networkId: string;
  text: string;
  embedding: number[];
  premiseHash: string;
  generatedAt: Date;
}>>;

/**
 * Cosine similarity search against intent embeddings using a context embedding.
 * Restores the profile→intent cross-search deleted when Path B was removed.
 */
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

- [ ] **Step 2: Add the new methods to the `OpportunityGraphDatabase` Pick type**

In the `OpportunityGraphDatabase` type (around line 1951), add the new method names to the Pick:

```typescript
export type OpportunityGraphDatabase = Pick<
  Database,
  | 'getProfile'
  // ... existing entries ...
  | 'getPremisesForUser'
  | 'searchPremisesBySimilarity'
  // User context methods
  | 'getUserContext'
  | 'getUserContexts'
  | 'searchIntentsByContextEmbedding'
> & Pick<
  NegotiationQueries,
  | 'getNegotiationTaskForOpportunity'
>;
```

- [ ] **Step 3: Build the protocol package**

```bash
cd packages/protocol && bun run build
```

Expected: compiles without errors. The backend will fail type checks until the adapter implements the new methods (Task 5).

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/shared/interfaces/database.interface.ts
git commit -m "feat: add searchIntentsByContextEmbedding and context CRUD to database interface"
```

---

### Task 5: Implement `searchIntentsByContextEmbedding` and context CRUD in database adapter

**Files:**
- Modify: `backend/src/adapters/database.adapter.ts`

- [ ] **Step 1: Add the `userContexts` schema import**

At the top of `database.adapter.ts`, find the schema imports and add `userContexts`:

```typescript
import { ..., userContexts } from '../schemas/database.schema';
```

- [ ] **Step 2: Implement `upsertUserContext`**

Add to the `ChatDatabaseAdapter` class (or whichever class implements `Database`):

```typescript
async upsertUserContext(params: {
  userId: string;
  networkId: string;
  text: string;
  embedding: number[];
  premiseHash: string;
}): Promise<{ id: string }> {
  const vectorStr = `[${params.embedding.join(',')}]`;
  const rows = await db.insert(schema.userContexts)
    .values({
      userId: params.userId,
      networkId: params.networkId,
      text: params.text,
      embedding: sql`${vectorStr}::vector`,
      premiseHash: params.premiseHash,
      generatedAt: new Date(),
    } as any)
    .onConflictDoUpdate({
      target: [schema.userContexts.userId, schema.userContexts.networkId],
      set: {
        text: params.text,
        embedding: sql`${vectorStr}::vector`,
        premiseHash: params.premiseHash,
        generatedAt: new Date(),
      } as any,
    })
    .returning({ id: schema.userContexts.id });
  return { id: rows[0].id };
}
```

- [ ] **Step 3: Implement `getUserContext`**

```typescript
async getUserContext(userId: string, networkId: string) {
  const rows = await db.select()
    .from(schema.userContexts)
    .where(and(
      eq(schema.userContexts.userId, userId),
      eq(schema.userContexts.networkId, networkId),
    ))
    .limit(1);
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    id: r.id,
    text: r.text,
    embedding: r.embedding as unknown as number[],
    premiseHash: r.premiseHash ?? '',
    generatedAt: r.generatedAt,
  };
}
```

- [ ] **Step 4: Implement `getUserContexts`**

```typescript
async getUserContexts(userId: string) {
  const rows = await db.select()
    .from(schema.userContexts)
    .where(eq(schema.userContexts.userId, userId));
  return rows.map(r => ({
    id: r.id,
    networkId: r.networkId,
    text: r.text,
    embedding: r.embedding as unknown as number[],
    premiseHash: r.premiseHash ?? '',
    generatedAt: r.generatedAt,
  }));
}
```

- [ ] **Step 5: Implement `searchIntentsByContextEmbedding`**

Follow the same SQL pattern as `searchPremisesBySimilarity` (lines 5104-5144), but target the `intents` table scoped via `intent_networks`:

```typescript
async searchIntentsByContextEmbedding(params: {
  embedding: number[];
  networkIds: string[];
  excludeUserId: string;
  limit: number;
  minScore?: number;
}) {
  const { embedding, networkIds, excludeUserId, limit, minScore = 0.30 } = params;
  const vectorStr = `[${embedding.join(',')}]`;

  const rows = await db.execute<{
    intentId: string;
    userId: string;
    networkId: string;
    payload: string;
    summary: string | null;
    similarity: number;
  }>(sql`
    SELECT
      i.id AS "intentId",
      i.user_id AS "userId",
      ine.network_id AS "networkId",
      i.payload,
      i.summary,
      1 - (i.embedding <=> ${vectorStr}::vector) AS similarity
    FROM ${schema.intents} i
    JOIN ${schema.intentNetworks} ine ON i.id = ine.intent_id
    JOIN ${schema.users} u ON i.user_id = u.id
    WHERE ine.network_id = ANY(${networkIds})
      AND i.user_id != ${excludeUserId}
      AND i.status = 'ACTIVE'
      AND i.embedding IS NOT NULL
      AND u."deletedAt" IS NULL
      AND 1 - (i.embedding <=> ${vectorStr}::vector) >= ${minScore}
    ORDER BY i.embedding <=> ${vectorStr}::vector
    LIMIT ${limit}
  `);

  return rows as Array<{
    intentId: string;
    userId: string;
    networkId: string;
    payload: string;
    summary: string | null;
    similarity: number;
  }>;
}
```

- [ ] **Step 6: Run type check**

```bash
cd backend && bun run tsc --noEmit
```

Expected: no errors. The adapter now satisfies the `OpportunityGraphDatabase` interface.

- [ ] **Step 7: Commit**

```bash
git add backend/src/adapters/database.adapter.ts
git commit -m "feat: implement searchIntentsByContextEmbedding and user context CRUD"
```

---

### Task 6: Create UserContextGenerator in protocol

**Files:**
- Create: `packages/protocol/src/context/context.generator.ts`
- Modify: `packages/protocol/src/index.ts`

- [ ] **Step 1: Create the context generator**

Create `packages/protocol/src/context/context.generator.ts`:

```typescript
import { createModel } from '../shared/agent/model.config.js';
import type { EmbeddingGenerator } from '../shared/interfaces/embedder.interface.js';

export interface UserContextInput {
  premises: Array<{ text: string }>;
  networkPrompt: string | null;
  networkTitle: string;
}

export interface IncrementalContextInput {
  currentContext: string;
  changeType: 'added' | 'updated' | 'retracted' | 'expired';
  premiseText: string;
  previousPremiseText?: string;
  networkPrompt: string | null;
  networkTitle: string;
}

export interface UserContextResult {
  text: string;
  embedding: number[];
}

export class UserContextGenerator {
  constructor(private embeddingGenerator: EmbeddingGenerator) {}

  async generateColdStart(input: UserContextInput): Promise<UserContextResult> {
    const model = createModel({ temperature: 0.3 });
    const premiseBlock = input.premises.map(p => `- ${p.text}`).join('\n');
    const networkContext = input.networkPrompt
      ? `Network "${input.networkTitle}": ${input.networkPrompt}`
      : `Network: ${input.networkTitle}`;

    const response = await model.invoke([
      {
        role: 'system',
        content: `You synthesize user context paragraphs for community matching. Given a list of premises (atomic facts about a person) and a network description, write a focused paragraph (3-6 sentences) that captures who this person is through the lens of that network's purpose. Highlight what is most relevant to the network. Write in third person. Be specific and concrete, not generic.`,
      },
      {
        role: 'user',
        content: `${networkContext}\n\nPremises:\n${premiseBlock}\n\nWrite a focused context paragraph for this person in this network.`,
      },
    ]);

    const text = typeof response.content === 'string'
      ? response.content
      : (response.content as Array<{ text?: string }>).map(c => c.text ?? '').join('');

    const embResult = await this.embeddingGenerator.generate(text);
    const embedding = Array.isArray(embResult[0]) ? embResult[0] : embResult as number[];

    return { text, embedding };
  }

  async generateIncremental(input: IncrementalContextInput): Promise<UserContextResult> {
    const model = createModel({ temperature: 0.3 });
    const networkContext = input.networkPrompt
      ? `Network "${input.networkTitle}": ${input.networkPrompt}`
      : `Network: ${input.networkTitle}`;

    let changeDescription: string;
    switch (input.changeType) {
      case 'added':
        changeDescription = `A new fact was learned about this person:\n"${input.premiseText}"`;
        break;
      case 'updated':
        changeDescription = `A fact was updated.\nOld: "${input.previousPremiseText}"\nNew: "${input.premiseText}"`;
        break;
      case 'retracted':
        changeDescription = `A fact was retracted (no longer true):\n"${input.premiseText}"`;
        break;
      case 'expired':
        changeDescription = `A fact has expired (time-bound, no longer current):\n"${input.premiseText}"`;
        break;
    }

    const response = await model.invoke([
      {
        role: 'system',
        content: `You maintain user context paragraphs for community matching. You will receive the current context paragraph, a change that occurred, and the network description. Update the context paragraph to reflect the change while preserving all other information. Keep the same style: 3-6 sentences, third person, specific and concrete. For retractions/expirations, remove the relevant information. For additions/updates, integrate the new information naturally.`,
      },
      {
        role: 'user',
        content: `${networkContext}\n\nCurrent context:\n${input.currentContext}\n\nChange:\n${changeDescription}\n\nWrite the updated context paragraph.`,
      },
    ]);

    const text = typeof response.content === 'string'
      ? response.content
      : (response.content as Array<{ text?: string }>).map(c => c.text ?? '').join('');

    const embResult = await this.embeddingGenerator.generate(text);
    const embedding = Array.isArray(embResult[0]) ? embResult[0] : embResult as number[];

    return { text, embedding };
  }
}
```

- [ ] **Step 2: Export from protocol index**

In `packages/protocol/src/index.ts`, add:

```typescript
export { UserContextGenerator } from './context/context.generator.js';
export type { UserContextInput, IncrementalContextInput, UserContextResult } from './context/context.generator.js';
```

- [ ] **Step 3: Build the protocol package**

```bash
cd packages/protocol && bun run build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/context/context.generator.ts packages/protocol/src/index.ts
git commit -m "feat: add UserContextGenerator for network-scoped context synthesis"
```

---

### Task 7: Update CandidateMatch type and add `sourceContexts` to opportunity state

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.state.ts`

- [ ] **Step 1: Add `matchedStrategies` to `CandidateMatch` and update `discoverySource`**

In `packages/protocol/src/opportunity/opportunity.state.ts`, update the `CandidateMatch` interface (lines 48-61):

```typescript
export interface CandidateMatch {
  candidateUserId: Id<'users'>;
  candidateIntentId?: Id<'intents'>;
  candidatePremiseId?: Id<'premises'>;
  networkId: Id<'networks'>;
  similarity: number;
  lens: string;
  candidatePayload: string;
  candidateSummary?: string;
  discoverySource?: 'query' | 'premise-similarity' | 'context-to-intent';
  matchedStrategies?: string[];
}
```

- [ ] **Step 2: Add `sourceContexts` annotation**

Add a new annotation to `OpportunityGraphState` (after the `sourcePremises` annotation, around line 352):

```typescript
/** User contexts per network (from prep). Used for context-to-intent discovery. */
sourceContexts: Annotation<Array<{ networkId: Id<'networks'>; embedding: number[] }>>({
  reducer: (curr, next) => next ?? curr,
  default: () => [],
}),
```

- [ ] **Step 3: Build the protocol package**

```bash
cd packages/protocol && bun run build
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.state.ts
git commit -m "feat: add matchedStrategies to CandidateMatch, sourceContexts to state"
```

---

### Task 8: Wire context-to-intent discovery into opportunity graph

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts`

- [ ] **Step 1: Load user contexts in the prep node**

In the prep node (around line 275), add user context loading alongside the existing `Promise.all`:

```typescript
const discoveryUserId = state.onBehalfOfUserId ?? state.userId;
const [intents, profile, userPremises] = await Promise.all([
  this.database.getActiveIntents(discoveryUserId),
  this.database.getProfile(discoveryUserId),
  this.database.getPremisesForUser(discoveryUserId, 'ACTIVE'),
]);
```

After computing `sourcePremises`, add:

```typescript
const sourceContexts = await (async () => {
  const contexts = await self.database.getUserContexts(discoveryUserId);
  return contexts
    .filter(c => c.embedding && c.embedding.length > 0 && userNetworkIds.includes(c.networkId as Id<'networks'>))
    .map(c => ({
      networkId: c.networkId as Id<'networks'>,
      embedding: c.embedding,
    }));
})();
```

Add `sourceContexts` to the return object:

```typescript
return {
  userNetworks: userNetworkIds,
  indexedIntents,
  sourceProfile,
  sourcePremises,
  sourceContexts,
  trace: [{
    node: "prep",
    detail: `${userNetworkIds.length} network(s), ${intents.length} intent(s), ${sourcePremises.length} premise(s), ${sourceContexts.length} context(s), ${profile ? 'profile loaded' : 'no profile'}`,
  }],
};
```

- [ ] **Step 2: Add `runContextToIntentDiscovery` function**

Add a new function inside the discovery node closure (near `runPremiseDiscovery`, around line 955), after the `mergePremiseCandidates` function:

```typescript
/**
 * Context-to-intent discovery: searches intents using user context embeddings.
 * Restores the profile→intent cross-search deleted when Path B was removed.
 */
async function runContextToIntentDiscovery(): Promise<CandidateMatch[]> {
  if (!state.sourceContexts?.length) return [];
  const contextToIntentEnabled = process.env.DISCOVERY_CONTEXT_TO_INTENT !== '0';
  if (!contextToIntentEnabled) return [];

  const targetNetworkIds = state.targetNetworks.map(t => t.networkId);
  if (targetNetworkIds.length === 0) return [];

  logger.verbose('[Graph:Discovery] runContextToIntentDiscovery start', {
    contextCount: state.sourceContexts.length,
    targetNetworks: targetNetworkIds.length,
  });

  const searchResults = await Promise.all(
    state.sourceContexts
      .filter(ctx => targetNetworkIds.includes(ctx.networkId))
      .map(ctx =>
        self.database.searchIntentsByContextEmbedding({
          embedding: ctx.embedding,
          networkIds: [ctx.networkId],
          excludeUserId: discoveryUserId,
          limit: 20,
          minScore: minScore,
        })
      )
  );

  const contextCandidates: CandidateMatch[] = [];
  for (const results of searchResults) {
    for (const r of results) {
      contextCandidates.push({
        candidateUserId: r.userId as Id<'users'>,
        candidateIntentId: r.intentId as Id<'intents'>,
        networkId: r.networkId as Id<'networks'>,
        similarity: typeof r.similarity === 'number' ? r.similarity : parseFloat(String(r.similarity)),
        lens: 'context_match',
        candidatePayload: r.payload ?? '',
        candidateSummary: r.summary ?? undefined,
        discoverySource: 'context-to-intent',
      });
    }
  }

  const byKey = new Map<string, CandidateMatch>();
  for (const c of contextCandidates) {
    const key = `${c.candidateUserId}:${c.candidateIntentId ?? 'none'}:${c.networkId}`;
    if (!byKey.has(key) || c.similarity > (byKey.get(key)?.similarity ?? 0)) {
      byKey.set(key, c);
    }
  }
  const deduped = Array.from(byKey.values());
  logger.verbose('[Graph:Discovery] runContextToIntentDiscovery complete', {
    rawCount: contextCandidates.length,
    dedupedCount: deduped.length,
  });
  return deduped;
}
```

- [ ] **Step 3: Add `mergeStrategyCandidates` function**

Add a generic merge function that handles multi-strategy dedup and boosting:

```typescript
/**
 * Merge candidates from multiple strategies. Deduplicates by userId + networkId + entityId,
 * keeps the highest similarity, tracks which strategies found each candidate,
 * and applies a multi-strategy boost (+0.05 per additional strategy, capped at 1.0).
 */
function mergeStrategyCandidates(...groups: CandidateMatch[][]): CandidateMatch[] {
  const merged = new Map<string, CandidateMatch & { _strategies: Set<string> }>();
  for (const group of groups) {
    for (const c of group) {
      const entityId = c.candidateIntentId ?? c.candidatePremiseId ?? 'none';
      const key = `${c.candidateUserId}:${c.networkId}:${entityId}`;
      const existing = merged.get(key);
      if (!existing) {
        merged.set(key, { ...c, _strategies: new Set([c.discoverySource ?? 'unknown']) });
      } else {
        existing._strategies.add(c.discoverySource ?? 'unknown');
        if (c.similarity > existing.similarity) {
          Object.assign(existing, c);
        }
      }
    }
  }
  return Array.from(merged.values()).map(({ _strategies, ...c }) => {
    const boost = Math.min((_strategies.size - 1) * 0.05, 0.15);
    return {
      ...c,
      similarity: Math.min(c.similarity + boost, 1.0),
      matchedStrategies: Array.from(_strategies),
    };
  });
}
```

- [ ] **Step 4: Wire both strategies into the profile-source discovery path**

Replace the profile-source discovery block (lines 798-806 — the "No search query" branch):

```typescript
// No search query — premise-to-premise + context-to-intent discovery
const [premiseCands, contextCands] = await Promise.all([
  runPremiseDiscovery(),
  runContextToIntentDiscovery(),
]);
if (premiseCands.length > 0 || contextCands.length > 0) {
  const merged = mergeStrategyCandidates(premiseCands, contextCands);
  const traceEntries: Array<{ node: string; detail?: string; data?: Record<string, unknown> }> = [];
  if (premiseCands.length > 0) {
    traceEntries.push({ node: "strategy", detail: `premise-to-premise → ${premiseCands.length} candidate(s)` });
  }
  if (contextCands.length > 0) {
    traceEntries.push({ node: "strategy", detail: `context-to-intent → ${contextCands.length} candidate(s)` });
  }
  traceEntries.push({
    node: "discovery",
    detail: `${[premiseCands.length > 0 && 'premise-to-premise', contextCands.length > 0 && 'context-to-intent'].filter(Boolean).length} strategies → ${premiseCands.length + contextCands.length} raw, ${merged.length} after dedup`,
  });
  return { candidates: filterByTarget(merged), trace: traceEntries };
}
return { candidates: [] };
```

Also update the profile-source path with search query (around line 790-795) to include context-to-intent:

```typescript
const [premiseCands, contextCands] = await Promise.all([
  runPremiseDiscovery(),
  runContextToIntentDiscovery(),
]);
const withPremisesAndContext = mergeStrategyCandidates(queryCandidates, premiseCands, contextCands);
if (premiseCands.length > 0) {
  traceEntries.push({ node: "strategy", detail: `premise-to-premise → ${premiseCands.length} candidate(s)` });
}
if (contextCands.length > 0) {
  traceEntries.push({ node: "strategy", detail: `context-to-intent → ${contextCands.length} candidate(s)` });
}
if (premiseCands.length > 0 || contextCands.length > 0) {
  traceEntries.push({ node: "discovery", detail: `+ Premise/context search → ${premiseCands.length + contextCands.length} candidate(s), merged to ${withPremisesAndContext.length}` });
}
return { candidates: filterByTarget(withPremisesAndContext), trace: traceEntries };
```

- [ ] **Step 5: Build the protocol package**

```bash
cd packages/protocol && bun run build
```

Expected: no errors.

- [ ] **Step 6: Run backend type check**

```bash
cd backend && bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts
git commit -m "feat: add context-to-intent discovery strategy to opportunity graph"
```

---

### Task 9: Wire context generation into enrichment completion

**Files:**
- Modify: `backend/src/main.ts`

- [ ] **Step 1: Add a context generation function in main.ts**

In `backend/src/main.ts`, add a function that generates user contexts for all networks a user belongs to. Place it after the existing event handlers (around line 147):

```typescript
import { UserContextGenerator } from '@indexnetwork/protocol';
import crypto from 'crypto';

async function generateUserContexts(userId: string): Promise<void> {
  const generator = new UserContextGenerator(embedderAdapter);
  const dbAdapter = new ChatDatabaseAdapter();

  const networkIds = await dbAdapter.getUserIndexIds(userId);
  const allPremises = await dbAdapter.getPremisesForUser(userId, 'ACTIVE');
  if (!allPremises?.length || networkIds.length === 0) return;

  const premiseTexts = allPremises
    .map(p => ({ text: (p as any).assertion?.text ?? '' }))
    .filter(p => p.text.length > 0);
  if (premiseTexts.length === 0) return;

  const premiseHash = crypto.createHash('sha256')
    .update(allPremises.map(p => `${p.id}:${(p as any).updatedAt}`).sort().join('|'))
    .digest('hex')
    .slice(0, 16);

  for (const networkId of networkIds) {
    try {
      const existing = await dbAdapter.getUserContext(userId, networkId);
      if (existing && existing.premiseHash === premiseHash) continue;

      const network = await dbAdapter.getNetwork(networkId);
      if (!network) continue;

      const result = await generator.generateColdStart({
        premises: premiseTexts,
        networkPrompt: network.prompt ?? null,
        networkTitle: network.title,
      });

      await dbAdapter.upsertUserContext({
        userId,
        networkId,
        text: result.text,
        embedding: result.embedding,
        premiseHash,
      });

      log.job.from('UserContext').verbose('Generated user context', { userId, networkId });
    } catch (err) {
      log.job.from('UserContext').error('Failed to generate user context', { userId, networkId, error: err });
    }
  }
}
```

- [ ] **Step 2: Call context generation in the enrichment completion callback**

Update the `enrichmentQueue.onEnrichmentComplete` callback to also generate contexts:

```typescript
enrichmentQueue.onEnrichmentComplete = (userId: string) => {
  generateUserContexts(userId)
    .catch(err => log.job.from('UserContext').error('Failed to generate contexts after enrichment', { userId, error: err }));

  fromProfileQueue.addJob(
    { userId },
    { priority: 20, jobId: `profile-discovery-${userId}-${Math.floor(Date.now() / (6 * 60 * 60 * 1000))}` },
  ).catch((err) => log.job.from('ProfileEnrichment').error('Failed to enqueue profile-based discovery', { userId, error: err }));
};
```

Context generation runs in parallel with discovery enqueue — it's fire-and-forget. The discovery job picks up whatever contexts exist when it runs.

- [ ] **Step 3: Run type check**

```bash
cd backend && bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/main.ts
git commit -m "feat: wire user context generation into enrichment completion"
```

---

### Task 10: Create backfill script for premises and user contexts

**Files:**
- Create: `backend/src/cli/backfill-premises.ts`
- Modify: `backend/package.json`

- [ ] **Step 1: Create the backfill script**

Create `backend/src/cli/backfill-premises.ts`:

```typescript
#!/usr/bin/env node
/**
 * Backfill CLI: enqueue enrichment jobs for all members of a network.
 * Creates premises (via enrichment) and user contexts for members who lack them.
 *
 * Usage: bun run maintenance:backfill-premises -- --network <networkId> [--dry-run]
 */
import dotenv from 'dotenv';
import path from 'path';

const envFile = process.env.NODE_ENV === 'development' ? '.env.development' : '.env.production';
dotenv.config({ path: path.resolve(process.cwd(), envFile) });

import { eq, and, isNull } from 'drizzle-orm';
import db, { closeDb } from '../lib/drizzle/drizzle';
import * as schema from '../schemas/database.schema';
import { enrichmentQueue } from '../queues/enrichment.queue';

function parseArgs(): { networkId: string; dryRun: boolean } {
  const args = process.argv.slice(2);
  const networkArg = args.find(a => a.startsWith('--network'));
  const dryRun = args.includes('--dry-run');

  let networkId = '';
  if (networkArg) {
    const eqIdx = networkArg.indexOf('=');
    if (eqIdx !== -1) {
      networkId = networkArg.slice(eqIdx + 1);
    } else {
      const nextIdx = args.indexOf(networkArg) + 1;
      if (nextIdx < args.length) networkId = args[nextIdx];
    }
  }

  if (!networkId) {
    console.error('Usage: bun run maintenance:backfill-premises -- --network <networkId> [--dry-run]');
    process.exit(1);
  }

  return { networkId, dryRun };
}

async function main() {
  const { networkId, dryRun } = parseArgs();
  console.log(`Backfilling premises for network: ${networkId}${dryRun ? ' (dry run)' : ''}`);

  const members = await db.select({
    userId: schema.networkMembers.userId,
  })
    .from(schema.networkMembers)
    .innerJoin(schema.users, eq(schema.networkMembers.userId, schema.users.id))
    .where(and(
      eq(schema.networkMembers.networkId, networkId),
      isNull(schema.users.deletedAt),
    ));

  console.log(`Found ${members.length} members in network`);

  if (dryRun) {
    console.log('Dry run — no jobs enqueued');
    for (const m of members) {
      console.log(`  Would enqueue: ${m.userId}`);
    }
  } else {
    const items = members.map(m => ({ userId: m.userId }));
    const jobs = await enrichmentQueue.addEnrichUserJobBulk(items);
    console.log(`Enqueued ${jobs.length} enrichment jobs`);
  }

  await closeDb();
  await enrichmentQueue.close();
  process.exit(0);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script**

In `backend/package.json`, add to the `scripts` section:

```json
"maintenance:backfill-premises": "bun ./src/cli/backfill-premises.ts"
```

- [ ] **Step 3: Run type check**

```bash
cd backend && bun run tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add backend/src/cli/backfill-premises.ts backend/package.json
git commit -m "feat: add backfill-premises maintenance script"
```

---

### Task 11: Version bumps

**Files:**
- Modify: `packages/protocol/package.json`

- [ ] **Step 1: Bump protocol package version**

Check current version and bump the minor version (new feature — `searchIntentsByContextEmbedding`, `CandidateMatch.matchedStrategies`, `sourceContexts` state):

```bash
grep '"version"' packages/protocol/package.json
```

Bump the minor version (e.g., `0.5.0` → `0.6.0`, or whatever the current version is).

- [ ] **Step 2: Commit**

```bash
git add packages/protocol/package.json
git commit -m "chore: bump @indexnetwork/protocol version"
```
