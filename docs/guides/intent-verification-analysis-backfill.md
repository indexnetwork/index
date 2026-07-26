# Intent verification analysis maintenance workflow

`maintenance:backfill-intent-verification-analysis` repairs only missing intent
verification-analysis columns. It is deliberately separate from discovery,
assignment, HyDE, and reconciliation work: those paths can contain relevance or
final/raw scores, none of which are semantic verifier inputs or substitutes.

The default is a side-effect-free, bounded dry run:

```sh
cd services/api
bun --silent run maintenance:backfill-intent-verification-analysis -- --limit 25
```

It reports target counts by root-cause partition, complete- and partial-analysis
control counts, bounded candidate counts and aggregate prerequisite-validation
outcomes, call/token/cost estimates, and the exact
`attempted`, `updated`, `skipped`, `failed`, and `unchanged-control` counters.
It never prints candidate identifiers, payload, profile context, verifier
reasoning, or a credential.

## Output contract

A successful invocation writes exactly one compact, machine-parseable JSON object
to stdout. The object contains only aggregate evidence: source/partition and
bounded-candidate counts, control counts, cost estimates, outcome counters, and
actual `verifierCalls`. A default dry run always reports `verifierCalls: 0`.
All diagnostics and failures go only to stderr. A pre-report failure emits only the
static `failed stage=<category>` code—one of `environment_loading`,
`entrypoint_setup`, `parse_options`, `validate_options`, `dependency_assembly`,
`count_partitions`, `count_controls`, `candidate_listing`, `profile_context`,
`write_operation`, `report_serialization`, or `report_emission`—and exits nonzero
rather than emitting a partial or unsafe report. It never emits an exception message,
URI, row, prompt, or provider detail. A
candidate-level failure is different: the command first emits its complete,
sanitized aggregate report, then exits nonzero and writes its diagnostic to stderr.

The entrypoint must not construct `SemanticVerifier` in dry-run mode. Model
construction requires provider configuration even when no verification is due.
The recovered disposable proof established a pre-report failure, while its raw
diagnostic was deliberately discarded. A hermetic package-command regression
identified and guards the candidate-query cause: it qualifies `intents.status` across
the proposal join with no provider configuration. The command creates the verifier
only for explicit write mode.

## Candidate partitions

Candidates are intents for which all three felicity scores are null. This broad
population is only the starting predicate, not a causal conclusion. The report
partitions it into:

- `proposal_confirm_default_only`: an intent linked by
  `intent_proposals.consumed_intent_id` to a consumed proposal and still holding
  the old default-only signature.
- `proposal_confirm_partial_missing`: a consumed-proposal-linked intent
  with a partial/non-default missing-analysis signature.
- `legacy_discovery_missing_analysis`: a discovery-form intent without a source
  proposal link.
- `other_missing_analysis`: every remaining source path, kept separate for
  review rather than silently treated as proposal-confirm fallout.

Target partition totals come from the full candidate population; per-row
prerequisite checks and LLM estimates are capped by `--limit` (1–250). A dry run
does not invoke the verifier or create provenance records, so it remains fully
side-effect-free; verifier-output validation happens only in explicit write mode.

## Authoritative input and validation policy

For each bounded candidate, the command invokes the canonical
`SemanticVerifier` using only the stored `intents.payload` and the owner profile
returned by `ChatDatabaseAdapter.getProfile`, matching the intent composition
path. No assignment, network, opportunity, queue, HyDE, embedding, or relevance
data is read as verifier context.

The output must be structurally valid and actionable: `COMMISSIVE`,
`DIRECTIVE`, or `DECLARATION`; entropy no greater than `.75`; clarity at least
`40`; and referential breadth not `broad`. Invalid, vague, or non-actionable
results are recorded as `skipped`; analysis is never fabricated. A valid output
maps only the canonical entropy, anchor, mode, speech-act, and three felicity
columns.

## Write workflow and controls

Writing is explicit and requires a stable run identifier:

```sh
cd services/api
bun --silent run maintenance:backfill-intent-verification-analysis -- \
  --write --run-id '<reviewed-run-uuid>' --limit 25
```

The command stores a run header (predicate version, verifier name/model, status)
and one attempt record per run/intent (payload/context hashes, output,
disposition, and error). `updated` and `skipped` attempts are resume markers;
failed attempts are retried on a later invocation of the same run ID.

Each update has an optimistic, fail-closed predicate over the original payload,
summary, owner, source, embedding, lifecycle/status, timestamps, old analysis,
and other non-target controls. Its `SET` list contains only:

`semantic_entropy`, `referential_anchor`, `intent_mode`, `speech_act_type`,
`felicity_authority`, `felicity_sincerity`, and `felicity_clarity`.

If any control changed, no intent row is updated and the attempt is reported as
`unchanged-control`. Product payload, summary, embedding, owner, lifecycle,
assignments, HyDE, opportunities, and timestamps are therefore preserved. Run
and attempt provenance live in dedicated tables rather than overloaded product
columns.

Before a write run, review the dry-run partition and cost report, choose the
bound, and record the run ID. After a write run, require `failed = 0` and
`unchanged-control = 0` before considering a new bounded batch; otherwise
investigate instead of broadening the predicate.

When the environment is explicitly `production`, a write additionally requires
`--confirm-production`; this guard cannot be satisfied by an unset environment.
