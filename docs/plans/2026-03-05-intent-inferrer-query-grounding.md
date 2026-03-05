# Intent Inferrer Query Grounding Fix

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Ensure the intent inferrer generates intents grounded in the user's query, not derived purely from their profile.

**Architecture:** The fix is in the `ExplicitIntentInferrer` system prompt (`intent.inferrer.ts`). When content is present, the prompt must instruct the LLM that every inferred intent must be directly related to the New Content. The profile is enrichment context only — it can add specificity but must not introduce unrelated intents.

**Tech Stack:** TypeScript, LangChain, Zod, bun:test

**Linear issue:** IND-118

---

### Task 1: Write failing test — sparse query should not produce profile-derived intents

**Files:**
- Modify: `protocol/src/lib/protocol/agents/tests/intent.inferrer.spec.ts`

**Step 1: Write the failing test**

Add a new `describe` block at the end of the test file:

```typescript
describe('ExplicitIntentInferrer - Query Grounding (IND-118)', () => {
  const inferrer = new ExplicitIntentInferrer();

  // Rich profile that could easily dominate a sparse query
  const richProfile = `
# User Profile

## Identity
Name: Alex Chen
Role: Founder & CTO

## Narrative
Building a decentralized discovery protocol using LangGraph and PostgreSQL.
Previously worked on blockchain infrastructure and DeFi protocols.
Interested in expanding the team and securing Series A funding.

## Attributes
Skills: TypeScript, LangGraph, PostgreSQL, Solidity, DeFi
Interests: AI agents, decentralized systems, venture capital
`;

  it('should infer intents related to the query, not unrelated profile goals', async () => {
    const result = await inferrer.invoke(
      'artist',
      richProfile,
      {
        allowProfileFallback: false,
        operationMode: 'create'
      }
    );

    // Should produce at most 1-2 intents, all related to "artist"
    // Should NOT produce intents about "decentralized discovery protocol",
    // "Series A funding", "DeFi", or "blockchain" — those are profile concerns
    for (const intent of result.intents) {
      const desc = intent.description.toLowerCase();
      expect(desc).not.toContain('decentralized');
      expect(desc).not.toContain('series a');
      expect(desc).not.toContain('defi');
      expect(desc).not.toContain('blockchain');
      expect(desc).not.toContain('venture capital');
      expect(desc).not.toContain('funding');
    }
  }, 30000);

  it('should produce intents semantically related to a short query', async () => {
    const result = await inferrer.invoke(
      'looking for a photographer',
      richProfile,
      {
        allowProfileFallback: false,
        operationMode: 'create'
      }
    );

    expect(result.intents.length).toBeGreaterThan(0);
    // At least one intent should reference photography/photographer
    const hasRelevant = result.intents.some(i =>
      /photograph/i.test(i.description)
    );
    expect(hasRelevant).toBe(true);
  }, 30000);
});
```

**Step 2: Run test to verify it fails**

Run: `cd protocol && bun test src/lib/protocol/agents/tests/intent.inferrer.spec.ts`
Expected: The first test likely FAILS — the inferrer currently generates profile-derived intents like "Secure partnerships for a decentralized discovery protocol" when given the sparse input "artist".

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/agents/tests/intent.inferrer.spec.ts
git commit -m "test(intent-inferrer): add query grounding tests for IND-118"
```

---

### Task 2: Fix the system prompt to anchor intents on New Content

**Files:**
- Modify: `protocol/src/lib/protocol/agents/intent.inferrer.ts:57-111` (system prompt)

**Step 1: Verify the system prompt (already implemented)**

Both `CONTENT GROUNDING (CRITICAL)` and `WHEN TO FALLBACK TO PROFILE` sections already exist in `intent.inferrer.ts` (lines 85-91 and 107-119). **Do not add duplicates.**

Verify the existing rules match the intended behavior:
1. Check that `CONTENT GROUNDING (CRITICAL)` block (lines 85-91) contains all six rules including the two examples (artist, photographer).
2. Check that `WHEN TO FALLBACK TO PROFILE` block (lines 107-119) enforces: only for CREATE with no content, never for query, profile as enrichment only.

If the wording needs refinement (e.g., stronger language), update the existing blocks in place — do not insert new ones.

**Step 2: Run the tests**

Run: `cd protocol && bun test src/lib/protocol/agents/tests/intent.inferrer.spec.ts`
Expected: All tests PASS, including the new query grounding tests from Task 1.

**Step 3: Rerun the intent inferrer tests to check for regressions**

Run: `cd protocol && bun test src/lib/protocol/agents/tests/intent.inferrer.spec.ts`
Expected: All existing tests still pass (explicit goals, tombstones, phatic, fallback behavior).

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/agents/intent.inferrer.ts
git commit -m "fix(intent-inferrer): ground inferred intents on query content, not profile

When New Content is present, every inferred intent must be directly related
to it. The user profile serves as enrichment context only — it may add
specificity but must not introduce unrelated intents.

Fixes IND-118"
```

---

### Task 3: Verify end-to-end with the reported scenario

**Step 1: Manual smoke test**

Reproduce the original bug scenario:
1. Start the dev server: `bun run dev` in protocol
2. In chat, send: "I'm looking for artist"
3. Verify: The agent calls `create_opportunities` and returns opportunity cards
4. If the agent also calls `create_intent`, verify the proposed intents are about "artist" — not about the user's profile topics

**Step 2: Commit plan doc**

```bash
git add docs/plans/2026-03-05-intent-inferrer-query-grounding.md
git commit -m "docs: add implementation plan for IND-118 intent inferrer query grounding"
```
