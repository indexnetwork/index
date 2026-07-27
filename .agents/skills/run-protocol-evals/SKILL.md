---
name: run-protocol-evals
description: Run packages/protocol evals correctly across baseline-backed live harnesses, the staged HyDE study, one-pass clarification taxonomy, budgeted live canary, and provider-free eval:verify gate. Use when asked to run evals, verify suites, add a harness, update a baseline, or fix eval:verify inventory/coverage failures. Live commands load OPENROUTER_API_KEY from root .env.test; eval:verify strips credentials.
---

# Run protocol evals

Two distinct modes live under `packages/protocol/eval/`. Picking the wrong one is the
classic mistake:

| Mode | Command | Credentials | What it proves |
|---|---|---|---|
| **Live eval** | suite-specific `bun run eval:<name>` command | `OPENROUTER_API_KEY` required | Actual model behavior under that suite's contract |
| **CI gate** | `bun run eval:verify` | none — deliberately stripped | Types + provider-free specs + suite inventory |

When a user says "run the eval", they almost always mean the **live harness** — the
evals exist to test LLMs. Do not strip credentials for live runs.

## Live eval modes

Run from `packages/protocol`. Package scripts embed `bun --env-file=../../.env.test`,
so `OPENROUTER_API_KEY` is auto-loaded from the root `.env.test`. The harnesses do not
share one CLI contract; choose the correct mode below.

### Baseline-backed harnesses

`matching`, `premise`, `profile`, and `opportunity` default to all cases, three
runs/case, judge-on evaluation, and committed-baseline comparison. Common flags after
`--` include `--runs N`, `--case ID`, `--rule R`, `--tier N`, `--no-judge`,
`--no-save`, `--report [path]`, and `--html [path]` (check `--help` for
suite-specific selectors such as premise `--component`). A cheap smoke may use
`--runs 1 --case <id>`; a full run costs real tokens.

Reports land in gitignored `eval/<name>/runs/`. Baseline updates require a complete,
unfiltered full-corpus run at a clean identifiable revision, an operator reason, and
explicit overwrite consent when replacing the committed baseline:

```bash
bun run eval:matching -- --runs 7 --update-baseline --reason "<why this change is intentional>" --force
```

### Staged HyDE evidence study

HyDE requires an explicit stage and does not use the baseline-backed flags or
`--update-baseline`. Start with `bun run eval:hyde -- list-cases` or
`validate-corpus`; collection uses
`bun run eval:hyde -- collect --out <path> [--case <prefix>] [--runs <even>]`.
Runs must be even and at least two; the canonical policy uses four paired runs. The
later `export`, `resolve`, `analyze`, and `report` stages require their documented
artifact paths and human judgments. Do not run the canonical study casually.

### Clarification taxonomy

`bun run eval:clarification` performs one pass over all clarification cases and reports
exact taxonomy matches. It has no runs/judge/baseline flags; do not append the common
baseline-backed options.

### Budgeted canary

`bun run eval:canary` executes the committed, budget-capped live subset and never
updates baselines. Use `bun run eval:canary -- --plan` for a provider-free manifest and
budget dry-run.

## Provider-free CI gate

```bash
cd packages/protocol && bun run eval:verify
```

Type-checks every `eval/*/tsconfig.json`, runs every `eval/*/tests/` suite in its own
process (avoids `mock.module` leaks), and enforces the suite inventory. It strips
`OPENROUTER_API_KEY`/`OPENAI_API_KEY` from child processes — a spec that reaches for a
live model fails loudly. CI runs it in the `eval-verify` job of
`.github/workflows/lint.yml`.

## Gotchas learned the hard way

1. **New eval directory ⇒ update the manifest.** `eval/verify.ts` has an explicit
   `SUITES` list; an `eval/<dir>` not listed there fails `eval:verify` (as does a suite
   missing `tsconfig.json` or `tests/`). Adding a harness requires touching the manifest.
2. **New corpus case ⇒ baseline coverage spec breaks.** The provider-free spec
   "committed baseline covers every corpus case" fails if a case is added without a live
   baseline update (for example the complete, reasoned, forced command above).
   If a live run isn't feasible yet, add the id to `BASELINE_PENDING_CASE_IDS` in
   `eval/matching/tests/matching.cases.spec.ts` and remove it at the next refresh —
   stale allowlist entries fail the spec by design.
3. **src renames silently break evals.** Eval entrypoints import live `src/` classes
   (e.g. `EnrichmentGenerator`, formerly `ProfileGenerator` before IND-368); the normal
   protocol build only covers `src/**`, so run `eval:verify` after renaming protocol
   symbols — its per-suite `tsc --noEmit` is what catches the drift.

Canonical docs: `packages/protocol/eval/README.md` (harness table, baseline contract,
"Adding a new harness" checklist).

See also: `verify-production-release` (pre-merge gates), `finish-pr` (CI checks before merge).
