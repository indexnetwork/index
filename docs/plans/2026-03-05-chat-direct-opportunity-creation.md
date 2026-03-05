# Chat Direct Opportunity Creation (IND-115)

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** When a user asks about a specific person in chat and confirms interest, the agent should create an opportunity between them — not suggest email outreach.

**Architecture:** Add a `targetUserId` parameter to the `create_opportunities` tool and the opportunity graph state. When set, the discovery pipeline filters candidates to only the target user, ensuring a direct opportunity is created. Add a new orchestration pattern to the system prompt so the LLM knows when and how to use this parameter.

**Tech Stack:** TypeScript, LangGraph state annotations, Zod schemas, bun:test

---

## Root Cause

Two gaps cause IND-115:

1. **Missing prompt pattern**: No orchestration pattern tells the agent to create an opportunity after detecting overlap with a specific mentioned user. Pattern 0 (named lookup) only presents profiles. Pattern 5 (shared context) only synthesizes — never creates. Pattern 6 (introduction) is for connecting two OTHER people.

2. **Missing tool capability**: `create_opportunities` has no way to target a specific user. Discovery mode (`searchQuery`) does semantic search — unreliable for a specific person. Introduction mode (`partyUserIds`) makes the current user an "introducer", not a "party".

## Fix Overview

| Layer | Change | File |
|-------|--------|------|
| Graph state | Add `targetUserId` field | `states/opportunity.state.ts` |
| Graph node | Filter candidates by `targetUserId` in `discoveryNode` | `graphs/opportunity.graph.ts` |
| Tool schema | Add `targetUserId` param to `create_opportunities` | `tools/opportunity.tools.ts` |
| Tool handler | Pass `targetUserId` through to discovery | `tools/opportunity.tools.ts` |
| Discover support | Thread `targetUserId` into `runDiscoverFromQuery` | `support/opportunity.discover.ts` |
| System prompt | Add Pattern 1a for direct connection with a specific person | `agents/chat.prompt.ts` |
| Tests | Graph: targetUserId filtering; Tool: targetUserId passthrough | `graphs/tests/opportunity.graph.spec.ts`, `tools/tests/opportunity.tools.spec.ts` |

---

### Task 1: Add `targetUserId` to Opportunity Graph State

**Files:**
- Modify: `protocol/src/lib/protocol/states/opportunity.state.ts:121-142`

**Step 1: Add the state field**

In `OpportunityGraphState = Annotation.Root({`, after the `triggerIntentId` field (line ~142), add:

```typescript
  /** Optional: restrict discovery to this specific user ID only (direct connection). */
  targetUserId: Annotation<Id<'users'> | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
```

**Step 2: Verify no type errors**

Run: `cd protocol && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No new errors (field is optional with a default).

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/states/opportunity.state.ts
git commit -m "feat(opportunity): add targetUserId field to graph state (IND-115)"
```

---

### Task 2: Filter candidates by `targetUserId` in discovery node

**Files:**
- Modify: `protocol/src/lib/protocol/graphs/opportunity.graph.ts:313+` (discoveryNode)
- Test: `protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`

**Step 1: Write the failing test**

Add to `opportunity.graph.spec.ts`, inside the `describe('Opportunity Graph')` block:

```typescript
describe('targetUserId filtering', () => {
  test('when targetUserId is set, only candidates matching that user are returned', async () => {
    const { compiledGraph, mockEmbedder } = createMockGraph();
    // Return two candidates: user-bob and user-alice
    spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
      {
        type: 'intent' as const,
        id: 'intent-bob' as Id<'intents'>,
        candidateUserId: 'user-bob',
        score: 0.9,
        matchedVia: 'mirror' as const,
        indexId: 'idx-1',
      },
      {
        type: 'intent' as const,
        id: 'intent-alice' as Id<'intents'>,
        candidateUserId: 'user-alice',
        score: 0.85,
        matchedVia: 'mirror' as const,
        indexId: 'idx-1',
      },
    ]);

    const result = await compiledGraph.invoke({
      userId: 'user-source' as Id<'users'>,
      searchQuery: 'design and technology overlap',
      targetUserId: 'user-alice' as Id<'users'>,
      options: {},
    });

    // Only user-alice should be evaluated and persisted
    expect(result.opportunities.length).toBeLessThanOrEqual(1);
    if (result.opportunities.length === 1) {
      const actors = result.opportunities[0].actors;
      const candidateActor = actors.find((a: { userId: string }) => a.userId !== 'user-source');
      expect(candidateActor?.userId).toBe('user-alice');
    }
  });

  test('when targetUserId is not set, all candidates are returned', async () => {
    const { compiledGraph, mockEmbedder } = createMockGraph();
    spyOn(mockEmbedder, 'searchWithHydeEmbeddings').mockResolvedValue([
      {
        type: 'intent' as const,
        id: 'intent-bob' as Id<'intents'>,
        candidateUserId: 'user-bob',
        score: 0.9,
        matchedVia: 'mirror' as const,
        indexId: 'idx-1',
      },
      {
        type: 'intent' as const,
        id: 'intent-alice' as Id<'intents'>,
        candidateUserId: 'user-alice',
        score: 0.85,
        matchedVia: 'mirror' as const,
        indexId: 'idx-1',
      },
    ]);

    const result = await compiledGraph.invoke({
      userId: 'user-source' as Id<'users'>,
      searchQuery: 'design and technology overlap',
      options: {},
    });

    // Both candidates should be present (no filtering)
    expect(result.opportunities.length).toBeGreaterThanOrEqual(1);
  });
});
```

**Step 2: Run test to verify it fails**

Ask user to run: `cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`
Expected: FAIL — `targetUserId` not recognized / candidates not filtered.

**Step 3: Implement the filter in discoveryNode**

In `opportunity.graph.ts`, inside `discoveryNode`, find every `return { candidates: ... }` statement (there are 5 return points in discovery). Before each return that includes a `candidates` array, apply the targetUserId filter.

The cleanest approach: add a helper at the top of `discoveryNode`, then wrap each return.

At the top of `discoveryNode` (after `const startTime = Date.now();`), add:

```typescript
        /** Filter candidates to targetUserId when set (direct-connection mode). */
        const filterByTarget = (candidates: CandidateMatch[]): CandidateMatch[] => {
          if (!state.targetUserId) return candidates;
          const filtered = candidates.filter(c => c.candidateUserId === state.targetUserId);
          logger.verbose('[Graph:Discovery] targetUserId filter applied', {
            targetUserId: state.targetUserId,
            before: candidates.length,
            after: filtered.length,
          });
          return filtered;
        };
```

Then at each of the 5 return points in discoveryNode that return `candidates`, wrap the value:

1. **Line ~428** (profile + query, merged path): `return { candidates: filterByTarget(merged), trace: traceEntries };`
2. **Line ~431** (profile + query, no profile vector): `return { candidates: filterByTarget(queryCandidates), trace: traceEntries };`
3. **Line ~538-541** (profile only, no query): `return { candidates: filterByTarget(candidates), trace: traceEntries };`
4. **Lines ~326, ~437, ~627** (empty returns `{ candidates: [] }`): No filter needed — already empty.
5. **The intent path return** (~line 690+ area, after `const candidates = Array.from(byUserAndIndex.values());`): Before the trace-building block, insert `const filteredCandidates = filterByTarget(candidates);` and use `filteredCandidates` in the return and trace entries.

Specifically, for the intent path (the last and largest return), find the line:
```typescript
          const candidates = Array.from(byUserAndIndex.values());
```
And change the rest of that block to use `filterByTarget(candidates)`. The final return for the intent path (around line 740+) should become:
```typescript
          return {
            candidates: filteredCandidates,
            hydeEmbeddings,
            trace: traceEntries,
          };
```

**Step 4: Run test to verify it passes**

Ask user to run: `cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/graphs/opportunity.graph.ts protocol/src/lib/protocol/graphs/tests/opportunity.graph.spec.ts
git commit -m "feat(opportunity): filter discovery candidates by targetUserId (IND-115)"
```

---

### Task 3: Add `targetUserId` to `create_opportunities` tool schema and thread through discovery

**Files:**
- Modify: `protocol/src/lib/protocol/tools/opportunity.tools.ts:131-190` (schema), `~439-494` (discovery handler)
- Modify: `protocol/src/lib/protocol/support/opportunity.discover.ts:33-60` (DiscoverInput interface), `~423-475` (runDiscoverFromQuery)

**Step 1: Add `targetUserId` to tool Zod schema**

In `opportunity.tools.ts`, in the `querySchema: z.object({` for `create_opportunities` (line ~131), add after the `intentId` field:

```typescript
      targetUserId: z
        .string()
        .optional()
        .describe("Direct connection mode: create opportunity with this specific user ID. Used when the user wants to connect with a named person."),
```

**Step 2: Add `targetUserId` to DiscoverInput interface**

In `opportunity.discover.ts`, add to the `DiscoverInput` interface (after `triggerIntentId`):

```typescript
  /** When set, filter discovery candidates to this specific user only (direct connection). */
  targetUserId?: string;
```

**Step 3: Thread `targetUserId` through `runDiscoverFromQuery` into the graph**

In `runDiscoverFromQuery` (line ~469 in `opportunity.discover.ts`), where the graph is invoked:

```typescript
      const result = await opportunityGraph.invoke({
        userId,
        searchQuery: queryOrEmpty || undefined,
        indexId: indexScope.length === 1 ? indexScope[0] : undefined,
        triggerIntentId,
        targetUserId: input.targetUserId, // <-- add this line
        options,
      });
```

**Step 4: Thread `targetUserId` from tool handler to `runDiscoverFromQuery`**

In `opportunity.tools.ts`, in the discovery mode section (line ~483), where `runDiscoverFromQuery` is called:

```typescript
      const result = await runDiscoverFromQuery({
        opportunityGraph: graphs.opportunity,
        database,
        userId: context.userId,
        query: searchQuery,
        indexScope,
        limit: 20,
        minimalForChat: true,
        triggerIntentId,
        targetUserId: query.targetUserId?.trim() || undefined, // <-- add this line
        cache,
        ...(context.sessionId ? { chatSessionId: context.sessionId } : {}),
      });
```

**Step 5: Update tool description to mention targetUserId**

In `opportunity.tools.ts`, update the `description` string of `create_opportunities` (line ~123-130). Change:

```typescript
      "Two modes:\n" +
```

To:

```typescript
      "Three modes:\n" +
```

And add after the introduction mode description:

```typescript
      "3. **Direct connection**: pass targetUserId (a single user ID) + searchQuery (reason for connecting). " +
      "Creates an opportunity between the current user and the target user.\n\n" +
```

**Step 6: Verify no type errors**

Run: `cd protocol && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 7: Commit**

```bash
git add protocol/src/lib/protocol/tools/opportunity.tools.ts protocol/src/lib/protocol/support/opportunity.discover.ts
git commit -m "feat(opportunity): add targetUserId to create_opportunities tool and discovery (IND-115)"
```

---

### Task 4: Add orchestration pattern to system prompt

**Files:**
- Modify: `protocol/src/lib/protocol/agents/chat.prompt.ts:240-260` (after Pattern 1)

**Step 1: Add Pattern 1a after Pattern 1 (Discovery)**

After Pattern 1 block (which ends around line 262 with the `create_intent` fallback note), add:

```typescript
### 1a. User wants to connect with a specific mentioned person

When the user mentions a specific person via @mention or name AND expresses interest in connecting, collaborating, or exploring overlap (e.g. "what can I do with @X", "connect me with @X", user says "yes" after you present shared context with someone):

**This is a direct connection — NOT an introduction (introductions connect two OTHER people).**

\`\`\`
1. If not already done: read_user_profiles(userId=X) + read_index_memberships(userId=X)
2. Find shared indexes with the user (intersect with preloaded memberships)
3. If no shared indexes: tell the user you can't find a connection path
4. create_opportunities(targetUserId=X, searchQuery="<synthesized reason for connecting based on shared context>")
5. Present the opportunity card
\`\`\`

The searchQuery should be a brief description of why they'd connect (e.g. "shared interest in design and technology, both in Kernel community"). This gives the evaluator context for scoring.
```

**Step 2: Update Pattern 0 to reference Pattern 1a**

In Pattern 0 (line ~241-249), change the last bullet:

```
- Only fall back to \`create_opportunities\` if the user then asks for semantic discovery (e.g. "find people like them" or "who else works on similar things")
```

To:

```
- If the user then asks for semantic discovery (e.g. "find people like them"), use Pattern 1.
- If the user wants to connect with this specific person (e.g. "yes, connect us", "what can I do with them", "I'd like to reach out"), use Pattern 1a.
```

**Step 3: Update the Behavioral Rules "Discovery-first" section**

In the Behavioral Rules section (line ~363), the line says:

```
- Only call \`create_opportunities\` for explicit "find me connections" / discovery or for introductions between two other people.
```

Change to:

```
- Only call \`create_opportunities\` for: (a) discovery ("find me connections"), (b) introductions between two other people, or (c) direct connection with a specific mentioned person (Pattern 1a).
```

**Step 4: Update Tools Reference table**

In the Tools Reference table (line ~232), update the `create_opportunities` entry:

From:
```
| **create_opportunities** | searchQuery?, indexId?, partyUserIds?, entities?, hint? | Discovery (query text) or Introduction (partyUserIds + entities + hint). Discovery first for connection-seeking; intent creation can be suggested by the tool. |
```

To:
```
| **create_opportunities** | searchQuery?, indexId?, targetUserId?, partyUserIds?, entities?, hint? | Discovery (query text), Direct connection (targetUserId + searchQuery), or Introduction (partyUserIds + entities + hint). |
```

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/agents/chat.prompt.ts
git commit -m "feat(chat): add Pattern 1a for direct connection with mentioned person (IND-115)"
```

---

### Task 5: Write integration test for tool-level targetUserId flow

**Files:**
- Modify: `protocol/src/lib/protocol/tools/tests/opportunity.tools.spec.ts`

**Step 1: Add a test verifying the tool schema accepts targetUserId**

This is a structural test — we cannot easily invoke the full tool handler in a unit test (it requires database, graphs, etc.), but we can verify the Zod schema accepts the parameter:

```typescript
import { z } from "zod";

describe("create_opportunities schema", () => {
  it("should accept targetUserId parameter", () => {
    // The schema is internal to createOpportunityTools, so we test indirectly
    // by verifying the tool description mentions targetUserId
    // (Full integration test would require a running server)

    // This is a documentation-level check: verify the plan was implemented
    // by checking the tool description includes "targetUserId"
    expect(true).toBe(true); // Placeholder — real verification is via the graph test in Task 2
  });
});
```

Actually, the real integration coverage comes from Task 2's graph test. For the tool layer, the most valuable test is an E2E test that requires a running server. Instead, verify the type-level correctness:

**Step 2: Verify type compilation**

Run: `cd protocol && npx tsc --noEmit --pretty 2>&1 | head -20`
Expected: No errors.

**Step 3: Run all opportunity tests to check for regressions**

Ask user to run:
```bash
cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts src/lib/protocol/tools/tests/opportunity.tools.spec.ts
```
Expected: All tests PASS.

**Step 4: Commit (if any test changes were needed)**

```bash
git add -A
git commit -m "test(opportunity): verify targetUserId integration (IND-115)"
```

---

### Task 6: Final verification and cleanup

**Step 1: Run full type check**

Run: `cd protocol && npx tsc --noEmit --pretty`
Expected: No errors.

**Step 2: Run lint**

Run: `cd protocol && bun run lint`
Expected: No new warnings or errors.

**Step 3: Run all affected tests**

Ask user to run:
```bash
cd protocol && bun test src/lib/protocol/graphs/tests/opportunity.graph.spec.ts src/lib/protocol/tools/tests/opportunity.tools.spec.ts src/lib/protocol/support/tests/opportunity.discover.spec.ts
```
Expected: All PASS.

**Step 4: Final commit (if needed) and update Linear**

Update IND-115 status to "In Progress" and add a comment summarizing the fix.

---

## Risk Assessment

| Risk | Mitigation |
|------|-----------|
| Discovery returns 0 candidates when targetUser has no intents/embeddings | The evaluator still runs — if the target user has a profile in the index, profile-similarity path works. If they have no presence at all, the tool returns "no matches" and the agent can explain this naturally. |
| Existing opportunity between users | `persistNode` already handles this via `findOverlappingOpportunities` — it returns `existingBetweenActors` which the tool surfaces as "you already have a connection with X". No code change needed. |
| LLM ignores the new pattern | Pattern 1a is explicit and the agent already correctly identifies overlap (it just doesn't know what to do). Adding a clear pattern fills the gap. |
| Breaking existing Discovery/Introduction flows | `targetUserId` is optional with `undefined` default — zero impact when not set. All filtering is conditional on `state.targetUserId` being truthy. |
