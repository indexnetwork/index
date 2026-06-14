---
template_version: 2
date: 2026-06-12T00:20:55+0300
author: Yankı Ekin Yüksel
repository: agentvillage-controlplane
branch: feat/adhoc-announcement-broadcasts
commit: dbbe42d
review_type: pr
scope: "PR #12 feat/adhoc-announcement-broadcasts vs main (f481ef6..dbbe42d)"
scope_strategy: first-parent
in_scope_files_count: 5
status: ready
severity: { critical: 1, important: 3, suggestion: 3 }
verification: { verified: 8, weakened: 1, falsified: 0 }
blockers_count: 4
tags: [code-review, control-plane, announcements, telegram, broadcast]
---

# Code Review — PR #12: Ad-hoc Broadcast Announcements (control plane)

**Commit:** `dbbe42d` · **Status:** `ready` · **Findings:** 1🔴 · 3🟡 · 3🔵 · **Verification:** 8✓ / 1− / 0✗

## Top Blockers

1. **I3** — Concurrent sends can double-deliver the broadcast to every resident (no ready-claim before Telegram fan-out)
2. **I2** — Malformed JSON on the send route silently becomes a fleet-wide broadcast instead of a 400
3. **I4** — Partial delivery failures become terminal; failed tenants have no retry path

---

## Legend

```text
Severity    🔴 fix before merge   🟡 fix soon   🔵 nice to have   💭 discuss
ID prefix   I interaction   Q quality   S security   G gap
Verify      ✓ verified   − weakened (demoted)   ✗ falsified (dropped)
Annotate    [precedent-weighted]   [cascade: <kind>]   [subsumed-by <ID>]
```

---

## 🔴 Critical

### I3 🔴 Concurrent sends double-deliver to Telegram `[cascade: duplicate-processing]`

**Where**
`control-plane/src/announcements.js:270` · `:282` · `:287` · `:356-357`

**Code**
```js
const { rows } = await query('SELECT * FROM daily_brief_announcements WHERE id = $1', [trimmedId]);
// ... if (announcement.status === 'sent') { ... if (announcement.status !== 'ready') {
// ... after fan-out:
SET status = 'sent', sent_at = now(), delivery = $2, updated_at = now()
WHERE id = $1
```

**Why**
The ready check is a plain `SELECT` (no `FOR UPDATE`, no advisory lock) and the terminal write is `WHERE id = $1` only — there is no conditional claim. Two concurrent `POST /announcements/:id/send` requests (double-click in the admin UI, retried curl, two operators) both observe `status='ready'`, both run the full Telegram fan-out, and every resident receives the announcement twice. The check-then-act spans the entire awaited fan-out window (seconds at fleet scale), making the race window wide, and the landing UI's busy guard is render-async (see landing review I1) so it does not close it.

**Fix**
Claim the row before fan-out: `UPDATE daily_brief_announcements SET status = 'sent', sent_at = now() WHERE id = $1 AND status = 'ready' RETURNING *` — proceed only when `rowCount === 1`, then write `delivery` after fan-out. Test-send (canary) path keeps the plain SELECT since it never transitions state.

**Alt**
`SELECT ... FOR UPDATE` inside a transaction held across fan-out works but pins a connection for the whole delivery; the conditional-claim UPDATE is cheaper and idempotent.

---

## 🟡 Important

### I2 🟡 Malformed JSON silently becomes a fleet-wide broadcast

**Where**
`control-plane/src/index.js:277-278` · `control-plane/src/announcements.js:263-264`

**Code**
```js
const body = await readJson(req).catch(() => ({}));
const data = await sendBroadcastAnnouncement(route.announcementId, { only: body.only });
// announcements.js:
const onlyFilter = String(only || '').trim().toLowerCase();
const testMode = Boolean(onlyFilter);
```

**Why**
`readJson` throws on malformed JSON (`index.js:57`), but the catch collapses it to `{}` → `only: undefined` → `testMode=false` → all live tenants. A client that *intended* a canary test-send (`{"only": "me@..."}`) but shipped a broken body gets a production broadcast — the most destructive possible interpretation of an input error.

**Fix**
Return 400 on unparseable JSON for this route (e.g. `readJson(req).catch(() => null)` and reject `null`), keeping `{}` semantics only for a genuinely empty body.

### I1 🟡 Brief announcements can be PATCHed into a false-promise `ready` state

**Where**
`control-plane/src/announcements.js:107` · `:167` · `:277`

**Code**
```js
const status = channel === 'broadcast' ? normalizeStatus(input.status) : 'draft';   // create
params.push(normalizeStatus(input.status));                                          // update: no channel check
if (announcement.channel !== 'broadcast') {                                          // send rejects briefs
```

**Why**
Create forces brief rows to `draft`, but `updateAnnouncement` applies any editable status to any unsent row regardless of channel. A brief PATCHed to `ready` promises sendability that the send guard then rejects — and since `/brief/announcements` filters by channel only (never status, `index.js:259`, `announcements.js:80`), the kanban status is entirely meaningless for briefs while still being mutable. Inconsistent state surface, confusing for API users and future code.

**Fix**
In `updateAnnouncement`, reject `status` changes when the existing row's `channel !== 'broadcast'` (400), mirroring the create-time rule.

### I4 🟡 Partial delivery failures become terminal — no retry path for failed tenants

**Where**
`control-plane/src/announcements.js:324` · `:356` · `:282` · `:136`

**Code**
```js
return { ...target, ok: false, error: e.message || String(e) };  // tenant failure → result row
SET status = 'sent', sent_at = now(), delivery = $2, updated_at = now()  // unconditional terminal write
```

**Why**
A broadcast with 3 failed tenants (bot blocked, Telegram 5xx) still transitions to `sent`, after which both resend (`:282`) and edit (`:136`) return 409. The failures are *recorded* in `delivery` but *unactionable* — the only recovery is composing a duplicate announcement, which re-sends to the residents who already received it. Precedent: this repo's delivery features repeatedly grew recovery paths as same-week follow-ups (`80e1fe8` bulk unblock, `0ed1e06` send options).

**Fix**
Add a retry affordance scoped to failures: e.g. `POST /announcements/:id/send` with `{retryFailed: true}` allowed on `sent` rows, fanning out only to tenants whose last delivery result was `ok:false && !skipped`, merging results into `delivery`.

---

## 🔵 Suggestions

### S1 🔵 Bot token interpolated into Telegram URL unencoded; validated copy ≠ stored copy

**Where**
`control-plane/src/announcements.js:248` · `control-plane/src/telegram.js:6-13` · `control-plane/src/tenants.js:1619-1620`

**Fix**
`encodeURIComponent(botToken)` (and `.trim()`) at the send site. Provisioning validates a trimmed copy against `/^\d+:[A-Za-z0-9_-]{20,}$/` but stores the original value, so a token with surrounding whitespace passes validation yet fails (or alters) the request at send time. The charset regex blocks genuine path-smuggling for validated tokens — this is defense-in-depth plus correctness for whitespace, not an exploitable SSRF.

### Q2 🔵 Decrypt failure reported as `no_bot_token`

**Where**
`control-plane/src/announcements.js:242` · `:318`

**Fix**
Distinguish the bare `catch` (corrupt secret / wrong master key) from genuinely absent secrets — e.g. skip reason `secret_decrypt_failed` vs `no_bot_token` — so an ops-level key problem isn't diagnosed as per-tenant onboarding gaps.

### Q7 🔵 No HTTP-level test for the send route

**Where**
`control-plane/src/index.js:100` · `control-plane/tests/announcements.test.js:25,143`

**Fix**
The 13 unit tests exercise the module directly; routing, `requireApiKey`, and `readJson` behavior for `POST /announcements/:id/send` are untested. Add one route-level test (inject the handler with a mock req/res) covering auth-reject, malformed-body, and happy path — it would have caught I2.

---

## 💭 Discussion

### Q9 💭 Migration relaxes NOT NULL with no reverse path

**Where**
`control-plane/src/migrations/0009_announcement_broadcasts.sql:2`

**Why**
`ALTER COLUMN brief_date DROP NOT NULL` is one-way, but the migration runner (`db.js:22-28`) is forward-only by design and no migration in the repo carries a down path — convention-consistent. Worth noting only because re-tightening NOT NULL later requires backfilling dateless broadcast rows first.

### Q10 💭 DB CHECK accepts `sent` while the JS normalizer rejects it

**Where**
`control-plane/src/migrations/0009_announcement_broadcasts.sql:14` · `control-plane/src/announcements.js:5`

**Why**
Intentional asymmetry: `sent` is system-set by the send path only (`:356`), never request-settable. Verified that no other write path needs it. Document the invariant with a comment on `EDITABLE_STATUSES` so a future contributor doesn't "fix" the asymmetry.

---

## Impact

| Consumer | Change | Findings |
| --- | --- | --- |
| `control-plane/src/index.js:259` (`/brief/announcements`) | now filters `channel='brief'` | I1 |
| `control-plane/src/index.js:267-293` (6 route bindings) | channel param, send route added | I2, Q7 |
| `agentvillage/skills/.../build-daily-brief-context.ts:547` (cross-repo) | unchanged contract; broadcasts excluded | I1 |
| Telegram Bot API (cross-process, per-tenant) | new direct fan-out | I3, I4, S1 |

---

## Precedents

| Commit | Subject | Follow-ups |
| --- | --- | --- |
| `8fab4a1` | feat: add daily brief announcements | reverted same day (`167f8fb`), relanded + review fixes (`19b11d2`) |
| `960f649` | Add digest send triggers for ready kanban cards | `0ed1e06` Telegram send options, `80e1fe8` bulk unblock recovery |
| `864fc92` | Add Telegram user allowlist and idempotency lookup | backed out same day (`e387e7b`); `3ccbb77` explicit bot-token validation |
| `85474fe`+ | Tenant secret/key provisioning, env checks | `6fff503` lightweight rekey; 2× same-day env-check fixes |

**Recurring lessons (most → least frequent)**

1. Announcement/delivery features here repeatedly needed same-day reverts or recovery-path follow-ups — ship the retry/recovery affordance with the feature (→ I4).
2. Record delivery state only after actual send; idempotency must be structural, not UI-enforced (→ I3).
3. Validate bot-token failures explicitly; secret-dependent flows need diagnostics (→ Q2, S1).

---

## Recommendation

| # | ID | Action | Alt / Note |
| - | -- | ------ | ---------- |
| 1 | I3 | Replace the post-fan-out unconditional UPDATE with a pre-fan-out conditional claim (`... WHERE id=$1 AND status='ready' RETURNING *`); abort on 0 rows | `SELECT ... FOR UPDATE` in a tx (pins a connection) |
| 2 | I2 | 400 on unparseable JSON body for the send route | — |
| 3 | I4 | Allow `{retryFailed: true}` re-send to failed (non-skipped) tenants on `sent` rows | Or document "recreate announcement" as the deliberate recovery story |
| 4 | I1 | Reject status PATCH when `channel !== 'broadcast'` | — |
| 5 | S1/Q2 | Trim+encode token at send; split `secret_decrypt_failed` from `no_bot_token` | — |
