# Matching Quality Eval Harness

Measures whether the opportunity evaluator (`invokeEntityBundle`) makes the right
matching judgments, against a curated golden set. Standalone and opt-in — NOT part of
`bun test`.

## Run

```bash
# from packages/protocol
bun run eval:matching                         # all cases, 3 runs, judge on, diff baseline
bun run eval:matching -- --runs 5             # more runs = less noise
bun run eval:matching -- --rule is_a_identity # one rule
bun run eval:matching -- --case location/known-mismatch-penalized # one case/prefix
bun run eval:matching -- --tier 4             # one tier
bun run eval:matching -- --list-cases         # print selected cases and exit
bun run eval:matching -- --no-judge           # skip LLM reasoning checks (free)
bun run eval:matching -- --update-baseline    # overwrite the committed baseline
bun run eval:matching -- --report             # write a full run report incl. evaluator reasoning
bun run eval:matching -- --report out.json    # ...to a specific path
bun run eval:matching -- --html              # write a standalone HTML scorecard
bun run eval:matching -- --html out.html     # ...to a specific path
bun run eval:matching -- --rolling-baseline  # compare against trailing 7-day run average
bun run eval:matching -- --rolling-baseline 14 # compare against trailing 14 days
bun run eval:matching -- --alpha 0.01        # stricter regression significance threshold
bun run eval:matching -- --no-save           # do not auto-save full-corpus run JSON
```

Requires `OPENROUTER_API_KEY` (loaded via `.env.test`). Exits non-zero on a regression
versus `baselines/matching.baseline.json`, or versus the rolling window when
`--rolling-baseline` is set. Regression significance defaults to α=0.05; override with
`--alpha`. Full-corpus runs are automatically written to
`runs/<timestamp>.json` (gitignored) so future rolling windows have data; use
`--no-save` for exploratory full-corpus runs that should not feed rolling baselines.

## HTML reports (`--html`)

`--html` renders a standalone, self-contained HTML scorecard with no external assets or
JavaScript — openable directly from a file browser. Each case card shows every
candidate's expected vs. actual outcomes per run, with the evaluator's verbatim
reasoning behind collapsible blocks. Pass-rates carry 95% Wilson confidence intervals
on hover. Regressions vs baseline are surfaced in a red alert section.

## Run reports (`--report`)

`--report` writes the full scorecard — including each candidate's **actual score, role,
and the evaluator's own verbatim `reasoning`** — to `runs/<timestamp>.json` (gitignored),
or to a path you pass. The committed baseline deliberately omits this reasoning to keep
diffs lean; the run report is where the "why" lives. This artifact is the input the
matching-eval report skill reads to explain *why* the evaluator scored as it did.

## Rolling baseline (`--rolling-baseline`)

By default, regressions are checked against the committed baseline in
`baselines/matching.baseline.json`. With `--rolling-baseline` the harness instead reads
recent JSON reports in `runs/`, builds a synthetic pass-weighted baseline per case/rule,
and compares against that. This catches drift relative to recent behavior while preserving
the committed baseline as the canonical release checkpoint. The default window is 7 days;
pass a number to change it, e.g. `--rolling-baseline 14`.

## Layout

- `matching.cases.ts` — the golden corpus (Tier 1 surgical, Tier 2 realistic). Add Tier 1/2 cases here; it also spreads in the Tier 3 cases.
- `matching.historical.ts` — Tier 3 historical-collaboration cases (see below). Add Tier 3 cases here.
- `matching.personas.ts` — shared Tier-2 persona pool.
- `matching.scorer.ts` / `matching.runner.ts` / `matching.reporter.ts` — pure-ish units, unit-tested in `tests/`.
- `matching.eval.ts` — CLI.

## Selecting cases

Use `--rule`, `--case`, and `--tier` to narrow an eval run. `--case` accepts an exact
case id or an id prefix, so `--case location/` runs all location cases. Add
`--list-cases` to inspect the selected set without invoking the evaluator.

## Adding a case

Append a `MatchingCase` to `CASES`. Set `match`, optional `scoreBand`, optional `role`, and
`reasoningCriteria` only when a code check can't express the expectation. Negative cases are
best authored as minimal-pair perturbations of a positive. Re-run with `--update-baseline`
after an intentional change.

## Tier 3 — historical collaborations

`matching.historical.ts` holds five anonymized real collaborations (e.g. complementary
cofounders, co-researchers on a landmark paper, a songwriting duo, a first-check
investor + founder, a cross-disciplinary expert + ML researcher), recreated as the people
looked *before* they connected. Each case places the discoverer, the eventual partner, and
three plausible contemporary distractors in one shared index, and asserts the evaluator
surfaces the partner (band `[60, 100]`) while the distractors do not (`[0, 29]`). Names are
anonymized so the model judges on fit, not fame; provenance lives in code comments. Run with
`bun run eval:matching -- --rule historical`.
