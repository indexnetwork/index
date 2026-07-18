# IND-434 Lens B shadow acceptance gate — insufficient-data NO-GO

Date: 2026-07-18 (UTC)
Scope: acceptance gate for IND-434 ("Review 20 eligible hypotheses, or record an
insufficient-data no-go; at least 80% must be grounded, non-sensitive, and
neutrally askable") — precondition for starting IND-438.
Method: read-only dev audit + targeted hermetic tests. No shared data mutated,
no workers run against shared queues, no live questions enabled. All evidence
below is aggregate-only: no opportunity/user/intent identifiers, no user text,
no classifier reasoning, no raw outcome rows.

## Decision

**NO-GO (insufficient eligible data).** Zero outcome feedback events have been
captured, so zero eligible hypotheses exist to review. The 20-hypothesis review
cannot be performed without weakening the k=5 independent-support floor or the
no-backfill rule, which IND-434 forbids. IND-438 must not begin.

## Evidence (aggregate only)

1. **Flag state.** Railway dev service `protocol` has
   `OUTCOME_QUESTIONS_MODE=shadow` (capture + mining active, shadow-only).
   Prod does not have the feature at all (table absent on the production
   branch; PR #1149 not yet released to main).

2. **Captured events.** Neon project "Protocol", dev branch
   (`br-late-tooth-ahlsfgdb`, confirmed as the branch behind the dev service's
   database endpoint): `opportunity_outcome_events` exists and contains
   **0 rows** (0 accepted, 0 rejected, 0 distinct recipients).

3. **Exposure window.** The Lens B capture path merged to dev at
   2026-07-18 03:28 UTC (commit `7cd26f6`, PR #1149) and deployed at
   03:31 UTC — roughly **9 hours** of exposure at audit time. Only *future*
   explicit owner actions are captured (IND-434 forbids historical backfill),
   so an empty table is the expected state, not a defect.

4. **Distance to the eligibility floor.** One eligible hypothesis requires a
   single recipient + intent + fingerprint scope holding ≥ k×2 = 10 distinct
   independent (counterpart-deduplicated) examples, each an explicit owner
   accept/reject with a cached presentation-safe snapshot. Current distance:
   10 of 10 missing for every scope (no scope exists).

5. **Accrual outlook (upper bounds from dev, aggregates only).**
   - Opportunity transitions to accepted/rejected across ALL users on dev,
     last 4 weeks: ≈ 27 → 52 → 21 → 29 per week. This over-counts eligibility
     (it includes system/TTL/screening rejections, multiparty and
     snapshot-less opportunities that Lens B excludes).
   - Per-recipient distinct-counterpart density over the last 30 days of
     decided 2-party opportunities: 192 recipients with ≥1, median 4,
     max 50; **38 recipients** would sit at/above the 10-counterpart floor
     *if history counted* — it does not, but this shows the floor is
     plausibly reachable from live usage within weeks, so a re-review is
     worthwhile rather than a redesign.

6. **Gate machinery verified (hermetic, no live data).** Targeted suites all
   pass — 18/18 in `packages/protocol` (`outcome.env`, `outcome.hypotheses`,
   `outcome.shadow`: blind assignment, k-threshold, small-cell suppression,
   dedup, deterministic ordering) and 28/28 in `services/api`
   (`outcome.mining.shared`, `outcome-events.store`,
   `outcome-feedback.recorder`, `outcome-migration`: recipient/intent
   isolation, provenance and snapshot fail-closed rules, idempotency,
   redacted telemetry).
   Note: one recorder test ("returns null when OUTCOME_QUESTIONS_MODE is
   off") fails only when bun auto-loads a local `.env.development` that sets
   `OUTCOME_QUESTIONS_MODE=shadow`; running with the variable neutralized
   passes 28/28. Environmental, not a code defect.

## Constraints honored

- `OUTCOME_QUESTIONS_MODE` remains `shadow` on dev; nothing flipped.
- No live questions enabled; IND-438 not started.
- k=5 per side and ≥2 compared sides unchanged.
- Read-only queries only; no shared Neon data mutated; no API workers run.
- No raw outcomes, identifiers, user text, reasoning, vectors, or small-cell
  counts in this record or anywhere else.

## Re-review criteria

Re-run this acceptance review when shadow telemetry (grep dev deploy logs for
`OutcomeQuestionMiner` → `shadow_result`) reports non-zero `eligibleCount`
across scopes, or after enough capture time that
`opportunity_outcome_events` plausibly holds ≥10 distinct dedup keys within at
least one scope. At that point, hypothesis label + questionSeed review (the
grounded / non-sensitive / neutrally-askable rubric, ≥80% pass, 20 hypotheses)
can be performed from a read-only shadow re-run; until then this gate stays
NO-GO.
