# Protocol Eval Harnesses

Standalone eval harnesses for the protocol's LLM agents. Each harness exercises one agent
against a curated golden corpus and gives you a scorecard plus regression detection.

They run **outside** `bun test` — run them via package scripts, e.g.
`bun run eval:matching`. Expects `OPENROUTER_API_KEY` in your `.env.test` (or the
equivalent env) — harnesses call real models.

## Harnesses

| Harness    | Script             | Agent under test                    |
| :--------- | :------------------ | :----------------------------------- |
| `matching` | `bun run eval:matching` | `OpportunityEvaluator.invokeEntityBundle` |

### Matching eval

Measures whether the evaluator correctly surfaces / rejects / scores candidates.
Full docs at [`eval/matching/README.md`](./matching/README.md).

Quick reference:

```bash
bun run eval:matching                         # All cases × 3 runs, judge on, diff baseline
bun run eval:matching -- --runs 5              # More runs, less noise
bun run eval:matching -- --rule is_a_identity   # One rule only
bun run eval:matching -- --no-judge             # Skip LLM reasoning checks (free)
bun run eval:matching -- --update-baseline      # Overwrite the committed baseline
bun run eval:matching -- --report               # Write full run report (incl. evaluator reasoning)
bun run eval:matching -- --report out.json      # …to a specific path
bun run eval:matching -- --html                 # Write standalone HTML scorecard
bun run eval:matching -- --rolling-baseline     # Compare against recent run reports (7d)
```

## Anatomy of a harness

Each harness lives in its own subdirectory (`eval/<name>/`) and follows this layout:

```
eval/<name>/
├── <name>.types.ts       # Shared types used by the corpus, scorer, and reporter
├── <name>.cases.ts       # The golden corpus (Tier 1 surgical → Tier N realistic)
├── <name>.scorer.ts      # Per-run scoring logic + aggregation into a CaseResult
├── <name>.runner.ts       # Wraps the agent under test, repeats N runs
├── <name>.reporter.ts    # Scorecard builder, baseline diff, CLI formatting
├── <name>.eval.ts        # CLI entry point (drives runner → scorer → reporter → exit code)
├── <name>.personas.ts    # Shared persona pool (optional — Tier-2+ cases benefit from this)
├── <name>.historical.ts  # Historical-collaboration cases (optional)
├── baselines/
│   └── <name>.baseline.json  # Committed baseline scorecard (stripped of per-candidate reasoning)
├── runs/
│   └── *.json                 # gitignored — full run reports incl. evaluator reasoning
├── tsconfig.json               # Extends ../../tsconfig.json, includes eval + src
└── tests/
    └── *.spec.ts               # Unit tests for scorer, runner, reporter, cases
```

## Adding a new harness

1. **Create the directory** following the layout above. Copy `matching/tsconfig.json`
   and adjust its paths.

2. **Define your types** in `<name>.types.ts`. At minimum you'll need a case type and
   a scorecard aggregate type.

3. **Build a corpus** in `<name>.cases.ts`. Start with a few Tier-1 surgical cases
   (single expectation, binary pass/fail), then add Tier-2 realistic scenarios. If you
   need shared synthetic personas, put them in `<name>.personas.ts`.

4. **Wire the agent** via a minimal `RunnerLike` interface in `<name>.runner.ts`.
   The runner calls the agent N times and collects its outputs.

5. **Score each run** in `<name>.scorer.ts`. The scorer compares agent output to
   expectations (match, band, role, LLM-checked reasoning) and returns per-run
   assertions. Aggregate multiple runs into a `CaseResult` with pass-rate.

6. **Report results** in `<name>.reporter.ts`. Build a scorecard, diff against the
   committed or rolling baseline with a one-sided binomial significance test, and format
   console/HTML output.

7. **Write the CLI entry point** in `<name>.eval.ts`. Parse --runs, --rule, --no-judge,
   --update-baseline, --report, --html, and optional rolling-baseline flags from
   process.argv. Drive the flow: cases → runner → scorer → baseline → console + optional
   report.

8. **Add a package.json script** in the protocol root:
   ```json
   "eval:<name>": "bun run eval/<name>/<name>.eval.ts"
   ```

9. **Write tests** in `eval/<name>/tests/`. Cover at minimum: case corpus invariants,
   scorer correctness, and reporter/baseline round-trips.

10. **Commit the baseline** after a stable run:
    ```bash
    bun run eval:<name> -- --runs 7 --update-baseline
    git add eval/<name>/baselines/
    ```
    The committed baseline omits per-candidate `reasoning` to keep diffs lean.

## Testing the evals themselves

Each harness has unit tests in its `tests/` subdirectory. Run with:

```bash
bun test eval/<name>/tests/
```

These are standard `bun test` specs — they do NOT invoke live agents; they validate that
types, scoring logic, runner wiring, reporter math, and baseline handling are correct.

## Baseline contract

- **Committed baseline** (`baselines/<name>.baseline.json`): the scorecard with
  `reasoning` fields stripped. Kept lean so diffs are meaningful. Updated with
  `--update-baseline` after intentional eval changes.

- **Run report** (`runs/<timestamp>.json`): the full scorecard with evaluator reasoning
  verbatim, written by full-corpus runs and on demand with `--report`. gitignored — for
  human review and rolling-baseline computation, not diffing.

- **Rolling baseline** (`--rolling-baseline [days]`): a synthetic baseline computed from
  recent JSON reports in `runs/`. Useful for drift detection relative to current model
  behavior. Default window is 7 days.

- **Regression detection**: run → scorecard → `diffBaseline()` → exit code 1 if any case
  or rule is significantly below the baseline by one-sided binomial test (default
  α=0.05). New cases never count as regressions.