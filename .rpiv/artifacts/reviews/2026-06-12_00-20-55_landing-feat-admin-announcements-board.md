---
template_version: 2
date: 2026-06-12T00:20:55+0300
author: Yankı Ekin Yüksel
repository: agentvillage-landing
branch: feat/admin-announcements-board
commit: 199041c
review_type: pr
scope: "PR #16 feat/admin-announcements-board vs main (cfd930c..199041c)"
scope_strategy: first-parent
in_scope_files_count: 5
status: ready
severity: { critical: 0, important: 1, suggestion: 5 }
verification: { verified: 8, weakened: 2, falsified: 1 }
blockers_count: 1
tags: [code-review, landing, admin, announcements, nextjs]
---

# Code Review — PR #16: Admin Announcements Board (landing)

**Commit:** `199041c` · **Status:** `ready` · **Findings:** 0🔴 · 1🟡 · 5🔵 · **Verification:** 8✓ / 2− / 1✗

## Top Blockers

1. **I1** — Double-click on "Send now" can fire two broadcast POSTs before the busy flag renders (constituent of control-plane review I3 🔴)

---

## Legend

```text
Severity    🔴 fix before merge   🟡 fix soon   🔵 nice to have   💭 discuss
ID prefix   I interaction   Q quality   S security   G gap   PM peer-mirror
Verify      ✓ verified   − weakened (demoted)   ✗ falsified (dropped)
Annotate    [precedent-weighted]   [cascade: <kind>]   [subsumed-by <ID>]
```

---

## 🟡 Important

### I1 🟡 No re-entrancy guard on send — double-click fires two broadcasts `[cascade constituent — root cause: controlplane review I3]`

**Where**
`app/admin/announcements/page.tsx:160` · `:399`

**Code**
```tsx
setBusyIds((current) => ({ ...current, [id]: true }));   // inside withBusy — no early return if already busy
<button onClick={() => sendAnnouncement(a)} ... disabled={busy}>
```

**Why**
The only protection against double-submission is `disabled={busy}`, which takes effect on the *next render*. Two rapid clicks both enter `withBusy` before React re-renders, producing two `POST /send` requests — and the control plane currently has no conditional ready-claim (its review, finding I3), so both fan out to every resident. The UI-side guard is half of the fix for that 🔴 cascade.

**Fix**
First line of `withBusy`: `if (busyIds[id]) return;` (read via a ref or functional check). The CP-side conditional claim remains the authoritative fix; do both.

---

## 🔵 Suggestions

### Q1 🔵 Daily composer and broadcast board don't share a channel predicate

**Where**
`app/admin/announcements/page.tsx:124` · `app/admin/page.tsx:1268` · `app/api/admin/announcements/route.ts:25`

**Fix**
The board queries `channel=broadcast`; the pre-existing daily composer queries by date with no channel, and the CP allows broadcast rows to carry a date (`announcements.js:103`), so a dated broadcast (creatable via direct API) shows up in the daily-brief composer list. Pass `channel=brief` from the composer fetch at `app/admin/page.tsx:1268` to make both consumers explicit.

### Q6 🔵 Edit failures close the modal as if they succeeded

**Where**
`app/admin/announcements/page.tsx:157-164` · `:430-431` · `:469-471`

**Fix**
`withBusy` catches without rethrowing, so `await patchAnnouncement(...)` always resolves and `setEditing(null)` closes the modal even when the PATCH failed (e.g. CP 409 for a just-sent row); EditModal's own error state at `:469-471` is dead code. Have `withBusy` rethrow (or return success boolean) and keep the modal open on failure.

### Q5 → see 💭 (weakened) · Q7 🔵 Send proxy forwards arbitrary client JSON upstream

**Where**
`app/api/admin/announcements/[id]/send/route.ts:17` · `:21`

**Fix**
`req.json()` output is forwarded verbatim under the control-plane bearer key. Today CP only reads `only`, but any future CP field becomes silently reachable from the browser. Whitelist: `body: JSON.stringify(typeof body?.only === "string" ? { only: body.only } : {})`.

### I2 🔵 Sent announcements are deletable, destroying the delivery audit record

**Where**
`app/admin/announcements/page.tsx:412-413` · CP `announcements.js:197`

**Fix**
CP makes sent rows immutable for edit/resend but `DELETE` has no status guard, and the board exposes Delete as the only sent-card action — the one mutable thing about a "permanent" record is total erasure of who received what. Consider soft-delete (`active=false`) for sent rows, or at least a stronger confirm.

### PM1 🔵 Status rendering diverges from peer board's StatusPill

**Where**
`app/admin/kanbans/page.tsx:189` · `app/admin/announcements/page.tsx:273,388`

**Fix**
Kanbans board renders status via a `StatusPill` component; the announcements board encodes status purely in column placement and inline conditionals. Extract/reuse the pill for visual consistency across admin boards.

---

## 💭 Discussion

### Q5 💭 Skipped deliveries listed under failure details *(weakened: aggregate counts are correct)*

**Where**
`app/admin/announcements/page.tsx:352` · `:366` · `:380`

**Why**
`filter((r) => !r.ok)` pulls `skipped: true` rows (`no_telegram_user`, `no_bot_token`) into the red failure list, though the summary chips count them separately. Split the detail list on `r.skipped` to match the chips.

### Q3 💭 Repo has zero test files

**Where**
repo-wide (integration scan: 0 test files)

**Why**
Convention-consistent — the landing has no test infrastructure at all, so no per-finding test gap is actionable here. The send/test-send body branching (`page.tsx:237`) and the proxy 424 guard would be the first candidates if a test harness is ever added.

### G1 💭 Nav anchor vs `<Link>` *(weakened: file-convention-consistent)*

**Where**
`app/admin/page.tsx:1416`

**Why**
The new nav entry uses a plain `<a>`, but so does all of `app/admin/page.tsx`'s nav; sibling pages use Next `<Link>`. Whole-file convention question, not a PR defect.

### D1 💭 Strict 424 guard is intentionally correct — keep it

**Where**
`app/api/admin/announcements/[id]/send/route.ts:29`

**Why**
`res.status === 404 && data?.error === "not found"` matches only the CP router's unknown-route body (`index.js:209`), while a missing announcement returns `announcement not found` and correctly falls through as a plain 404. This is *stricter and better* than the peer send-ready route, which 424s any 404. Consider back-porting the strict check to the peer.

### D2 💭 200 vs peer's 202 — intentional

**Where**
`app/api/admin/announcements/[id]/send/route.ts:35` · peer `send-ready/route.ts:27`

**Why**
CP announcement send is synchronous (returns final delivery counts), so 200 is right; the peer's 202 reflects an async bulk enqueue. No change needed.

---

## Pattern Analysis

| Peer | Mirrored | Missing | Diverged | Intentional |
| --- | ---: | ---: | ---: | ---: |
| `app/admin/kanbans/page.tsx` | 10 | 21 | 16 | 0 |
| `app/api/admin/kanbans/send-ready/route.ts` | 9 | 0 | 6 | 0 |

**Missing/Diverged rows drive:** PM1, D1, D2, I1 (busy-map divergence)

**Key divergences from peer**
- Most page-pair Missing rows are kanban-domain helpers (cron/resident/bulk actions) — domain-inapplicable, dropped at reconciliation.
- Route pair: stricter 424 guard (D1, improvement) and 200-vs-202 (D2, intentional); auth/env/error scaffolding fully mirrored.

---

## Impact

| Consumer | Change | Findings |
| --- | --- | --- |
| `app/admin/page.tsx:1268` (daily composer GET) | shares `/api/admin/announcements` with new channel param | Q1 |
| `app/admin/page.tsx:1125` (composer POST) | unchanged (no channel → CP defaults brief) | Q1 |
| Control plane `/announcements/:id/send` (cross-repo) | new proxy consumer | I1, Q7, D1 |

---

## Precedents

| Commit | Subject | Follow-ups |
| --- | --- | --- |
| `ad060e2`/`39f8902` | feat: manage daily brief announcements | reverted same day (`b3958e8`), relanded |
| `1479bb7` | feat(admin): add daily kanban dashboard | 5 missing-operator-action follow-ups within 2 days |
| `2711e8f` | Add admin dashboard and API proxy endpoints | localStorage→signed-cookie auth fix (`61c7198`), state-loss fix, retry affordance |
| `f2bc5aa` | Add OpenRouter credit top-up UI and API | same-day page adjustment; env-check UI follow-up |

**Recurring lessons (most → least frequent)**

1. Admin board features here grow missing operator actions within days — the sent-card terminal state (I2) and failed-delivery visibility (Q5) are the likely first asks.
2. Auth/session/env handling is the recurring breakage area — this PR mirrors the peer's guard scaffolding faithfully (verified Mirrored ×9).
3. Same-day revert/reland happened to the previous announcements UI — keep the PR paired tightly with its control-plane counterpart at deploy time.

---

## Recommendation

| # | ID | Action | Alt / Note |
| - | -- | ------ | ---------- |
| 1 | I1 | Add `if (busyIds[id]) return;` re-entrancy guard at the top of `withBusy` | Pair with CP conditional claim (CP review I3 — the authoritative fix) |
| 2 | Q6 | Rethrow from `withBusy` (or return a success flag) so EditModal stays open on failure | — |
| 3 | Q7 | Whitelist `{only}` in the send proxy body | — |
| 4 | Q1 | Send `channel=brief` from the daily composer fetch | — |
| 5 | I2 | Soft-delete (`active=false`) for sent rows instead of hard DELETE | Stronger confirm as minimum |
