# Daily Digest Card Quality Audit — 2026-06-13

**Question:** Apart from opportunity growth, are there problems in the digest cards? Grammar, broken links, hallucinations, ownership leaks, etc.
**Scope:** All `Morning digest — 2026-06-13` kanban cards from the agentvillage control-plane.
**Sources:** control-plane `/tenants/kanbans` (158 tenants) + Index Network prod Neon DB (`protocol_prod`).

## Coverage
- 158 tenants, **155 digest cards today**, 98 cards carry an opportunity.
- 96 unique opportunity IDs, 98 unique connect-link codes, 51 unique profile links.

## ✅ What's clean

| Check | Result |
|---|---|
| **Ownership** (recipient is an actor + connect link belongs to them) | **98/98 OK** — zero MISMATCH, zero MISSING, zero cross-user leaks |
| **Connect links** (`/c/<code>`) | All sampled return `302 →` index.network; all 98 codes exist in DB |
| **Link expiry** | None expired |
| **Profile links** (`index.network/u/<uuid>`) | **51/51 resolve to real users** (no fabricated people) |
| **Event/Luma links** | All sampled `200`; 0 malformed URLs across 962 event links |
| **Template/placeholder leaks** | None — no `{name}`, `{{ }}`, `undefined`, `null`, no-reply marker, or JSON leakage in any of 155 bodies |
| **Grammar / prose** | Clean and well-toned in all read samples |
| **Hallucination** | Digest "because…" rationales faithfully match each opportunity's stored `interpretation.reasoning` (spot-checked) — no invented claims |

## ⚠️ Issues found

### 1. Calendar events are out of chronological order — systematic (HIGH)
**Every** multi-event card (154/154) lists events out of time order. The digest builds a chronological "today" list and then **appends a personalized/extra event at the end without re-sorting**, so the timeline breaks.

- 117 cards: exactly the last item is out of order.
- 37 cards: multiple breaks (2+ appended events).
- Today's dominant offender: **"Why YOU should start (or join) an AI Safety org" (5:30 PM)** appended after the **7:30 PM** "Esmeralda in Bloom" party in 110 cards.

Example (askjulienguyen@gmail.com): `10:00 → 3:00 → 4:00 → 5:30 → 7:30 → 5:30` — the trailing 5:30 PM item lands after 7:30 PM.

**Fix:** merge the personalized event into the list and sort all events by start time before rendering.

### 2. More than half of surfaced opportunities are `draft`, not `pending` (MEDIUM)
Digest opportunity status split: **45 pending / 53 draft**. Drafts are pre-`pending` in the lifecycle (`latent → draft → … → pending`). Confirm whether `draft` opportunities are intended to be delivery-eligible, or whether the digest should gate on `pending`+. (Ownership for the drafts is still correct.)

### 3. Cosmetic whitespace — low priority (LOW)
- 154/155 cards contain double spaces in venue text (e.g. `Wellness Space  - 405 Healdsburg Ave`).
- 154/155 cards have trailing spaces before newlines (e.g. `120 North Street \n`).

Harmless in most renderers but sloppy; trace to the event-formatting template (likely a venue/address concatenation that double-joins).

## Verdict
Digests are **safe and accurate** on the things that matter most: correct recipient ownership, working links, real people, and faithful (non-hallucinated) rationales. The one substantive content bug is the **non-chronological event ordering** (universal), plus a policy question about **delivering `draft`-status opportunities**. Whitespace is cosmetic.

## Suggested next steps
1. Sort the merged event list by start time before rendering the digest (fixes #1, universal).
2. Decide and enforce the minimum opportunity status for digest delivery (`draft` vs `pending`) (#2).
3. Trim trailing/double whitespace in the event/venue formatter (#3).
