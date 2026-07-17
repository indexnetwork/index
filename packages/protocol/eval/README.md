# Protocol Eval Harnesses

Standalone eval harnesses for the protocol's LLM agents. Each harness exercises one (or a
small group of related) agent(s) against a curated golden corpus and gives you a scorecard
plus regression detection.

They run **outside** `bun test` — run them via package scripts, e.g.
`bun run eval:matching`. Expects `OPENROUTER_API_KEY` in your `.env.test` (or the
equivalent env) — harnesses call real models.

## Harnesses

| Harness    | Script                  | Agent(s) under test                                              |
| :--------- | :---------------------- | :-------------------------------------------------------------- |
| `matching`    | `bun run eval:matching`    | `OpportunityEvaluator.invokeEntityBundle` (secondary evaluator-only regression check) |
| `hyde`        | `bun run eval:hyde`        | Paired real legacy/frame-v1 HyDE generation, validation, embedding, and in-memory retrieval |
| `premise`     | `bun run eval:premise`     | `PremiseDecomposer.invoke`, `PremiseAnalyzer.invoke`                           |
| `profile`     | `bun run eval:profile`     | `EnrichmentGenerator.invoke` (incl. the PII-redaction guarantee)              |
| `opportunity` | `bun run eval:opportunity` | `OpportunityPresenter.present` (the user-facing card: headline/summary/greeting) |
| `clarification` | `bun run eval:clarification` | `IntentClarifier` QUD underspecification taxonomy (exact-match corpus)     |

Each harness has its own README with full flag docs:
[`matching`](./matching/README.md) · [`hyde`](./hyde/README.md) ·
[`premise`](./premise/README.md) · [`profile`](./profile/README.md) ·
[`opportunity`](./opportunity/README.md) · [`clarification`](./clarification/README.md).

The IND-426 `hyde` harness is retrieval-only and has no committed baseline or run
artifacts. Evidence-v2 is a staged collect -> blind export -> independent human
adjudication -> resolve -> analyze -> report study over 90 frozen background cases, 900
candidates, and four paired runs per case. Its primary cohort is 75 asynchronously
processed saved intents; its secondary cohort is 15 premise-derived, network-scoped user
contexts. It contains no synchronous direct-search cohort. The private runner maps saved
intents to the current internal `query` graph branch and contexts to `context`; this
implementation label is hidden from blind adjudication and does not represent a user
request. Its eight gates become insufficient unless the full
canonical collection and resolved blinded judgments from two independent humans are
complete. Export runs a full collection-only semantic preflight before review. Analysis
also requires the original judgment artifacts (and resolver decisions, when used) so it
can regenerate and revalidate the resolved parent rather than trusting a self-authored
resolution file; its schema recomputes gates and rejects internally inconsistent PASS
edits. Report generation additionally recomputes the analysis from every supplied parent,
and collection preflight recomputes score/ranking derivations from retained per-lens
cosines. Provenance pins identify configured primary IDs only: production fallback identity,
separate frame-extraction resources, tokens, and cost remain unavailable. The unsigned
multi-file artifacts and unauthenticated reviewer attestations require external
custody/identity/fingerprint review. The `matching` harness calls `OpportunityEvaluator` without HyDE and remains
only a secondary evaluator-regression check, not retrieval evidence.

`matching` scores *which* people get surfaced; `opportunity` judges the *card a person
actually reads* once a match exists — complementary surfaces of the same feature.

Common flags (most baseline-backed harnesses): `--runs N`, `--rule R`, `--case ID`, `--tier N`,
`--list-cases`, `--no-judge`, `--update-baseline`, `--report [path]`, `--html [path]`,
`--rolling-baseline [days]`, `--alpha P`, `--no-save`. The `premise` harness additionally
takes `--component decompose|analyze`.

## Architecture: shared lib + thin harnesses

The harness-agnostic machinery lives in [`eval/shared/`](./shared) and is reused by the
baseline-backed scorecard harnesses. HyDE is standalone because it uses versioned evidence artifacts, blinded adjudication,
hierarchical paired bootstrap intervals, and fixed gates rather than the shared
scorecard/baseline machinery.

```
eval/
├── shared/                 # generic, harness-agnostic library
│   ├── stats.ts            # Wilson CI, binomial + beta-binomial p-values
│   ├── types.ts            # CaseResultLike / ScorecardLike / RuleResult / Regression
│   ├── scorecard.ts        # buildScorecard (generic over the case type)
│   ├── baseline.ts         # read/write/diff baselines, writeRunReport
│   ├── rolling.ts          # computeRollingBaseline from recent run reports
│   ├── console.ts          # formatConsole (parameterized title)
│   ├── runner.ts           # repeatRuns: repeat-with-retry execution loop
│   ├── html.ts             # renderScorecardShell: standalone HTML document shell
│   ├── cli.ts              # arg / has / flagValue argv helpers
│   ├── index.ts            # barrel export — import everything from "../shared/index.js"
│   └── tests/              # unit tests for the shared lib
├── matching/               # matching corpus, scorer, bespoke HTML renderer
├── hyde/                   # paired retrieval eval; intentionally no canonical baseline
├── premise/                # premise corpus, scorer, reporter (shared HTML shell)
├── profile/                # profile corpus, scorer, PII detectors, reporter
├── opportunity/            # opportunity-card corpus, scorer, leakage detectors, reporter
├── clarification/          # IntentClarifier QUD taxonomy corpus + scorer
└── verify.ts               # provider-free CI gate: per-suite typecheck + tests (see below)
```

The shared scorecard types are **structural**: they describe only the aggregate fields the
shared functions read (`caseId`, `rule`, `runs`, `passes`, `passRate`, `flaky`). Each
harness defines its own richer `CaseResult` (with per-run assertions + agent-output detail)
that extends `CaseResultLike`, and specializes `Scorecard = ScorecardLike<CaseResult>`. The
shared layer never reads harness-specific run internals, so harness types stay fully owned
by the harness while reusing all aggregation, baseline, rolling, console, and HTML code.

## Anatomy of a harness

Each harness lives in `eval/<name>/` and follows this layout:

```
eval/<name>/
├── <name>.types.ts       # Harness types; specialize the shared scorecard types
├── <name>.cases.ts       # The golden corpus (Tier 1 surgical → Tier N realistic)
├── <name>.runner.ts      # Wraps the agent(s); calls shared repeatRuns N times
├── <name>.scorer.ts      # Per-run assertions → CaseResult (deterministic + judged)
├── <name>.selection.ts   # --rule / --case / --tier (and harness-specific) filters
├── <name>.reporter.ts    # HTML scorecard via the shared shell (matching uses a bespoke one)
├── <name>.constants.ts   # Retry budget, etc.
├── <name>.eval.ts        # CLI entry point (runner → scorer → shared baseline/report → exit)
├── baselines/
│   └── <name>.baseline.json  # Committed baseline (per-run detail stripped)
├── runs/                      # gitignored — full run reports incl. agent output/reasoning
├── tsconfig.json              # Extends ../../tsconfig.json, includes eval + src
└── tests/                     # Unit tests (no live agents)
```

## Adding a new harness

1. **Create the directory** and copy `premise/tsconfig.json` (paths are generic).

2. **Define your types** in `<name>.types.ts`: import `CaseResultLike`, `RuleResult`,
   `ScorecardLike` from `../shared/index.js`; declare your `Rule` union and a `CaseResult
   extends CaseResultLike`; alias `Scorecard = ScorecardLike<CaseResult>`. Add a per-run
   `detail` type for agent output you want in run reports.

3. **Build a corpus** in `<name>.cases.ts`. Start with a few Tier-1 surgical cases (single
   expectation, deterministic pass/fail), then add realistic ones.

4. **Wire the agent(s)** in `<name>.runner.ts` via a minimal `*Like` interface, and call
   `repeatRuns(invoke, runs, { label })` from the shared lib.

5. **Score each run** in `<name>.scorer.ts`. Prefer deterministic checks; route fuzzy
   expectations through an injected `Judge` (the CLI passes `assertLLM`, or a pass-through
   under `--no-judge`). Aggregate with your own `scoreCase`.

6. **Report** in `<name>.reporter.ts` using `renderScorecardShell` from the shared lib —
   supply a title, an intro, summary sections (e.g. `renderRuleTable(sc)`), and your
   case-card HTML.

7. **Write the CLI** in `<name>.eval.ts`, importing `buildScorecard`, `diffBaseline`,
   `readBaseline`, `writeBaseline`, `writeRunReport`, `computeRollingBaseline`,
   `formatConsole`, and `arg`/`has`/`flagValue` from `../shared/index.js`. Pass a
   `leanCase` to `writeBaseline` that strips your per-run `detail`.

8. **Add a package.json script**:
   ```json
   "eval:<name>": "bun --env-file=.env.test ./eval/<name>/<name>.eval.ts"
   ```
   and gitignore `packages/protocol/eval/<name>/runs/`. Also add the suite to the
   `SUITES` manifest in [`eval/verify.ts`](./verify.ts) — `bun run eval:verify`
   fails on any eval directory that is not in the manifest, so a new harness
   cannot silently skip CI verification.

9. **Write tests** in `eval/<name>/tests/`: corpus invariants, scorer correctness,
   selection. These do NOT invoke live agents.

10. **Commit the baseline** after a stable run:
    ```bash
    bun run eval:<name> -- --runs 7 --update-baseline
    git add eval/<name>/baselines/
    ```

## Testing the evals themselves

```bash
bun run eval:verify              # the CI gate: everything below, plus typechecks
bun test eval/shared/tests/      # the shared lib
bun test eval/matching/tests/    # a harness
bun test eval/premise/tests/ eval/profile/tests/
```

These are standard `bun test` specs — they do NOT invoke live agents; they validate types,
scoring logic, runner wiring, reporter math, and baseline handling.

### `bun run eval:verify` — the provider-free CI gate

One command verifies every suite without touching a provider:

1. **Inventory check** — the directories under `eval/` must exactly match the
   explicit `SUITES` manifest in [`verify.ts`](./verify.ts), and every suite must
   have a `tsconfig.json` and a `tests/` directory. New suites cannot escape CI
   unnoticed: an unlisted directory fails the run.
2. **Per-suite typecheck** — `tsc --noEmit -p eval/<suite>/tsconfig.json` for all
   seven suites (including `shared`; the regular protocol build only covers `src/`).
3. **Provider-free tests** — `bun test --timeout 30000 eval/<suite>/tests/` per
   suite, each in its own process (so `mock.module()` state never leaks between
   suites). The per-test timeout is capped at 30 seconds (vs Bun's 5s default)
   because some HyDE specs deterministically recompute bootstrap/report evidence
   on CPU and exceed 5s on slower CI runners.

It never loads `.env.test`, strips `OPENROUTER_API_KEY`/`OPENAI_API_KEY` from the
child environment, calls no models or embedders, and writes no baselines or run
artifacts — so it needs no secrets. CI runs it in the `eval-verify` job of
[`.github/workflows/lint.yml`](../../../.github/workflows/lint.yml) on every PR and
push to `dev`/`main` (typically ~1–2 minutes; local runtime is dominated by the
seven `tsc` invocations plus the `hyde` specs).

## Baseline contract

The evidence-v2 `hyde` harness is the exception: it rejects `--update-baseline`, commits
no baseline/run artifact, and requires its full 90-case, four-paired-run collection plus
resolved independent human adjudication for canonical evidence. Filtered/debug runs are
noncanonical. The contract below applies to the baseline-backed harnesses.

- **Committed baseline** (`baselines/<name>.baseline.json`): the scorecard with per-run
  `detail` stripped (via the harness's `leanCase`). Kept lean so diffs are meaningful.
  Updated with `--update-baseline` after intentional eval changes.

- **Run report** (`runs/<timestamp>.json`): the full scorecard with agent output/reasoning
  verbatim, written by full-corpus runs and on demand with `--report`. gitignored.

- **Rolling baseline** (`--rolling-baseline [days]`): a synthetic baseline computed from
  recent JSON reports in `runs/`. Default window is 7 days.

- **Regression detection**: run → scorecard → `diffBaseline()` → exit code 1 if any case
  or rule is significantly below the baseline by a one-sided beta-binomial
  posterior-predictive test (default α=0.05). The baseline is treated as finite evidence,
  not a perfect point estimate, so e.g. 6/7 after a 7/7 baseline is not automatically a
  hard regression. New cases never count as regressions.
