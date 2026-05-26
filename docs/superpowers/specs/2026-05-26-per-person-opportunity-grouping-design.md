# Per-Person Opportunity Grouping in Digest/Ambient Surfaces

**Date:** 2026-05-26
**Status:** Design

## Problem

When the discovery engine creates multiple opportunities between the same two users (different match reasons from different intents/premises), the morning digest and ambient pass render each as a separate bullet. The user sees:

```
4 conversations await you
- Ashish — reason A, message Ashish
- Ashish — reason B, message Ashish
- Ashish — reason C, message Ashish
- Ashish — reason D, message Ashish
```

Each "Ashish" is the same person. The existing dedup (heartbeat-state.json) only prevents the same opportunity ID from appearing across days — it cannot help because these are 4 distinct opportunity IDs.

## Solution

Group opportunities by counterpart person in the MCP prose output, so each person appears once with multiple conversation entry points.

**Target rendering:**

```
1 conversation awaits you
- [Ashish](profileUrl) — An experienced technologist spanning
  [generative software](acceptUrl1), [AI infrastructure](acceptUrl2),
  [creative AI design](acceptUrl3), and [deep learning research](acceptUrl4).
  Multiple reasons to connect.
```

One `profileUrl` on the name (who they are). Each opportunity's `acceptUrl` on a distinct topic phrase (why to message them about that specific thing). Each click opens a conversation pre-filled with context for that particular opportunity.

## Architecture

Three layers, each with a distinct responsibility:

### 1. Protocol: `buildOpportunityPresentation` (structural grouping)

**File:** `packages/protocol/src/opportunity/opportunity.tools.ts`

The MCP branch (`isMcp=true`) currently iterates cards flat. Change it to:

1. Group cards by `(userId, feedCategory)`. The `userId` field is on every card from `buildMinimalOpportunityCard`. Grouping by feedCategory too prevents merging a card where the viewer is a direct party with one where the viewer is an introducer for the same counterpart (different digest sections).

2. **Single-card groups** render exactly as today — no behavior change.

3. **Multi-card groups** render in a new format:

```
1. Ashish
   profileUrl: https://t.me/ashish
   feedCategory: connection
   status: pending
   This person connects with you in multiple ways:
   a. generative software and programmable organizations
      acceptUrl: https://edge.index.network/c/abc123
      opportunityId: uuid1
   b. AI in creativity and design
      acceptUrl: https://edge.index.network/c/def456
      opportunityId: uuid2
   c. AI infrastructure and deployment
      acceptUrl: https://edge.index.network/c/ghi789
      opportunityId: uuid3
   d. deep learning study groups
      acceptUrl: https://edge.index.network/c/jkl012
      opportunityId: uuid4
```

Each sub-entry's text is derived from the card's `mainText`. The `opportunityId` is included per sub-entry so the digest LLM can call `confirm_opportunity_delivery` for each. The `acceptUrl` per sub-entry lets the LLM create distinct hyperlinks per topic.

4. **Updated LLM instructions** appended to the existing instruction block:

> For grouped entries (one person with multiple connections), link the person's name to their profileUrl once, then embed each sub-entry's acceptUrl on a distinct topic phrase so the user can start a conversation about that specific area. Call confirm_opportunity_delivery for every opportunityId in the group. The count of "conversations" in section headers should reflect unique people, not raw opportunity count.

5. **Numbering:** The top-level numbering (`1.`, `2.`, ...) counts unique people, not raw opportunities. This naturally fixes the "N conversations await you" count — the LLM reads 1 entry, says 1 conversation.

### 2. Digest prompt: updated rendering template

**File:** `packages/agentvillage/skills/index-network/prompts/digest.md`

Update step 6 bullet template to show the multi-connection case:

```
**{N} conversations await you**
- [Name](profileUrl) — 1–2 sentences on why, [message Name](acceptUrl)
- [Name](profileUrl) — When multiple connections exist: weave each acceptUrl
  into the description as a hyperlink on the relevant topic phrase.
  "Spanning [generative software](url1), [AI infra](url2), and
  [deep learning](url3) — several angles worth exploring."
```

Also update step 10 to clarify: confirm delivery for every opportunityId, including all sub-entries within grouped cards.

### 3. Ambient prompt: same update

**File:** `packages/agentvillage/skills/index-network/prompts/ambient.md`

Mirror the digest template change in step 9 section A rendering instructions.

### 4. Exemplars: add a grouped example

**File:** `packages/agentvillage/skills/index-network/exemplars.md`

Add a grouped-person exemplar to both the digest and ambient sections so the LLM has a concrete target shape to mimic.

## What does NOT change

- **Web UI cards** (`isMcp=false` branch): each opportunity stays a separate interactive card. Grouping is MCP-only.
- **`buildMinimalOpportunityCard`**: still builds one card per opportunity. Grouping happens downstream in the presentation layer.
- **`selectByComposition`**: still balances across feed categories. Grouping happens after composition selection.
- **`list_opportunities` schema and handler logic**: no changes to fetching, filtering, or the card-building loop. Only the final prose formatting changes.
- **`confirm_opportunity_delivery`**: still called per opportunity, not per person. The grouped format surfaces all opportunityIds.
- **Heartbeat dedup state**: still tracks individual opportunity IDs. All IDs within a group get added to the dedup set.

## Edge Cases

- **Mixed feedCategory for same person**: A user could be both a direct party and an introducer for the same counterpart across different opportunities. These land in different digest sections (connection vs connector-flow) because the grouping key is `(userId, feedCategory)`. Each section shows the person independently — correct behavior.
- **Some cards in a group have acceptUrl, others don't**: Sub-entries without an acceptUrl render as plain text topic phrases (no hyperlink). The grouped header still shows the profileUrl on the name.
- **Single-card groups**: Render exactly as today. The grouping is a no-op for the common case.
- **Connector-flow grouped entries**: Same grouping applies. Multiple introducer opportunities for the same person merge into one bullet with multiple topic phrases. No acceptUrls (connector-flow never has them). The `make intro` trailing text appears once.

## Files Touched

1. `packages/protocol/src/opportunity/opportunity.tools.ts` — `buildOpportunityPresentation` MCP branch
2. `packages/agentvillage/skills/index-network/prompts/digest.md` — step 6 template + step 10 clarification
3. `packages/agentvillage/skills/index-network/prompts/ambient.md` — step 9 template + step 10 clarification
4. `packages/agentvillage/skills/index-network/exemplars.md` — add grouped-person exemplar
