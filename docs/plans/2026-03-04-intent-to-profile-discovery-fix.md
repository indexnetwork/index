# Intent-to-Profile Discovery Fix — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the existing discovery pipeline so profile-based candidates are no longer suppressed by high thresholds, biased dedup logic, generic HyDE prompts, and insufficient profile-corpus lenses.

**Architecture:** Four targeted changes to the existing pipeline — lower profile similarity threshold, remove intent-over-profile dedup bias, improve profile HyDE prompts, bias LensInferrer toward profile lenses. No new tables, graphs, or queue jobs.

**Tech Stack:** TypeScript, Drizzle ORM (pgvector), LangChain, Zod, bun:test

---

### Task 1: Add `profileMinScore` to Embedder Interface and Adapter

**Files:**
- Modify: `protocol/src/lib/protocol/interfaces/embedder.interface.ts:18-29`
- Modify: `protocol/src/adapters/embedder.adapter.ts:23-29`

**Step 1: Update the interface `HydeSearchOptions` to add `profileMinScore`**

In `protocol/src/lib/protocol/interfaces/embedder.interface.ts`, add `profileMinScore` to `HydeSearchOptions`:

```typescript
export interface HydeSearchOptions {
  indexScope: string[];
  excludeUserId?: string;
  limitPerStrategy?: number;
  limit?: number;
  /** Minimum cosine similarity for intent searches (default 0.40). */
  minScore?: number;
  /** Minimum cosine similarity for profile searches (default 0.25). Lower because profile embeddings are broader. */
  profileMinScore?: number;
}
```

Since `ProfileEmbeddingSearchOptions` is aliased to `HydeSearchOptions`, it inherits the new field automatically.

**Step 2: Update the local `HydeSearchOptions` in the adapter**

In `protocol/src/adapters/embedder.adapter.ts` lines 23-29, add the same field:

```typescript
export interface HydeSearchOptions {
  indexScope: string[];
  excludeUserId?: string;
  limitPerStrategy?: number;
  limit?: number;
  minScore?: number;
  profileMinScore?: number;
}
```

**Step 3: Update `searchWithHydeEmbeddings` to use `profileMinScore` for profiles**

In `protocol/src/adapters/embedder.adapter.ts`, modify `searchWithHydeEmbeddings` (lines 135-173):

```typescript
  async searchWithHydeEmbeddings(
    lensEmbeddings: LensEmbedding[],
    options: HydeSearchOptions
  ): Promise<HydeCandidate[]> {
    const {
      indexScope,
      excludeUserId,
      limitPerStrategy = 40,
      limit = 80,
      minScore = 0.40,
      profileMinScore = 0.25,
    } = options;

    const filter = { indexScope, excludeUserId };

    const searchPromises = lensEmbeddings.map(async (le) => {
      if (!le.embedding?.length) return [];

      if (le.corpus === 'profiles') {
        return this.searchProfilesForHyde(
          le.embedding,
          filter,
          limitPerStrategy,
          profileMinScore,  // <-- use lower threshold for profiles
          le.lens
        );
      }
      return this.searchIntentsForHyde(
        le.embedding,
        filter,
        limitPerStrategy,
        minScore,
        le.lens
      );
    });

    const allResults = await Promise.all(searchPromises);
    const flatResults = allResults.flat();
    return this.mergeAndRankCandidates(flatResults, limit);
  }
```

**Step 4: Update `searchWithProfileEmbedding` to use `profileMinScore` for profiles**

In `protocol/src/adapters/embedder.adapter.ts`, modify `searchWithProfileEmbedding` (lines 175-193):

```typescript
  async searchWithProfileEmbedding(
    profileEmbedding: number[],
    options: ProfileEmbeddingSearchOptions
  ): Promise<HydeCandidate[]> {
    const {
      indexScope,
      excludeUserId,
      limitPerStrategy = 40,
      limit = 80,
      minScore = 0.40,
      profileMinScore = 0.25,
    } = options;
    const filter = { indexScope, excludeUserId };
    const [profileResults, intentResults] = await Promise.all([
      this.searchProfilesByProfileEmbedding(profileEmbedding, filter, limitPerStrategy, profileMinScore),  // <-- lower threshold
      this.searchIntentsByProfileEmbedding(profileEmbedding, filter, limitPerStrategy, minScore),
    ]);
    const flatResults = [...profileResults, ...intentResults];
    return this.mergeAndRankCandidates(flatResults, limit);
  }
```

**Step 5: Run existing tests to verify no regressions**

Run: `cd protocol && bun test src/adapters/tests/embedder.adapter.spec.ts`
Expected: All existing tests pass (defaults are backward-compatible)

**Step 6: Commit**

```bash
git add protocol/src/lib/protocol/interfaces/embedder.interface.ts protocol/src/adapters/embedder.adapter.ts
git commit -m "feat(embedder): add profileMinScore option for lower profile similarity threshold"
```

---

### Task 2: Remove Intent-over-Profile Dedup Bias in Opportunity Graph

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts` (3 locations)

There are 4 dedup blocks in the discovery node. Each uses the key `${userId}:${indexId}` and prefers intent candidates over profile ones. Change all 4 to preserve both.

**Step 1: Fix dedup in `runQueryHydeDiscovery` helper (around line 612)**

Replace the dedup block:

```typescript
// BEFORE (line 612-618):
const byKey = new Map<string, CandidateMatch>();
for (const c of all) {
  const key = `${c.candidateUserId}:${c.indexId}`;
  if (!byKey.has(key) || (byKey.get(key)?.candidateIntentId == null && c.candidateIntentId != null)) {
    byKey.set(key, c);
  }
}
return Array.from(byKey.values());
```

With:

```typescript
// AFTER: Keep both profile and intent candidates for the same user
const byKey = new Map<string, CandidateMatch>();
for (const c of all) {
  const key = `${c.candidateUserId}:${c.indexId}:${c.candidateIntentId ?? 'profile'}`;
  if (!byKey.has(key) || c.similarity > (byKey.get(key)?.similarity ?? 0)) {
    byKey.set(key, c);
  }
}
return Array.from(byKey.values());
```

**Step 2: Fix dedup in intent-path discovery (around line 684)**

Replace:

```typescript
// BEFORE (line 684-690):
const byUserAndIndex = new Map<string, CandidateMatch>();
for (const c of allCandidates) {
  const key = `${c.candidateUserId}:${c.indexId}`;
  if (!byUserAndIndex.has(key) || (byUserAndIndex.get(key)?.candidateIntentId == null && c.candidateIntentId != null)) {
    byUserAndIndex.set(key, c);
  }
}
const candidates = Array.from(byUserAndIndex.values());
```

With:

```typescript
// AFTER: Keep both profile and intent candidates for the same user
const byUserAndIndex = new Map<string, CandidateMatch>();
for (const c of allCandidates) {
  const key = `${c.candidateUserId}:${c.indexId}:${c.candidateIntentId ?? 'profile'}`;
  if (!byUserAndIndex.has(key) || c.similarity > (byUserAndIndex.get(key)?.similarity ?? 0)) {
    byUserAndIndex.set(key, c);
  }
}
const candidates = Array.from(byUserAndIndex.values());
```

**Step 3: Fix dedup in profile-as-source discovery (around line 473)**

Replace:

```typescript
// BEFORE (line 473-479):
const byUserAndIndex = new Map<string, CandidateMatch>();
for (const c of allCandidates) {
  const key = `${c.candidateUserId}:${c.indexId}`;
  if (!byUserAndIndex.has(key) || (byUserAndIndex.get(key)?.candidateIntentId == null && c.candidateIntentId != null)) {
    byUserAndIndex.set(key, c);
  }
}
const candidates = Array.from(byUserAndIndex.values());
```

With:

```typescript
// AFTER: Keep both profile and intent candidates for the same user
const byUserAndIndex = new Map<string, CandidateMatch>();
for (const c of allCandidates) {
  const key = `${c.candidateUserId}:${c.indexId}:${c.candidateIntentId ?? 'profile'}`;
  if (!byUserAndIndex.has(key) || c.similarity > (byUserAndIndex.get(key)?.similarity ?? 0)) {
    byUserAndIndex.set(key, c);
  }
}
const candidates = Array.from(byUserAndIndex.values());
```

**Step 4: Fix merge in profile+HyDE combined path (around line 405)**

The merge at line 405-412 prefers HyDE candidates over profile-embedding candidates. Change to keep both:

```typescript
// BEFORE (line 405-412):
const byKey = new Map<string, CandidateMatch>();
for (const c of queryCandidates) {
  byKey.set(`${c.candidateUserId}:${c.indexId}`, c);
}
for (const c of profileCandidates) {
  const key = `${c.candidateUserId}:${c.indexId}`;
  if (!byKey.has(key)) byKey.set(key, c);
}
const merged = Array.from(byKey.values());
```

With:

```typescript
// AFTER: Keep both HyDE and profile-similarity candidates
const byKey = new Map<string, CandidateMatch>();
for (const c of [...queryCandidates, ...profileCandidates]) {
  const key = `${c.candidateUserId}:${c.indexId}:${c.candidateIntentId ?? 'profile'}:${c.discoverySource ?? 'unknown'}`;
  if (!byKey.has(key) || c.similarity > (byKey.get(key)?.similarity ?? 0)) {
    byKey.set(key, c);
  }
}
const merged = Array.from(byKey.values());
```

**Step 5: Run existing tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`
Expected: All existing tests pass

**Step 6: Commit**

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "fix(opportunity): remove intent-over-profile dedup bias in discovery"
```

---

### Task 3: Improve Profile HyDE Corpus Prompt

**Files:**
- Modify: `protocol/src/lib/protocol/agents/hyde.strategies.ts:19-26`
- Modify: `protocol/src/lib/protocol/agents/tests/hyde.strategies.spec.ts`

**Step 1: Update the test to validate new prompt behavior**

In `protocol/src/lib/protocol/agents/tests/hyde.strategies.spec.ts`, update the profiles test:

```typescript
  it('profiles prompt embeds source text and lens with intent-aware framing', () => {
    const result = HYDE_CORPUS_PROMPTS.profiles('Looking for a React co-founder', 'senior frontend engineer');
    expect(result).toContain('Looking for a React co-founder');
    expect(result).toContain('senior frontend engineer');
    expect(result).toContain('fulfill');  // intent-aware framing
    expect(result.length).toBeGreaterThan(0);
  });
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/lib/protocol/agents/tests/hyde.strategies.spec.ts`
Expected: FAIL — current prompt doesn't contain "fulfill"

**Step 3: Update the profiles corpus prompt**

In `protocol/src/lib/protocol/agents/hyde.strategies.ts`, replace lines 19-26:

```typescript
export const HYDE_CORPUS_PROMPTS: Record<'profiles' | 'intents', (sourceText: string, lens: string) => string> = {
  profiles: (sourceText, lens) => `
    Write a professional biography for someone who could fulfill this need: "${sourceText}".
    Focus on the specific expertise, background, and role described by: ${lens}.

    Write in first person. Include concrete skills, domain experience, and current professional focus that would make them a strong match.
  `,
  intents: (sourceText, lens) => `
    Write a goal or aspiration statement for someone who is: ${lens}.
    This person's needs would complement: "${sourceText}".

    Write in first person as if stating their own goal.
  `,
};
```

**Step 4: Run test to verify it passes**

Run: `cd protocol && bun test src/lib/protocol/agents/tests/hyde.strategies.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/agents/hyde.strategies.ts protocol/src/lib/protocol/agents/tests/hyde.strategies.spec.ts
git commit -m "feat(hyde): improve profile corpus prompt with intent-aware framing"
```

---

### Task 4: Bias LensInferrer Toward Profile Lenses

**Files:**
- Modify: `protocol/src/lib/protocol/agents/lens.inferrer.ts:37-49`

**Step 1: Update the SYSTEM_PROMPT**

In `protocol/src/lib/protocol/agents/lens.inferrer.ts`, replace the `SYSTEM_PROMPT` (lines 37-49):

```typescript
const SYSTEM_PROMPT = `You analyze goals and search queries to identify the most relevant perspectives for finding matching people in a professional network.

For each perspective you identify, specify:
1. A clear, specific description of who or what to search for
2. Whether to search "profiles" (user bios, expertise, backgrounds) or "intents" (stated goals, needs, aspirations)
3. A brief reason why this perspective is relevant

Guidelines:
- Be specific and domain-aware. "early-stage crypto infrastructure investor" is better than "investor".
- Consider both sides: who can help the person AND whose goals complement theirs.
- When user context is provided, tailor perspectives to their domain (e.g. a DePIN founder searching for "investors" needs crypto-native infra investors specifically).
- Generate only perspectives that add distinct search value — don't repeat similar angles.
- Use "profiles" when looking for a type of person (expert, advisor, leader). Use "intents" when looking for a complementary goal or need (someone raising, someone hiring, someone seeking collaboration).
- Always include at least one "profiles" perspective when the source describes a need that a specific type of professional could fulfill. Most intents benefit from profile-based discovery.`;
```

**Step 2: Run existing tests**

Run: `cd protocol && bun test src/lib/protocol/agents/tests/lens.inferrer.spec.ts`
Expected: All existing tests pass (the corpus assignment test already checks for profile lenses)

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/agents/lens.inferrer.ts
git commit -m "feat(lens-inferrer): bias toward generating at least one profile-corpus lens"
```

---

### Task 5: Update Opportunity Graph `minScore` for Intent-Path Profile Searches

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts` (line 657)

The intent-path discovery at line 657 hardcodes `minScore: 0.40` when calling `searchWithHydeEmbeddings`. The adapter now uses `profileMinScore` separately, but this hardcoded 0.40 overrides the default. Remove it so the adapter defaults apply (0.40 for intents, 0.25 for profiles).

**Step 1: Replace the hardcoded `minScore` with the graph's local `minScore` variable**

At line 652-657, the call passes `minScore: 0.40`:

```typescript
// BEFORE:
const results = await this.embedder.searchWithHydeEmbeddings(lensEmbeddings, {
  indexScope: [targetIndex.indexId],
  excludeUserId: state.userId,
  limitPerStrategy,
  limit: perIndexLimit,
  minScore: 0.40,
});
```

Change to use the local `minScore` variable (set to 0.3 at line 334), which is already used in all other search calls:

```typescript
// AFTER:
const results = await this.embedder.searchWithHydeEmbeddings(lensEmbeddings, {
  indexScope: [targetIndex.indexId],
  excludeUserId: state.userId,
  limitPerStrategy,
  limit: perIndexLimit,
  minScore,
});
```

**Step 2: Run tests**

Run: `cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts
git commit -m "fix(opportunity): use consistent minScore for intent-path discovery instead of hardcoded 0.40"
```

---

### Task 6: Final Verification

**Step 1: Run all affected test files**

Run all four test suites:

```bash
cd protocol && bun test src/adapters/tests/embedder.adapter.spec.ts src/lib/protocol/graphs/tests/opportunity.graph.spec.ts src/lib/protocol/agents/tests/hyde.strategies.spec.ts src/lib/protocol/agents/tests/lens.inferrer.spec.ts
```

Expected: All pass

**Step 2: Run lint**

```bash
cd protocol && bun run lint
```

Expected: No new lint errors
