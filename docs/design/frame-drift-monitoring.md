---
title: "Frame-Drift Monitoring"
type: design
tags: [measurement, embeddings, networks, bullmq, pgvector]
created: 2026-07-16
updated: 2026-07-16
---

# Frame-Drift Monitoring

IND-430 adds a disabled-by-default, backend-only measurement pipeline. It records daily embedding-centroid movement within networks and normalized opportunity yield between networks. It has no dashboard or API and does not mutate embeddings, prompts, vocabulary, assignments, opportunities, or networks. Its only writes are idempotent upserts to the two metric snapshot tables.

## Components

- `FrameDriftQueue` owns BullMQ scheduling and worker lifecycle only.
- `FrameDriftMonitoringService` validates a closed UTC day, calculates drift/rates, and emits bounded aggregate logs.
- `FrameDriftDatabaseAdapter` takes one PostgreSQL `REPEATABLE READ` snapshot, reads the cohort and prior metrics, then bulk-upserts both result sets in the same transaction.
- `frame_centroid_snapshots` and `cross_network_yield_snapshots` retain daily history.

The feature is configured with:

```dotenv
FRAME_DRIFT_MONITORING_ENABLED=false
FRAME_DRIFT_MONITORING_SCHEDULE='15 0 * * *'
FRAME_DRIFT_MONITORING_MAX_NETWORKS=200
FRAME_DRIFT_MONITORING_MAX_PAIRS=10000
```

The schedule is interpreted in UTC. Invalid values fall back to defaults and numeric bounds are clamped. Disabled startup removes a scheduler left by an earlier deployment and does not create a worker.

## Daily scheduling and idempotency

The queue uses BullMQ 5's supported `Queue.upsertJobScheduler` API with stable queue, job-name, and scheduler IDs. BullMQ's scheduler API deliberately excludes a caller-supplied `jobId`; BullMQ derives each occurrence's ID from the stable scheduler identity and due timestamp. Registering the same scheduler from multiple replicas is therefore safe. Database unique keys make duplicate/retried processing safe as well.

A worker prefers `job.opts.prevMillis` as the scheduled occurrence timestamp and falls back to `job.timestamp`. It derives the most recently closed UTC calendar day as `[bucketStart, bucketEnd)`. Failures escape the processor so BullMQ applies three exponential-backoff attempts.

## Centroid snapshots

Eligible networks are undeleted, non-personal networks ordered by ID and bounded by `FRAME_DRIFT_MONITORING_MAX_NETWORKS`. For each selected network, PostgreSQL computes `avg(vector)` over non-null embeddings:

- `premise`: ACTIVE, undeleted premises joined through `premise_networks`;
- `intent`: unarchived intents with status ACTIVE or legacy NULL joined through `intent_networks`;
- `user_context`: non-global rows (`network_id IS NOT NULL`).

Assignment primary keys mean a source row contributes once to each network to which it is assigned. Raw pgvector values are normalized and checked before calculation or persistence. The model recorded with each snapshot is `OPENROUTER_EMBEDDING_MODEL`. The prior centroid is the latest older snapshot for the exact network/corpus/model key.

Cosine drift is:

```text
1 - clamp(cosineSimilarity(current, prior), -1, 1)
```

It is NULL when there is no prior centroid or either vector is malformed, zero-length/zero-norm, nonfinite, or dimension-mismatched.

## Cross-network yield

Pairs are canonical distinct network IDs `A < B`. The denominator is computed from end-of-bucket active intent-assignment aggregates without expanding a Cartesian product of intents:

```text
assignments(A) * assignments(B)
- sum_over_same_owner(assignments(owner,A) * assignments(owner,B))
```

Only positive denominators are retained. Pairs are ranked by denominator descending and then IDs ascending, and bounded by `FRAME_DRIFT_MONITORING_MAX_PAIRS`.

The numerator counts distinct opportunities created in `[bucketStart, bucketEnd)` for each canonical pair. Attribution expands only opportunity actors, excludes introducers, requires exact `intent` and `userId`, verifies that the intent belongs to that user, and requires the intent-network assignment to exist no later than opportunity creation. Actor users must differ. Actor `networkId` is shared match context and is never used as the pair source. Personal/deleted networks are excluded through the selected cohort. Duplicate actors or multi-assignment paths cannot count an opportunity more than once for the same pair. Opportunity lifecycle status is intentionally ignored.

```text
yieldRate = opportunityCount / potentialActiveIntentPairCount
yieldRateDelta = yieldRate - exactPreviousDailyBucketRate
```

Rates are normalized yield, not probabilities, and may exceed 1. A missing exact previous daily bucket produces a NULL delta.

## Logging and safety

Each successful run emits one start and one completion record with stable `event` values. Completion includes row counts, duration, truncation flags, and at most ten largest centroid drifts and ten most negative yield deltas. One aggregate warning covers invalid vectors and cohort truncation. Vectors and actors are never logged. Unsafe counts or nonfinite rates abort the transaction, so neither table is partially written.

The queue is intentionally omitted from Bull Board because it is an internal scheduled measurement, not an operator-facing workflow.

## Limitations

- Source premise, intent, and user-context rows do not record embedding-model provenance. The configured current model labels the aggregate but cannot prove every source vector was generated by it.
- The denominator is end-of-bucket point-in-time state, not a historical reconstruction of all states during the day.
- Deleted assignments cannot be reconstructed, so historical denominators and attribution are limited by retained assignment rows.
- Yield is normalized and can exceed 1; it must not be interpreted as a probability.
- Network and pair bounds define a monitored cohort. Truncation flags indicate that the snapshot is not system-wide.
- Snapshot history grows daily. Retention/partitioning is intentionally deferred until observed storage growth justifies it.
