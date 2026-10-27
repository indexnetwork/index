# MoralMod × Index integration — design

Date: 2026-10-27
Status: draft for Seref's approval (nothing built yet)
Counterparty: Sydney Levine Lab (decision-studio, flexible-moral-reasoning — both private, read access confirmed)

## Intent and why

The lab's MoralMod always-on experiment arm is stalled at a five-box cohort because their
hosted decision service cannot absorb the village's turn volume (~10k negotiation turns/day,
~5k in the ON arm; each ON turn needs a 1–2 min assessment of ~13–32 LLM calls). They propose
that Index run ON-arm residents' negotiation turns with the MoralMod consult embedded, while
OFF-arm residents keep the plain negotiator, so the arms stay comparable.

Index gains: the lab's four asks map almost one-to-one onto hardening we want anyway
(turn idempotency, outcome export, per-user agent configuration, bounded agent concurrency).

## Goals

1. ON-arm residents' turns run through Index's hosted agent with the MoralMod consult applied
   before the negotiator model writes the message; OFF-arm residents run the unmodified
   negotiator. Capacity: ~5k ON turns/day sustained, with headroom for ~20/min peaks.
2. Idempotent turn submission (client turn id), so a lost response is reconcilable and a
   retry of a committed turn is success, not 403.
3. An outcome export joinable on opportunity id (agreed/declined/closed, turns to settle,
   principal accept/reject), scoped to the study cohort, no identities.
4. A staged ramp with explicit gates, mirroring the lab's own (5 boxes → 50 → fleet canary).
5. Research events: every ON turn emits `moralmod.turn_exposure@1` to the lab's Village Data
   relay (opaque refs), unchanged in shape from wherever the logic runs.
6. Both arms migrate: the memo's "your stack handles all of the turn work" (~10k turns/day)
   covers OFF-arm residents too — they run on our hosted agent with no consult. That is what
   makes anti-goal 1 (arms differ only by the consult) achievable; it also puts ~10k
   turns/day of negotiator model calls (plus wakes, briefs, summaries) on Index's own model
   keys and hosted-agent capacity, a cost line Seref must explicitly accept (open question 7).

## Non-goals

- Re-implementing the flexible-moral-reasoning Python pipeline in TypeScript. The science
  stays in the lab's validated code.
- Porting the lab's full VillageTurnCommand ledger (claim/prepare/begin/unknown state
  machine). That machine exists to get exactly-once semantics against a remote Index with no
  idempotency key. Inside Index we own the database; a client turn id plus our existing
  advisory-lock + `(negotiation_id, turn_index)` unique-index transaction gives the same
  guarantee far more cheaply. (Open question 1 below checks the lab doesn't need the ledger
  for evidence reasons.)
- Running OFF-arm turns any differently than today.
- A general experiment/feature-flag framework. The arm mirror is one keyed value per agent.

## Anti-goals (failure even if it "works")

- The arms become incomparable: ON and OFF must differ only by the consult. OFF-arm code
  paths must be byte-identical to today's hosted agent.
- Assessment backpressure stalls the village: a saturated assessment queue must degrade to
  the lab's existing fallback (plain negotiate, reason `deadline`), never block turns.
- Score leakage: MoralMod scores/terminology must never reach counterparties or principals.
  The lab's publication guard ports with the decorator and applies to ON turns.
- Identity leakage into research events: only opaque `subject_ref`/`opportunity_ref` leave
  our boundary, as the lab's events already do.

## Architecture decision

Three options considered:

- **A. Full port** — reimplement pipeline + selection + decorator inside Index. Rejected:
  the Python pipeline is substantial research code; a port destroys scientific validity and
  the lab's ability to vouch for the results.
- **B. Hook + hosted worker (chosen)** — Index embeds the negotiator-side logic (consult,
  selection, model decorator, fallback) as a `NegotiateHook`; the assessment itself runs as
  the lab's own decision-service worker images deployed in Index infrastructure, scaled
  horizontally (their service is Postgres/Procrastinate with separately operated API and
  worker processes — the "one job queue" is a deployment limit, not an architectural one).
  The lab's control plane keeps signing JWTs (JWKS/authorization), which their memo
  explicitly supports.
- **C. Scale the lab's hosted service in place** — not on offer; the volume constraint is
  their hosting, and it leaves the double-ledger coupling (their turn state machine wrapping
  our API) in place.

Why B: the lab already patched into our own vendored agent loop at the `submitTurn` host
hook — their `custom-negotiator` wraps `upstream/agent` (our `packages/agent`). The native
equivalent is our existing `NegotiateHook` (`packages/agent/src/host.ts:15-18`, applied at
:728, also accepted by the external runner `packages/agent/runner/runner.ts:19,62`). The
negotiator-side pieces that must move are small and already TypeScript:
`custom-negotiator/src/intervention/assessment.ts` (selection policy
`aggregate-value-mean-hold-v1`, `validateResult`, `assessmentContext` — pure functions) and
`src/intervention/turn.ts` (`assessedTurn`, the model decorator with the integrity guards)
plus the publication guard from `src/intervention/policy.ts`/`publication.ts`. The heavy
coordination machinery (`hosts/village/turns.ts`, `phases.ts`, the evidence/proof plumbing)
exists to bridge two systems that are becoming one, and does not move.

## Components (index repo, with anchors)

### 1. Arm assignment mirror

- Source of truth stays the lab control plane (`tenants.moralmod_arm`). Index mirrors it to
  a per-agent value: `agents.metadata.moralmod = {arm: "on"|"off", experimentId, syncedAt}`
  (per-agent `metadata` jsonb exists, `services/api/src/schemas/database.schema.ts:547-575`).
- Sync: a small authenticated endpoint the lab cp pushes to (preferred — cp is source of
  truth and already signs JWTs we can verify against their JWKS), plus a reconciling pull on
  hosted-agent recovery. Builder's call on exact shape.
- Unassigned residents (not in the study) have no key and are untouched.

### 2. MoralMod `NegotiateHook` (the ON-turn path)

Registered by the hosted agent (`services/api/src/lib/agent/hosted.agent.ts:262-270` is the
existing hook example) and offered to external runners. Per turn:

1. If the input user's agent is not ON-arm → return undefined (built-in negotiator runs;
   this is the OFF arm and every non-study resident).
2. Build the assessment request from the already-assembled `NegotiateInput`
   (`packages/agent/src/host.ts:727`, type `packages/agent/src/types.ts:178-190`) and start
   or join a run on the assessment service (lab contract: workflow start/wait; their client
   collapses byte-identical requests, we keep that property keyed on
   (opportunity, turn index, source digest)).
3. Await the result up to the assessment deadline (lab semantics: `assessment_due_at`).
   On deadline, unavailability, or an `AssessmentError` → emit a fallback-reason research
   event and return undefined so the plain negotiator takes the turn (the lab's existing
   `fallback`/`deadline` behaviour, `custom-negotiator/src/hosts/village/phases.ts:259-282`).
4. On result: `validateResult` → `assessmentContext` (vendored) → run `assessedTurn` (the
   vendored decorator) over the same `negotiate()` the built-in path uses, honouring
   `input.signal`. Return its turn or stall through the hook.
5. Emit `moralmod.turn_exposure@1` (run id, selection evidence, opaque refs) to the lab's
   Village Data relay, and append a durable copy as an `opportunity_events` row
   (`database.schema.ts:368-381` allows free-form typed events), which makes exposure
   joinable on opportunity id in our own export.

Concurrency guard: a bounded semaphore per hosted-agent replica for in-flight consults
(hosted agent fan-out is currently unbounded — every `negotiation.turn` frame starts a run,
`hosted.session.ts:154-167` only dedupes per opportunity). Overflow waits briefly, then takes
the fallback path. Queue depth and fallback rate are first-class metrics.

Known timing interactions (accepted, documented): a 1–2 min consult means the opening-turn
summary can go out before the opening turn (`OPENING_MS = 60s`, `host.ts:39,597-601`), and a
submit after a long consult can fail `already_settled`/`intent_inactive`/409 — those are
clean losses the hook must treat as a no-op turn (re-read on next wake), never retry blindly.

### 3. Turn idempotency (lab ask 2)

- Add optional `clientTurnId` (uuid) to `POST /api/opportunities/{id}/negotiation/turns`
  (schema `packages/protocol/src/protocol/negotiation.rules.ts:7-10`, route
  `services/api/src/controllers/opportunity.controller.ts:386-440`).
- New nullable column on `negotiation_turns` + partial unique index
  `(negotiation_id, client_turn_id)`.
- Semantics: inside the existing transaction (`negotiation.database.adapter.ts:513-545`),
  if a turn with this `clientTurnId` already exists → return it as success with a
  `replayed: true` marker instead of 403/409. New submissions behave exactly as today;
  the field is optional so every existing client is unaffected.
- Expose in `@indexnetwork/client` `submitTurn` (`packages/client/src/client.ts:491-499`).
  This fixes the lab's "unknown send" dead end whether or not any part of their box persists.

### 4. Outcome export (lab ask 3)

A read-only, authenticated export (endpoint first; scheduled dump if the lab prefers files)
joining, per opportunity id in the study cohort:

- `negotiations.outcome` + `settledAt` (`database.schema.ts:388-413`),
- turn count from `negotiation_turns` (turns-to-settle is derived, not stored),
- principal accept/reject from `opportunity_events` lifecycle rows (`committed` = principal
  accept, `declined` = principal pass; at most one `committed` per actor),
- exposure rows from component 2, so the research side can verify ON coverage.

Caveat the lab must know: `outcome='declined'` is currently unused by writes (a decline ends
a round, not the negotiation — `negotiation.rules.ts:100-103`); terminal states are `agreed`,
`closed` (human pass/expiry), or still-open. The export schema says this explicitly rather
than synthesizing a fake `declined`.

No identities: rows carry opportunity id and the lab-side opaque refs only. The lab maps
opportunity id → `opportunity_ref` on their side (they already hold that mapping).

### 5. Assessment service deployment

- The lab's decision-studio images (root `Dockerfile`: `api` and `scientific` stages;
  production shape is Postgres + Procrastinate with separate API and worker processes, per
  `deployment/README.md`) run in Index infrastructure with a dedicated Postgres.
- Sizing: 5k ON turns/day ≈ 3.5/min average; at ~20/min peak and p95 2 min, ~40 concurrent
  assessments → start with worker capacity for 48 concurrent runs and measure. Each
  assessment is 13–32 LLM calls, so ~65k–160k provider calls/day: provider rate limits on
  the lab's `OPENAI_API_KEY`/`OPENROUTER_API_KEY`/`TYPESAFE_API_KEY` are the likeliest real
  ceiling — the lab must confirm their key tiers or issue dedicated keys (my call: dedicated
  keys, so their remaining hosted cohort is isolated from our volume).
- Authorization: the lab cp keeps its JWKS/authorization role; our workers and hook verify
  against it. Secrets live in our secret store, never in images (their build already
  mandates this).

### 6. Ramp (lab ask 4)

Stage 0 — shadow: consult runs for a handful of ON-arm residents but the hook returns
undefined (plain negotiator takes every turn); we measure latency, failure and fallback
rates with zero behaviour change. Conditional on open question 5 (shadow runs must be
markable or run under a separate experiment id, or Stage 0 is cut).
Stage 1 — the existing five-box cohort's residents, consult applied.
Stage 2 — 50 residents. Stage 3 — full ON arm (~half the village).
Gates between stages (hold if breached): assessment p95 ≤ 2.5 min; fallback rate ≤ agreed
threshold (lab sets it — fallbacks dilute the treatment); submit-failure rate after consult
≈ OFF-arm baseline; zero publication-guard leaks; exposure events ≈ ON turns.

## What we need from the lab first (ordered)

1. Written permission + keys (they're requesting tonight; dedicated provider keys preferred).
2. The promised file-level memo, pinned to answers for the five contract questions below
   (bound/unbound, consult contract without stage plumbing, exposure emission path, runtime
   receipt/identity, shadow-run marking) — these decide the build, not just document it.
3. cp endpoints: arm push/pull, JWKS, Village Data relay credentials (if hook-side emission).
4. Delivery of the decision-service images: lab-pushed at a stated pin, or build-from-source
   instructions naming the one validated native rev (their deployment README lists three
   pinned revs) plus the BuildKit token flow for the private pipeline dependency. My call:
   ask for lab-pushed images.
5. Their fallback-rate threshold and the agreed outcome-export schema.

## Open questions

For the lab (contract-deciding — the build plan cannot be finalized without these):

1. **Ledger/evidence:** does research evidence require the signed VillageTurn ledger
   (claim/prepare/begin receipts, carried stages), or are idempotent submission + exposure
   events with run ids sufficient provenance? This design assumes the latter.
2. **Bound vs unbound:** does the study run with a canonical policy projection
   (policy-consumer-1 "bound" mode — two-tool constraint flow, `policyHold`, principal
   questions) or unbound (preferred-action mode)? And does a start/wait/result consult
   contract exist that does not require `consumer`/`stage_id`/`proof(observation)` — i.e.
   the stage plumbing this design drops — or is the lab writing new service code for us?
   The answer decides what gets vendored (`policy.ts` hold/question flow or not), the hook's
   stall semantics, and whether the pinned contract is validated code or new.
3. **Exposure emission:** their production path saves exposure evidence in the decision
   service and delivers it via a separate `--maintenance` outbox process with retry and
   cp-side consent re-checks (research_delivery runbook) — the design's hook-side emission
   is the opposite. Which do they want: we run their maintenance outbox (then the hook
   writes turn/selection receipts back to the service instead of emitting), or hook-side
   emission (then we need the event schema, relay auth, and delivery semantics)? Wrong guess
   double-counts or drops exposures, and "exposure events ≈ ON turns" is a ramp gate.
4. **Per-resident identity:** building the consult request and `assessmentContext` needs a
   per-resident runtime receipt (lab-side opaque user id for `participant_map`/owner,
   experiment id, evaluation profile, assignment/permission/runtime revisions, allow flags),
   fetched today with per-box credentials. Does the arm sync push the full receipt, or does
   the hook fetch `/integrations/index/runtime` per resident — and can their authorization
   support one multi-tenant Index service principal for all residents (their model is
   per-resident JWTs)? This couples consult availability to lab-cp uptime and shapes the
   sync endpoint and secret handling.
5. **Shadow-run marking:** Stage 0 consults create real cases/runs in the service DB. Can
   shadow runs be marked (or run under a separate experiment id) so they are excluded from
   exposure counts and the experiment dataset? If not, Stage 0 corrupts what the ramp gates
   measure and must be redesigned.
6. **OFF-arm guard:** their box applies publication/plain-language checks on ON paths only;
   confirm OFF arm should remain the stock negotiator with no guard, as this design assumes.

For Seref (decisions needed):

7. **Both-arm migration and the model bill:** confirm both arms' residents move to our
   hosted agent (flipping `handleNegotiations`, retiring the box negotiators), and that
   ~10k turns/day of negotiator model calls on Index's keys is acceptable. Alternative — the
   lab's boxes stay the executor and only the assessment service moves to us — halves our
   obligations but keeps their coordination stack in the loop and weakens comparability.
8. **Where the assessment service runs** (our k8s/kind setup, Fly like the lab's, or the
   boat.dev sandbox). Assessment provider calls (~65k–160k/day) stay on the lab's keys per
   the memo — confirm you're fine being the operator but not the payer of that part.

## Left to the builder

Exact arm-sync endpoint shape; semaphore size and overflow wait; whether the vendored
intervention files come in as a package (`packages/moralmod/`) or under the hosted-agent lib;
export delivery mechanism (endpoint vs dump) after the lab states a preference; metrics
naming. Vendored lab files keep their provenance headers and come from a pinned commit.
