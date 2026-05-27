# Per-Person Opportunity Dedup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace per-person grouping in the presentation layer with per-person deduplication in the selection layer, so only the single most relevant opportunity per counterpart reaches the LLM.

**Architecture:** Add a `deduplicateByPerson` function in `opportunity.utils.ts` that runs on raw opportunities before `selectByComposition`. Revert the grouping logic in `buildOpportunityPresentation` to the original flat rendering. Revert prompt/exemplar additions.

**Tech Stack:** TypeScript, Bun test runner

---

### File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/protocol/src/opportunity/opportunity.utils.ts` | Modify | Add `deduplicateByPerson` function |
| `packages/protocol/src/opportunity/opportunity.tools.ts` | Modify | Wire dedup call site, revert grouping in `buildOpportunityPresentation` |
| `packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts` | Modify | Replace grouping tests with dedup tests |
| `packages/agentvillage/skills/index-network/prompts/digest.md` | Modify | Revert grouped-entry additions |
| `packages/agentvillage/skills/index-network/prompts/ambient.md` | Modify | Revert grouped-entry additions |
| `packages/agentvillage/skills/index-network/exemplars.md` | Modify | Remove grouped exemplar sections |
| `packages/protocol/package.json` | Modify | Bump version 1.17.0 → 1.18.0 |

---

### Task 1: Write `deduplicateByPerson` tests

**Files:**
- Modify: `packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts`

- [ ] **Step 1: Add the import and test describe block**

At the top of the file, add `deduplicateByPerson` to the import from `opportunity.utils.js` (after line 5):

```typescript
import { deduplicateByPerson } from "../opportunity.utils.js";
```

Then at the end of the file (after the last `describe` block), add:

```typescript
// ---------------------------------------------------------------------------
// deduplicateByPerson — per-person dedup in the selection layer
// ---------------------------------------------------------------------------

describe("deduplicateByPerson", () => {
  function makeOpp(id: string, counterpartId: string, viewerId: string, confidence?: number) {
    return {
      id,
      status: "pending",
      actors: [
        { userId: viewerId, role: "party" },
        { userId: counterpartId, role: "party" },
      ],
      interpretation: confidence != null ? { confidence } : null,
    };
  }

  const VIEWER = "viewer-1";

  it("keeps only the highest-confidence opportunity per counterpart", () => {
    const opps = [
      makeOpp("opp-low", "ashish", VIEWER, 0.6),
      makeOpp("opp-high", "ashish", VIEWER, 0.9),
      makeOpp("opp-mid", "ashish", VIEWER, 0.75),
    ];
    const result = deduplicateByPerson(opps, VIEWER);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("opp-high");
  });

  it("passes through single-opportunity counterparts unchanged", () => {
    const opps = [
      makeOpp("opp-a", "alice", VIEWER, 0.8),
      makeOpp("opp-b", "bob", VIEWER, 0.7),
    ];
    const result = deduplicateByPerson(opps, VIEWER);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("opp-a");
    expect(result[1].id).toBe("opp-b");
  });

  it("deduplicates per person while preserving different counterparts", () => {
    const opps = [
      makeOpp("opp-a1", "ashish", VIEWER, 0.6),
      makeOpp("opp-m1", "maya", VIEWER, 0.8),
      makeOpp("opp-a2", "ashish", VIEWER, 0.9),
    ];
    const result = deduplicateByPerson(opps, VIEWER);
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.id)).toEqual(["opp-m1", "opp-a2"]);
  });

  it("prefers the opportunity with a score over one without", () => {
    const opps = [
      makeOpp("opp-no-score", "ashish", VIEWER),       // interpretation: null
      makeOpp("opp-has-score", "ashish", VIEWER, 0.5),
    ];
    const result = deduplicateByPerson(opps, VIEWER);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("opp-has-score");
  });

  it("on equal confidence, keeps the first encountered (stable)", () => {
    const opps = [
      makeOpp("opp-first", "ashish", VIEWER, 0.8),
      makeOpp("opp-second", "ashish", VIEWER, 0.8),
    ];
    const result = deduplicateByPerson(opps, VIEWER);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("opp-first");
  });

  it("passes through opportunities with no derivable counterpart", () => {
    const oppNoCounterpart = {
      id: "opp-edge",
      status: "latent",
      actors: [
        { userId: VIEWER, role: "introducer" },
        { userId: "intro-target", role: "introducer" },
      ],
      interpretation: { confidence: 0.7 },
    };
    const opps = [oppNoCounterpart, makeOpp("opp-normal", "bob", VIEWER, 0.8)];
    const result = deduplicateByPerson(opps, VIEWER);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("opp-edge");
    expect(result[1].id).toBe("opp-normal");
  });

  it("preserves original input order among winners", () => {
    const opps = [
      makeOpp("opp-c1", "charlie", VIEWER, 0.5),
      makeOpp("opp-a1", "ashish", VIEWER, 0.6),
      makeOpp("opp-b1", "bob", VIEWER, 0.7),
      makeOpp("opp-a2", "ashish", VIEWER, 0.9),
    ];
    const result = deduplicateByPerson(opps, VIEWER);
    // charlie(opp-c1), ashish(opp-a2 wins but appeared after bob), bob(opp-b1)
    // Winners ordered by the index of the winner in the original array:
    // opp-c1 at index 0, opp-b1 at index 2, opp-a2 at index 3
    expect(result.map((o) => o.id)).toEqual(["opp-c1", "opp-b1", "opp-a2"]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd packages/protocol && bun test src/opportunity/tests/opportunity.tools.spec.ts
```

Expected: FAIL — `deduplicateByPerson` is not exported from `opportunity.utils.js` yet.

- [ ] **Step 3: Commit the failing tests**

```bash
git add packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts
git commit -m "test: add failing tests for deduplicateByPerson"
```

---

### Task 2: Implement `deduplicateByPerson`

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.utils.ts`

- [ ] **Step 1: Add the function at the end of the file (before the closing of the module)**

Append to `packages/protocol/src/opportunity/opportunity.utils.ts`, after `selectByComposition`:

```typescript
/**
 * Deduplicate opportunities so each counterpart appears at most once.
 * Keeps the opportunity with the highest interpretation.confidence per
 * counterpart userId. On ties, the first encountered wins (stable).
 *
 * Counterpart = first actor whose userId !== viewerId and role !== 'introducer'.
 * Opportunities without a derivable counterpart pass through undeduped.
 *
 * @param opportunities - Pre-sorted opportunities (e.g. by confidence/recency)
 * @param viewerId - The viewing user's ID
 * @returns Deduped subset preserving original input order among winners
 */
export function deduplicateByPerson<T extends {
  actors: Array<{ userId: string; role: string }>;
  interpretation?: { confidence?: number } | null;
}>(opportunities: T[], viewerId: string): T[] {
  const bestByCounterpart = new Map<string, { opp: T; index: number }>();
  const noCounterpart: Array<{ opp: T; index: number }> = [];

  for (let i = 0; i < opportunities.length; i++) {
    const opp = opportunities[i];
    const counterpart = opp.actors.find(
      (a) => a.userId !== viewerId && a.role !== 'introducer',
    );

    if (!counterpart) {
      noCounterpart.push({ opp, index: i });
      continue;
    }

    const key = counterpart.userId;
    const existing = bestByCounterpart.get(key);

    if (!existing) {
      bestByCounterpart.set(key, { opp, index: i });
      continue;
    }

    const newConf = opp.interpretation?.confidence ?? -1;
    const oldConf = existing.opp.interpretation?.confidence ?? -1;
    if (newConf > oldConf) {
      bestByCounterpart.set(key, { opp, index: i });
    }
    // On tie (newConf === oldConf), keep existing (first encountered)
  }

  // Merge winners + no-counterpart entries, sorted by original index
  const all = [...bestByCounterpart.values(), ...noCounterpart];
  all.sort((a, b) => a.index - b.index);

  const result = all.map((entry) => entry.opp);
  if (result.length < opportunities.length) {
    logger.info(
      `[deduplicateByPerson] deduped ${opportunities.length} → ${result.length} opportunities`,
    );
  }
  return result;
}
```

- [ ] **Step 2: Run the tests to verify they pass**

```bash
cd packages/protocol && bun test src/opportunity/tests/opportunity.tools.spec.ts
```

Expected: All `deduplicateByPerson` tests PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.utils.ts
git commit -m "feat: add deduplicateByPerson to selection layer"
```

---

### Task 3: Wire dedup into `list_opportunities` and revert grouping

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.tools.ts`

- [ ] **Step 1: Add the import**

At the top of `opportunity.tools.ts`, find the import from `./opportunity.utils.js` and add `deduplicateByPerson`:

```typescript
import { selectByComposition, deduplicateByPerson } from "./opportunity.utils.js";
```

(The exact existing import may vary — just add `deduplicateByPerson` to whatever is already imported from that module.)

- [ ] **Step 2: Wire dedup into the list_opportunities handler**

In the `list_opportunities` handler, find this block (around line 1365):

```typescript
      // Compose-balance across feed categories so the digest/ambient prompt
      // can fill both Section A (connection) and Section B (connector-flow).
      // Falls back to the unbalanced view when the helper has nothing to do.
      const opportunities = visible.length > 0
        ? selectByComposition(visible, context.userId)
        : visible;
```

Replace with:

```typescript
      // Per-person dedup: when discovery created multiple opportunities for
      // the same counterpart across different runs, keep only the highest-
      // confidence one so each person appears at most once in the feed.
      const deduped = deduplicateByPerson(visible, context.userId);

      // Compose-balance across feed categories so the digest/ambient prompt
      // can fill both Section A (connection) and Section B (connector-flow).
      // Falls back to the unbalanced view when the helper has nothing to do.
      const opportunities = deduped.length > 0
        ? selectByComposition(deduped, context.userId)
        : deduped;
```

- [ ] **Step 3: Revert `buildOpportunityPresentation` MCP branch to original flat rendering**

Replace the entire MCP branch of `buildOpportunityPresentation` (the `if (opts.isMcp) { ... }` block, from the grouping logic through the return statement) with the original flat rendering:

```typescript
  if (opts.isMcp) {
    const prose = cards
      .map((card, i) => {
        const lines: string[] = [`${i + 1}. ${card.name ?? "Unknown"}`];
        if (card.mainText) lines.push(`   ${card.mainText}`);
        if (card.status) lines.push(`   status: ${card.status}`);
        if (card.profileUrl) lines.push(`   profileUrl: ${card.profileUrl}`);
        if (card.acceptUrl) lines.push(`   acceptUrl: ${card.acceptUrl}`);
        if (card.feedCategory) lines.push(`   feedCategory: ${card.feedCategory}`);
        // Only surface opportunityId when there's no acceptUrl. Exposing the
        // UUID alongside an actionable link gives the LLM a foothold to
        // hallucinate bare `/api/opportunities/<id>/connect` URLs.
        if (!card.acceptUrl) {
          lines.push(`   opportunityId: ${card.opportunityId}`);
        }
        return lines.join("\n");
      })
      .join("\n\n");
    const hasLinks = cards.some((c) => c.acceptUrl);
    const hasOpportunityIds = cards.some((c) => !c.acceptUrl);
    const linkInstructions = hasLinks
      ? `For each card that has an acceptUrl, embed it on a short verb phrase (e.g. "message [Name]" for connection, "make intro" for connector-flow). For each card that has a profileUrl, link the person's name to it. Some cards may have neither — render those as plain text and never fabricate URLs for them. The acceptUrl is opaque and self-contained — embed it verbatim. Do NOT append, encode, or modify any part of any URL. Never render link strips or tables — weave URLs into prose. `
      : "";
    const idInstructions = hasOpportunityIds
      ? `Use opportunityId values only when calling update_opportunity (send/accept/reject).`
      : "";
    return (
      `${opts.leadIn}\n\n${prose}\n\n` +
      `Summarize these for the user in natural prose — mention first names and a brief match reason per connection. ` +
      `${linkInstructions}` +
      `Do NOT print raw JSON, field labels, opportunityIds, or confidence scores. ` +
      `${idInstructions}`
    );
  }
```

This is the exact code from before the grouping change (commit `9348259a3`). Note: keep `userId` on `OpportunityCardLike` — it's still populated by card building and useful for other consumers.

- [ ] **Step 4: Delete the grouping test block**

In `opportunity.tools.spec.ts`, delete the entire `describe("buildOpportunityPresentation — per-person grouping (MCP)")` block (lines 655–882 approximately). This includes all 6 grouping tests.

- [ ] **Step 5: Run tests**

```bash
cd packages/protocol && bun test src/opportunity/tests/opportunity.tools.spec.ts
```

Expected: All tests PASS. The existing `buildOpportunityPresentation` tests (MCP opportunityId omission) still pass with the flat rendering. The new `deduplicateByPerson` tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.tools.ts packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts
git commit -m "feat: wire deduplicateByPerson into list_opportunities, revert grouping"
```

---

### Task 4: Revert prompt and exemplar changes

**Files:**
- Modify: `packages/agentvillage/skills/index-network/prompts/digest.md`
- Modify: `packages/agentvillage/skills/index-network/prompts/ambient.md`
- Modify: `packages/agentvillage/skills/index-network/exemplars.md`

- [ ] **Step 1: Revert digest.md**

In `packages/agentvillage/skills/index-network/prompts/digest.md`:

**Step 6 header** — replace:
```
   **{N} conversations await you** ← only if there are direct (connection) candidates — receiver is a party, NOT the introducer. N = unique people, not raw opportunity count.
```
with:
```
   **{N} conversations await you** ← only if there are direct (connection) candidates — receiver is a party, NOT the introducer
```

**Step 6 grouped bullet** — delete this entire line:
```
   - [Name](profileUrl) — When multiple connections exist for the same person (grouped entry from the tool), weave each acceptUrl into the description as a hyperlink on the relevant topic phrase. Example: "An experienced technologist spanning [generative software](acceptUrl1), [AI infrastructure](acceptUrl2), and [deep learning research](acceptUrl3) — several angles worth exploring."
```

**Step 9** — replace:
```
9. **acceptUrl handling (connection candidates only):** Embed `acceptUrl` verbatim on a short verb phrase. For grouped entries (same person, multiple connections), embed each sub-entry's `acceptUrl` on a distinct topic phrase instead — see the template in step 6. The URL is opaque — do not append, encode, or modify any part of it. The backend has already prepared the greeting that will pre-fill the conversation when the user clicks. **`connector-flow` candidates carry no `acceptUrl`** — those trigger an introduction approval, not a direct conversation.
```
with:
```
9. **acceptUrl handling (connection candidates only):** Embed `acceptUrl` verbatim on a short verb phrase. The URL is opaque — do not append, encode, or modify any part of it. The backend has already prepared the greeting that will pre-fill the conversation when the user clicks. **`connector-flow` candidates carry no `acceptUrl`** — those trigger an introduction approval, not a direct conversation.
```

**Step 10** — replace:
```
10. For every opportunity you mention in the brief — including every sub-entry within grouped cards — call `confirm_opportunity_delivery(opportunityId, trigger="digest")`. Do NOT confirm for opportunities you skipped.
```
with:
```
10. For every opportunity you mention in the brief, call `confirm_opportunity_delivery(opportunityId, trigger="digest")`. Do NOT confirm for opportunities you skipped.
```

- [ ] **Step 2: Revert ambient.md**

In `packages/agentvillage/skills/index-network/prompts/ambient.md`:

**Step 6 cap** — replace:
```
   - At most **3 direct opportunities** (counted per person, not per sub-entry — a grouped entry with multiple connections still counts as one) — `feedCategory: "connection"`.
```
with:
```
   - At most **3 direct opportunities** — `feedCategory: "connection"`.
```
(Keep the rest of that line unchanged.)

**Section A verb-phrase instruction** — replace:
```
   - Embed `acceptUrl` verbatim on a short verb phrase like "message {Name}". For grouped entries (same person, multiple connections), embed each sub-entry's `acceptUrl` on a distinct topic phrase instead — see grouped example below. The URL is opaque — do not append, encode, or modify any part of it. The backend has already prepared the greeting that will pre-fill the conversation when the user clicks.
```
with:
```
   - Embed `acceptUrl` verbatim on a short verb phrase like "message {Name}". The URL is opaque — do not append, encode, or modify any part of it. The backend has already prepared the greeting that will pre-fill the conversation when the user clicks.
```

**Section A grouped clause** — delete this entire line:
```
   - When the same person appears with multiple connections (grouped entry from the tool), link their name to `profileUrl` once, then embed each sub-entry's `acceptUrl` on a distinct topic phrase. Example: "[Ashish](profileUrl) — spanning [generative software](acceptUrl1), [AI infrastructure](acceptUrl2), and [deep learning](acceptUrl3) — several angles worth exploring."
```

**Step 10** — replace:
```
10. For every opportunity you mention in the message — including every sub-entry within grouped cards — call `confirm_opportunity_delivery(opportunityId, trigger="ambient")`. Do NOT confirm for opportunities you skipped.
```
with:
```
10. For every opportunity you mention in the message, call `confirm_opportunity_delivery(opportunityId, trigger="ambient")`. Do NOT confirm for opportunities you skipped.
```

- [ ] **Step 3: Revert exemplars.md**

In `packages/agentvillage/skills/index-network/exemplars.md`:

Delete the "### Grouped: same person, multiple connections" section (between the end of the digest exemplar and the "## Ambient update" section). This includes the heading, the explanatory paragraph, and the entire blockquote exemplar.

Delete the "### Grouped: same person, multiple connections (ambient)" section (between the end of the ambient exemplar and the "## Greeting drafts" section). This includes the heading and the entire blockquote exemplar.

- [ ] **Step 4: Commit**

```bash
git add packages/agentvillage/skills/index-network/prompts/digest.md packages/agentvillage/skills/index-network/prompts/ambient.md packages/agentvillage/skills/index-network/exemplars.md
git commit -m "revert: remove grouped-entry prompt and exemplar additions"
```

---

### Task 5: Version bump and final verification

**Files:**
- Modify: `packages/protocol/package.json`

- [ ] **Step 1: Bump version**

In `packages/protocol/package.json`, change:
```json
"version": "1.17.0",
```
to:
```json
"version": "1.18.0",
```

- [ ] **Step 2: Run full test suite for the affected file**

```bash
cd packages/protocol && bun test src/opportunity/tests/opportunity.tools.spec.ts
```

Expected: All tests PASS.

- [ ] **Step 3: Run TypeScript compiler check**

```bash
cd packages/protocol && bunx tsc --noEmit
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/package.json
git commit -m "chore: bump @indexnetwork/protocol to 1.18.0"
```
