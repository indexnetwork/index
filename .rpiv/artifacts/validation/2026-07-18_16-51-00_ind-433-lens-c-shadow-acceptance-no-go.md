# IND-433 Lens C shadow acceptance gate — insufficient-data NO-GO

Date: 2026-07-18 (UTC)
Scope: acceptance gate for IND-433 ("Review 20 eligible negotiation-evidence
hypotheses, or record an insufficient-data no-go, with zero private-memory,
reasoning, disclosure, or cross-user leakage findings") — precondition for
starting IND-437.
Method: read-only dev audit (SELECT-only, via a local replay of the exact
shipped pipeline code: `collectNegotiationEvidenceSegments` →
`extractAllowlistedEvidence` → recurrence floor) + targeted hermetic tests +
dev deploy-log grep. No shared data mutated, no workers run against shared
queues, no live questions enabled, no LLM mining pass executed against user
data. All evidence below is aggregate-only: no opportunity/user/intent/task
identifiers, no user text, no message content, no reasoning, no vectors.

## Decision

**NO-GO (insufficient eligible data under the shipped pipeline).** Zero
negotiation-evidence hypotheses can currently be mined by the Lens C shadow
pass on dev, so the 20-hypothesis review cannot be performed. The blocking
cause is structural, not volume: every evidence-bearing opportunity lacks the
`context.networkId` binding the shipped single-network pass requires, so every
pass exits before segment collection. Performing the review anyway would
require bypassing the shipped network scope binding (a contamination guard),
which this gate treats the same as weakening k=5 or the allowlist — forbidden.
IND-437 must not begin.

## Evidence (aggregate only)

1. **Flag state.** Railway dev service `protocol` (environment `dev`) has
   `NEGOTIATION_EVIDENCE_QUESTIONS_MODE=shadow`; the local `.env.development`
   mirror agrees. Nothing was flipped during this audit.

2. **Capture is working.** Neon project "Protocol", dev branch
   `br-late-tooth-ahlsfgdb` (the branch behind the dev service's database
   endpoint): **8** negotiation tasks carry capture-time `intentSnapshots`
   (all created 2026-07-17, the first capture day), spanning **8 distinct
   opportunities**. All 16,626 pre-deploy negotiation tasks lack snapshots and
   fail closed, as designed (no backfill).

   Caution for re-reviewers: the local `.env.development` `DATABASE_URL`
   points at a *different* Neon branch (`br-delicate-dream-ahoh7xkw`) than the
   dev service. Probes must target the dev service's branch explicitly.

3. **Scope shape.** The snapshot tasks yield 35 candidate (recipient, intent)
   snapshot pairs; **5 scopes** span ≥5 task-opportunities (8/8/8/8/7) — the
   figure earlier aggregates reported as "at/above the k=5 floor". Those
   aggregates counted capture-time task metadata only; they did not apply the
   shipped pass's eligibility gates (below).

4. **Why the shipped pass mines nothing.** Replaying the exact shipped code
   against dev data:
   - **Network binding absent: 0 of 8** evidence-bearing opportunities have
     `context.networkId` (their `context` is an empty object), while all 8
     tasks recorded a capture-time `networkId` in task metadata. The shipped
     pass derives its single-network grouping from `opportunity.context`, so
     every pass exits pre-collection ("no single-network pool"). Dev-wide,
     only ~34% of opportunities carry `context.networkId` (3,523 of 10,458
     all-time; 672 of 1,970 in the last 30 days) — the gap is systemic to the
     creation flow of these opportunities, not a one-off.
   - **Pool status:** 2 of the 8 opportunities are in a terminal `rejected`
     status, outside the live-pool statuses (`draft|latent|pending|
     negotiating`), so they could never enter the mining pool even with the
     network binding fixed.
   - **Live telemetry agrees:** the active dev deployment's logs contain zero
     `NegotiationEvidenceShadow` "shadow result" lines (log search verified
     working against other terms).

5. **Distance to eligibility (counterfactual upper bound, non-shipped).**
   Re-running the same pipeline code with two deliberately permissive,
   NON-shipped assumptions — pass network taken from validated capture-time
   task metadata, and no pool-status filter — the 5 floor-satisfying scopes
   each reach **exactly** `distinctOpportunities = 5` (zero margin over k=5),
   with per-scope allowlisted evidence of 6 bilateral-action units + 5
   coarse-outcome units, **0 owner answers and 0 shared messages**, and 6–7
   records excluded per scope by the allowlist. Capture-time intent
   fingerprints matched current fingerprints for every validated task (no
   fingerprint drift). Critically, the 5 scopes are 5 intent views over the
   **same underlying negotiations** — one evidence substrate, not five
   independent ones. Even in this counterfactual, a retained hypothesis needs
   support spanning all 5 of 5 opportunities from generic action labels and
   coarse outcomes alone; 20 meaningfully distinct eligible hypotheses cannot
   exist. The review would be structurally vacuous even if the guard were
   bypassed — which it was not.

6. **Zero leakage findings.** Nothing user-authored, private, or reasoned was
   exposed anywhere in this audit:
   - The shipped pass never ran on dev (item 4), so no hypothesis text,
     span, or evidence content exists in any log; routine telemetry is
     aggregate-only by type (`NegotiationEvidenceTelemetry` carries counts
     only), confirmed by hermetic test.
   - The read-only probe printed anonymized scope labels and counts only.
   - Gate machinery verified hermetically (no DB/LLM): **35/35** protocol
     tests (`negotiation-evidence` extractor/verifier/shadow/env: reasoning
     and disclosure-subject exclusion by construction, untagged-message
     exclusion, `screened_out` exclusion, speaker constraint —
     counterparty statements can never support a claim about the recipient,
     verbatim-span verification, continuation grouping, k-floor, aggregate-
     only telemetry) and **10/10** api tests
     (`negotiation-evidence.shadow.spec`: cross-recipient/intent/network/
     task isolation, capture-time snapshot fail-closed rules, final
     lifecycle+fingerprint revalidation, bounded error telemetry).
   - Note (not a defect, but review-relevant): the api-side segment
     projection never sets `sharedTagged`, so `shared_message` evidence is
     currently impossible by construction — the strictest reading of the
     allowlist. Owner answers are likewise not yet projected. Any future
     wiring of either MUST preserve the explicit-consent tag and
     answerer-authority checks the extractor enforces.

## Constraints honored

- `NEGOTIATION_EVIDENCE_QUESTIONS_MODE` remains `shadow` on dev; nothing
  flipped; IND-437 not started.
- k=5 distinct-opportunity floor, single-network binding, and the four-family
  allowlist unchanged; the counterfactual in item 5 was a read-only diagnostic
  replay, not a code or config change.
- Read-only queries only; no shared Neon data mutated; no API workers run
  against shared queues; no LLM mining executed over user data.
- This record and all logs/telemetry produced during the audit contain only
  aggregates and fixed codes.

## Re-review criteria

Re-run this acceptance review when BOTH:

1. **The network binding gap is closed** — either opportunity creation flows
   populate `context.networkId` for negotiable opportunities, or IND-433
   follow-up work explicitly decides to derive the pass network from validated
   capture-time task metadata (a design decision to make in code review, not
   in an acceptance audit). Until one of these lands, the shadow pass mines
   nothing regardless of accrual.
2. **Independent substrate exists** — shadow telemetry (grep dev deploy logs
   for `NegotiationEvidenceShadow` → "negotiation-evidence shadow result")
   reports `hypothesesRecurrent > 0` across scopes that do not all resolve to
   the same underlying negotiation set, with owner-answer or shared-message
   evidence present (not only generic bilateral actions / coarse outcomes),
   so that 20 reviewable, distinct hypotheses are plausibly reachable.

At that point the hypothesis review (grounded / non-sensitive / neutrally
askable, ≥80% pass over 20 hypotheses, zero leakage findings) can be performed
from a read-only shadow re-run; until then this gate stays NO-GO.
