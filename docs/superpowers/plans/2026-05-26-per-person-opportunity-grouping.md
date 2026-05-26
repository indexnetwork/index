# Per-Person Opportunity Grouping Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Group same-person opportunities into a single entry in the MCP prose output so the digest/ambient surfaces show each person once with multiple conversation entry points.

**Architecture:** `buildOpportunityPresentation` (MCP branch) groups cards by `(userId, feedCategory)` before rendering prose. Single-card groups render as today. Multi-card groups render the person once with sub-entries per opportunity. Digest and ambient prompts + exemplars get updated rendering templates for the grouped format.

**Tech Stack:** TypeScript (Bun), no new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-26-per-person-opportunity-grouping-design.md`

---

### Task 1: Add `userId` to `OpportunityCardLike` and write grouping tests

The `OpportunityCardLike` type at `packages/protocol/src/opportunity/opportunity.tools.ts:323` is the input to `buildOpportunityPresentation`. It uses `Record<string, unknown>` so `userId` is accessible at runtime, but it's not typed. Add it to the explicit fields so the grouping logic is type-safe.

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.tools.ts:323-331` (add `userId` to `OpportunityCardLike`)
- Test: `packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts` (add grouping tests after the existing `buildOpportunityPresentation` block at line ~653)

- [ ] **Step 1: Add `userId` to `OpportunityCardLike`**

In `packages/protocol/src/opportunity/opportunity.tools.ts`, find the type at line 323:

```typescript
type OpportunityCardLike = Record<string, unknown> & {
  opportunityId: string;
  userId?: string | undefined;
  name?: string | undefined;
  mainText?: string | undefined;
  status?: string | undefined;
  feedCategory?: string | undefined;
  acceptUrl?: string | undefined;
  profileUrl?: string | undefined;
};
```

Add `userId?: string | undefined;` after `opportunityId`.

- [ ] **Step 2: Write failing tests for grouping behavior**

In `packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts`, add these tests after the existing `buildOpportunityPresentation — MCP opportunityId omission` describe block (after line ~653):

```typescript
describe("buildOpportunityPresentation — per-person grouping (MCP)", () => {
  test("groups multiple cards for the same person into one entry", () => {
    const out = buildOpportunityPresentation(
      [
        {
          opportunityId: "opp-1",
          userId: "ashish-id",
          name: "Ashish",
          mainText: "Generative software and programmable organizations.",
          status: "pending",
          acceptUrl: "https://api.test/c/link1",
          profileUrl: "https://app.test/u/ashish-id",
          feedCategory: "connection",
        },
        {
          opportunityId: "opp-2",
          userId: "ashish-id",
          name: "Ashish",
          mainText: "AI in creativity and design.",
          status: "pending",
          acceptUrl: "https://api.test/c/link2",
          profileUrl: "https://app.test/u/ashish-id",
          feedCategory: "connection",
        },
        {
          opportunityId: "opp-3",
          userId: "ashish-id",
          name: "Ashish",
          mainText: "AI infrastructure and deployment workflows.",
          status: "pending",
          acceptUrl: "https://api.test/c/link3",
          profileUrl: "https://app.test/u/ashish-id",
          feedCategory: "connection",
        },
      ],
      { isMcp: true, leadIn: "You have 1 opportunity(ies)." },
    );

    // Should appear as ONE top-level entry, not three
    expect(out).toContain("1. Ashish");
    expect(out).not.toContain("2. Ashish");
    expect(out).not.toContain("3. Ashish");

    // All three acceptUrls must be present
    expect(out).toContain("acceptUrl: https://api.test/c/link1");
    expect(out).toContain("acceptUrl: https://api.test/c/link2");
    expect(out).toContain("acceptUrl: https://api.test/c/link3");

    // All three opportunityIds must be present (for confirm_opportunity_delivery)
    expect(out).toContain("opportunityId: opp-1");
    expect(out).toContain("opportunityId: opp-2");
    expect(out).toContain("opportunityId: opp-3");

    // profileUrl appears once
    const profileMatches = out.match(/profileUrl: https:\/\/app\.test\/u\/ashish-id/g);
    expect(profileMatches?.length).toBe(1);

    // Sub-entries labeled with letters
    expect(out).toContain("a.");
    expect(out).toContain("b.");
    expect(out).toContain("c.");

    // Grouped instruction present
    expect(out).toContain("grouped entries");
  });

  test("single-card person renders exactly as before (no grouping)", () => {
    const out = buildOpportunityPresentation(
      [
        {
          opportunityId: "opp-solo",
          userId: "solo-id",
          name: "Maya",
          mainText: "Agent memory layer for long-running workflows.",
          status: "pending",
          acceptUrl: "https://api.test/c/solo-link",
          profileUrl: "https://app.test/u/solo-id",
          feedCategory: "connection",
        },
      ],
      { isMcp: true, leadIn: "You have 1 opportunity(ies)." },
    );

    // Renders as a flat entry, not grouped
    expect(out).toContain("1. Maya");
    expect(out).toContain("Agent memory layer");
    expect(out).toContain("acceptUrl: https://api.test/c/solo-link");
    // No sub-entry letters
    expect(out).not.toMatch(/\n\s+a\./);
  });

  test("different feedCategory for same userId stays separate", () => {
    const out = buildOpportunityPresentation(
      [
        {
          opportunityId: "opp-conn",
          userId: "ashish-id",
          name: "Ashish",
          mainText: "Direct connection reason.",
          status: "pending",
          acceptUrl: "https://api.test/c/conn-link",
          profileUrl: "https://app.test/u/ashish-id",
          feedCategory: "connection",
        },
        {
          opportunityId: "opp-intro",
          userId: "ashish-id",
          name: "Ashish",
          mainText: "Introducer reason.",
          status: "latent",
          profileUrl: "https://app.test/u/ashish-id",
          feedCategory: "connector-flow",
        },
      ],
      { isMcp: true, leadIn: "Found 2." },
    );

    // Two separate top-level entries because feedCategory differs
    expect(out).toContain("1. Ashish");
    expect(out).toContain("2. Ashish");
  });

  test("mixed: one grouped person + one solo person", () => {
    const out = buildOpportunityPresentation(
      [
        {
          opportunityId: "opp-a1",
          userId: "ashish-id",
          name: "Ashish",
          mainText: "Reason A.",
          status: "pending",
          acceptUrl: "https://api.test/c/a1",
          profileUrl: "https://app.test/u/ashish-id",
          feedCategory: "connection",
        },
        {
          opportunityId: "opp-a2",
          userId: "ashish-id",
          name: "Ashish",
          mainText: "Reason B.",
          status: "pending",
          acceptUrl: "https://api.test/c/a2",
          profileUrl: "https://app.test/u/ashish-id",
          feedCategory: "connection",
        },
        {
          opportunityId: "opp-m1",
          userId: "maya-id",
          name: "Maya",
          mainText: "Solo reason.",
          status: "pending",
          acceptUrl: "https://api.test/c/m1",
          profileUrl: "https://app.test/u/maya-id",
          feedCategory: "connection",
        },
      ],
      { isMcp: true, leadIn: "Found 2." },
    );

    // Ashish grouped as entry 1, Maya as entry 2
    expect(out).toContain("1. Ashish");
    expect(out).toContain("2. Maya");
    expect(out).not.toContain("3.");
    // Ashish has sub-entries
    expect(out).toContain("a.");
    expect(out).toContain("b.");
    // Maya rendered flat (solo)
    expect(out).toContain("Solo reason.");
  });

  test("web UI (isMcp=false) is unaffected — no grouping", () => {
    const out = buildOpportunityPresentation(
      [
        {
          opportunityId: "opp-1",
          userId: "ashish-id",
          name: "Ashish",
          mainText: "Reason A.",
          status: "pending",
          feedCategory: "connection",
        },
        {
          opportunityId: "opp-2",
          userId: "ashish-id",
          name: "Ashish",
          mainText: "Reason B.",
          status: "pending",
          feedCategory: "connection",
        },
      ],
      { isMcp: false, leadIn: "Found 2." },
    );

    // Web path emits code fences, one per card — both present
    const fenceCount = (out.match(/```opportunity/g) || []).length;
    expect(fenceCount).toBe(2);
  });

  test("grouped entry without acceptUrl shows opportunityId per sub-entry", () => {
    const out = buildOpportunityPresentation(
      [
        {
          opportunityId: "opp-d1",
          userId: "ashish-id",
          name: "Ashish",
          mainText: "Draft reason A.",
          status: "draft",
          profileUrl: "https://app.test/u/ashish-id",
          feedCategory: "connection",
        },
        {
          opportunityId: "opp-d2",
          userId: "ashish-id",
          name: "Ashish",
          mainText: "Draft reason B.",
          status: "draft",
          profileUrl: "https://app.test/u/ashish-id",
          feedCategory: "connection",
        },
      ],
      { isMcp: true, leadIn: "Found 1." },
    );

    expect(out).toContain("1. Ashish");
    expect(out).toContain("opportunityId: opp-d1");
    expect(out).toContain("opportunityId: opp-d2");
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `cd /Users/aposto/Projects/index/packages/protocol && bun test src/opportunity/tests/opportunity.tools.spec.ts`

Expected: The new tests fail because `buildOpportunityPresentation` does not group yet. Existing tests should still pass.

- [ ] **Step 4: Commit test file**

```bash
git add packages/protocol/src/opportunity/opportunity.tools.ts packages/protocol/src/opportunity/tests/opportunity.tools.spec.ts
git commit -m "test: add failing tests for per-person opportunity grouping in MCP presentation"
```

---

### Task 2: Implement grouping in `buildOpportunityPresentation`

**Files:**
- Modify: `packages/protocol/src/opportunity/opportunity.tools.ts:349-400` (rewrite MCP branch)

- [ ] **Step 1: Implement the grouping logic**

Replace the MCP branch of `buildOpportunityPresentation` (the `if (opts.isMcp) { ... }` block at lines 355-388) with:

```typescript
  if (opts.isMcp) {
    // Group cards by (userId, feedCategory) so the same person appears once
    // with multiple conversation entry points. Cards without userId fall
    // through ungrouped (each gets its own top-level entry).
    const groupKey = (card: OpportunityCardLike) =>
      card.userId && card.feedCategory
        ? `${card.userId}::${card.feedCategory}`
        : null;

    type CardGroup = { cards: OpportunityCardLike[]; key: string | null };
    const groups: CardGroup[] = [];
    const keyToGroup = new Map<string, CardGroup>();

    for (const card of cards) {
      const k = groupKey(card);
      if (k && keyToGroup.has(k)) {
        keyToGroup.get(k)!.cards.push(card);
      } else {
        const group: CardGroup = { cards: [card], key: k };
        groups.push(group);
        if (k) keyToGroup.set(k, group);
      }
    }

    let hasLinks = false;
    let hasOpportunityIds = false;
    let hasGroupedEntries = false;

    const prose = groups
      .map((group, gi) => {
        const first = group.cards[0];
        const entryNum = gi + 1;

        if (group.cards.length === 1) {
          // Single-card group: render exactly as before
          const lines: string[] = [`${entryNum}. ${first.name ?? "Unknown"}`];
          if (first.mainText) lines.push(`   ${first.mainText}`);
          if (first.status) lines.push(`   status: ${first.status}`);
          if (first.profileUrl) lines.push(`   profileUrl: ${first.profileUrl}`);
          if (first.acceptUrl) {
            lines.push(`   acceptUrl: ${first.acceptUrl}`);
            hasLinks = true;
          }
          if (first.feedCategory) lines.push(`   feedCategory: ${first.feedCategory}`);
          if (!first.acceptUrl) {
            lines.push(`   opportunityId: ${first.opportunityId}`);
            hasOpportunityIds = true;
          }
          return lines.join("\n");
        }

        // Multi-card group: one header, sub-entries per opportunity
        hasGroupedEntries = true;
        const lines: string[] = [`${entryNum}. ${first.name ?? "Unknown"}`];
        if (first.profileUrl) lines.push(`   profileUrl: ${first.profileUrl}`);
        if (first.feedCategory) lines.push(`   feedCategory: ${first.feedCategory}`);
        if (first.status) lines.push(`   status: ${first.status}`);
        lines.push(`   This person connects with you in multiple ways:`);

        const subLabels = "abcdefghijklmnopqrstuvwxyz";
        for (let si = 0; si < group.cards.length; si++) {
          const card = group.cards[si];
          const label = subLabels[si] ?? `${si + 1}`;
          lines.push(`   ${label}. ${card.mainText ?? "Connection opportunity"}`);
          if (card.acceptUrl) {
            lines.push(`      acceptUrl: ${card.acceptUrl}`);
            hasLinks = true;
          }
          lines.push(`      opportunityId: ${card.opportunityId}`);
          hasOpportunityIds = true;
        }

        return lines.join("\n");
      })
      .join("\n\n");

    const linkInstructions = hasLinks
      ? `For each card that has an acceptUrl, embed it on a short verb phrase (e.g. "message [Name]" for connection, "make intro" for connector-flow). For each card that has a profileUrl, link the person's name to it. Some cards may have neither — render those as plain text and never fabricate URLs for them. The acceptUrl is opaque and self-contained — embed it verbatim. Do NOT append, encode, or modify any part of any URL. Never render link strips or tables — weave URLs into prose. `
      : "";
    const idInstructions = hasOpportunityIds
      ? `Use opportunityId values only when calling update_opportunity (send/accept/reject) or confirm_opportunity_delivery. `
      : "";
    const groupedInstructions = hasGroupedEntries
      ? `For grouped entries (one person with multiple connections), link the person's name to their profileUrl once, then embed each sub-entry's acceptUrl on a distinct topic phrase so the user can start a conversation about that specific area. Call confirm_opportunity_delivery for every opportunityId in the group. The count of "conversations" in section headers should reflect unique people, not raw opportunity count. `
      : "";
    return (
      `${opts.leadIn}\n\n${prose}\n\n` +
      `Summarize these for the user in natural prose — mention first names and a brief match reason per connection. ` +
      `${linkInstructions}` +
      `${groupedInstructions}` +
      `Do NOT print raw JSON, field labels, opportunityIds, or confidence scores. ` +
      `${idInstructions}`
    );
  }
```

- [ ] **Step 2: Run all tests**

Run: `cd /Users/aposto/Projects/index/packages/protocol && bun test src/opportunity/tests/opportunity.tools.spec.ts`

Expected: All tests pass — both existing and new grouping tests.

- [ ] **Step 3: Run tsc**

Run: `cd /Users/aposto/Projects/index/packages/protocol && npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/protocol/src/opportunity/opportunity.tools.ts
git commit -m "feat(protocol): group same-person opportunities in MCP presentation

buildOpportunityPresentation now groups cards by (userId, feedCategory)
in the MCP branch. Each person appears once with sub-entries per
opportunity, each carrying its own acceptUrl and opportunityId.
Single-card groups render exactly as before. Web UI is unaffected."
```

---

### Task 3: Update digest prompt

**Files:**
- Modify: `packages/agentvillage/skills/index-network/prompts/digest.md`

- [ ] **Step 1: Update step 6 rendering template**

In `packages/agentvillage/skills/index-network/prompts/digest.md`, replace the template block in step 6 (lines 28-41) with:

```markdown
   ```
   {greeting}

   It's {weekday}, {short date / week context}. Here's what's worth your attention right now.

   **{N} conversations await you** ← only if there are direct (connection) candidates — receiver is a party, NOT the introducer. N = unique people, not raw opportunity count.
   - [Name](profileUrl) — 1–2 sentences on why this person matters to the user, [message Name](acceptUrl)
   - [Name](profileUrl) — When multiple connections exist for the same person, weave each acceptUrl into the description as a hyperlink on the relevant topic phrase. Example: "An experienced technologist spanning [generative software](acceptUrl1), [AI infrastructure](acceptUrl2), and [deep learning research](acceptUrl3) — several angles worth exploring."
   - …

   **Help your community find their opportunities** ← only if there are introducer (connector-flow) candidates — receiver IS the introducer
   A few residents are looking for something specific. If you know someone who fits, a quick nudge goes a long way.
   - [{Name}]({profileUrl}) — {their need / what they're looking for, 1–2 sentences from mainText}. {short closing phrase}, make intro
   - …
   ```
```

- [ ] **Step 2: Update step 10 to clarify grouped delivery confirmation**

Replace step 10 (line 55) with:

```markdown
10. For every opportunity you mention in the brief — including every sub-entry within grouped cards — call `confirm_opportunity_delivery(opportunityId, trigger="digest")`. Do NOT confirm for opportunities you skipped.
```

- [ ] **Step 3: Commit**

```bash
git add packages/agentvillage/skills/index-network/prompts/digest.md
git commit -m "feat(agentvillage): update digest prompt for per-person grouped opportunities"
```

---

### Task 4: Update ambient prompt

**Files:**
- Modify: `packages/agentvillage/skills/index-network/prompts/ambient.md`

- [ ] **Step 1: Update step 9 section A rendering instructions**

In `packages/agentvillage/skills/index-network/prompts/ambient.md`, after the existing section A instructions (lines 33-35), add a grouped-entry clause. Replace lines 29-35 with:

```markdown
   **Section A — direct candidates** (only if any direct candidates qualified)

   Header: `**New conversations worth starting**`

   For each direct (`connection`):
   - Link the person's name to `profileUrl`.
   - Embed `acceptUrl` verbatim on a short verb phrase like "message {Name}". The URL is opaque — do not append, encode, or modify any part of it. The backend has already prepared the greeting that will pre-fill the conversation when the user clicks.
   - When the same person appears with multiple connections (grouped entry), link their name to `profileUrl` once, then embed each sub-entry's `acceptUrl` on a distinct topic phrase. Example: "[Ashish](profileUrl) — spanning [generative software](acceptUrl1), [AI infrastructure](acceptUrl2), and [deep learning](acceptUrl3) — several angles worth exploring."
```

- [ ] **Step 2: Update step 10 to clarify grouped delivery confirmation**

Replace step 10 (line 55) with:

```markdown
10. For every opportunity you mention in the message — including every sub-entry within grouped cards — call `confirm_opportunity_delivery(opportunityId, trigger="ambient")`. Do NOT confirm for opportunities you skipped.
```

- [ ] **Step 3: Commit**

```bash
git add packages/agentvillage/skills/index-network/prompts/ambient.md
git commit -m "feat(agentvillage): update ambient prompt for per-person grouped opportunities"
```

---

### Task 5: Add grouped-person exemplars

**Files:**
- Modify: `packages/agentvillage/skills/index-network/exemplars.md`

- [ ] **Step 1: Add grouped exemplar to digest section**

In `packages/agentvillage/skills/index-network/exemplars.md`, after the existing digest exemplar (after line 20, before the `## Ambient update` header), add:

```markdown

### Grouped: same person, multiple connections

When `list_opportunities` returns multiple opportunities for the same person (grouped entry), render as a single bullet with multiple conversation entry points:

> 🌞 Good morning from Edge Esmeralda
>
> It's Tuesday, May 26. Here's what's worth your attention right now.
>
> **2 conversations await you**
> - [Ashish](profileUrl) — An experienced technologist spanning [generative software](acceptUrl1), [AI infrastructure](acceptUrl2), [creative AI design](acceptUrl3), and [deep learning research](acceptUrl4). Several angles worth exploring.
> - [Priya]({profileUrl}) — Building community-owned data infrastructure. Aligned on the ownership layer and complementary on discovery, could be interesting to [explore overlaps]({acceptUrl})
```

- [ ] **Step 2: Add grouped exemplar to ambient section**

After the existing ambient exemplar (after line 36, before the `## Greeting drafts` header), add:

```markdown

### Grouped: same person, multiple connections (ambient)

> **New conversations worth starting**
> - [Ashish](profileUrl) — An experienced technologist whose work spans [generative software](acceptUrl1), [AI infrastructure](acceptUrl2), and [deep learning research](acceptUrl3). Multiple overlapping connections with your interests.
```

- [ ] **Step 3: Commit**

```bash
git add packages/agentvillage/skills/index-network/exemplars.md
git commit -m "feat(agentvillage): add grouped-person exemplars for digest and ambient"
```

---

### Task 6: Final verification

- [ ] **Step 1: Run the full opportunity tools test suite**

Run: `cd /Users/aposto/Projects/index/packages/protocol && bun test src/opportunity/tests/opportunity.tools.spec.ts`

Expected: All tests pass.

- [ ] **Step 2: Run tsc across the protocol package**

Run: `cd /Users/aposto/Projects/index/packages/protocol && npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 3: Verify no other test suites are broken**

Run: `cd /Users/aposto/Projects/index/packages/protocol && bun test src/opportunity/tests/opportunity.presentation.spec.ts`

Expected: Existing presentation tests still pass.
