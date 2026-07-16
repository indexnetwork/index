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

IND-426 therefore includes a paired drift-focused eval in
`packages/protocol/eval/hyde/`. It runs the real legacy and frame-v1 HyDE pipelines against
a small in-memory candidate corpus using equivalent OpenRouter request configuration and
the same embedding model/dimensions. Its scorer approximates production's `0.40` cosine
floor and `0.1` additional-match bonus, but does not reproduce SQL per-lens limits, network
scope, or cross-row user grouping beyond one candidate row per user. PostgreSQL and
opportunity evaluation remain excluded. The existing matching eval remains a secondary
evaluator-regression check.

## Limitations and rollout

Frame constraints reduce unsupported entity/constraint drift; they do not prove factual
truth, guarantee semantic relevance, or replace downstream candidate evaluation. The live
eval corpus is intentionally small and provider-variable. Frame-v1 remains default-off
until full paired multi-run retrieval evidence and the separately labeled matching
regression check are reviewed. Filtered or single runs must not establish a canonical
baseline.
