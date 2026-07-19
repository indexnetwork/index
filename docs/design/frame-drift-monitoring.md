---
title: "Frame-Drift Monitoring"
type: design
tags: [measurement, embeddings, networks, bullmq, pgvector]
created: 2026-07-16
updated: 2026-07-19
---

# Frame-Drift Monitoring

IND-430 adds a disabled-by-default, backend-only observation pipeline. It records daily capture-time embedding centroids within networks and a non-causal intent-assignment-pair normalized opportunity-yield proxy between networks. It has no dashboard or API and does not mutate embeddings, prompts, vocabulary, assignments, opportunities, or networks. Its only writes are immutable observation headers and metric snapshots plus the separate, privacy-minimized scheduler execution-attempt ledger added by IND-468.

## Observation semantics and atomicity

`[bucketStart, bucketEnd)` is only the prior closed UTC opportunity-creation window. Historical lifecycle state cannot be reconstructed. Centroids and the proxy denominator are observations of source state when the transaction runs shortly after `bucketEnd`; `capturedAt` is the truth for when that state was observed. Neither value is an as-of/end-of-bucket reconstruction. The numerator alone uses opportunities created inside the closed window.

The database adapter starts one PostgreSQL `REPEATABLE READ` transaction by inserting a `frame_drift_observation_runs` header with a unique `bucket_start`. The first successful insert owns the entire bucket. Only that transaction performs measurement reads and writes metric rows; it then stores the stable cohort hash and aggregate diagnostics on the header before commit. Any failure rolls back the header and all rows, allowing a clean retry.

If header insertion conflicts, the adapter performs no measurement reads or writes and returns `observationStatus: 'duplicate'`, the original run's `capturedAt`, and zero inserted counts. A later retry therefore cannot append a newly eligible centroid, pair, or differently configured model to an old bucket. Per-row unique keys remain defense in depth. Metric rows have a non-null `run_id` with `ON DELETE CASCADE` to the observation header.

## Configuration and scheduling

```dotenv
FRAME_DRIFT_MONITORING_ENABLED=false
FRAME_DRIFT_MONITORING_SCHEDULE='15 0 * * *'
FRAME_DRIFT_MONITORING_MAX_NETWORKS=200
FRAME_DRIFT_MONITORING_MAX_PAIRS=10000
FRAME_DRIFT_MONITORING_MIN_USERS=5
```

The scheduler accepts exactly one fixed numeric minute and hour in a simple five-field UTC cron (`M H * * *`) and also validates it with node-cron. Invalid or potentially more-frequent expressions fall back to `15 0 * * *`. Network and pair limits are hard-clamped to 200 and 10,000. The privacy threshold defaults to 5 distinct users and is clamped to 2–100.

BullMQ uses a stable scheduler identity. On enabled startup, reconciliation first reads the existing scheduler and compares the desired cron pattern, UTC timezone, job name, template data, attempts, backoff, and completed/failed retention. It also requires the unsupported scheduling controls `limit`, `startDate`, `endDate`, and `every` to be absent, so a finite, bounded, or interval scheduler is never mistaken for the desired unlimited daily cron. Runtime scheduler fields such as `next`, `iterationCount`, and `offset` are not configuration. A materially matching scheduler is reused without calling `upsertJobScheduler`, even when its `next` timestamp is overdue, so deployment startup cannot delete that pending iteration. A match with a missing or non-finite `next` is treated as inconsistent scheduler state and repaired through upsert rather than reused. Only a missing, materially changed, or invalid-`next` scheduler is upserted; the stored definition is then re-validated with the same comparator, and a divergence (for example from a rolling-deployment race) fails reconciliation before any worker starts. Registration logs `schedulerAction: created|reused|updated` with the scheduler's authoritative `next` timestamp. The scheduler identity written to the ledger is read from BullMQ's `job.repeatJobKey` (the stable constant is only a manual-enqueue fallback).

Disabled startup still removes a scheduler left by an earlier deployment and does not create a worker. Enabled lookup/upsert and disabled removal retry automatically up to three times with short exponential delays; a terminal failure resets the startup promise so a later call can retry. The processor rechecks the feature flag after durable attempt-start tracking, records a structured skip when disabled, and rethrows service or tracking failures for BullMQ. Failure metadata includes `willRetry`; the final attempt is explicitly logged as final rather than promising another retry.

## Durable execution attempts

`frame_drift_execution_attempts` is an operational ledger separate from `frame_drift_observation_runs`. It has no observation-run foreign key and never participates in the repeatable-read observation transaction. One row is unique on `(job_id, attempt)` and contains only queue/scheduler/job identity, the BullMQ scheduled time, daily bucket bounds, attempt/max-attempt numbers, start/completion times, terminal status, `willRetry`, and an allowlisted failure category. It contains no vectors, prompts, network/user/actor IDs, cohort sizes, raw error messages, stacks, or serialized errors.

`recordStarted` is awaited before the runtime flag check or measurement call. Replaying the same job attempt retains the original start time, while conflicting identity is rejected. A replay also returns any existing terminal status: successful/skipped terminal attempts short-circuit without remeasurement, while failed terminal attempts rethrow a generic failure so BullMQ retry semantics are preserved. A started row transitions once to `inserted`, `duplicate`, `skipped`, or `failed`; a semantically identical terminal replay is accepted while preserving the first completion time, and missing or conflicting transitions are rejected. Successful outcomes and skips have no failure category. Failed measurement attempts store only `failureCategory='measurement'` and whether BullMQ has another configured attempt.

A tracking failure fails the BullMQ job rather than allowing an untracked successful measurement. Terminal ledger writes (`inserted`, `duplicate`, `skipped`, and `failed`) are retried with bounded in-process attempts and short exponential backoff; measurement is never re-run during these retries. If a terminal write eventually succeeds the job completes normally. If it exhausts its retries the original BullMQ failure behavior is preserved: on a non-final attempt a later BullMQ retry re-enters and the observation adapter's `duplicate` path re-records the terminal row, and when failure bookkeeping itself exhausts retries the original measurement error is preserved and rethrown. The irreducible case is terminal-write exhaustion on the *final* BullMQ attempt: there is no later retry, so the started row is left as durable incomplete evidence. A process crash can likewise leave a started row incomplete; the partial index on `started_at WHERE completed_at IS NULL` supports diagnosis, and the bucket-start index supports daily incident review.

Checks enforce non-empty identities, one midnight-aligned UTC day with the scheduled fire in the following UTC day, bounded attempt numbers, terminal/failure allowlists, and coherent started versus completed state. Most importantly, absent attempt rows mean **unobserved/unknown**. They are not expected-fire materialization and are not proof that BullMQ never enqueued a job.

## Stable bounded cohort

Eligible networks are undeleted, non-personal networks. Selection is `created_at ASC, id ASC`, limited to the first `FRAME_DRIFT_MONITORING_MAX_NETWORKS`, so a newly created network cannot displace the initial bounded cohort; deletion may shrink it. The run header stores a SHA-256 hash of the ordered selected IDs. Aggregate diagnostics include eligible and selected network counts.

After the same bounded selection, each network receives an admission ordinal from `row_number() over (ORDER BY created_at, id)`. Pairs are enumerated by admission order and limited by `(later_ordinal, earlier_ordinal)`. Consequently, while the network cohort is below its bound, every pair introduced by a newly admitted network appends after all pairs among older networks. Stored IDs are independently canonicalized with `LEAST/GREATEST`, preserving `network_a_id < network_b_id` without making lexical ID order the cohort policy.

The pair cohort is independent of activity. Only after the bounded pair cohort is selected are privacy eligibility and the positive denominator evaluated. Diagnostics report total possible cohort pairs, selected pairs, and positive measured pairs.

## Privacy-safe, user-balanced centroid observations

For each selected network and corpus, PostgreSQL first averages embeddings per `(network, user)` and then averages those per-user vectors. Every contributing user therefore has equal centroid weight even when users contribute different numbers of source rows:

- `premise`: ACTIVE, undeleted premises joined through `premise_networks`;
- `intent`: unarchived ACTIVE or legacy-NULL intents joined through `intent_networks`;
- `user_context`: non-global rows (`network_id IS NOT NULL`).

Every corpus joins its owning user and requires `users.deleted_at IS NULL`. A centroid is persisted only when at least `FRAME_DRIFT_MONITORING_MIN_USERS` distinct undeleted users contributed. Suppressed small cohorts never persist, and aggregate diagnostics expose only `suppressedCentroidCount` and `emptyCentroidCount`, never a suppressed cohort's exact size. `sample_count` remains the total number of contributing source rows; it is not the weighting basis.

Assignment primary keys mean a source row contributes once to each network to which it is assigned. Raw pgvector values pass through the shared `normalizeEmbedding` boundary and additional finite validation. `configured_embedding_model` records `OPENROUTER_EMBEDDING_MODEL` configured at capture; source rows do not carry model provenance, so it does not claim to prove the model that produced each vector. Cosine drift compares with the latest older snapshot for the exact network/corpus/configured-model key and is NULL without a valid finite, same-dimensional, nonzero prior.

Historical aggregates that met the threshold are de-identified and deliberately are not recomputed after a later user soft deletion. Hard network deletion cascades to metric rows; deleting an observation run cascades to all rows in that capture.

## Non-causal intent-assignment-pair normalized opportunity-yield proxy

Before a selected pair is eligible, **each side** must have at least `FRAME_DRIFT_MONITORING_MIN_USERS` distinct undeleted owners with active, unarchived, embedded intents. No pair row—and therefore no exact denominator or numerator—is persisted when either side is below that threshold.

For eligible sides, the denominator is a capture-time observation using independent `intent_networks` assignments:

```text
assignments(A) * assignments(B)
- sum_over_same_owner(assignments(owner,A) * assignments(owner,B))
```

An intent without an embedding is excluded. Canonical attribution deliberately does not use `actor.networkId`, which is shared match context rather than assignment provenance. Because assignments are independent and can be multiple, one opportunity can be attributed to multiple measured frame pairs. It is counted distinctly at most once within each pair.

The numerator considers only opportunities created in `[bucketStart, bucketEnd)` whose `detection.source` is exactly `opportunity_graph`. Manual, enrichment, and test opportunities do not count. Each non-introducer actor must identify an exact intent and user; the intent must have an embedding, belong to that undeleted user, and have had the relevant network assignment by opportunity creation. `intent_networks.created_at` is a legacy timestamp without timezone and is explicitly interpreted as UTC for this comparison. Actor owners must differ. Missing, embeddingless, mismatched, deleted-owner, or late-assigned actor intents are not attributed.

```text
yieldRate = graphOpportunityCountForPair / captureTimePotentialIntentAssignmentPairCount
yieldRateDelta = yieldRate - exactPreviousDailyBucketRate
```

The rate is a **non-causal intent-assignment-pair normalized opportunity-yield proxy**. It is not discovery provenance, causal evidence, an exposure probability, or proof that a frame pair produced a match; it may exceed 1. Immutable per-discovery frame-pair/attempt provenance is required future work before causal diagnosis or any realignment mechanism. A missing exact prior daily bucket produces a NULL delta.

Coverage diagnostics report aggregate total graph opportunities in the window, graph opportunities attributed to at least one persisted positive-denominator selected pair, and the remainder as unattributed. Opportunities mapping only to selected but privacy-ineligible or zero-denominator pairs are not called measured. No actors are logged.

## Logging, integrity, and rollout

Start, warning, failure, skip, and completion records use stable event names. Completion records state `observationStatus: inserted|duplicate`. Inserted completion/warning logs may include aggregate diagnostics and bounded top drift/proxy-delta lists. Duplicate completion logs include only the existing capture identity and zero inserted counts; they never emit recomputed diagnostics or top metrics. Vectors, actors, and suppressed cohort sizes are never logged.

Observation-table checks enforce one-day closed bucket shape, capture after bucket end, bounded capture configuration, a non-empty configured model, optional 64-character cohort hash, object-shaped diagnostics, a plain-text corpus allowlist, positive centroid sample counts, nonnegative opportunity counts, positive potential pair counts, nonnegative yield rates, cosine drift NULL or in `[0,2]`, canonical `A < B`, and valid metric bucket ranges. Unique metric keys also support latest-row lookup, so no redundant non-unique latest indexes are created. Execution-attempt checks and indexes are described separately above; they do not weaken or couple to observation atomicity.

The rollout intentionally does **not** add a transactional index to the live `opportunities` table. If production query performance requires a `created_at` index, assess it from observed plans and create it separately using an online/concurrent operational procedure.

## Remaining limitations

- Capture-time source state can differ from state at `bucketEnd`; `capturedAt` makes that limitation explicit.
- Deleted assignment history cannot be reconstructed.
- The configured-at-capture model label cannot prove every source vector used that model.
- Stable bounds mean monitoring may not be system-wide; aggregate counts and the cohort hash expose coverage.
- Historical privacy-qualified aggregates are intentionally not recomputed after later user deletion.
- Snapshot history grows daily. Retention/partitioning is deferred until observed storage growth justifies it.
- There is no catch-up or expected-fire table. A missing execution-attempt row is unknown evidence, not proof that BullMQ did not enqueue or start an iteration.
