# Historical Discovery Quality — Design

**Status:** Draft for written review
**Date:** 2026-08-05
**Scope:** `packages/protocol/eval/` and the existing API-owned discovery eval runtime
**Linear project:** Historical Discovery Quality (to be created after written-spec approval)

## Purpose

Measure whether Index can rediscover documented, successful historical collaborators from what was knowable before they connected, without relying on fame, hindsight, or a preselected candidate bundle. Use the same corpus to compare models and environment configurations under controlled conditions.

This is a measurement project. It succeeds when the evidence is complete, attributable, and reproducible. It does not require the current system to achieve a target score. Poor results become separate tuning issues rather than being tuned away inside the measurement work.

## Decisions

- Build a new Linear project with seven main issues and three milestones; do not implement this as one issue or one PR.
- Expand in stages from the existing five collaborations to 15 documented pairs and approximately 35 background people.
- Measure both active user-discovery graph shapes: intent-triggered discovery and no-intent enrichment-triggered discovery.
- Require documented pre-connection evidence for model-facing historical facts and documented evidence of the successful outcome.
- Use one shared candidate pool instead of one small network per historical case.
- Attribute failures separately to execution, retrieval, evaluator approval, and final ranking.
- Reuse and extend the existing corpus, fixture, discovery runner, scorer, Neon isolation, and artifact contracts. Do not create a new live harness or artifact family.
- Seed reviewed premise/context inputs and their frozen derived retrieval artifacts into the protected base; canonical runs do not regenerate participant premises or contexts.
- Start every measured slot from the same protected database state and an isolated cache namespace; this harness performs exactly one graph attempt per requested slot.
- Apply each A/B side's model and environment configuration before any model-dependent import or graph construction.
- Ordinary A/B comparisons change one resolved graph-agent model assignment or one environment key at a time; judge and embedding models remain fixed.
- Report separate completeness, retrieval, ranking, evaluator, and labelled-negative metrics. Do not collapse them into a composite quality pass rate or winner.
- Cap one run at 200 graph invocations. Full-corpus workload and provider-call/cost estimates require explicit confirmation.
- Defer creation of a committed regression baseline until the first full measurement shows that the corpus and stochastic protocol are stable enough to govern.
- Keep IND-630 related but outside this project; testing seven flags unreachable from the discovery graph is a separate concern.

## Current State

The canonical historical source is `packages/protocol/eval/matching/matching.historical.ts`. It contains five anonymized collaborations and report-only real names. The matching harness calls `OpportunityEvaluator.invokeEntityBundle` over a supplied candidate bundle, so it is a useful evaluator regression check but not discovery evidence.

`packages/protocol/eval/discovery-env-matrix/` adapts those same five cases into API fixtures, and `services/api/src/cli/discovery*.ts` runs the real discovery graph against protected Neon branches. The discovery runner currently uses an intent trigger, one network per case, and supports either one operator configuration or paired environment configurations. The eval-ops site can launch and inspect those runs.

The new work generalizes these existing paths rather than replacing them.

## Historical Corpus Contract

### Case shape

Each historical case represents one source person and one documented eventual collaborator. It contains:

- a stable anonymous case and participant identifier;
- the collaboration domain;
- a dated collaboration boundary whose cutoff is exclusive: model-facing historical facts must be true before the first substantive collaboration;
- cited evidence for the successful outcome;
- cited pre-connection facts used to construct each model-facing profile, premise, context, or intent;
- reviewed, frozen premise and user-context text for the enrichment trigger;
- one expected partner;
- case-specific authored semantic hard negatives, with the violated case requirement recorded for each;
- report-only real identities and citations;
- model-safe intent-triggered input;
- model-safe enrichment-triggered input.

The existing Page/Brin-to-Bechtolsheim case must stop representing two people as one source identity. The revised case uses one founder as the source person. A cofounder may appear only as cited context, not as a composite user.

### Provenance standard

Every model-facing historical claim must be supported by a source dated before the first substantive collaboration or by a source that explicitly documents the person's pre-connection state. The cutoff is exclusive. A year-level cutoff is acceptable only when the evidence establishes ordering within that year; otherwise the case is excluded. Retrospective sources are acceptable only when they clearly distinguish what was true before the collaboration from what became true afterward.

Reconstructions are minimized. When a concise model-facing sentence combines sourced facts, its provenance records the exact supporting excerpts. Unsupported plausible biography or intent text is not allowed in the historical cohort.

Every successful outcome must have an independent citation. Source URLs, excerpts, real names, and audit notes are report-only and must be removed by the model-safe projection.

### Anonymization standard

Anonymization is a validity boundary, not only a privacy feature. Model input must remove:

- real names and recognizable aliases;
- unique company, paper, song, product, institution, or project names;
- exact dates when a broad period is sufficient;
- outcome-revealing language;
- citations and report-only audit fields.

Some historical narratives remain inferable from combinations of facts. Each case therefore receives an adversarial leakage review. The reviewer records whether the case is plausibly recognizable and either approves the remaining detail as necessary for matching semantics or requires broader wording.

### Shared-pool labels

The full pool contains approximately 30 historical participants and 35 authored background people in one evaluation network.

The expected partner is the positive label. Case-specific authored semantic hard negatives are negative labels: each is designed and reviewed to violate a stated requirement of that case. This label makes no claim that a real historical collaboration never occurred. Mere absence of a documented collaboration is never negative evidence.

Other historical participants and unrelated backgrounds are unlabelled unless the corpus provides an explicit semantic-negative justification for that case. An unlabelled person is ranking pressure, but their appearance is not automatically called a false positive; historical ground truth is not exhaustive enough to support that claim.

Each case must have at least three authored semantic hard negatives. Background people must contain realistic profiles, frozen reviewed premises, frozen reviewed contexts, and, where appropriate, intents so they are retrievable rather than inert filler.

## Runtime Design

### Existing components to extend

1. `matching/matching.historical.ts` remains the canonical historical source.
2. The discovery fixture projection continues adapting that source into deterministic database rows.
3. The protected `eval-discovery-base` branch remains the immutable fixture base.
4. The existing `eval:discovery` runner remains the live entry point for one-configuration and paired runs.
5. `historical-matrix.policy.ts` remains the scoring-policy home.
6. The existing artifact envelope and eval-ops run storage remain authoritative.

No new live harness, runner, or artifact family is introduced.

### Trigger dimension

Every selected case runs under either or both of these trigger modes:

- `intent`: invoke the graph with the source user's exact `triggerIntentId`, `operationMode: "create"`, and `options.initialStatus: "latent"`;
- `enrichment`: invoke the graph with `operationMode: "create"` and `options.initialStatus: "latent"`, without a query or trigger intent, matching `from-enrichment.queue.ts`.

Trigger selection is shared by both A/B sides. A comparison with different trigger sets is invalid.

The artifact case identity includes historical case, trigger, side or single configuration, and repetition. This makes every requested slot explicit and prevents one trigger's evidence from being mistaken for the other's.

### Shared fixture

The base fixture contains one shared evaluation network. Every corpus participant belongs to that network, and no non-fixture user belongs to it. One generic, model-safe, leakage-reviewed corpus-wide prompt describes an interdisciplinary collaboration community; case-specific network prompts are prohibited. Participants map to deterministic database identities directly from stable participant IDs, never by profile-text equality.

The protected base persists the reviewed profile, premise, intent, and user-context inputs, their embeddings, and any stored derived retrieval documents required by the graph. Derived documents are generated only during a deliberate corpus-build operation, reviewed for obvious leakage, fingerprinted, and then frozen. Canonical measurement slots do not run participant premise or context generation.

Fixture metadata includes corpus version, corpus fingerprint, schema migration fingerprint, embedding model/configuration, derived-document fingerprint, the corpus-wide prompt fingerprint, and expected participant/network counts. `DISCOVERY_TARGETS` gains a separately attested read-only base endpoint so the parent can verify metadata and fixture integrity before resetting a child branch. Base credentials remain server-side and never enter logs or artifacts.

Every measured slot starts from the same state. Immediately before a slot, the parent restores the side branch from the verified protected base and launches a fresh child process with a unique side/run/slot cache namespace. A paired slot restores both branches before launching A and B. Slots are not batched against accumulating opportunity state. The historical-discovery harness overrides the shared runner to allow exactly one attempt per requested slot; automatic retries would both contaminate state and make the spend ceiling dishonest. A transient failure remains incomplete evidence and is not silently replaced by a retry. A changed corpus or migration invalidates the base before any child reset or provider spend. Refreshing the protected base is a deliberate operator action, never an automatic response to a failed run.

## Observation and Scoring

The runner records three distinct stages:

1. **Execution:** whether graph invocation completed with valid evidence.
2. **Retrieval:** raw evidence rows plus a canonical user-level candidate order.
3. **Evaluator/final result:** evaluator eligibility, actual submission, evaluator return/score, final inclusion, and one-based final rank.

User-level retrieval rank groups all evidence rows by stable participant ID, assigns each person their best normalized retrieval score, breaks equal scores by stable participant ID, and unions their evidence types/identifiers. Recall@K uses that deduplicated order, so extra premise/context rows cannot improve or harm a person's rank merely through multiplicity.

Per case, trigger, and repetition, deterministic scoring records:

- execution completeness;
- expected partner retrieved or missed;
- expected partner retrieval rank and recall at 1, 3, 5, and 10;
- whether the expected partner was eligible for and actually submitted to the evaluator;
- whether the evaluator returned it, its evaluator score, final inclusion, final rank, and reciprocal rank;
- authored semantic hard negatives retrieved, submitted to the evaluator, and finally surfaced;
- fixture ownership and allowed-evidence violations;
- failure stage, using this precedence: `execution` when the slot did not complete; `retrieval` when the target was absent from raw user-level retrieval; `evaluation_admission` when retrieved but not submitted (including falling outside the evaluator's bounded candidate batch); `evaluation_rejection` when submitted but not returned/approved; `finalization` when evaluator-approved but absent from final candidates; otherwise `none`.

A low final rank is a metric, not a failure stage. Submission is captured from the graph's actual evaluator trace rather than inferred solely from raw rank.

Aggregate reporting includes separate metrics by trigger, domain, case, model/config side, and overall cohort. The report distinguishes labelled semantic negatives from unlabelled candidates. It does not emit a composite quality pass rate or declare an A/B winner.

The shared scorecard transport still requires `runs`, `passes`, and `passRate`; for this harness they represent execution completeness only and are labelled **completeness**, never match quality. Discovery-specific metric fields travel in the existing case-row extension seam, and eval-ops renders those metrics instead of the generic pass-rate comparison.

The LLM judge is optional, diagnostic-only, fixed across sides, and excluded from completeness and quality metrics. If enabled, it receives an audited model-safe projection of anonymized source/candidate evidence, not report identities, expected labels, or raw evaluator reasoning. A missing or failed judge cannot repair deterministic evidence or block an otherwise complete slot.

Project completion has no match-rate floor. Incomplete evidence has no verdict.

## Model and Environment Comparisons

The existing A/B engine remains paired by case, trigger, and repetition, with one isolated Neon child branch per side reset from the same protected base.

The parent resolves and validates each side, then places that configuration in the child process environment at spawn. No model-dependent protocol/API module may load before the child environment is active. This is required because several agents construct model clients in their constructors; mutating environment variables only around `graph.invoke()` is insufficient.

An ordinary comparison must differ in exactly one resolved factor:

- one graph-agent model assignment for one named agent; or
- one environment key.

A JSON `EVAL_MODEL_OVERRIDES` value is compared semantically by resolved agent assignment, not treated as one opaque key. Judge model, embedding model, provider account, selection, corpus version, trigger set, repetitions, scoring policy, and database starting state remain equal.

Each child reports its resolved graph-agent model IDs and a secret-free configuration fingerprint covering inherited defaults, judge policy, embedding configuration, and operator overrides. Artifacts retain both resolved provenance and the operator-specified delta; credentials and raw secret values are excluded.

A/B artifacts remain baseline-free. The pair is the result. They report per-side metric values and paired deltas without a winner or statistical-significance claim. Multi-factor runs are allowed only as explicitly labelled exploratory runs and produce no causal claim.

## Failure and Safety Behavior

The runner fails closed in this order:

1. validate corpus structure and model-safe projection;
2. validate selected cases, triggers, repetitions, and one-factor A/B constraints;
3. compute the attempt ceiling and refuse more than 200 graph invocations; because this harness sets `maxAttempts: 1`, requested slots and maximum graph invocations are equal;
4. attest the read-only protected-base endpoint and child branches;
5. verify fixture/schema/derived-document fingerprints on the protected base;
6. show graph-invocation count plus pilot-calibrated maximum provider calls, cost, and wall time, then require explicit confirmation;
7. for each slot, restore only the child branch or branches that slot will use;
8. launch fresh configured child processes with isolated cache namespaces;
9. preserve complete or partial artifacts with honest completeness status.

Eval-ops pricing and CLI help include the trigger and side multipliers and state that automatic retries are disabled before full-corpus runs are enabled. A default canonical run is 15 cases × 2 triggers × 3 repetitions × 1 attempt = at most 90 graph invocations. A full paired comparison is at most 180 and fits under the hard cap; any larger design or retry policy requires separate review.

Failures before step 7 spend nothing and mutate no child branch. Failures after reset report which branches were reset and whether provider work may have occurred. Partial artifacts remain diagnostic only and yield no comparison verdict.

Database-backed tests run only against an attested disposable database with `TEST_DATABASE_SAFE=1`. Production and dev databases remain unreachable by construction.

## Verification Strategy

Each implementation issue must run affected provider-free tests and `cd packages/protocol && bun run eval:verify`.

Milestone gates add progressively stronger evidence:

- **Contract/corpus:** structural tests, citation completeness, projection leakage tests, and independent corpus review.
- **Shared-pool pilot:** deterministic fixture tests, stable-ID mapping, frozen premise/context/derived-document checks, disposable-database fixture verification, per-slot restore proof, cache isolation, single-attempt enforcement, evaluator-submission attribution, and one-case live smoke for each trigger.
- **Corpus v2:** exact participant/network counts, one corpus-wide prompt, fixture ownership, pre-reset base verification, fingerprint refresh, and selected-case retrieval smoke.
- **A/B:** semantic one-factor validation, resolved-configuration provenance, proof that child configuration is active before model-dependent imports/graph construction, correct workload pricing, and a one-case paired live smoke.
- **Canonical measurement:** full selected corpus, both triggers, planned repetitions, complete artifact, and a privacy-safe findings report.

Raw live artifacts remain in protected/internal run storage. The repository receives a privacy-safe findings document containing aggregate metrics, corpus/config fingerprints, Git revision, model identifiers, completeness, and links or hashes for the retained raw evidence. A committed regression baseline is a separate decision after reviewing stochastic stability.

## Linear Project

### Milestone 1 — Trustworthy pilot

1. **Lock historical discovery measurement contract**
   - Encode corpus provenance/cutoffs, projection, stable identity, trigger shapes, deduplicated ranking, evaluator admission/submission states, failure-stage precedence, completeness-only transport fields, single-attempt workload cap, and one-factor A/B invariants in provider-free tests and types.

2. **Re-source and harden the existing five historical pairs**
   - Add citations, repair unsupported reconstructions, complete adversarial anonymization review, and replace the composite source identity.

3. **Run the five-pair shared-pool dual-trigger pilot**
   - Build the pilot shared fixture with frozen reviewed premises/contexts, add the read-only base attestation, restore per slot, isolate caches, extend trigger/metric dimensions, verify both trigger shapes, and run one-case live smokes.

### Milestone 2 — Full corpus

4. **Expand to 15 pairs and approximately 35 backgrounds**
   - Parent issue for small domain-batch authoring/review child issues. Batches may proceed in parallel only after issue 3 fixes the schema.

5. **Integrate and verify historical corpus v2**
   - Assemble the full shared pool under one reviewed network prompt, seed/freeze derived retrieval artifacts, refresh the protected base deliberately, and prove fixture isolation/fingerprints before child resets.

### Milestone 3 — Measurements

6. **Harden paired model and environment comparisons**
   - Apply configuration at child spawn before model-dependent imports, record resolved provenance, enforce semantic one-factor comparisons, update workload pricing, and run a paired live smoke.

7. **Run canonical measurements and publish findings**
   - Run the default configuration and selected model/environment comparisons, publish the privacy-safe report, and create separate tuning issues from observed failures.

Dependency spine: `1 → 2 → 3 → 5 → 6 → 7`. Issue 4 starts after issue 3 and also blocks issue 5.

## Non-Goals

- Improving prompts, retrieval algorithms, ranking, or production defaults to hit a score target.
- Covering introducer discovery.
- Solving IND-630's seven non-discovery-graph flags.
- Testing onboarding data collection or enrichment generation from raw external sources.
- Testing negotiation or delivery after opportunity creation.
- Treating every non-partner in the shared pool as a false positive.
- Adding a new eval UI, runner, artifact family, or statistical-significance claim.
- Committing a regression baseline before the first full evidence review.

## Project Completion

The project is complete when:

- the 15-pair/~35-background corpus satisfies provenance and anonymization review;
- the protected shared fixture is versioned and verified;
- intent and enrichment triggers run over the same corpus;
- retrieval, evaluation, ranking, labelled-negative, and completeness evidence are attributable;
- model and environment comparisons are paired and one-factor by default;
- the canonical run is complete and its privacy-safe findings are published;
- every observed product-quality failure is captured as a separate tuning issue.

The measured score may be low. Missing or incomparable evidence may not be presented as a result.
