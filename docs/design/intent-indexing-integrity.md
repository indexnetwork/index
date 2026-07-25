# Intent indexing admission integrity

## Admission invariant

For a normal active intent create, the only successful path is:

```text
assignment -> intent HyDE generation -> from-intent discovery enqueue -> discovery completion stamp
```

Promptless, assignment-eligible memberships are deliberately assigned with
`finalScore=1.0` and no `rawScores`; this is a deterministic successful
assignment, not an evaluator failure. A prompted network can validly have zero
assignments when its evaluated score is below the unified threshold. Those two
states must never be conflated.

The first-discovery success stamp is permitted only after discovery finishes and
the same active assignment/membership admission predicate still holds. A
membership removal or unassignment that happens while discovery runs leaves the
stamp unset and causes the BullMQ job to retry.

## Incident causal proof (IND-586)

The historical source is deterministic and directly explains the affected dev
shape (no `intent_networks`, no intent HyDE documents, but a success stamp):

1. Commit `1f54b7f666bd590903a67bed93b6af2257d743bc` (2026-07-21) added
   `first_discovery_succeeded_at` stamping after any successful
   `FromIntentQueue` run.
2. At that point `IntentEvents.onCreated` independently enqueued
   `fromIntentQueue` before assignment or HyDE. The queue accepted an omitted
   network scope, so this path could complete and stamp without indexing
   artifacts.
3. Commit `7fd003809733564c5044fa6468951c5f57f0d44f` (2026-07-22) removed
   that alternate create-time enqueue explicitly because it raced assignment and
   produced misleading success.
4. The confirmation service also persisted first and caught a rejected
   `addGenerateHydeJob` call. That fail-open acknowledgement gap independently
   stranded successful confirmations with neither assignments nor HyDE.

Focused regression tests reproduce the two prevented conditions: failed
confirmation admission is returned as retryable, and an assignment disappearing
between discovery admission and completion cannot receive a success stamp.

## Reconciliation

`reconcile_orphaned_intent` is idempotent. It re-reads owner, active lifecycle,
scope, current assignments, and intent HyDE documents at execution time. It
skips missing, foreign, paused, and archived intents; does nothing once both
artifacts exist; otherwise it invokes the ordinary admission path. Its scope is
narrowing-only, so it cannot widen a scoped agent's reachable networks. Queue
failures use BullMQ's three-attempt exponential backoff and retain failures for
seven days for inspection.
