# Durable Discriminator-Axis Memory

**Status:** Approved for planning
**Scope:** `pool_discovery` discriminator questions only

## Problem

Intent-scoped Personal Agent cards can repeat a discriminator that the user has already answered. The pool-discovery pipeline stores the original discriminator label, question seed, and semantic embedding, but it treats resolved axes as fresh only while their stored intent fingerprint matches the current intent.

An answer commonly causes an intent refinement. The fingerprint then changes, so later mining can omit the prior resolved axis from its novelty references. The transactional persistence guard likewise permits an answered/dismissed exact label once its stored fingerprint is no longer current. A later mining run can therefore create an equivalent card, whether with identical wording or a paraphrase.

## Goals

- Do not ask a user the same discriminator axis again for the same intent after they answer or dismiss it.
- Suppress both exact-label repeats and semantic paraphrases across all subsequent intent versions.
- Preserve legitimate questions about genuinely new axes.
- Keep existing pending-card, pool-freshness, lifecycle, and delivery behavior intact.
- Do not add a user-facing reset/reopen control in this release.

## Non-goals

- Changing generic recovery, chat, discovery, enrichment, or negotiation question generation.
- Adding a controlled global taxonomy of discriminator categories.
- Reopening resolved axes automatically when the intent changes.
- Adding a database migration or new table.

## Design

### Durable scope and lifecycle

A pool-discovery axis is durable per `(userId, intentId)`. Any non-voided question in that scope with status `answered` or `dismissed` is a resolved axis, irrespective of the intent fingerprint recorded when it was created.

An intent edit must never make an answered/dismissed discriminator eligible again. The existing lifecycle logic may invalidate pending cards whose snapshot is stale, but it must not invalidate the resolved-axis history.

There is no reset UI or chat command in this release. A future explicit reopen capability must deliberately mark the chosen historical axis as voided/reopened before it can be mined again; changing the intent is not an implicit reopen operation.

### Semantic novelty before queueing

`pool/mining.shared.ts` already loads resolved pool axes and passes their text or compatible stored embeddings to `runPoolDiscriminatorShadow`. The adapter read must be widened so that it returns durable resolved axes across intent fingerprints rather than only rows fresh for the current fingerprint.

The existing novelty scorer compares a newly mined discriminator's embedding with those prior references. Equivalent axes receive very low novelty and therefore fail the VoI threshold before a question job is enqueued. The user-facing label may differ; the semantic axis remains suppressed.

If resolved-axis history exists but the semantic comparison cannot be performed, the mining pass must skip question enqueueing rather than degrade to fail-open behavior that could create a duplicate. A later discovery run may retry normally. Mining/logging may otherwise retain their existing error isolation.

### Exact-label defense at persistence

`QuestionerAdapter.persistFreshPoolQuestion` remains the authoritative, advisory-lock-protected write boundary.

Its historical label lookup must treat a non-voided answered or dismissed row with the same normalized label as a duplicate regardless of fingerprint. It must continue to reject a pending same-label row and preserve all existing lifecycle, intent-fingerprint, live-pool, mode-flag, and pending-budget checks.

This transactional guard prevents exact repeats even if a stale queue job or an upstream novelty failure reaches persistence. Semantic suppression remains upstream because the database does not perform vector similarity comparisons.

## Components

| Component | Responsibility |
| --- | --- |
| `QuestionerAdapter.listResolvedPoolAxes` | Return all durable resolved axes for the user and intent, excluding voided rows and independent of intent fingerprint. |
| `pool/mining.shared.ts` | Supply durable axis history to novelty scoring; avoid enqueueing when historical semantic protection cannot be evaluated. |
| Existing novelty helpers and scorer | Compare mined axes against stored embeddings or stored axis text; suppress semantic equivalents. |
| `QuestionerAdapter.persistFreshPoolQuestion` | Enforce cross-version exact normalized-label suppression under the existing transaction/advisory lock. |
| Pool queue and synthesis helpers | Remain responsible for deterministic card construction, freshness, pending budget, and delivery only. |

## Failure handling

- **No resolved history:** preserve current mining and question generation behavior.
- **Resolved history with compatible embeddings:** use semantic novelty scoring.
- **Legacy/mismatched/missing stored embeddings:** use the existing text-reference fallback.
- **Semantic comparison failure while history exists:** emit no new pool-discovery question for that pass; retry on a later discovery trigger.
- **Concurrent enqueue attempts:** the existing intent-scope advisory lock and persistence guard select one valid insertion.
- **Exact old label reaches persistence:** reject it even if an intent update changed the fingerprint.

## Test plan

### Adapter and queue tests

1. An answered discriminator followed by a material intent update blocks a new card with the same normalized label.
2. A dismissed discriminator followed by a material intent update also blocks that label.
3. A distinct new label remains eligible after the same update.
4. Pending-question limits, live-pool freshness, and stale-intent rejection retain their current behavior.

### Mining and semantic novelty tests

1. A resolved-axis embedding suppresses a paraphrased newly mined discriminator after an intent update.
2. A legacy or embedding-model-mismatched resolved axis suppresses a semantic equivalent through the text fallback.
3. A genuinely distinct discriminator retains sufficient novelty and is eligible.
4. When resolved history exists and semantic comparison fails, no pool-discovery question is enqueued.
5. With no resolved history, an embedding failure retains the existing degraded mining behavior.

### Regression coverage

Run the focused protocol discriminator tests, pool mining/queue tests, pool answer-handler tests, and QuestionerAdapter lifecycle tests. Add an end-to-end isolated queue scenario that proves answer -> refinement -> discovery/mining cannot recreate the resolved axis.

## Acceptance criteria

- Answering or dismissing a discriminator prevents the same axis from appearing again for that intent after any number of ordinary intent refinements.
- Paraphrased versions are suppressed when semantic comparison is available.
- An upstream comparison failure with durable history does not create a possible duplicate.
- A genuinely distinct axis can still be surfaced.
- No automatic or user-visible reopen behavior is introduced.
