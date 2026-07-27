# IND-496 Post-Deployment Organic Negotiation Lifecycle Validation

- Verdict: **PARTIALLY VERIFIED**.
- Scope: read-only dev evidence only. No implementation, repair, replay, flag, Railway, or Neon mutation.
- Canonical dev observed at `fe3b11378155d7c5d9c05dedebb066832b9930a7`.

## Boundary and evidence window

- PR #1196 merged to `dev` as `e9e1b0cba9ebf1c2e68ee8ebd469d897dac9a166` at `2026-07-22T04:37:15Z`.
- Railway dev protocol deployment `81ff2bea-f0db-4d8f-984d-6af92e6b6eb7` started `2026-07-22T04:37:18.192Z`; IND-496's durable terminal-SUCCESS record was written at `2026-07-22T04:40:40.923Z`. Use that later record as the conservative lower bound.
- Neon snapshot upper bound: `2026-07-22T16:49:58.953Z`.
- Database target explicitly: project `shiny-cloud-34341469`, branch `br-late-tooth-ahlsfgdb`, database `protocol_prod` (not `neondb`).

## Authoritative semantics

Current deployed schema was read before cohort queries: `opportunities` has `status`, `detection`, `actors`, `metadata`, and `created_at`/`updated_at`; negotiation `tasks` bind through `metadata.type='negotiation'` plus `metadata.opportunityId`, with `state` and timestamps; `artifacts.task_id` is an FK to `tasks.id`. Current enums: opportunity `{latent,draft,negotiating,pending,stalled,accepted,rejected,expired}`; task `{submitted,working,input_required,completed,failed,canceled,rejected,auth_required,waiting_for_agent,claimed}`. Current code atomically promotes the exact opportunity status/version to `negotiating` while inserting the task; finalize maps the negotiation outcome to opportunity state and writes an artifact, while blank task IDs skip persistence.

## Privacy-minimized cohort

Cohort predicate: opportunity `created_at` within the evidence window; nonblank exact `detection.triggeredBy`; source in `opportunity_graph|enrichment`. Counts:

- 86 opportunities total: 84 `opportunity_graph`, 2 `enrichment`; 12 distinct trigger intents and 56 hashed/distinct actor pairs.
- Current outcomes: 55 `pending`, 31 `rejected`.
- Every one of 86 has exactly one `completed` negotiation task and exactly one artifact.
- Lifecycle classification at snapshot: no-task latent 0; prior-status (`latent|draft`) without task 0; negotiating+task 0; waiting/active 0; terminal+completed task+artifact 86; terminal+completed without artifact 0; terminal without completed task 0; multiple tasks 0.
- Post-boundary malformed task relationships: blank negotiation `opportunityId` 0; blank task ID 0; dangling negotiation opportunity relationship 0.
- Opportunity creation range `06:28:26.535Z`–`13:01:20.533Z`; task creation range `06:28:27.206Z`–`13:01:20.847Z`; artifact range `06:28:29.685Z`–`13:01:31.087Z`.
- Opportunity→task delay min/median/max `0.227s / 0.698s / 5.132s`; task→artifact `1.803s / 5.893s / 47.938s`.

## Recovery/manual distinction

IND-500 recovery is excluded strongly: it targeted 51 opportunities created `2026-07-21T21:00Z–2026-07-22T00:00Z`, while this cohort requires opportunity creation after the conservative IND-496 boundary; additionally all cohort tasks were created within 5.132s of their opportunity rather than hours later. There were no explicit recovery/backfill/synthetic/manual keys in observed opportunity metadata, and the only sources were `opportunity_graph`/`enrichment` with exact triggers.

However, genuinely organic origin is not provable from the persisted schema: opportunities do not carry an immutable discovery-run/job origin that distinguishes automatic from-intent execution from a manual or synthetic invocation that entered the same graph. Therefore do not upgrade this to fully VERIFIED.

## Competing/stale claims

No observable stale/competing loser exists in this current post-boundary cohort: zero exact-trigger rows retained `latent|draft` without a task, and zero rows had multiple tasks. Static terminal rows also cannot prove the transient `negotiating` state or record a failed competing claim because unsuccessful claims create no durable task/audit row. This classification is zero observed, not proof the path was exercised.

## Railway logs

Across all 12 protocol deployments that actually ran during the evidence window (skipped builds excluded), bounded searches returned no matches for `Task  not found`, `Failed to persist outcome`, `Negotiation attempt`, or the blank-task guard message `Skipping outcome persistence because no negotiation task was claimed`. This is supporting evidence only: Railway reported dropped log messages on 11 of the 12 deployments (500 logs/sec/deployment rate limits), and superseded deployments are now marked REMOVED, so absence is not exhaustive proof.

## Decision and recommendation

**PARTIALLY VERIFIED**: persisted post-boundary exact-trigger/from-intent lifecycle evidence is internally complete and regression-free for all 86 observed rows, and the IND-500 recovery cohort is disjoint. Full “genuinely organic” verification and direct stale-loser/atomic-transition observation are missing because run provenance and failed-claim transition history are not persisted, while logs have known gaps.

Recommendation: no repair, replay, flag, or implementation action from this validation. Continue passive observation. If future acceptance requires full organic/competition proof, separately design privacy-minimized immutable run-origin and claim-transition audit evidence; do not infer it from current metadata.
