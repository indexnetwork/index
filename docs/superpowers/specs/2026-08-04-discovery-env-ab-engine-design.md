# Discovery env A/B engine — design

**Linear:** [IND-627](https://linear.app/indexnetwork/issue/IND-627) (engine), [IND-626](https://linear.app/indexnetwork/issue/IND-626) (base fixture), [IND-628](https://linear.app/indexnetwork/issue/IND-628) (eval-ops UI, later)
**Date:** 2026-08-04
**Status:** proposed

## 1. Problem

Operators want to test discovery strategies against each other: run the pipeline one way, run it another way, see which produces better matches. The eval-ops site appears to offer this — saved configs carry environment overrides drawn from `PROFILE_ENV_ALLOWLIST` — but the feature is inert.

No eval harness reads any of those keys. Traced mechanically over the full transitive import closure of every harness entry point:

| Harness | Files in closure | Of the 16 env flags, read |
|---|---|---|
| matching | 44 | 0 |
| premise | 30 | 0 |
| profile | 30 | 0 |
| opportunity | 127 | 0 executed (`negotiation.graph.ts` appears in the closure but the harness never invokes it) |
| canary | 52 | 0 |
| clarification | 15 | 0 |
| discovery-retrieval | 63 | 0 |
| hyde | 47 | 0 |
| stance | 26 | 0 |

The flags are read by `services/api/src/startup.env.ts` and by `src/opportunity/application/opportunity.graph.ts` — the running product. The four scorecard harnesses invoke agents directly (`OpportunityEvaluator`, `OpportunityPresenter`, `EnrichmentGenerator`, `PremiseDecomposer`/`PremiseAnalyzer`) and never enter the graph.

So `DISCOVERY_SOURCE_PREMISE_LIMIT=5` and `=50` produce byte-identical behavior on every harness the site can run. An A/B over env values today would render two identical columns and call it a comparison.

**To compare strategies, something has to run the code that reads them.**

## 2. What already exists

`discovery-env-matrix` does exactly that, for a fixed set of strategies:

- **Cases and scoring** in `packages/protocol/eval/discovery-env-matrix/` — `HISTORICAL_MATRIX_CASES` (15 seeded networks), `historical-matrix.policy.ts` (deterministic assertions plus a relationship judge), a reporter.
- **Runner** in `services/api/src/cli/discovery-env-matrix*.ts` — composes the real `OpportunityGraphFactory` against a Neon child branch, one child process per branch, and aggregates slots into a governed artifact.
- **Five hard-coded rows** varying `DISCOVERY_ALLOWED_TYPES` × `DISCOVERY_PROFILE_SOURCE`: `intent-only`, `profile-premise`, `profile-context`, `both-premise`, `both-context`.
- **Proven**: a committed baseline from 2026-07-30 records 15 cases × 5 rows × 3 repetitions = 75 slots, aggregate pass rate 93.3%, wall clock 14 minutes across 15 parallel children. Per-slot duration ~52s.

Three gaps: it varies 2 of the 16 flags in 5 combinations chosen at authoring time; it is invisible from eval-ops; and its base branch `eval-discovery-base` no longer exists in the Neon project (confirmed 2026-08-04 — only `production`, `dev`, `local-dev`, `eval-ops-fixtures*` and dated backups remain).

## 3. Goal and non-goals

**Goal.** A `discovery-ab` harness that runs the real discovery graph twice — once per operator-chosen environment configuration — over a shared case selection, and emits one artifact holding both sides.

**Non-goals.**

- **No baseline.** Arbitrary env configurations have no committed baseline and never will; the pair is the result. This harness is comparison-native, not regression-gated.
- **No flags outside the graph's reach.** Seven of the sixteen (`POOL_QUESTIONS_MODE`, `POOL_QUESTIONS_PUSH`, `POOL_QUESTIONS_RANKING`, `POOL_QUESTIONS_MINING`, `OUTCOME_QUESTIONS_MODE`, `NEGOTIATION_EVIDENCE_QUESTIONS_MODE`, `INTRODUCER_DISCOVERY_ENABLED`) gate subsystems the discovery graph never invokes, so this harness cannot exercise them and must not offer them. That is **not** the same as saying they are untestable — see appendix A and IND-630.
- **No eval-ops UI.** That is IND-628, specced once this engine has produced a real artifact.
- **No model overrides.** The graph composes its own agents; model selection stays as configured. Adding it later is additive.

## 4. The nine offerable flags

Only flags reachable from `opportunity.graph.ts` may appear. Traced from the graph as entry point (140 files):

| Flag | Read by | Kind |
|---|---|---|
| `DISCOVERY_ALLOWED_TYPES` | `opportunity.graph.ts`, `discovery.env.ts` | string list |
| `DISCOVERY_PROFILE_SOURCE` | `opportunity.graph.ts`, `discovery.env.ts` | string |
| `DISCOVERY_CONTEXT_TO_INTENT` | `opportunity.graph.ts` | `0`/`1` |
| `DISCOVERY_SOURCE_PREMISE_LIMIT` | `opportunity.graph.ts` | integer ≥ 0 |
| `DISCOVERY_REJECTION_COOLDOWN_DAYS` | `opportunity.graph.ts` | positive float |
| `RUN_OPPORTUNITY_EVAL_IN_PARALLEL` | `opportunity.graph.ts` | `true`/`false` |
| `NEGOTIATION_MAX_TURNS_CHAT` | `opportunity.graph.ts` | integer |
| `NEGOTIATION_MAX_TURNS_AMBIENT` | `opportunity.graph.ts`, `negotiation.graph.ts` | integer |
| `NEGOTIATION_INCLUDE_OTHER_INTENTS` | `opportunity.existing-negotiation.ts` | `true`/`false` |

This list is derived, not copied: a test recomputes the reachable set and fails when the graph starts or stops reading a flag, so the harness cannot silently drift into offering a dead lever — the exact failure this whole project exists to correct.

## 5. Architecture

Invoked as `eval:discovery-ab` from `services/api`.

```
discovery-ab.main.ts  (parent, no database of its own)
  │
  ├─ safety gate: confirm variable set; both side URLs resolve to designated
  │               A/B branches; refuse anything else
  ├─ reset eval-ab-a from base ─┐  Neon reset-from-parent, awaited
  ├─ reset eval-ab-b from base ─┘
  │
  ├─ spawn child A: DATABASE_URL=<eval-ab-a>, env config A ─┐
  ├─ spawn child B: DATABASE_URL=<eval-ab-b>, env config B ─┘  concurrently
  │     each child, for each case × repetition:
  │       withDiscoveryEnvironment(config, () => graph.invoke({...}))
  │       collect candidates, project evaluator outcomes
  │     child writes slots as JSON to a temp path
  │
  └─ parent: aggregate slots → scorecard (rule = side) → one artifact
```

One process per side is not stylistic: the API composes its database singleton once per process, so a side's `DATABASE_URL` must be fixed for that process's lifetime. This mirrors the existing matrix runner, which spawns one child per branch for the same reason.

**Components and boundaries.**

| Unit | Responsibility | Depends on |
|---|---|---|
| `discovery-ab.plan.ts` | Turn (cases, reps, two configs) into slots; validate configs against the nine-flag set | nothing (pure) |
| `discovery-ab.env.ts` | Apply a config around one graph invocation, restore prior values in `finally` | nothing (pure) |
| `discovery-ab.branches.ts` | Resolve the two side URLs, assert they are designated A/B branches, reset both from base | Neon control plane |
| `discovery-ab.ts` (child) | Run assigned slots against one branch under one config | graph, policy |
| `discovery-ab.main.ts` (parent) | Gate, reset, spawn, aggregate, write artifact | all of the above |

`discovery-ab.env.ts` generalizes today's `withMatrixEnvironment`, which hard-codes two keys and restores them in a `finally`. The generalized version takes a `Record<string, string>`, applies only allowlisted keys, and restores every key it touched — including deleting keys that were previously unset.

**Why clone rather than re-seed.** Seeding the corpus is not a pure SQL insert: `seedProtectedBase` embeds every fixture intent and builds HyDE documents with vectors, and `verifyBaseFixtureIntegrity` refuses a base whose intents are unembedded or whose vectors are malformed. Re-seeding per run would mean re-embedding per run — provider spend and non-determinism on every comparison. Cloning a pre-embedded protected base gives an identical, already-embedded corpus in seconds, which is why the existing matrix works this way.

**One new mutating capability.** `discovery-env-matrix.neon.ts` exposes a deliberately read-only control plane: a GET-only request helper behind `getBranch` and `listEndpoints`. Reset needs one write. It is added as a single narrowly-scoped call that refuses any branch whose name is not an A/B branch, rather than by opening the client up to general writes. `NEON_API_KEY` is required; the eval database is `protocol_eval`.

## 6. Selection is shared; configuration is not

| Scope | Values | Behavior |
|---|---|---|
| **Selection** | cases, repetitions | Shared by both sides. Two sides that ran different cases are not comparable, so this is one control, not two. |
| **Configuration** | the nine env flags | Per side. This is the thing being compared. |

Defaults: all 15 cases, 3 repetitions per side — 90 graph invocations, ~40 minutes at the observed ~52s per invocation. `--runs 1` is the quick look (30 invocations, ~13 minutes) and cannot mark anything flaky, since one observation per case cannot separate a difference from noise.

If the two configurations are identical the run is refused: it would spend ~90 graph invocations to measure noise. The refusal names the flags that would have to differ.

## 7. Scoring and artifact

Scoring is reused unchanged from `historical-matrix.policy.ts` — deterministic assertions (expected user surfaced, excluded users absent, fixture ownership) plus the relationship judge over final evaluator outcomes, with raw retrieval retained for diagnostics only. Reusing it means A/B numbers are directly readable next to the existing matrix baseline.

The artifact keeps the established envelope (`artifactType`, `harness`, `harnessVersion`, `corpusFingerprint`, `configFingerprint`, `git`, `completeness`, `execution`, `payload`) so existing viewer tooling can read it. Two departures, both deliberate:

- `payload.rules` holds exactly two entries, the two sides, rather than five fixed strategy rows.
- A new `payload.configs` block records each side's exact env map and the diff between them. Without it the artifact would show that A beat B while omitting what A and B were.

Per case the artifact records passes/runs per side and a flaky marker, so a 3/3 vs 1/3 difference is distinguishable from 2/3 vs 3/3 noise. That distinction is the reason repetitions default to 3.

## 8. Safety

The graph writes opportunities and negotiation tasks. Three gates, in order:

1. **Confirm variable.** Absent it, the command refuses, mirroring `DISCOVERY_ENV_MATRIX_CONFIRM=1`.
2. **Branch allowlist.** Each side's URL must resolve to its designated A/B branch, and the reset call refuses any branch outside that set. `production` (`br-fragrant-brook-ahexgsek`) and `dev` are unreachable by construction, not by care — a reset pointed at either is refused by the same check that authorizes the A/B branches.
3. **Reset before, not after.** Both branches are reset from base *before* a run. A crashed run leaves dirty branches, which the next run cleans; the alternative leaves a window where a dirty branch looks clean.

Provider and database errors are sanitized before they reach logs or artifacts, following the existing `MatrixExecutionError` classification — these errors can carry credentials and response bodies.

## 9. Failure modes

| Failure | Behavior |
|---|---|
| Reset fails for either branch | Refuse to start. No half-isolated comparison. |
| One side fails mid-run | Artifact marks the run incomplete and reports no verdict. A comparison with one side missing is not a comparison. |
| A slot exhausts its attempts | Recorded as a failed slot; the side continues. `completeness.complete` becomes false. |
| Both configs identical | Refused before any spend (§6). |
| Child process hangs | Existing bounded child supervision terminates it (SIGTERM, then SIGKILL after a grace window). |

## 10. Testing

Provider-free, following the repo's targeted-validation policy:

- **Plan builder** — slot count equals cases × reps × 2; both sides receive identical selection; identical configs are refused.
- **Env application** — only allowlisted keys applied; previously-unset keys deleted afterwards, not left behind; prior values restored on throw.
- **Nine-flag derivation** — recompute the reachable flag set from the graph and assert it equals the offered set (§4).
- **Safety gate** — a non-designated URL is refused; a missing confirm variable is refused; production and dev URLs are refused explicitly.
- **Artifact shape** — two rules, per-side config recorded, diff correct, no baseline comparison attempted.

Live validation is one 1-case × 1-repetition smoke per side (~2 minutes, 4 invocations) before any full run.

## 11. Sequencing

1. **P1 (IND-626)** — recreate and seed `eval-discovery-base` (including intent embeddings and HyDE documents), verify fingerprints, mark protected. Prerequisite; no design decisions remain.
2. **Create the two A/B branches** from the verified base.
3. **P2 (IND-627)** — this design, built and smoke-tested from the CLI.
4. **P3 (IND-628)** — eval-ops integration, specced against a real artifact.

## 12. Open question deferred on purpose

What the comparison should *show* an operator — rank of the expected user, surfaced/excluded counts, judge verdicts, or a blend — is not settled here. The artifact records all of it; choosing the headline number is IND-628's job, made with a real artifact in hand rather than an imagined one.

## Appendix A — the other seven flags (IND-630)

Shipping this engine fixes 9 of 16 and would leave 7 in exactly the state that caused this project: configurable, unmeasured, easy to believe in. They are recorded here so the omission stays visible and gets a decision.

Calling them "API-side flags" would be wrong, and the distinction decides the work. For nearly all of them the **behavior lives in `packages/protocol`**; the API queue only decides *when* to run it. The entire API-side contribution for two of them is `services/api/src/queues/pool/mining.shared.ts:93`:

```ts
return poolQuestionsMiningMode() === 'shadow' || poolQuestionsMode() === 'on';
```

…where the miner, the shadow runner and the selection logic are all imported from `@indexnetwork/protocol`. The accurate statement is **"not reachable from the discovery graph"**, not "not reachable at all".

| Flag | Protocol reader (behavior) | API reader (orchestration) | Testable without the API? |
|---|---|---|---|
| `POOL_QUESTIONS_PUSH` | `discriminator.env.ts` | — | **Yes** — protocol only |
| `INTRODUCER_DISCOVERY_ENABLED` | `opportunity.introducer-feature.ts`, facade, `maintenance.graph.ts` | — | **Yes** — protocol only |
| `POOL_QUESTIONS_MINING` | `discriminator.env.ts`, miner/shadow runner | `queues/pool/mining.shared.ts` | Likely — mining behavior is protocol |
| `POOL_QUESTIONS_MODE` | `discriminator.env.ts` | `mining.shared.ts`, `visitmining.queue.ts` | Partly — selection is protocol, enqueue is API |
| `POOL_QUESTIONS_RANKING` | `discriminator.env.ts`, `radar.graph.ts` | `opportunity.database.adapter.ts`, `answer.shared.ts` | Partly — ranking is protocol, ordering is in the adapter |
| `OUTCOME_QUESTIONS_MODE` | `outcome.env.ts`, `outcome.shadow.ts`, `outcome.hypotheses.ts` | `outcome-feedback.recorder.ts`, schema | Partly |
| `NEGOTIATION_EVIDENCE_QUESTIONS_MODE` | `negotiation-evidence.env.ts` | `negotiation-evidence.shadow.ts` | Partly |

Two of these need no database, no branches and no live spend — a protocol-level harness would cover them far more cheaply than this engine covers its nine. That is the likely first move, but the decision per flag belongs to IND-630, not to this spec.
