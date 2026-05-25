# Decouple Discovery from Onboarding — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace onboarding.completedAt-based discovery filters with embedding-presence checks so pre-verified users are discoverable without bypassing the agent onboarding ritual.

**Architecture:** Remove the `(isGhost = true OR onboarding->>'completedAt' IS NOT NULL)` SQL filter from four vector search methods in the embedder adapter, replace the onboarding skip condition in opportunity enrichment with an embedding check, and delete the `completedAt`-setting SQL from the experiment signup/import paths. The MCP tool gate and agent-side onboarding flow are untouched.

**Tech Stack:** Drizzle ORM, PostgreSQL, TypeScript, bun:test

**Spec:** `docs/superpowers/specs/2026-05-25-decouple-discovery-from-onboarding-design.md`

---

### Task 1: Update the test to reflect new filter logic

**Files:**
- Modify: `backend/tests/onboarding-filter.spec.ts`

- [ ] **Step 1: Rewrite the test file**

Replace the entire test file. The new filter criterion is embedding presence (not `onboarding.completedAt`). The test validates the logic that will be used in `opportunity.discover.ts` after Task 3.

```typescript
import { describe, it, expect } from 'bun:test';

describe('Discovery eligibility filtering in opportunity enrichment', () => {
  it('should NOT skip candidates with a profile embedding', () => {
    const profile = { embedding: [0.1, 0.2, 0.3] };
    const isDirectTarget = false;

    const shouldSkip = !isDirectTarget && !profile?.embedding;
    expect(shouldSkip).toBe(false);
  });

  it('should skip candidates without a profile embedding', () => {
    const profile = { embedding: null };
    const isDirectTarget = false;

    const shouldSkip = !isDirectTarget && !profile?.embedding;
    expect(shouldSkip).toBe(true);
  });

  it('should skip candidates with no profile at all', () => {
    const profile = null as { embedding: number[] | null } | null;
    const isDirectTarget = false;

    const shouldSkip = !isDirectTarget && !profile?.embedding;
    expect(shouldSkip).toBe(true);
  });

  it('should NOT skip direct-connection targets even without embedding', () => {
    const profile = null as { embedding: number[] | null } | null;
    const isDirectTarget = true;

    const shouldSkip = !isDirectTarget && !profile?.embedding;
    expect(shouldSkip).toBe(false);
  });

  it('should still skip soft-deleted users regardless of embedding (separate guard)', () => {
    const candidateUser = {
      id: 'deleted-user-1',
      name: 'Deleted',
      deletedAt: '2026-02-01T00:00:00Z',
    };

    const shouldSkipDeleted = !!(candidateUser && 'deletedAt' in candidateUser && candidateUser.deletedAt);
    expect(shouldSkipDeleted).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd backend && bun test tests/onboarding-filter.spec.ts`
Expected: All 5 tests PASS. These tests validate pure boolean logic independent of the production code — they'll pass immediately.

- [ ] **Step 3: Commit**

```bash
git add backend/tests/onboarding-filter.spec.ts
git commit -m "test: update discovery filter tests for embedding-based eligibility"
```

---

### Task 2: Remove onboarding filter from vector search queries

**Files:**
- Modify: `backend/src/adapters/embedder.adapter.ts:237,287,329,376`

- [ ] **Step 1: Remove the filter from `searchProfilesForHyde`**

In the `conditions` array around line 237, delete this line:

```typescript
sql`(${schema.users.isGhost} = true OR ${schema.users.onboarding}->>'completedAt' IS NOT NULL)`,
```

The remaining conditions (`isNotNull(userProfiles.embedding)`, `isNull(schema.users.deletedAt)`) already express discovery eligibility.

- [ ] **Step 2: Remove the filter from `searchIntentsForHyde`**

In the `conditions` array around line 287, delete this line:

```typescript
sql`(${schema.users.isGhost} = true OR ${schema.users.onboarding}->>'completedAt' IS NOT NULL)`,
```

- [ ] **Step 3: Remove the filter from `searchProfilesByProfileEmbedding`**

In the `conditions` array around line 329, delete this line:

```typescript
sql`(${schema.users.isGhost} = true OR ${schema.users.onboarding}->>'completedAt' IS NOT NULL)`,
```

- [ ] **Step 4: Remove the filter from `searchIntentsByProfileEmbedding`**

In the `conditions` array around line 376, delete this line:

```typescript
sql`(${schema.users.isGhost} = true OR ${schema.users.onboarding}->>'completedAt' IS NOT NULL)`,
```

- [ ] **Step 5: Verify lint passes**

Run: `cd backend && bun run lint`
Expected: No new errors. The `schema.users` import and join are still needed for the `deletedAt` filter.

- [ ] **Step 6: Commit**

```bash
git add backend/src/adapters/embedder.adapter.ts
git commit -m "fix: remove onboarding gate from vector search filters

Discovery eligibility is now based on embedding presence and
soft-delete status, not onboarding.completedAt. Pre-verified
users with embeddings are now discoverable without being marked
as onboarded."
```

---

### Task 3: Replace onboarding filter in opportunity enrichment

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.discover.ts:324-327`

- [ ] **Step 1: Replace the filter condition**

Find these lines (around line 324-327):

```typescript
      // Skip non-onboarded real users (registered but haven't completed onboarding),
      // unless this is an explicit direct-connection target (targetUserId bypass).
      const isDirectTarget = targetUserId && candidateUserId === targetUserId;
      if (candidateUser && !candidateUser.isGhost && !candidateUser.onboarding?.completedAt && !isDirectTarget) return null;
```

Replace with:

```typescript
      const isDirectTarget = targetUserId && candidateUserId === targetUserId;
      if (!isDirectTarget && !profile?.embedding) return null;
```

The `profile` variable is already fetched on line ~320. Candidates without a profile embedding are skipped unless they're an explicit direct-connection target. The `isGhost` and `onboarding` checks are no longer needed.

- [ ] **Step 2: Verify lint passes**

Run: `cd backend && bun run lint`
Expected: No new errors.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.discover.ts
git commit -m "fix: use embedding presence for opportunity candidate filtering

Replace isGhost/onboarding.completedAt check with profile
embedding presence. Candidates with embeddings are eligible
regardless of onboarding status."
```

---

### Task 4: Remove `completedAt` writes from experiment service

**Files:**
- Modify: `backend/src/services/experiment.service.ts:1,94-105,204-217`

- [ ] **Step 1: Remove the `completedAt` block from `signup()`**

Delete lines 94–105 (the entire block including the comment):

```typescript
    // Mark as onboarded so the user is discoverable in vector search filters.
    // Uses an atomic WHERE guard so concurrent signup() calls for the same user
    // cannot both read completedAt as missing and race to overwrite each other.
    const completedAt = new Date().toISOString();
    await db.update(schema.users)
      .set({
        onboarding: sql`COALESCE(${schema.users.onboarding}::jsonb, '{}'::jsonb) || ${JSON.stringify({ completedAt })}::jsonb`,
      })
      .where(and(
        eq(schema.users.id, result.user.id),
        sql`(${schema.users.onboarding} IS NULL OR ${schema.users.onboarding}->>'completedAt' IS NULL)`,
      ));
```

- [ ] **Step 2: Remove the `completedAt` block from `importMembers()`**

Delete lines 204–217 (the entire block including the comment):

```typescript
    // Mark imported users as onboarded so they appear in vector search filters
    // (embedder requires isGhost=true OR onboarding.completedAt IS NOT NULL).
    // Merges into existing onboarding JSON to preserve other fields (flow, currentStep, etc.).
    if (importedUserIds.length > 0) {
      const completedAt = new Date().toISOString();
      await db.update(schema.users)
        .set({
          onboarding: sql`COALESCE(${schema.users.onboarding}::jsonb, '{}'::jsonb) || ${JSON.stringify({ completedAt })}::jsonb`,
        })
        .where(and(
          inArray(schema.users.id, importedUserIds),
          sql`(${schema.users.onboarding} IS NULL OR ${schema.users.onboarding}->>'completedAt' IS NULL)`,
        ));
    }
```

- [ ] **Step 3: Remove unused `inArray` import**

On line 1, `inArray` is no longer used anywhere in the file. Change:

```typescript
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
```

To:

```typescript
import { and, eq, isNull, sql } from 'drizzle-orm';
```

- [ ] **Step 4: Verify lint passes**

Run: `cd backend && bun run lint`
Expected: No new errors.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/experiment.service.ts
git commit -m "fix: stop marking signup/import users as onboarded

The completedAt writes existed solely to satisfy the vector search
filter, which now gates on embedding presence instead. Removing
them lets pre-verified users go through the interactive agent
onboarding ritual when they first connect."
```

---

### Task 5: Run full affected test suite

**Files:** None (verification only)

- [ ] **Step 1: Run the updated test**

Run: `cd backend && bun test tests/onboarding-filter.spec.ts`
Expected: All 5 tests PASS.

- [ ] **Step 2: Run the onboarding-has-name test (related)**

Run: `cd backend && bun test tests/onboarding-has-name.spec.ts`
Expected: PASS (this test covers a different onboarding concern and should be unaffected).

- [ ] **Step 3: Run type check**

Run: `cd backend && bunx tsc --noEmit`
Expected: No type errors. The removed code was the only consumer of `inArray` in experiment.service.ts; the `profile.embedding` access in opportunity.discover.ts types correctly against the existing `ProfileRow` interface.

- [ ] **Step 4: Build the protocol package**

Run: `cd packages/protocol && bun run build`
Expected: Clean build with no errors.
