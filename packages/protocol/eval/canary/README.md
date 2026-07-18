# Live-eval canary (IND-447)

A budgeted, measurement-only canary over the four baseline-backed live eval suites
(`matching`, `opportunity`, `premise`, `profile`). It runs a committed, representative
subset of each suite's corpus against real providers — manually
(`workflow_dispatch`) or on a low-frequency schedule (weekly cron) — and produces
the same ER2-versioned run artifacts the harnesses always produce, so consecutive
canary runs are directly comparable.

```
bun run eval:canary              # live run (needs OPENROUTER_API_KEY, e.g. via ../../.env.test)
bun run eval:canary -- --plan    # provider-free plan/dry-run: validate + budget, execute nothing
bun run eval:canary -- --out d   # write artifacts to a specific directory
```

## The committed manifest

[`canary.manifest.json`](./canary.manifest.json) is the single source of truth for
what the canary executes: which suites, exactly which case ids, how many runs per
case, and the regression alpha. Scheduled and manual runs consume the same
committed file — there is no run-time case selection, so no success-only rerun
selection is possible. Resolution fails when a declared case id no longer exists
in its corpus, or when it is ambiguous under the harnesses' exact-or-prefix
`--case` matching (one invocation must run exactly one case for the budget
accounting to be honest).

Suites that are not baseline-backed are rejected by manifest validation. In
particular the **HyDE canonical study is excluded from routine scheduling by
design** — it requires staged blind human adjudication and must be run
deliberately, never on a cron.

## Budget model

Hard caps live in [`canary.manifest.ts`](./canary.manifest.ts) as code constants —
a manifest edit can shrink the canary but can never grow it past the caps without
a reviewable code change:

| cap | value |
| :-- | :-- |
| total cases | ≤ 24 |
| runs per case | ≤ 3 |
| requested run slots | ≤ 60 |
| attempts per run slot | ≤ 3 (the shared runner's retry ceiling) |

The plan prints, before any provider call: pinned model + judge IDs (embedding
models: none — the canary suites invoke chat models only), git SHA, scoring-config
and per-case corpus fingerprints, the caps, and a call-count budget: the
all-first-try floor, the retry ceiling, and a wall-clock ceiling derived from the
harnesses' per-attempt deadlines. The eval runner records no token or cost
telemetry, so tokens and cost are reported as **unavailable** — never estimated
from fabricated numbers. After execution the summary reports actuals from
recorded evidence only (invocations, attempts, wall clock), with tokens/cost
again marked unavailable. The workflow's `timeout-minutes` is the operative hard
wall-clock stop.

## Alert classification

Each (suite, case) invocation is classified from the existing governance exit
contract (`0` pass · `1` regression · `2` execution/artifact error · `3`
insufficient strict evidence) plus the artifact's recorded execution
completeness — no parallel taxonomy:

| class | evidence |
| :-- | :-- |
| pass | exit 0 |
| measured regression | exit 1 |
| provider incident / execution failure | exit 2 with incomplete or missing artifact, or a spawn failure |
| baseline incompatibility | exit 2 with a *complete* artifact (governed comparison refused) |
| insufficient evidence | exit 3 |

The aggregate exit code is `2` if any incident/incompatibility, else `3` if any
insufficient evidence, else `1` if any regression, else `0`. **Alerts inform;
they never gate and never auto-revert.**

## Measurement-only guarantees

- The canary never passes `--update-baseline` or `--force` (asserted at run time
  and by spec); committed baseline JSONs stay byte-identical, which the workflow
  proves with `git diff --exit-code` after every run.
- ER3 discipline is inherited wholesale: provider failures, timeouts, and
  incomplete slots are retained as first-class attempt evidence in the uploaded
  artifacts; retries never exceed the shared runner's declared protocol.
- On top of ER3's error sanitization, a post-run leak scan quarantines (deletes)
  any output file containing a secret-like environment value or a
  provider-key-shaped string before artifacts can be uploaded, and forces exit 2.

## CI workflow

[`.github/workflows/eval-canary.yml`](../../../../.github/workflows/eval-canary.yml)
runs the canary weekly (Monday 05:17 UTC) and on manual dispatch (with an
optional provider-free `plan_only` mode). It is **not** a required check, has no
`pull_request`/`push` triggers, runs with a concurrency group of 1 and
`timeout-minutes: 90`, and uploads artifacts with **30-day retention** — enough
to compare consecutive weekly runs and investigate an alert without accumulating
provider output indefinitely. `OPENROUTER_API_KEY` comes from repository
secrets; it is never echoed and never part of the uploaded artifact set.
`OPENAI_API_KEY` is not passed: no canary-schedulable suite consumes it (only
embedding-dependent paths like HyDE do).

> **Explicit rule:** turning this canary into a release gate (required check,
> merge blocker, or auto-revert trigger) requires a later, deliberate human
> decision with its own review — do not wire it into required CI as part of any
> refactor.

## Files

| file | purpose |
| :-- | :-- |
| `canary.manifest.json` | committed, versioned execution manifest |
| `canary.manifest.ts` | manifest schema, hard caps, corpus resolution |
| `canary.suites.ts` | provider-free registry of schedulable suites |
| `canary.plan.ts` | invocation planning + honest budget model |
| `canary.classify.ts` | alert classification, leak scan, summary artifact |
| `canary.eval.ts` | CLI entrypoint (`--plan` dry run / live execution) |
| `tests/` | provider-free specs (run via `bun run eval:verify`) |
