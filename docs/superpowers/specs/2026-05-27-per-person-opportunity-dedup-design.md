# Per-Person Opportunity Deduplication

**Date:** 2026-05-27
**Status:** Approved
**Replaces:** Per-person grouping approach (merged in `release/2026-05-26`, PR #21 on edge-city/agentvillage)

## Problem

The discovery engine can create multiple opportunities between the same two users across different discovery runs (different intents, different times). Within a single run, dedup already happens by similarity score. But across runs, duplicates accumulate. The result: the same person appears multiple times in the daily digest and ambient passes.

The grouping approach (showing one entry per person with multiple acceptUrls) was implemented and merged but adds unnecessary complexity to both the protocol layer and the LLM prompt instructions. A simpler solution: deduplicate at the selection layer so only the single most relevant opportunity per counterpart reaches the presentation layer.

## Design

### New function: `deduplicateByPerson`

**Location:** `packages/protocol/src/opportunity/opportunity.utils.ts`

**Signature:**
```typescript
export function deduplicateByPerson<T extends {
  actors: Array<{ userId: string; role: string }>;
  interpretation?: { confidence?: number } | null;
}>(opportunities: T[], viewerId: string): T[]
```

**Algorithm:**
1. For each opportunity, derive the counterpart userId: the first actor whose `userId !== viewerId` and `role !== 'introducer'`. If no counterpart can be derived (edge case), the opportunity passes through undeduped.
2. Group opportunities by counterpart userId.
3. For each group with more than one entry, keep the opportunity with the highest `interpretation.confidence`. On ties (equal confidence or both missing), keep the first encountered (stable ordering).
4. Return the deduped array preserving original input order.

**Call site:** `list_opportunities` tool handler in `opportunity.tools.ts`, between the visibility filter and `selectByComposition`. This ensures composition balancing operates on accurate per-person counts.

```
Raw opportunities → visibility filter → deduplicateByPerson → selectByComposition → card building → presentation
```

### Revert: `buildOpportunityPresentation` grouping

Remove the entire grouping path from the MCP branch of `buildOpportunityPresentation`:
- Remove `groupKey`, `CardGroup`, `keyToGroup`, `groups` array, and multi-card rendering logic
- Restore the original flat rendering: one numbered entry per card
- Remove `hasGroupedEntries` flag and `groupedInstructions` string
- Keep `userId` on `OpportunityCardLike` (still populated by card building, useful for other consumers)

### Revert: prompt and exemplar changes

**`packages/agentvillage/skills/index-network/prompts/digest.md`:**
- Step 6: Remove "N = unique people, not raw opportunity count" annotation
- Step 6: Remove the grouped-entry bullet template
- Step 9: Remove "For grouped entries... see the template in step 6." clause
- Step 10: Revert "including every sub-entry within grouped cards" back to original

**`packages/agentvillage/skills/index-network/prompts/ambient.md`:**
- Step 6 cap: Remove "(counted per person, not per sub-entry — a grouped entry with multiple connections still counts as one)"
- Section A: Remove "For grouped entries... see grouped example below." from the verb-phrase instruction
- Section A: Remove the grouped-entry clause entirely
- Step 10: Revert "including every sub-entry within grouped cards" back to original

**`packages/agentvillage/skills/index-network/exemplars.md`:**
- Remove "### Grouped: same person, multiple connections" section (digest)
- Remove "### Grouped: same person, multiple connections (ambient)" section

### Tests

**Delete:** The entire `buildOpportunityPresentation — per-person grouping (MCP)` describe block in `opportunity.tools.spec.ts`.

**Add:** New `deduplicateByPerson` tests (in `opportunity.tools.spec.ts` or a new `opportunity.utils.spec.ts`):

1. **Two opportunities, same counterpart** — keeps highest confidence
2. **Single opportunity per person** — passes through unchanged
3. **Multiple counterparts** — all preserved, one per person
4. **Missing confidence on one** — the one with a score wins over the one without
5. **Equal confidence** — first encountered wins (stable)
6. **No derivable counterpart** (edge case, e.g. all actors are introducers) — passes through

### Version bump

`packages/protocol/package.json`: bump from 1.17.0 → 1.18.0 (behavior change in selection layer).

## Scope

- `packages/protocol/src/opportunity/opportunity.utils.ts` — add `deduplicateByPerson`
- `packages/protocol/src/opportunity/opportunity.tools.ts` — revert grouping, wire dedup call
- `packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts` — replace grouping tests with dedup tests
- `packages/agentvillage/skills/index-network/prompts/digest.md` — revert grouped-entry additions
- `packages/agentvillage/skills/index-network/prompts/ambient.md` — revert grouped-entry additions
- `packages/agentvillage/skills/index-network/exemplars.md` — revert grouped exemplar sections
