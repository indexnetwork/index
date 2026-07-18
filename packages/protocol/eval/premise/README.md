# Premise Quality Eval Harness

Measures whether the premise agents make the right judgments against a curated golden
set. Standalone and opt-in — NOT part of `bun test`. Two agents are under test:

- **Decompose** (`PremiseDecomposer.invoke`): free text → atomic, first-person premises
  with `assertive` / `contextual` tiering and no leaked intents.
- **Analyze** (`PremiseAnalyzer.invoke`): a premise → speech-act class
  (`DECLARATIVE` / `ASSERTIVE`) + felicity scores (authority, sincerity, clarity) and
  semantic entropy.

## Run

```bash
# from packages/protocol
bun run eval:premise                          # all cases, 3 runs, judge on, diff baseline
bun run eval:premise -- --runs 5              # more runs = less noise
bun run eval:premise -- --component analyze    # only the analyzer (or: decompose)
bun run eval:premise -- --rule speech_act      # one rule
bun run eval:premise -- --case atomicity/      # one case or id prefix
bun run eval:premise -- --tier 1               # one tier
bun run eval:premise -- --list-cases           # print selected cases and exit
bun run eval:premise -- --no-judge             # skip LLM coverage/exclusion/reasoning checks (free)
bun run eval:premise -- --update-baseline --force # replace the committed baseline
bun run eval:premise -- --report [path]        # write a full run report incl. agent output
bun run eval:premise -- --html [path]          # write a standalone HTML scorecard
bun run eval:premise -- --rolling-baseline [d] # compare against trailing run average (default 7d)
bun run eval:premise -- --alpha 0.01           # stricter regression significance threshold
bun run eval:premise -- --no-save              # do not auto-save full-corpus run JSON
```

Requires `OPENROUTER_API_KEY` (loaded via `.env.test`). Exits non-zero on a regression
versus `baselines/premise.baseline.json` (one-sided beta-binomial posterior-predictive
test, default α=0.05). Shared machinery (scorecard math, baseline diff, rolling baseline,
console/HTML reporting, runner) lives in [`eval/shared`](../shared); this harness owns only
its corpus, scorer, types, and CLI.

## Checks

**Decompose** — deterministic: premise `count` band, `empty` for no-fact inputs, `tier`
counts (assertive/contextual), `first_person` structural check. Judged (skipped with
`--no-judge`): `coverage` (all expected facts represented) and `exclusion` (no leaked
intents/desires).

**Analyze** — deterministic: `speech_act` class, and `authority` / `sincerity` / `clarity`
/ `entropy` score bands. Judged: optional `reasoning` rubric.

Score bands are intentionally generous — they assert direction (high vs low), not exact
model values.

## Adding a case

Append a `PremiseCase` to `CASES` in `premise.cases.ts`. Set `component`
(`decompose` | `analyze`), `rule`, `tier` (1 surgical, 2 realistic), `input`, and the
component-specific `expect`. Prefer deterministic expectations; reach for judged
`mustCover` / `mustNotContain` / `reasoningCriteria` only when a code check can't express
the expectation. Re-run with `--update-baseline --force` after an intentional change.

## Layout

- `premise.cases.ts` — the golden corpus.
- `premise.types.ts` — harness types (specializes the shared scorecard types).
- `premise.runner.ts` — invokes the agents N times (shared retry loop).
- `premise.scorer.ts` — per-run assertions → `CaseResult`.
- `premise.reporter.ts` — HTML scorecard via the shared shell.
- `premise.selection.ts` — `--rule` / `--component` / `--case` / `--tier` filtering.
- `premise.eval.ts` — CLI.
- `baselines/premise.baseline.json` — committed baseline (per-run detail stripped).
- `runs/*.json` — gitignored full run reports (rolling-baseline fuel).
- `tests/` — unit tests (no live agents).

## Execution evidence

Schema-v2 run reports retain every decomposer/analyzer invocation attempt, including
retries, timeout/cancellation, sanitized errors, retryability, and backoff. Only terminal
successful outputs are scored. Use `--strict-evidence` for release evidence and
`--attempt-timeout-ms N` to override the 90-second per-attempt deadline. Exit codes are
0 pass, 1 regression, 2 execution/artifact error, and 3 incomplete strict evidence.
