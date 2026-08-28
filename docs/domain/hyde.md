---
title: "HyDE (Hypothetical Document Embeddings)"
type: domain
tags: [hyde, semantic-search, lenses, embeddings, discovery, caching]
created: 2026-03-26
updated: 2026-07-16
---

# HyDE (Hypothetical Document Embeddings)

HyDE is the semantic retrieval bridge used by Index discovery. Instead of embedding only
a seeker's words, the system generates a short hypothetical document in an ideal
counterpart's voice, embeds it, and searches real intent and premise documents in the same
vector space.

For example, "looking for a co-founder" is in the seeker's voice, while a useful candidate
may describe themselves as an engineer interested in co-founding. A hypothetical
counterpart document reduces that voice mismatch before candidate evaluation.

## Lenses and target corpora

`LensInferrer` analyzes `sourceText` plus optional `profileContext` and returns 1-N
free-text lenses. Each lens has a label, a target-corpus hint, and reasoning. The hints are:

- `intents`: complementary goals, needs, or aspirations;
- `premises`: identity, expertise, values, or worldview assertions;
- `profiles`: a retained lens vocabulary meaning "a type of person." The live API no
  longer has a profile-vector corpus; it remaps this hint to premise search.

The API searches both intents and premises for each lens, allocating more results to the
preferred corpus, then merges candidates. Profile identity fields on `users` are for
presentation, not a HyDE source or vector corpus.

## Source/profile boundary

HyDE source types are `intent`, `query`, and `context`. There is no `profile` source type.
A context source is a synthesized user-context paragraph; profile-HyDE and the
`user_profiles` corpus were retired.

`profileContext` may help **select and specialize lenses**, but it is not source evidence.
This distinction matters most in frame-v1:

- frame extraction reads only `sourceText`;
- each frame item must quote an exact `sourceText` evidence span;
- sanitization removes unsupported frame values;
- neither the frame-v1 generator nor validator receives `profileContext`.

The legacy lens label can still reflect profile context, and its unconstrained generator
can elaborate that lens. Frame-v1 keeps lens usefulness while preventing profile-only
names, locations, credentials, or constraints from becoming accepted source facts.

## Two generation modes

`HYDE_FRAME_CONSTRAINTS_ENABLED` controls the production mode. Only the exact string
`true` enables `frame-v1`; the default is `legacy` so rollout is opt-in.

### Legacy

```text
infer_lenses -> check_cache -> generate_missing -> embed -> cache_results
```

Legacy inference returns lenses only. `HydeGenerator` combines each source and lens with a
corpus-specific prompt, and generated documents go directly to embedding. Existing legacy
cache keys and database strategies remain unchanged.

### frame-v1

```text
infer_lenses + source_frame
  -> check versioned cache
  -> generate_missing from sanitized frame
  -> validate_generated (one batch)
  -> embed accepted/ephemeral documents
  -> cache only validated documents
```

Frame-v1 inference returns lenses plus a sanitized frame containing source roles,
complementary roles, explicit hard constraints, named entities, and domain vocabulary.
Generic reciprocal-role inference is allowed, but hard facts require exact source evidence.
The generator may elaborate generic roles/domain language and write in the counterpart's
voice; it must not invent proper nouns or hard location, time, numeric, credential,
organization, or exclusivity constraints.

## Post-generation validation

`HydeValidator` runs once over all newly generated frame-v1 documents before embedding.
It compares each document with `sourceText` and the sanitized frame. First-person target
voice, generic domain elaboration, and reciprocal/complementary inversion are allowed.
Unsupported named entities or hard constraints make a document invalid.

Validation outcomes are deliberately per document:

- **Partial rejection:** invalid documents are removed; valid siblings continue to
  embedding, output, Redis, and PostgreSQL.
- **All rejected:** the graph completes successfully with no HyDE documents or embeddings;
  discovery gets no candidates from that HyDE pass. This does not revoke an earlier
  validated cohort for the unchanged source; source-text hashing prevents that cohort from
  surviving a source edit.
- **Validator failure or malformed/missing/contradictory verdict:** the affected document
  is marked `failed_open`, embedded, and returned for the current invocation so provider
  trouble does not turn discovery into a hard failure. It is **ephemeral**: failed-open
  output is never cached or persisted.
- **Validated cache/DB hit:** a frame-v1 document with matching version, lens, source/frame
  fingerprints, generation marker, and `validationStatus: valid` is reused without another
  validator call.

Legacy documents have no validation status and never pass through this validator node.

## Versioned caches and persistence

Frame-v1 does not overwrite or trust legacy entries.

- Legacy Redis keys keep their original namespace and lens/corpus hash.
- Frame-v1 Redis keys add `frame-v1` plus a fingerprint of the exact `sourceText` and
  sanitized frame.
- Legacy PostgreSQL strategy values remain unchanged.
- Frame-v1 PostgreSQL strategies use a stable `frame-v1` + lens/corpus hash, so a source
  revision upserts its prior frame row instead of appending one row per revision.
- Frame-v1 context metadata records the lens, source-text hash, source/frame fingerprint,
  generation marker, and validated status. Bulk context discovery reads only the active
  mode, requires the current source-text hash, and selects the newest generation-marker
  group; disabling the flag therefore returns to legacy rows only.

A changed source or sanitized frame cannot reuse an older frame-v1 document, while stable
DB identities prevent revision accumulation. Only validated frame-v1 documents are written.
Redis still provides short-lived reuse and PostgreSQL longer-lived reuse; intent/context
lifecycle jobs handle regeneration and invalidation as before.

## Retrieval and downstream evaluation

Accepted or failed-open document text is embedded with the configured OpenRouter embedding
model (default `openai/text-embedding-3-large`, 2000 dimensions), the same model used for
candidate intents and premises. The API performs cosine-similarity search in network scope,
merges multi-lens candidates, and then passes them to `OpportunityEvaluator`. HyDE retrieval
and opportunity evaluation are separate stages: an evaluator-only regression suite cannot
show that a hypothetical document retrieved the right candidate.

IND-426 therefore included the evidence-v2 paired retrieval study, which lived in
`packages/protocol/eval/hyde/` until the evals were removed on 2026-08-16 (restore it
from the `archive/eval-2026-08-16` tag). Its frozen local corpus had 90 cases and 900 candidates
under the existing five drift strata: profile-context contamination, entity/location
substitution, time/numeric scale, credential/organization/exclusivity, and role/polarity
controls. Every stratum retains at least 15 cases. The primary 75-case cohort represents
stored intents processed asynchronously by background discovery. The secondary 15-case
cohort represents premise-derived, network-scoped user-context paragraphs matched against
other users' active intents. There is no synchronous direct-search cohort. Every case has
10 candidates: two authored graded positives, four linked minimal-pair hard negatives, and
four distractors. Authored
grades are construction labels only; resolved, blinded judgments from two independent
humans define canonical retrieval and grounding truth.

The harness invokes the unchanged production agents and graph with empty cache/database
ports and embeds each case's candidate pool once for all modes/runs. To match the current
`DiscoveryQueue` and `OpportunityGraph`, it privately maps `saved-intent` to graph
`sourceType: 'query'`; `query` is an internal background-branch label fed a stored intent,
not a direct user request. `user-context` maps to `sourceType: 'context'` with a stable
synthetic source ID. Collection provenance and paired blocks record both names, while the
blind public batch exposes neither. Removing or refactoring the direct-search product must
preserve this saved-intent background branch or intentionally migrate the mapping and eval
contract. Saved-intent cases always receive the production-shaped discoverer context:
the trigger source under `Active intents:` plus an authored global `Context:` paragraph
when the case tests profile contamination. Canonical execution fixes the live background
cosine cutoff at `0.30`, additional-lens bonus at `0.1`, maximum lenses at 3,
and uses four paired runs counterbalanced by a fixed case/run hash. Provenance pins are
configured **primary** model/embedding IDs. Production retries/fallbacks remain enabled,
but per-call fallback provider/model identity is unavailable and not recorded. Failures
are explicit: there are no eval-level retries or success-only selection. Failed concurrent
generation waits for every started generator call to settle before resource capture;
frame extraction cannot be observed separately through the injected lens-inferrer port.
The public adjudication batch contains only opaque IDs, rubrics, `sourceText`, and judged
text; it excludes background source, internal graph source, mode/run, production validator
output, and map/return status.
`profileContext` is not grounding support. The private mapping is written mode 0600 and
must remain hidden from adjudicators/resolver. Production `HydeValidator` output is
diagnostic only, and optional LLM triage can never replace the two human judgments or make
evidence canonical. Resolver decisions are valid only for disagreement/`unable` items;
any surplus or otherwise unused decision makes resolution incomplete and noncanonical.

Evidence-v2 reports tie-fractional Precision@5, graded nDCG@5, linked-hard-negative FPR@5,
raw-cosine positive-to-nearest-linked-negative margin, unsupported-generation and returned
exposure/grounding-error rates, all-rejected/failed-open/incomplete-pair rates, and
resource timing. It also reports non-gating coverage and point estimates for all eight
metrics by saved-intent versus user-context cohort. Per-call fallback identity and
separate frame-extraction resource data are explicitly unavailable. A no-return run has zero exposure, but retrieval and
all-rejected metrics guard that case separately. Confidence intervals use a deterministic 10,000-replicate,
fixed-seed, 95% percentile hierarchical paired bootstrap: cases within each stratum and
paired runs within case are resampled, then run -> case -> stratum means receive equal
weight in a five-stratum macro average.

The only release gates are: grounding-error delta CI upper `< 0`; frame grounding CI upper
`<= 0.05`; Precision@5 delta CI lower `>= -0.05`; nDCG@5 delta CI lower `>= -0.05`; margin
delta CI lower `>= -0.03`; hard-negative FPR@5 delta CI upper `<= 0.02`; frame all-rejected
CI upper `<= 0.05`; and frame failed-open CI upper `<= 0.02`. Incomplete or noncanonical
evidence makes every gate and the overall result `INSUFFICIENT`.

## Limitations and rollout

Frame constraints reduce unsupported entity/constraint drift; they do not prove factual
truth, guarantee semantic relevance, or replace downstream candidate evaluation. The eval
uses a frozen local corpus and an in-memory adapter approximation without SQL limits or
cross-row grouping. It does not execute BullMQ, network scoping, database persistence or
reuse, raw-context fallback, candidate merging, negotiation, or delivery; it tests only
the HyDE generation/retrieval component used inside those background jobs. It intentionally scores both intent and premise
candidates for every lens, matching production's cross-corpus search; target corpus is a
preference/limit-allocation hint rather than a filter. Provider variance and a heavy
human-judgment burden remain. It does not establish production opportunity precision,
recall, fairness, or external validity; canonical token/cost accounting is unavailable.
Report generation recomputes analysis from all supplied parent artifacts rather than
trusting a standalone PASS file, and retained per-lens cosines let preflight recompute the
score/ranking derivation. Artifacts are still unsigned and embeddings are not retained, so
coordinated parent edits require trusted custody/fingerprint review. Human reviewer IDs
and independence attestations likewise require external identity verification. Each export
file is atomically replaced, but the public/private/template set is
not transactional and `--force` regenerates opaque IDs; preserve it as one set. Run
artifacts are gitignored and there is no committed baseline. Frame-v1 remains default-off
until full canonical evidence is reviewed. The matching eval remains only a secondary evaluator-only
check. The staged CLI, adjudication rubrics, exact metrics, and artifact handling are
documented in that suite's README, preserved in the `archive/eval-2026-08-16` tag.
