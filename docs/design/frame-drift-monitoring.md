---
title: "Frame-Drift Monitoring"
type: design
tags: [measurement, embeddings, networks, bullmq, pgvector]
created: 2026-07-16
updated: 2026-07-16
---

# Frame-Drift Monitoring

IND-430 adds a disabled-by-default, backend-only observation pipeline. It records daily capture-time embedding centroids within networks and an intent-assignment-pair normalized opportunity-yield proxy between networks. It has no dashboard or API and does not mutate embeddings, prompts, vocabulary, assignments, opportunities, or networks. Its only writes are immutable rows in two metric snapshot tables.

## Observation semantics

`[bucketStart, bucketEnd)` is only the prior closed UTC opportunity-creation window. Historical lifecycle state cannot be reconstructed. Centroids and the proxy denominator are observations of source state when the transaction runs shortly after `bucketEnd`; `capturedAt` is the truth for when that state was observed. Neither value is an as-of/end-of-bucket reconstruction. The numerator alone uses opportunities created inside the closed window.

The database adapter takes one PostgreSQL `REPEATABLE READ` snapshot and inserts both result sets atomically. Unique daily keys use `ON CONFLICT DO NOTHING`: the first successful transaction wins, and retries or backfills can never rewrite a bucket after source state changes. Returned row counts are actual insert counts and are zero for a duplicate bucket.

## Configuration and scheduling

```dotenv
FRAME_DRIFT_MONITORING_ENABLED=false
FRAME_DRIFT_MONITORING_SCHEDULE='15 0 * * *'
FRAME_DRIFT_MONITORING_MAX_NETWORKS=200
FRAME_DRIFT_MONITORING_MAX_PAIRS=10000
FRAME_DRIFT_MONITORING_MIN_USERS=5
```

The scheduler accepts exactly one fixed numeric minute and hour in a simple five-field UTC cron (`M H * * *`) and also validates it with node-cron. Invalid or potentially more-frequent expressions fall back to `15 0 * * *`. Network and pair limits are hard-clamped to 200 and 10,000. The privacy threshold defaults to 5 distinct users and is clamped to 2–100.

BullMQ uses a stable scheduler identity. Disabled startup removes a scheduler left by an earlier deployment and does not create a worker. The processor rechecks the feature flag, logs a structured skip when disabled, and rethrows service failures after structured bucket/job/attempt logging so BullMQ can retry. Scheduler-registration failure resets the startup promise, allowing a later startup retry.

## Stable bounded cohort

Eligible networks are undeleted, non-personal networks. Selection is `created_at ASC, id ASC`, limited to the first `FRAME_DRIFT_MONITORING_MAX_NETWORKS`, so a newly created network cannot displace the initial bounded cohort; deletion may shrink it. Diagnostics include eligible and selected network counts plus a SHA-256 hash of the ordered selected IDs.

The pair cohort is independent of activity. All canonical selected-network pairs `A < B` are ordered by IDs, then limited by `FRAME_DRIFT_MONITORING_MAX_PAIRS`. Only afterward is the denominator calculated, and only positive-denominator pairs are persisted. Diagnostics report total possible cohort pairs, selected pairs, and positive measured pairs. This prevents changing activity from changing pair membership.

## Privacy-safe centroid observations

For each selected network, PostgreSQL computes `avg(vector)` over non-null embeddings:

- `premise`: ACTIVE, undeleted premises joined through `premise_networks`;
- `intent`: unarchived ACTIVE or legacy-NULL intents joined through `intent_networks`;
- `user_context`: non-global rows (`network_id IS NOT NULL`).

Every corpus joins its owning user and requires `users.deleted_at IS NULL`. A centroid is persisted only when at least `FRAME_DRIFT_MONITORING_MIN_USERS` distinct undeleted users contributed. Suppressed small cohorts never persist, and logs expose only aggregate `suppressedCentroidCount` and `emptyCentroidCount`, never a suppressed cohort's exact size. Persisted qualifying rows retain their source-row `sample_count`.

Assignment primary keys mean a source row contributes once to each network to which it is assigned. Raw pgvector values pass through the shared `normalizeEmbedding` boundary and additional finite validation. The recorded model is `OPENROUTER_EMBEDDING_MODEL`; source rows do not record model provenance. Cosine drift compares with the latest older snapshot for the exact network/corpus/model key and is NULL without a valid finite, same-dimensional, nonzero prior.

Historical aggregates that met the threshold are de-identified and are deliberately not recomputed after a later user soft deletion. Hard network deletion cascades to both snapshot tables.

## Intent-assignment-pair normalized opportunity-yield proxy

The denominator is a capture-time observation over active, unarchived, embedded intents owned by undeleted users, using independent `intent_networks` assignments:

```text
assignments(A) * assignments(B)
- sum_over_same_owner(assignments(owner,A) * assignments(owner,B))
```

An intent without an embedding is excluded. Canonical attribution deliberately does not use `actor.networkId`, which is shared match context rather than assignment provenance. Because assignments are independent and can be multiple, one opportunity can be attributed to multiple selected frame pairs. It is counted distinctly at most once within each pair.

The numerator considers only opportunities created in `[bucketStart, bucketEnd)` whose `detection.source` is exactly `opportunity_graph`. Manual, enrichment, and test opportunities do not count. Each non-introducer actor must identify an exact intent and user; the intent must have an embedding, belong to that undeleted user, and have had the relevant network assignment by opportunity creation. Actor owners must differ. Missing, embeddingless, mismatched, deleted-owner, or late-assigned actor intents are not attributed.

```text
yieldRate = graphOpportunityCountForPair / captureTimePotentialIntentAssignmentPairCount
yieldRateDelta = yieldRate - exactPreviousDailyBucketRate
```

The rate is an **intent-assignment-pair normalized opportunity-yield proxy**. It is not discovery provenance, causal evidence, an exposure probability, or proof that a frame pair produced a match; it may exceed 1. Immutable per-discovery frame-pair/attempt provenance is required future work before causal diagnosis or any realignment mechanism. A missing exact prior daily bucket produces a NULL delta.

Coverage diagnostics report aggregate total graph opportunities in the window, graph opportunities attributed to at least one selected pair, and unattributed graph opportunities. No actors are logged.

## Logging, integrity, and rollout

Start, warning, failure, skip, and completion records use stable event names. Warning and completion records carry bucket boundaries, `capturedAt`, exact cohort/pair/coverage counts, aggregate suppression/empty/invalid-vector counts, and bounded top drift/proxy-delta lists. Vectors, actors, and suppressed cohort sizes are never logged.

Database checks enforce a plain-text corpus allowlist, positive centroid sample counts, nonnegative opportunity counts, positive potential pair counts, nonnegative yield rates, cosine drift NULL or in `[0,2]`, canonical `A < B`, and `bucket_end > bucket_start`. Unique daily keys also support latest-row lookup, so no redundant non-unique latest indexes are created.

The rollout intentionally does **not** add a transactional index to the live `opportunities` table. If production query performance requires a `created_at` index, assess it from observed plans and create it separately using an online/concurrent operational procedure.

## Remaining limitations

- Capture-time source state can differ from state at `bucketEnd`; `capturedAt` makes that limitation explicit.
- Deleted assignment history cannot be reconstructed.
- The configured model labels an aggregate but cannot prove every source vector used that model.
- Stable bounds mean monitoring may not be system-wide; exact counts and the cohort hash expose coverage.
- Snapshot history grows daily. Retention/partitioning is deferred until observed storage growth justifies it.
