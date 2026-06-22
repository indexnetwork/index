# Landing Manifesto Promo Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use executing-plans to implement this plan task-by-task.

**Goal:** Replace the landing page's `They're closer than you think` section with a full-width promo banner that reuses the `found-in-translation-6` hero visual and links internally to `/found-in-translation-6`.

**Architecture:** Update the existing landing page in `apps/web/src/app/page.tsx` in place. Remove the old manifesto promo section and its dedicated animated graph logic, then insert a simpler banner section that uses the existing hero image asset, a dark overlay, and a `react-router` `Link` CTA.

**Tech Stack:** React, React Router, Tailwind utility classes, inline JSX styles already used in the landing page

---

### Task 1: Replace The Promo Section

**Files:**
- Modify: `apps/web/src/app/page.tsx`

**Step 1: Write the failing test**

There is no focused automated test harness for this static landing-page composition change. Verify by checking for the old section markup in `apps/web/src/app/page.tsx` and treating its presence as the pre-change failure condition.

**Step 2: Run test to verify it fails**

Run: inspect `apps/web/src/app/page.tsx`
Expected: the old `They're closer than you think` section, animated graph markup, and external story link are still present

**Step 3: Write minimal implementation**

- Add `Link` import from `react-router`
- Remove the animated graph `useRef`, effect, and CSS that only supported the old section
- Replace the old section with a full-width banner using:
  - background image `/found-in-translation/found-in-translation-1-hero.png`
  - dark readability overlay
  - concise promo copy
  - internal CTA linking to `/found-in-translation-6`

**Step 4: Run verification**

Run:
- `cd apps/web && bun run lint`
- Read IDE diagnostics for `apps/web/src/app/page.tsx`

Expected:
- Lint exits successfully
- No new diagnostics in the edited file

**Step 5: Commit**

Do not commit unless the user explicitly asks for it.
