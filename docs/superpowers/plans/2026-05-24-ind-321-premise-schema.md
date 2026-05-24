# IND-321: Premise Schema, Enums, and Drizzle Migration

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `premises` and `premise_networks` tables, enums, JSONB interfaces, Drizzle relations, and type exports to establish the data layer for composable profiles.

**Architecture:** Follows the existing schema patterns in `database.schema.ts` — JSONB composable columns (like opportunities), a relational junction table (like `intent_networks`), and HNSW vector index (like intents and profiles). Purely additive: no existing tables change.

**Tech Stack:** Drizzle ORM, PostgreSQL, pgvector

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `backend/src/schemas/database.schema.ts` | Enum, interfaces, table definitions, relations, type exports |
| Create | `backend/drizzle/0071_add_premises_and_premise_networks.sql` | Generated migration (will be renamed from Drizzle's random name) |
| Modify | `backend/drizzle/meta/_journal.json` | Update tag to match renamed migration file |

---

### Task 1: Add enum and JSONB interfaces

**Files:**
- Modify: `backend/src/schemas/database.schema.ts:6-16` (enum block)
- Modify: `backend/src/schemas/database.schema.ts:287-329` (interface block, before opportunities)

- [ ] **Step 1: Add `premiseStatusEnum` after line 16 (the `networkTypeEnum` line)**

Add this line after the existing enum declarations:

```typescript
export const premiseStatusEnum = pgEnum('premise_status', ['ACTIVE', 'RETRACTED', 'EXPIRED']);
```

- [ ] **Step 2: Add JSONB interfaces before the `OpportunityDetection` interface (before line 287)**

Insert these interfaces just above the `export interface OpportunityDetection` block:

```typescript
export interface PremiseAssertion {
  text: string;
  tier: 'assertive' | 'contextual';
  summary?: string;
}

export interface PremiseProvenance {
  source: 'explicit' | 'enrichment' | 'integration' | 'onboarding';
  sourceId?: string;
  confidence: number;
  timestamp: string;
}

export interface PremiseAnalysis {
  speechActType: 'DECLARATIVE' | 'ASSERTIVE';
  felicityAuthority: number;
  felicitySincerity: number;
  felicityClarity: number;
  semanticEntropy: number;
}

export interface PremiseValidity {
  validFrom?: string;
  validUntil?: string;
  volatile: boolean;
}
```

- [ ] **Step 3: Verify file compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors (interfaces are standalone, no dependencies)

- [ ] **Step 4: Commit**

```bash
git add backend/src/schemas/database.schema.ts
git commit -m "feat(schema): add premise status enum and JSONB interfaces"
```

---

### Task 2: Add `premises` table definition

**Files:**
- Modify: `backend/src/schemas/database.schema.ts` — insert after `userNotificationSettings` table (after line 263), before the `HydeSourceType` type

- [ ] **Step 1: Add the `premises` table**

Insert after the `userNotificationSettings` closing `});` and before `export type HydeSourceType`:

```typescript
export const premises = pgTable('premises', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  assertion: jsonb('assertion').$type<PremiseAssertion>().notNull(),
  provenance: jsonb('provenance').$type<PremiseProvenance>().notNull(),
  analysis: jsonb('analysis').$type<PremiseAnalysis>(),
  validity: jsonb('validity').$type<PremiseValidity>().notNull(),
  embedding: vector('embedding', { dimensions: 2000 }),
  status: premiseStatusEnum('status').notNull().default('ACTIVE'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  retractedAt: timestamp('retracted_at', { withTimezone: true }),
}, (table) => ({
  embeddingIdx: index('premises_embedding_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  userIdIdx: index('premises_user_id_idx').on(table.userId),
  statusIdx: index('premises_status_idx').on(table.status),
}));
```

- [ ] **Step 2: Verify file compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/schemas/database.schema.ts
git commit -m "feat(schema): add premises table definition"
```

---

### Task 3: Add `premise_networks` junction table

**Files:**
- Modify: `backend/src/schemas/database.schema.ts` — insert after the `premises` table, before `HydeSourceType`

- [ ] **Step 1: Add the `premiseNetworks` junction table**

Insert directly after the `premises` table closing `});`:

```typescript
export const premiseNetworks = pgTable('premise_networks', {
  premiseId: text('premise_id').notNull().references(() => premises.id, { onDelete: 'cascade' }),
  networkId: text('network_id').notNull().references(() => networks.id),
  relevancyScore: numeric('relevancy_score'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.premiseId, t.networkId] }),
  networkIdIdx: index('premise_networks_network_id_idx').on(t.networkId),
}));
```

- [ ] **Step 2: Verify file compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/schemas/database.schema.ts
git commit -m "feat(schema): add premise_networks junction table"
```

---

### Task 4: Add Drizzle relations

**Files:**
- Modify: `backend/src/schemas/database.schema.ts` — Relations section (after line 596)

- [ ] **Step 1: Add `premises` to the `usersRelations`**

In the existing `usersRelations` block, add `premises: many(premises),` after the `intents: many(intents),` line:

```typescript
export const usersRelations = relations(users, ({ one, many }) => ({
  intents: many(intents),
  premises: many(premises),
  memberOf: many(networkMembers),
  // ... rest stays the same
```

- [ ] **Step 2: Add `premisesRelations` after the `userProfilesRelations` block**

Insert after the `userProfilesRelations` closing `});`:

```typescript
export const premisesRelations = relations(premises, ({ one, many }) => ({
  user: one(users, {
    fields: [premises.userId],
    references: [users.id],
  }),
  networks: many(premiseNetworks),
}));

export const premiseNetworksRelations = relations(premiseNetworks, ({ one }) => ({
  premise: one(premises, {
    fields: [premiseNetworks.premiseId],
    references: [premises.id],
  }),
  network: one(networks, {
    fields: [premiseNetworks.networkId],
    references: [networks.id],
  }),
}));
```

- [ ] **Step 3: Add `premises` to `networksRelations`**

In the existing `networksRelations` block, add `premises: many(premiseNetworks),` after the `intents: many(intentNetworks),` line:

```typescript
export const networksRelations = relations(networks, ({ many }) => ({
  members: many(networkMembers),
  intents: many(intentNetworks),
  premises: many(premiseNetworks),
  // ... rest stays the same
```

- [ ] **Step 4: Verify file compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 5: Commit**

```bash
git add backend/src/schemas/database.schema.ts
git commit -m "feat(schema): add premises and premise_networks relations"
```

---

### Task 5: Add type exports

**Files:**
- Modify: `backend/src/schemas/database.schema.ts:726-758` (type exports section)

- [ ] **Step 1: Add Premise and PremiseNetwork type exports**

Insert after the `NewUserProfile` line (line 733):

```typescript
export type Premise = typeof premises.$inferSelect;
export type NewPremise = typeof premises.$inferInsert;
export type PremiseNetwork = typeof premiseNetworks.$inferSelect;
export type NewPremiseNetwork = typeof premiseNetworks.$inferInsert;
```

- [ ] **Step 2: Verify file compiles**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add backend/src/schemas/database.schema.ts
git commit -m "feat(schema): add Premise and PremiseNetwork type exports"
```

---

### Task 6: Generate and rename migration

**Files:**
- Create: `backend/drizzle/0071_add_premises_and_premise_networks.sql`
- Modify: `backend/drizzle/meta/_journal.json`

- [ ] **Step 1: Generate the migration**

Run: `cd backend && bun run db:generate`
Expected: Drizzle generates a new `.sql` file in `backend/drizzle/` with a random name (e.g., `0071_some_random_name.sql`). It should contain `CREATE TYPE premise_status`, `CREATE TABLE premises`, `CREATE TABLE premise_networks`, and the index creation statements.

- [ ] **Step 2: Rename the migration file**

```bash
cd backend/drizzle
mv 0071_*.sql 0071_add_premises_and_premise_networks.sql
```

- [ ] **Step 3: Update the journal tag**

Open `backend/drizzle/meta/_journal.json`. Find the last entry (idx 71). Change its `"tag"` value from the random name to `"0071_add_premises_and_premise_networks"`.

- [ ] **Step 4: Verify no further diff**

Run: `cd backend && bun run db:generate`
Expected: "No schema changes detected" (or equivalent — no new migration generated)

- [ ] **Step 5: Commit**

```bash
git add backend/drizzle/
git commit -m "feat(schema): add premises migration"
```

---

### Task 7: Final verification

- [ ] **Step 1: Type check the full backend**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run existing tests to check for regressions**

Run: `cd backend && bun test tests/e2e.test.ts`
Expected: All existing tests pass (schema additions are additive, no breakage)

- [ ] **Step 3: Verify the schema file exports are consistent**

Run: `cd backend && grep -n "export type.*Premise" src/schemas/database.schema.ts`
Expected output shows 4 lines: `Premise`, `NewPremise`, `PremiseNetwork`, `NewPremiseNetwork`

Run: `cd backend && grep -n "export const premise" src/schemas/database.schema.ts`
Expected output shows 5 lines: `premiseStatusEnum`, `premises`, `premiseNetworks`, `premisesRelations`, `premiseNetworksRelations`
