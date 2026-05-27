# End-to-End Discovery Eval — Design

**Status:** Approved for planning
**Date:** 2026-05-27
**Component:** new `backend/eval/discovery/` (end-to-end matching/discovery eval)
**Related:** `project_matching_eval_harness` (the scoring-only eval at `packages/protocol/eval/matching/`); this is its end-to-end complement.

## Why this exists

The existing matching eval (`packages/protocol/eval/matching/`) tests only the final scoring
step: it hand-feeds a candidate set to `invokeEntityBundle` and checks the score/role/match
judgment. It does **not** exercise retrieval, premises, user-contexts, the discovery triggers,
or cross-pool false positives — so it cannot catch the dominant production failure mode: *the
right person is never retrieved at all.*

This eval runs the **real opportunity-creation flow** against a seeded population and asserts
the right opportunities are created and false positives are not. It is the faithful,
end-to-end complement to the scoring eval — both are kept.

## What the real flow is (verified, with citations)

- **Entry point:** `runDiscoverFromQuery(input: DiscoverInput)`
  (`packages/protocol/src/opportunity/opportunity.discover.ts:645`), which invokes a compiled
  graph from `OpportunityGraphFactory`
  (`packages/protocol/src/opportunity/opportunity.graph.ts:179`).
- **Two production triggers:**
  - per-intent — `IntentEvents.onCreated` → `FromIntentQueue` invokes the graph with a
    `triggerIntentId` and the intent payload as the query (`backend/src/main.ts:321`,
    `backend/src/queues/opportunity/from-intent.queue.ts`).
  - per-onboarding / no-intent — enrichment completion → `generateUserContexts` +
    `FromProfileQueue` invokes the graph with no query, falling back to
    profile/premise/context discovery (`backend/src/main.ts:122`,
    `backend/src/queues/opportunity/from-profile.queue.ts`).
- **Retrieval** is over premise embeddings, user-context embeddings, and intent embeddings,
  plus query-time HyDE, then merged (`opportunity.graph.ts` discovery paths + merge).
- **Persistence:** `persistOpportunities` → `database.createOpportunity` → `opportunities`
  table (`packages/protocol/src/opportunity/opportunity.persist.ts:52`). Read back with
  `getOpportunitiesForUser(userId, networkId?, options?)`.
- **Isolation fact (the key enabler):** the candidate pool is **strictly network-scoped** —
  it comes from `getNetworkMemberships(discoverer)` and candidates are filtered to those
  networks (`opportunity.graph.ts:264-265, 304`). There is **no global candidate path.** So a
  dedicated eval network containing only the seeded people is a guaranteed closed population:
  real test-DB users in other networks cannot leak in, which is what makes false-positive
  assertions valid.

## What this eval measures

Given a realistic seeded population whose discovery inputs (profiles, premises, intents,
user-contexts) are golden, does the **real discovery graph** surface the right partner and
reject everyone else — through retrieval *and* scoring, under both triggers?

It does **not** test enrichment generation (whether onboarding produces good premises/contexts
from raw input) — that is a separate quality concern. We seed the discovery inputs directly so
matching/discovery quality is isolated and attributable.

## Architecture

### Location
`backend/eval/discovery/` — opt-in (NOT part of `bun test`), structured like the scoring eval
(`packages/protocol/eval/matching/`): a population module, a seeder, a runner, a scorer, a
reporter, and a CLI. It lives in `backend/` because that is where the real adapters
(`src/adapters/`), the test DB (`.env.test`), and the embedder live; the protocol package has
only interfaces and unit mocks.

### Files
- `discovery.population.ts` — the seeded golden population (data; see "Population").
- `discovery.seed.ts` — inserts the population into the test DB with **real** embeddings;
  returns handles + a `runId`. All seeded row ids are prefixed `eval-<runId>-`.
- `discovery.runner.ts` — constructs the real `OpportunityGraphFactory` and runs discovery
  per discoverer in both triggers, scoped to the eval network.
- `discovery.scorer.ts` — reads created opportunities and evaluates the two-level assertions.
- `discovery.reporter.ts` — scorecard (per-pair retrieval %, end-to-end %, false-positive
  count), mirroring the scoring eval's reporter style.
- `discovery.eval.ts` — CLI entry (flags: `--runs`, `--pair`, `--report`, `--keep` to skip
  cleanup for debugging).
- `discovery.cleanup.ts` — deletes all `eval-<runId>-` rows; also a safety sweep for stale
  eval rows.

## Population (~65 people in one eval network)

- **~15 documented real collaboration pairs** (30 people) — the scored ground truth.
  Anonymized exactly like the Tier-3 scoring cases: real names/specifics only in `//`
  provenance comments, never in data. Each person carries a profile (bio/skills/interests/
  location), 2–3 **premises**, one seeking **intent** (for the discoverer side), and a
  network-scoped **user-context** paragraph. The five Tier-3 collaborations
  (Wozniak/Jobs, Watson/Crick, Lennon/McCartney, angel+founder, AlphaFold-style expert+ML)
  seed the first batch; the remaining ~10 span varied domains (other tech cofounders,
  scientists, creative duos, investor+founder, designer+engineer, writer+editor, etc.).
- **~35 background personas** — realistic, varied community members who are **not** anyone's
  true partner. Each needs a profile + 2–3 premises + a user-context so it is *retrievable*
  (and thus a genuine distractor); a subset also carry intents so they appear in intent
  search. No provenance needed — these are plausible originals, not claims about real people.
  They expand on the existing `matching.personas.ts` POOL style.
- All ~65 are members of **one dedicated eval network**; each is a member of *only* that
  network (plus an empty personal index), so the candidate pool equals the seeded population.

Authoring ~65 people across several embedded fields each is the dominant effort of this
project and is staged accordingly (see "Staging").

## Seeder

`seedPopulation(population)` → for each person inserts: a user row, a profile, premises (each
embedded via the **real `EmbedderAdapter`**), intents (embedded), and a user-context
(embedded); creates the eval network and the membership rows; links intents to the eval
network (`intent_indexes`). Returns a `SeededWorld { runId, networkId, people }`. Real
embeddings are mandatory — a mock embedder returns semantically meaningless vectors, which
would make retrieval a coin flip. Embeddings are cheap; this is the affordable part.

## Runner — the real graph, both triggers

`runDiscovery(world, discovererId, trigger)`:
1. Build the real graph: `new OpportunityGraphFactory(testDbAdapter, realEmbedder,
   realHydeGraph, realEvaluator, /* notifier */ undefined, /* negotiationGraph */ undefined,
   /* dispatcher */ undefined, /* queueNegotiateExisting */ undefined).createGraph()`.
   Negotiation/dispatcher are omitted so candidates persist without negotiation side-effects;
   we measure matching, not the negotiation lifecycle.
2. Invoke in both production modes, scoped to the eval network (`indexScope=[networkId]`):
   - **per-intent:** query = the discoverer's seeking intent, `triggerIntentId` set.
   - **per-onboarding / no-intent:** no query → profile/premise/context discovery.

## Assertions — two levels (so a miss is attributable)

Read created opportunities via `getOpportunitiesForUser(discovererId, evalNetworkId)`. For
each ground-truth pair's discoverer:
- **Retrieval:** the true partner survived retrieval into the evaluated candidate set.
  (A failure here = a premise/context/HyDE retrieval miss — the person was never seen.)
- **End-to-end:** an opportunity was created pairing discoverer↔partner with a sound
  score/role, **and no** opportunity was created for any other person (background personas or
  other pairs' people). (A failure here with retrieval passing = an evaluator scoring miss.)

Because every person shares one network, each discoverer is implicitly tested against all ~64
others — so cross-domain false positives (the pooled sweep) are covered for free. The
two-level split is what makes results diagnosable rather than just pass/fail.

## Isolation & cleanup

- The dedicated eval network is a verified closed pool (see "isolation fact" above); seeded
  people belong to no other network.
- `runId`-prefixed ids make cleanup exact. `discovery.cleanup.ts` runs in a `try/finally` so a
  failed run still cleans up, plus a `beforeAll` safety sweep removes stale `eval-` rows from
  prior aborted runs.
- Uses the `.env.test` test DB only. **Never** touches the production Neon branch.

## Cost & runtime

Real embeddings at seed time (~65 people × several fields — cheap) plus, per discovery run,
query-time HyDE (LLM) and the evaluator over a ~65-candidate pool (the expensive part). This
is materially slower and pricier than the scoring eval, so it is opt-in and not in `bun test`.

## Staging (informs the plan)

1. **Walking skeleton:** the full harness (seed → real graph → assert → cleanup) wired against
   a tiny population (2 pairs + ~3 background), proving end-to-end mechanics and isolation on
   the test DB. Both triggers exercised.
2. **Author the 15 ground-truth pairs** (batched), starting from the 5 Tier-3 collaborations
   (add premises + contexts to their existing profiles/intents).
3. **Author the ~35 background personas** (batched).
4. **Reporter + CLI flags**, and a **calibration run** to set realistic retrieval/score
   expectations and record findings (mirroring the scoring eval's baseline discipline).

## Non-goals (YAGNI)

- No test of enrichment generation (raw onboarding → premises/contexts via LLM). Inputs are
  seeded directly.
- No negotiation-lifecycle testing (negotiation/dispatcher deps omitted).
- No new infra: no separate DB, no Neon branch, no local Postgres — the dedicated eval network
  on the existing test DB is the isolation mechanism.
- Not part of `bun test`; opt-in only.

## Open authoring note

The ~15 real collaborations must be genuinely documented and anonymizable across varied
domains; the ~35 background personas must be diverse enough that the true partner has to win
on fit, not on being the only plausible candidate in its domain. Both are hand-authored (no
LLM-generated bios), consistent with the project's no-fabrication rule.
