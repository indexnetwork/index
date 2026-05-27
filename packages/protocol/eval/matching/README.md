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
bun run eval:matching -- --no-judge           # skip LLM reasoning checks (free)
bun run eval:matching -- --update-baseline    # overwrite the committed baseline
bun run eval:matching -- --report             # write a full run report incl. evaluator reasoning
bun run eval:matching -- --report out.json    # ...to a specific path
```

Requires `OPENROUTER_API_KEY` (loaded via `.env.test`). Exits non-zero on a regression
versus `baselines/matching.baseline.json`.

## Run reports (`--report`)

`--report` writes the full scorecard — including each candidate's **actual score, role,
and the evaluator's own verbatim `reasoning`** — to `runs/<timestamp>.json` (gitignored),
or to a path you pass. The committed baseline deliberately omits this reasoning to keep
diffs lean; the run report is where the "why" lives. This artifact is the input the
matching-eval report skill reads to explain *why* the evaluator scored as it did.

## Layout

- `matching.cases.ts` — the golden corpus (Tier 1 surgical, Tier 2 realistic). Add cases here.
- `matching.personas.ts` — shared Tier-2 persona pool.
- `matching.scorer.ts` / `matching.runner.ts` / `matching.reporter.ts` — pure-ish units, unit-tested in `tests/`.
- `matching.eval.ts` — CLI.

## Adding a case

Append a `MatchingCase` to `CASES`. Set `match`, optional `scoreBand`, optional `role`, and
`reasoningCriteria` only when a code check can't express the expectation. Negative cases are
best authored as minimal-pair perturbations of a positive. Re-run with `--update-baseline`
after an intentional change.

## Future (Tier 3)

Recreate profiles for real successful collaborations (companies, papers) as they looked
before the connection, and assert the protocol would have surfaced them. Additive — same
`MatchingCase` schema.
