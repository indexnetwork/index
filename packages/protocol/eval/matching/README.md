# Matching Quality Eval Harness

Measures whether the opportunity evaluator (`invokeEntityBundle`) makes the right
matching judgments, against a curated golden set. The harness invokes
`OpportunityEvaluator` **directly**; it does not run `LensInferrer`, HyDE generation,
validation, embedding, or vector retrieval. For IND-426 it is therefore only a
**secondary evaluator-regression check**, not evidence that frame-v1 improves HyDE
retrieval. Use the separately labeled [`eval/hyde`](../hyde/README.md) paired eval for
retrieval evidence. Standalone and opt-in — NOT part of `bun test`.

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
bun run eval:matching -- --update-baseline --force # replace the committed baseline
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
`--alpha`. The significance test is one-sided beta-binomial posterior predictive:
the baseline is treated as finite evidence rather than a perfect point estimate, so
single misses after perfect 7/7 baselines are not automatically hard regressions.
Full-corpus runs are automatically written to `runs/<timestamp>.json` (gitignored) so
future rolling windows have data; use `--no-save` for exploratory full-corpus runs that
should not feed rolling baselines.

## HTML reports (`--html`)

`--html` renders a standalone, self-contained HTML scorecard with no external assets or
JavaScript — openable directly from a file browser. The report includes explanatory copy,
component-level performance, domain/rule/tier rollups, failed-check details, and one case card per
corpus case. Each case card shows every candidate's expected vs. actual outcomes per run,
with the evaluator's verbatim reasoning behind collapsible blocks when an opportunity was
returned. When a candidate was not returned, the report says that explicitly instead of
showing a vague missing-reasoning placeholder. HTML display names come from a report-only
mapping: `reportNames` overrides profile names for historical real-world labels, otherwise
corpus profile names are used for readability with stable entity ids shown underneath.
Pass-rates carry 95% Wilson confidence intervals on hover. Regressions vs baseline are
surfaced in a red alert section.

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

- `matching.cases.ts` — the golden corpus entry point (Tier 1 surgical, Tier 2 realistic). Add new hand-authored Tier 1/2 cases here; it also spreads in Tier 3 and Tier 4.
- `matching.historical.ts` — Tier 3 historical-collaboration cases (see below). Add Tier 3 cases here.
- `matching.cases-tier4.ts` — Tier 4 deterministic corpus augmentation cases (see below). Add minimal-pair paraphrases here.
- `matching.personas.ts` — shared Tier-2/Tier-4 persona pool.
- `matching.scorer.ts` / `matching.runner.ts` / `matching.reporter.ts` — pure-ish units, unit-tested in `tests/`.
- `matching.eval.ts` — CLI.

## Selecting cases

Use `--rule`, `--case`, and `--tier` to narrow an eval run. `--case` accepts an exact
case id or an id prefix, so `--case location/` runs all location cases. Add
`--list-cases` to inspect the selected set without invoking the evaluator.

## Adding a case

Append a `MatchingCase` to `CASES`. Every case must declare one or more broad `domains`
(`technology`, `research`, `arts`, `funding`, `location`, `community`, `sports`) so the
report can show whether failures cluster by domain rather than only by evaluator rule. Set
`match`, optional `scoreBand`, optional `role`, and `reasoningCriteria` only when a code
check can't express the expectation. Only assert `role` when the case is explicitly about
valency; query-primary and score-calibration cases should usually avoid role assertions so
component metrics stay isolated. Negative cases are best authored as minimal-pair
perturbations of a positive. Re-run with `--update-baseline --force` after an intentional change.

The eval runner uses `returnAll: true` to capture diagnostic low scores, but the scorer only
counts a candidate as surfaced when `score >= MATCHING_MIN_SCORE` (currently 30). A returned
candidate with score 1–29 is visible in reports as "returned below surfacing threshold" but
does not satisfy `match: true`.

## Tier 4 — deterministic augmentation

`matching.cases-tier4.ts` contains deterministic, hand-reviewable paraphrases of Tier 1/2
cases. These vary names, bios, locations, interests, and intents while preserving the rule
semantics and expected outcome. Use Tier 4 for corpus breadth / tighter confidence intervals;
use Tier 1 when introducing a new surgical behavior or minimal-pair rule.

## Tier 3 — historical collaborations

`matching.historical.ts` holds five real collaborations (e.g. complementary cofounders,
co-researchers on a landmark paper, a songwriting duo, a first-check investor + founder,
a cross-disciplinary biomedical research pair), recreated as the people looked *before* they
connected. Each case places the discoverer, the eventual partner, and three plausible
contemporary distractors in one shared network, and asserts the evaluator surfaces the partner
(band `[60, 100]`) while the distractors do not (`[0, 29]`). Evaluator input names stay
anonymized so the model judges on fit, not fame, but `reportNames` exposes the real-world
referents in HTML/reports. Run with `bun run eval:matching -- --rule historical`.

## Execution evidence

The runner records every requested slot and invocation attempt in schema-v2 run reports,
including retries, timeout/cancellation, sanitized errors, retryability, and backoff. Only
terminal successful outputs are scored. Use `--strict-evidence` for release evidence and
`--attempt-timeout-ms N` to override the 90-second per-attempt deadline. Exit codes are
0 pass, 1 regression, 2 execution/artifact error, and 3 incomplete strict evidence.
