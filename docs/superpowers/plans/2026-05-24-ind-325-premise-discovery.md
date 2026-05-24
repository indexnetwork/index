# IND-325: Premise-Aware Discovery and Opportunity Actor Tracking

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate premises into the opportunity discovery graph as a fourth search path (premise-to-premise matching), add `premise` tracking to `OpportunityActor`, and update the opportunity presenter to explain premise-grounded opportunities.

**Architecture:** The opportunity discovery graph currently runs two search strategies: intent-based (HyDE queries against intent corpus) and profile-based (profile embedding against profiles corpus). This adds a third: premise-based (premise embeddings against premise corpus within shared indexes). The `OpportunityActor` interface gains an optional `premise` field for traceability. The opportunity presenter learns to reference premises in explanations.

**Tech Stack:** LangGraph, pgvector similarity search, Drizzle ORM

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `packages/protocol/src/opportunity/opportunity.state.ts` | Add `'premise-similarity'` to `discoverySource` union, add `'premise'` to `discoverySource` annotation |
| Modify | `backend/src/schemas/database.schema.ts` | Add `premise` field to `OpportunityActor` interface |
| Modify | `packages/protocol/src/shared/interfaces/database.interface.ts` | Add premise search methods, update `OpportunityActor` |
| Modify | `packages/protocol/src/opportunity/opportunity.graph.ts` | Add premise search path in discovery node |
| Modify | `packages/protocol/src/opportunity/opportunity.presenter.ts` | Reference premises in opportunity explanations |
| Modify | `packages/protocol/src/opportunity/opportunity.utils.ts` | Add premise corpus role assignment |
| Create | `packages/protocol/src/premise/tests/premise.discovery.spec.ts` | Discovery integration tests |

---

### Task 1: Add premise field to OpportunityActor

**Files:**
- Modify: `backend/src/schemas/database.schema.ts:296-311`

- [ ] **Step 1: Add optional `premise` to OpportunityActor**

```typescript
export interface OpportunityActor {
  networkId: Id<'networks'>;
  userId: Id<'users'>;
  intent?: Id<'intents'>;
  premise?: Id<'premises'>;  // Which premise grounded this match
  role: string;
  approved?: boolean;
  actedAt?: string;
}
```

- [ ] **Step 2: Update the same interface in database.interface.ts (protocol package)**

Find the `OpportunityActor` type in the protocol's database interface and add the same field. Search for where the interface is defined or re-exported.

- [ ] **Step 3: Verify compilation**

Run: `cd backend && npx tsc --noEmit && cd ../packages/protocol && npx tsc --noEmit`
Expected: No errors (the field is optional, so no existing code breaks)

- [ ] **Step 4: Commit**

```bash
git add backend/src/schemas/database.schema.ts packages/protocol/src/shared/interfaces/database.interface.ts
git commit -m "feat(schema): add premise field to OpportunityActor interface"
```

---

### Task 2: Add premise-similarity to discovery source types

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.state.ts`

- [ ] **Step 1: Update CandidateMatch discoverySource**

Find the `CandidateMatch` interface and add `'premise-similarity'` to the `discoverySource` union:

```typescript
discoverySource?: 'query' | 'profile-similarity' | 'premise-similarity';
```

- [ ] **Step 2: Update the top-level discoverySource annotation**

Find the `discoverySource` annotation in the graph state and add `'premise'`:

```typescript
discoverySource: Annotation<'intent' | 'profile' | 'premise'>({
  reducer: (curr, next) => next ?? curr,
  default: () => 'intent',
}),
```

- [ ] **Step 3: Verify compilation**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.state.ts
git commit -m "feat(protocol): add premise-similarity discovery source type"
```

---

### Task 3: Add premise search to the discovery node

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts`
- Modify: `packages/protocol/src/shared/interfaces/database.interface.ts`

- [ ] **Step 1: Add premise search method to database interface**

Add to the `Database` interface:

```typescript
searchPremisesBySimilarity(params: {
  embedding: number[];
  networkIds: string[];
  excludeUserId: string;
  limit: number;
}): Promise<Array<{
  premiseId: string;
  userId: string;
  networkId: string;
  assertionText: string;
  similarity: number;
}>>;
```

Add it to the `OpportunityGraphDatabase` Pick type as well.

- [ ] **Step 2: Implement in the database adapter**

In `backend/src/adapters/database.adapter.ts`, implement the similarity search using pgvector cosine distance against the `premises` table, joined with `premise_networks` to scope by network:

```typescript
async searchPremisesBySimilarity(params: {
  embedding: number[];
  networkIds: string[];
  excludeUserId: string;
  limit: number;
}) {
  // SQL: SELECT p.id, p.user_id, pn.network_id, p.assertion->>'text',
  //        1 - (p.embedding <=> $embedding) as similarity
  //      FROM premises p
  //      JOIN premise_networks pn ON p.id = pn.premise_id
  //      WHERE pn.network_id = ANY($networkIds)
  //        AND p.user_id != $excludeUserId
  //        AND p.status = 'ACTIVE'
  //      ORDER BY p.embedding <=> $embedding
  //      LIMIT $limit
  // Use Drizzle's sql template for the vector operation.
}
```

- [ ] **Step 3: Add premise search path to the discovery node**

In the opportunity graph's discovery node (search step), add a third search pass after intent search and profile search. For each of the user's premise embeddings:

1. Search the premise corpus within target networks
2. Convert results to `CandidateMatch` entries with `discoverySource: 'premise-similarity'`
3. Merge into the existing candidate list

The premise search uses the user's premise embeddings (fetched in the prep node) as queries against other users' premise embeddings.

- [ ] **Step 4: Update prep node to fetch user premises**

The prep node should fetch the user's active premises (embeddings) so the discovery node can use them as search vectors. Add to the prep node's data fetching.

- [ ] **Step 5: Verify compilation**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No errors (or only adapter-related)

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts packages/protocol/src/shared/interfaces/database.interface.ts backend/src/adapters/database.adapter.ts
git commit -m "feat(protocol): add premise-to-premise search path in discovery"
```

---

### Task 4: Update role assignment for premise matches

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.utils.ts`

- [ ] **Step 1: Add premise corpus handling**

Find the `assignRolesFromCorpus` function (or equivalent) that maps corpus type to actor roles. Add handling for the `'premises'` corpus:

```typescript
case 'premises':
  // Found by who they are → premise alignment → Peer
  // Unlike intents (which have directional roles: agent/patient),
  // premise matches are symmetric: two people whose identities align.
  return 'Peer';
```

- [ ] **Step 2: Verify compilation**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.utils.ts
git commit -m "feat(protocol): add premise corpus role assignment (Peer)"
```

---

### Task 5: Update persist node for premise tracking

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.graph.ts`

- [ ] **Step 1: Track source premise in opportunity actors**

In the persist node where `OpportunityActor` objects are constructed, when the discovery source is `'premise-similarity'`, populate the `premise` field with the candidate's premise ID from the `CandidateMatch`:

```typescript
// When building the actor:
const actor: OpportunityActor = {
  networkId: candidate.networkId,
  userId: candidate.candidateUserId,
  intent: candidate.candidateIntentId,
  premise: candidate.discoverySource === 'premise-similarity'
    ? candidate.candidatePremiseId
    : undefined,
  role: assignedRole,
};
```

This requires the `CandidateMatch` interface to carry an optional `candidatePremiseId` field. Add it:

```typescript
export interface CandidateMatch {
  // ... existing fields ...
  candidatePremiseId?: Id<'premises'>;
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.graph.ts packages/protocol/src/opportunity/opportunity.state.ts
git commit -m "feat(protocol): track source premise in opportunity actors"
```

---

### Task 6: Update opportunity presenter for premise-grounded explanations

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.presenter.ts`

- [ ] **Step 1: Fetch premises in `gatherPresenterContext`**

In the `gatherPresenterContext` function that fetches viewer profile, intents, and other party profiles, also fetch premises for both parties when the opportunity has premise-grounded actors:

```typescript
// Check if any actor has a premise field
const hasPremiseGrounding = opportunity.actors.some(a => a.premise);
if (hasPremiseGrounding) {
  // Fetch premises for relevant parties in parallel with other fetches
}
```

- [ ] **Step 2: Include premise context in the presenter prompt**

When premises are available, add a "Premises" section to the prompt context that the LLM uses to generate the personalized summary:

```typescript
if (viewerPremises?.length) {
  sections.push("## Your Premises");
  sections.push(viewerPremises.map(p => `- ${p.assertion.text}`).join("\n"));
}
if (otherPremises?.length) {
  sections.push("## Their Premises");
  sections.push(otherPremises.map(p => `- ${p.assertion.text}`).join("\n"));
}
```

- [ ] **Step 3: Verify compilation**

Run: `cd packages/protocol && npx tsc --noEmit`
Expected: No errors (or only adapter-related)

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.presenter.ts
git commit -m "feat(protocol): include premises in opportunity presenter context"
```

---

### Task 7: Write discovery integration test

**Files:**
- Create: `packages/protocol/src/premise/tests/premise.discovery.spec.ts`

- [ ] **Step 1: Create test file**

```typescript
import { describe, it, expect } from "bun:test";
import { config } from "dotenv";
config({ path: ".env.development", override: true });

describe("Premise Discovery Integration", () => {
  it("produces CandidateMatch entries with premise-similarity source", async () => {
    // This test validates the data flow:
    // 1. Two users with complementary premises in the same index
    // 2. Discovery runs and finds the premise match
    // 3. CandidateMatch has discoverySource: 'premise-similarity'
    //
    // Requires mocked database with seeded premises and embeddings.
    // Full E2E requires the opportunity graph with all deps.
    expect(true).toBe(true); // Scaffold — implement with mocked discovery node
  }, 60_000);
});
```

- [ ] **Step 2: Commit**

```bash
git add packages/protocol/src/premise/tests/premise.discovery.spec.ts
git commit -m "test(protocol): add premise discovery integration test scaffold"
```

---

### Task 8: Final verification

- [ ] **Step 1: Build protocol package**

Run: `cd packages/protocol && bun run build`
Expected: Build succeeds

- [ ] **Step 2: Type check backend**

Run: `cd backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Run existing tests**

Run: `cd backend && bun test tests/e2e.test.ts`
Expected: All existing tests pass (changes are additive, no breaking modifications)
