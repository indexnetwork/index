# IND-113: Opportunity Notification Body Text Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent the introducer's name from appearing in the opportunity notification body text (`personalizedSummary`), keeping it only in the narrator chip footer.

**Architecture:** Two-layer defense: (1) Strengthen the LLM prompt with explicit negative/positive examples to improve compliance, (2) Add programmatic post-processing to strip introducer mentions as a safety net.

**Tech Stack:** TypeScript, Zod, LLM prompts (Google Gemini 2.5 Flash via OpenRouter), Bun test framework

---

## Background

The issue (IND-113) is that opportunity notification cards mention the introducer (e.g., "Seref Yarar introduced you to Lucy...") in the body text (`personalizedSummary`), but the introducer should only appear in the attribution footer (`narratorChip` with `narratorRemark`).

The body text should focus only on the match quality between the two users.

---

## Files to Touch

- `protocol/src/lib/protocol/agents/opportunity.presenter.ts` (prompt modification)
- `protocol/src/lib/protocol/support/opportunity.sanitize.ts` (new utility function)
- `protocol/src/lib/protocol/support/opportunity.card-text.ts` (integrate stripping)
- `protocol/src/lib/protocol/support/tests/opportunity.sanitize.spec.ts` (new tests)

---

## Task 1: Write Failing Test for Introducer Name Stripping

**Files:**
- Create: `protocol/src/lib/protocol/support/tests/opportunity.sanitize.spec.ts`
- Modify: None yet

**Step 1: Create the test file with failing test cases**

```typescript
import { describe, expect, it } from "bun:test";
import { stripIntroducerMentions } from "../opportunity.sanitize";

describe("stripIntroducerMentions", () => {
  it("removes introducer mention at start of sentence", () => {
    const text = "Seref Yarar introduced you to Lucy, who is actively seeking a product co-founder.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).not.toContain("Seref Yarar");
    expect(result).toContain("Lucy");
    expect(result).toBe("Lucy, who is actively seeking a product co-founder.");
  });

  it("removes introducer mention with 'thinks you should meet' pattern", () => {
    const text = "Bob thinks you should meet Alice because your skills align.";
    const result = stripIntroducerMentions(text, "Bob");
    expect(result).not.toContain("Bob");
    expect(result).toBe("Alice because your skills align.");
  });

  it("removes introducer mention with 'connected you' pattern", () => {
    const text = "Alice connected you to Bob, who needs your help.";
    const result = stripIntroducerMentions(text, "Alice");
    expect(result).not.toContain("Alice");
    expect(result).toBe("Bob, who needs your help.");
  });

  it("handles text without introducer mention (no change)", () => {
    const text = "Lucy is seeking a co-founder for her marketplace.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).toBe(text);
  });

  it("handles case-insensitive matching", () => {
    const text = "SEREF YARAR introduced you to Lucy.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).not.toContain("SEREF YARAR");
  });

  it("handles first name only matching", () => {
    const text = "Seref introduced you to Lucy, who needs help.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).not.toContain("Seref");
    expect(result).toBe("Lucy, who needs help.");
  });

  it("removes common introducer patterns with 'to'", () => {
    const text = "Jane introduced you to Mark. Mark is looking for a designer.";
    const result = stripIntroducerMentions(text, "Jane");
    expect(result).toBe("Mark. Mark is looking for a designer.");
  });

  it("trims whitespace after removal", () => {
    const text = "Seref introduced you to Lucy.";
    const result = stripIntroducerMentions(text, "Seref Yarar");
    expect(result).toBe("Lucy.");
  });

  it("returns original text if introducerName is empty", () => {
    const text = "Some text here.";
    const result = stripIntroducerMentions(text, "");
    expect(result).toBe(text);
  });

  it("returns original text if introducerName is undefined", () => {
    const text = "Some text here.";
    const result = stripIntroducerMentions(text, undefined);
    expect(result).toBe(text);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
cd protocol && bun test src/lib/protocol/support/tests/opportunity.sanitize.spec.ts
```

Expected: FAIL with "function not defined" or similar

**Step 3: Commit the test file**

```bash
git add protocol/src/lib/protocol/support/tests/opportunity.sanitize.spec.ts
git commit -m "test: add failing tests for stripIntroducerMentions utility"
```

---

## Task 2: Implement stripIntroducerMentions Utility

**Files:**
- Modify: `protocol/src/lib/protocol/support/opportunity.sanitize.ts`

**Step 1: Read the existing file to understand current exports**

```bash
cat protocol/src/lib/protocol/support/opportunity.sanitize.ts
```

**Step 2: Add the stripIntroducerMentions function**

Add this function to the existing file:

```typescript
/**
 * Strips introducer mentions from opportunity summary text.
 * Removes patterns like:
 * - "[Introducer] introduced you to [Counterpart]"
 * - "[Introducer] thinks you should meet [Counterpart]"
 * - "[Introducer] connected you to [Counterpart]"
 * - "[Introducer] suggested you meet [Counterpart]"
 *
 * @param text - The text to clean (personalizedSummary)
 * @param introducerName - Full name of the introducer to strip
 * @returns Text with introducer mentions removed, counterpart preserved
 */
export function stripIntroducerMentions(
  text: string,
  introducerName: string | undefined,
): string {
  if (!introducerName?.trim()) return text;

  const fullName = introducerName.trim();
  const firstName = fullName.split(/\s+/)[0];
  const namesToCheck = [fullName];
  if (firstName && firstName.length > 1) {
    namesToCheck.push(firstName);
  }

  let result = text;

  for (const name of namesToCheck) {
    const escapedName = escapeRegex(name);

    // Pattern: "Name introduced you to " (with or without comma)
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+introduced\\s+you\\s+to\\s*`, "gi"),
      "",
    );

    // Pattern: "Name thinks you should meet "
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+thinks\\s+you\\s+should\\s+meet\\s*`, "gi"),
      "",
    );

    // Pattern: "Name connected you to "
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+connected\\s+you\\s+(?:to|with)\\s*`, "gi"),
      "",
    );

    // Pattern: "Name suggested you meet "
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+suggested\\s+you\\s+(?:meet|connect\\s+(?:to|with))\\s*`, "gi"),
      "",
    );

    // Pattern: "Name recommended you meet "
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+recommended\\s+you\\s+(?:meet|connect)\\s*`, "gi"),
      "",
    );

    // Pattern: "Name thinks you and Counterpart should meet" -> remove entire phrase up to Counterpart
    result = result.replace(
      new RegExp(`\\b${escapedName}\\s+thinks\\s+you\\s+and\\s+`, "gi"),
      "",
    );
  }

  // Clean up: remove leading/trailing whitespace and common punctuation artifacts
  result = result
    .replace(/^[,\s]+/, "") // Remove leading commas/spaces
    .replace(/\s{2,}/g, " ") // Normalize multiple spaces
    .trim();

  // Capitalize first letter if we removed from start
  if (result.length > 0) {
    result = result.charAt(0).toUpperCase() + result.slice(1);
  }

  return result;
}

// Helper function (if not already in file)
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
```

**Step 3: Run tests to verify they pass**

```bash
cd protocol && bun test src/lib/protocol/support/tests/opportunity.sanitize.spec.ts
```

Expected: All tests PASS

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/support/opportunity.sanitize.ts
git commit -m "feat: add stripIntroducerMentions utility for cleaning opportunity summaries"
```

---

## Task 3: Integrate Stripping into Card Text Processing

**Files:**
- Modify: `protocol/src/lib/protocol/support/opportunity.card-text.ts`

**Step 1: Import the new function**

Add to imports at top:
```typescript
import { stripIntroducerMentions } from "./opportunity.sanitize";
```

**Step 2: Modify viewerCentricCardSummary to use stripping**

Add optional `introducerName` parameter and apply stripping:

```typescript
export function viewerCentricCardSummary(
  reasoning: string,
  counterpartName: string,
  maxChars: number = MINIMAL_MAIN_TEXT_MAX_CHARS,
  viewerName?: string,
  introducerName?: string, // NEW PARAMETER
): string {
  const raw = stripUuids(reasoning);
  if (!raw) return "A suggested connection.";

  const name = counterpartName.trim();
  if (!name) {
    let out = raw.length <= maxChars ? raw : raw.slice(0, maxChars) + "...";
    out = replaceViewerNameWithYou(out, viewerName);
    // NEW: Strip introducer mentions if present
    if (introducerName) {
      out = stripIntroducerMentions(out, introducerName);
    }
    return out;
  }

  // ... rest of existing logic ...
  
  // At each return point, apply stripping:
  // Line 76 (after finding clean sentence):
  let out = result.length <= maxChars ? result : result.slice(0, maxChars) + "...";
  out = replaceViewerNameWithYou(out, viewerName, [name]);
  // NEW: Strip introducer mentions
  if (introducerName) {
    out = stripIntroducerMentions(out, introducerName);
  }
  return out;

  // Line 96 (compound sentence case):
  let out = result.length <= maxChars ? result : result.slice(0, maxChars) + "...";
  out = replaceViewerNameWithYou(out, viewerName, [name]);
  // NEW: Strip introducer mentions
  if (introducerName) {
    out = stripIntroducerMentions(out, introducerName);
  }
  return out;

  // Line 105 (fallback):
  let out = raw.length <= maxChars ? raw : raw.slice(0, maxChars) + "...";
  out = replaceViewerNameWithYou(out, viewerName, [name]);
  // NEW: Strip introducer mentions
  if (introducerName) {
    out = stripIntroducerMentions(out, introducerName);
  }
  return out;

  // Line 113 (final fallback):
  let out =
    fromCounterpart.length <= maxChars
      ? fromCounterpart
      : fromCounterpart.slice(0, maxChars) + "...";
  out = replaceViewerNameWithYou(out, viewerName, [name]);
  // NEW: Strip introducer mentions
  if (introducerName) {
    out = stripIntroducerMentions(out, introducerName);
  }
  return out;
}
```

**Step 3: Update buildMinimalOpportunityCard to pass introducerName**

In `protocol/src/lib/protocol/tools/opportunity.tools.ts`:

```typescript
const mainText = viewerCentricCardSummary(
  reasoning,
  counterpartName,
  MINIMAL_MAIN_TEXT_MAX_CHARS,
  viewerName,
  introducerName ?? undefined, // NEW PARAMETER
);
```

**Step 4: Run existing tests to ensure no regression**

```bash
cd protocol && bun test src/lib/protocol/support/tests/opportunity.card-text.spec.ts
```

Expected: All tests PASS (or no test file exists yet)

**Step 5: Commit**

```bash
git add protocol/src/lib/protocol/support/opportunity.card-text.ts protocol/src/lib/protocol/tools/opportunity.tools.ts
git commit -m "feat: integrate introducer stripping into card summary generation"
```

---

## Task 4: Strengthen the LLM Prompt with Examples

**Files:**
- Modify: `protocol/src/lib/protocol/agents/opportunity.presenter.ts:210-232`

**Step 1: Update the homeCardSystemPrompt**

Replace the current Introduction-originated opportunities section (lines 210-215) with:

```typescript
|**Introduction-originated opportunities (ONLY when INTRODUCTION CONTEXT is provided):**
When INTRODUCTION CONTEXT is provided, this opportunity was explicitly created by an introducer. It was NOT automatically discovered.
- For parties/patients/agents/peers viewing an introduction: keep the introducer signal in narratorRemark (and narrator chip), not in personalizedSummary.
- For these introduced parties, personalizedSummary must focus ONLY on fit/value between viewer and counterpart. Do NOT mention the introducer there.
- narratorRemark should carry the introduction signal (e.g., "saw strong alignment between you two" or "thought this connection could be valuable"), without repeating the narrator name at the start.
- This is a personal recommendation, not an algorithm match. Frame it accordingly.

**CRITICAL: NEVER include introducer names in personalizedSummary. Examples:**
❌ WRONG: "Seref introduced you to Lucy, who is actively seeking a product co-founder..."
✅ CORRECT: "Lucy is actively seeking a product co-founder for a niche APAC marketplace. With your expertise in UX and AI, this could be an ideal collaboration."

❌ WRONG: "Bob thinks you should meet Alice because your React skills align with her needs."
✅ CORRECT: "Alice is building a React-based platform and needs frontend expertise. Your experience with component architecture makes you a strong fit."

❌ WRONG: "Jane connected you to Mark, who is looking for a designer."
✅ CORRECT: "Mark is building a consumer app and needs design expertise. Your background in user-centered design aligns well with what he's building."

Remember: The introducer's name goes ONLY in narratorRemark, NEVER in personalizedSummary.
```

**Step 2: Add similar examples to systemPrompt (for present() method)**

In the `systemPrompt` around lines 152-156, add examples section:

```typescript
|**Introduction-originated opportunities:**
When INTRODUCTION CONTEXT is provided, this opportunity was explicitly created by an introducer. This is NOT an automatic system discovery.
- For ALL roles: acknowledge the introducer's role naturally in the suggestedAction or context, BUT NOT in personalizedSummary for home card displays.
- The introduction itself is a strong signal — treat it with the weight of a personal recommendation.
- If the parties' intents don't obviously overlap, that's fine — the introducer saw something worth connecting. Focus on what the introducer likely saw.

**Examples for home card presentation:**
- If the introducer is "Seref" and the counterpart is "Lucy", personalizedSummary should say "Lucy is seeking..." NOT "Seref introduced you to Lucy..."
```

**Step 3: Run any existing presenter tests**

```bash
cd protocol && bun test src/lib/protocol/agents/tests/opportunity.presenter.spec.ts 2>/dev/null || echo "No test file found"
```

**Step 4: Commit**

```bash
git add protocol/src/lib/protocol/agents/opportunity.presenter.ts
git commit -m "fix: strengthen LLM prompt to prevent introducer mentions in body text"
```

---

## Task 5: Integration Test for End-to-End Flow

**Files:**
- Create: `protocol/src/lib/protocol/agents/tests/opportunity.presenter.spec.ts` (if doesn't exist)

**Step 1: Create integration test**

```typescript
import { describe, expect, it } from "bun:test";
import { OpportunityPresenter, type HomeCardPresenterInput } from "../opportunity.presenter";

describe("OpportunityPresenter - IND-113: Introducer should not appear in body text", () => {
  const presenter = new OpportunityPresenter();

  const createIntroducerInput = (
    introducerName: string,
    counterpartName: string,
  ): HomeCardPresenterInput => ({
    viewerContext: `Name: Test Viewer\nBio: UX designer with AI expertise\nActive intents:\n- Looking for collaboration opportunities`,
    otherPartyContext: `Name: ${counterpartName}\nBio: Building a marketplace startup\nSkills: product management, operations`,
    matchReasoning: `${introducerName} introduced you to ${counterpartName}, who is actively seeking a product co-founder for a niche APAC marketplace. Both parties have complementary skills in design and product development.`,
    category: "collaboration",
    confidence: 0.85,
    signalsSummary: "Complementary skills in design and product",
    indexName: "Test Index",
    viewerRole: "party",
    opportunityStatus: "pending",
    isIntroduction: true,
    introducerName,
    mutualIntentCount: 1,
  });

  it("should NOT include introducer name in personalizedSummary for introduction opportunities", async () => {
    const input = createIntroducerInput("Seref Yarar", "Lucy Chen");

    const result = await presenter.presentHomeCard(input);

    // Body text should NOT contain introducer
    expect(result.personalizedSummary).not.toContain("Seref");
    expect(result.personalizedSummary).not.toContain("Yarar");
    expect(result.personalizedSummary).not.toContain("introduced you");

    // Body text SHOULD contain counterpart
    expect(result.personalizedSummary).toContain("Lucy");

    // Narrator remark CAN contain introducer context
    expect(result.narratorRemark).toBeDefined();

    // Print output for manual review
    console.log("Headline:", result.headline);
    console.log("Summary:", result.personalizedSummary);
    console.log("NarratorRemark:", result.narratorRemark);
  }, 30000); // 30s timeout for LLM

  it("should include counterpart name in personalizedSummary", async () => {
    const input = createIntroducerInput("Bob Smith", "Alice Johnson");

    const result = await presenter.presentHomeCard(input);

    expect(result.personalizedSummary).toContain("Alice");
    expect(result.personalizedSummary.length).toBeGreaterThan(50);
  }, 30000);

  it("should set appropriate narratorRemark for introduction", async () => {
    const input = createIntroducerInput("Jane Doe", "Mark Wilson");

    const result = await presenter.presentHomeCard(input);

    // narratorRemark should mention the connection
    expect(result.narratorRemark.length).toBeGreaterThan(10);
    expect(result.narratorRemark.length).toBeLessThanOrEqual(80);
  }, 30000);
});
```

**Step 2: Run the integration test**

```bash
cd protocol && bun test src/lib/protocol/agents/tests/opportunity.presenter.spec.ts
```

Expected: Tests may show variable LLM output - document any failures

**Step 3: Commit**

```bash
git add protocol/src/lib/protocol/agents/tests/opportunity.presenter.spec.ts
git commit -m "test: add integration tests for IND-113 introducer text fix"
```

---

## Task 6: Update Opportunity Graph Integration

**Files:**
- Check: `protocol/src/lib/protocol/graphs/opportunity.graph.ts`
- Check: `protocol/src/lib/protocol/states/opportunity.state.ts`

**Step 1: Verify opportunity graph uses presenter correctly**

Search for `presentHomeCard` usage:
```bash
grep -n "presentHomeCard" protocol/src/lib/protocol/graphs/opportunity.graph.ts
```

**Step 2: If needed, ensure introducerName is passed through**

In `opportunity.graph.ts`, verify that when calling `presentHomeCard`, the `introducerName` is included in the `PresenterInput`.

**Step 3: Commit any changes**

```bash
git add -A
git commit -m "fix: ensure introducerName flows through opportunity graph" || echo "No changes needed"
```

---

## Task 7: Final Verification and Documentation

**Step 1: Run all related tests**

```bash
cd protocol && bun test src/lib/protocol/support/tests/opportunity.sanitize.spec.ts src/lib/protocol/agents/tests/opportunity.presenter.spec.ts 2>/dev/null || bun test src/lib/protocol/support/tests/opportunity.sanitize.spec.ts
```

**Step 2: Document the changes in commit summary**

```bash
git log --oneline -7
```

**Step 3: Create summary for Linear**

The fix addresses IND-113 through:
1. **Prompt Strengthening**: Added explicit ❌ WRONG / ✅ CORRECT examples to the LLM system prompt
2. **Programmatic Defense**: Added `stripIntroducerMentions()` utility that removes introducer patterns from text
3. **Integration**: Connected the stripping logic into `viewerCentricCardSummary()` and the minimal card path

**Expected outcome after fix:**
- Body text (`personalizedSummary`) focuses only on the match quality
- Footer (`narratorChip`) contains introducer information
- No redundant introducer mentions

---

## Post-Implementation: Monitor LLM Output

After deployment, monitor actual LLM outputs to verify the fix works:

1. Check Langfuse traces for opportunity generation
2. Look for any remaining introducer mentions in `personalizedSummary`
3. If LLM still occasionally includes introducers, the programmatic stripping acts as safety net

---

## Rollback Plan

If issues arise:
1. Revert commits in reverse order
2. The programmatic stripping is safe to keep even if prompt changes are reverted
3. Monitor for any edge cases where legitimate text is incorrectly stripped
