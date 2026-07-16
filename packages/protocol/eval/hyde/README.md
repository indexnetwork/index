# Paired HyDE Retrieval Eval (IND-426)

This is a small, deliberately drift-focused retrieval eval. It is **not** a set of
normal matching cases. Each source is paired with a hand-authored expected target and
same-domain traps/distractors that differ on role, named entity, location, time, scale,
or financing constraints.

The matching eval is labeled separately because it invokes `OpportunityEvaluator`
directly. It is useful as a secondary evaluator-regression check, but it is not evidence
that HyDE generation or retrieval improved.

## What the live eval exercises

For every selected case and repetition, the harness runs a paired `legacy` and `frame-v1`
pass using the production:

- `LensInferrer`
- `HydeGenerator`
- `HydeGraphFactory`
- `HydeValidator` (the graph intentionally calls it only in `frame-v1`; legacy has no
  validation node)

The graph uses empty in-memory cache/database ports with `forceRegenerate: true`. No
PostgreSQL, pgvector, network scope, opportunity graph, or `OpportunityEvaluator` is
involved. Recording delegates retain generated documents and real validator verdicts for
diagnosis without replacing any production agent.

Candidates and returned HyDE documents use `OpenAIEmbeddings` with an OpenRouter
request configuration equivalent to the API adapter and the same model/dimensions:

- base URL: `https://openrouter.ai/api/v1`
- model: `EMBEDDING_MODEL` or `openai/text-embedding-3-large`
- dimensions: `EMBEDDING_DIMENSIONS` or `2000`
- API key: `OPENROUTER_API_KEY`

The in-memory scorer approximates the current production `EmbedderAdapter`: each
candidate-lens cosine must meet `--min-score` (default `0.40`), candidates with no
qualifying match are omitted, and the final score is
`min(best + 0.1 * (additional qualifying matches), 1)`. Lens IDs travel with query
embeddings and are retained on ranked candidates. Raw maximum cosine remains a diagnostic;
the bonus-adjusted score is the headline rank. Exact score ties use their average rank for
Recall@K/MRR, so candidate IDs or authored order cannot decide headline metrics.

This remains a production approximation, not an adapter replica. It does not run the SQL
per-lens/per-corpus limits, enforce network scope, or group multiple intent/premise rows by
user. The hand-authored corpus intentionally has one candidate row per user, so it cannot
exercise cross-row user grouping or the extra matches that grouping can create.

## Metrics and diagnostics

Per run, the report includes:

- expected-target rank (or `null` for a miss/no returned document)
- full candidate ranking with bonus-adjusted score, raw max cosine, qualifying-match
  count, and matched lens IDs
- inferred lens count
- generated and returned document counts
- frame-v1 rejected count from key-resolved `valid: false` verdicts with at least one
  unsupported named entity or hard constraint; legacy reports `null` because rejection is
  not applicable
- failed-open count for contradictory, missing, duplicate, malformed, or validator-error
  outcomes
- generated-document overwrite/map-loss count, reported separately from rejection
- every generated document plus map status, opaque validator key, return status,
  `valid`/`invalid`/`failed_open`/`not_submitted`/`not_applicable` status, failure reason,
  and the real key-resolved validator verdict when one exists

Per mode, it reports Recall@K, MRR, and total generated/overwritten/rejected/failed-open
counts.
Failed-open frame-v1 documents are intentionally included in ephemeral ranking because
that is the production graph behavior; they are not written to Redis or PostgreSQL.

## Run

From `packages/protocol`:

```bash
bun run eval:hyde                              # all cases, 3 paired runs each
bun run eval:hyde -- --runs 5 --k 1 --min-score 0.40
bun run eval:hyde -- --case profile-boundary/
bun run eval:hyde -- --list-cases              # provider-free
bun run eval:hyde -- --report                   # full JSON under eval/hyde/runs/
bun run eval:hyde -- --report /tmp/hyde.json
```

The package script loads `../../.env.test`. A live run calls external language and
embedding models and therefore requires valid provider configuration. Unit tests under
`tests/` are provider-free.

JSON reports record the configured primary lens-inferrer, generator, and validator model
IDs; embedding base URL/model/dimensions; frame generation version; Git revision with a
dirty marker; full-corpus and effective-config fingerprints; selected-case hashes;
minimum score; lens-bonus formula; and case/run/mode/concurrency ordering. Together these
make filtered and full runs diagnosable without implying that provider outputs themselves
are deterministic.

## Interpretation and limitations

This corpus is intentionally tiny and hand-authored. It measures whether constrained
hypothetical documents retrieve the intended local candidate better than plausible local
traps; it does not estimate production opportunity precision, recall, fairness, latency,
or cost. LLM and embedding-provider variance still applies, so release evidence should use
the complete corpus and multiple repetitions (at least the default three).

There is no committed HyDE baseline and no `--update-baseline` path. Never treat a
filtered or single-run report as a canonical baseline. Preserve a full multi-run report
for review, and use `eval:matching` only as the separately labeled secondary regression
check.
