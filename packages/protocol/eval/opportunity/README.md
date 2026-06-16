# Opportunity-Card Quality Eval Harness

Measures whether `OpportunityPresenter.present` writes good **user-facing cards** — the
headline, the "why this matters to you" summary, a suggested next step, and a ready-to-send
intro greeting. This is distinct from the `matching` eval, which scores *which* people get
surfaced; this one judges the *card a person actually reads*. Standalone and opt-in — NOT
part of `bun test`.

## Run

```bash
# from packages/protocol
bun run eval:opportunity                          # all cases, 3 runs, judge on, diff baseline
bun run eval:opportunity -- --runs 5              # more runs = less noise
bun run eval:opportunity -- --rule no_leakage      # one rule
bun run eval:opportunity -- --case greeting/        # one case or id prefix
bun run eval:opportunity -- --tier 1               # one tier
bun run eval:opportunity -- --list-cases           # print selected cases and exit
bun run eval:opportunity -- --no-judge             # skip LLM grounding/framing/tone checks (free)
bun run eval:opportunity -- --update-baseline      # overwrite the committed baseline
bun run eval:opportunity -- --report [path]        # write a full run report incl. generated cards
bun run eval:opportunity -- --html [path]          # write a standalone HTML scorecard
bun run eval:opportunity -- --rolling-baseline [d] # compare against trailing run average (default 7d)
bun run eval:opportunity -- --alpha 0.01           # stricter regression significance threshold
bun run eval:opportunity -- --no-save              # do not auto-save full-corpus run JSON
```

Requires `OPENROUTER_API_KEY` (loaded via `.env.test`). Exits non-zero on a regression
versus `baselines/opportunity.baseline.json`. Shared machinery lives in [`eval/shared`](../shared).

## Checks

Deterministic (on by default for every card): **`voice`** (the summary speaks to the
viewer in second person), **`uuid`** / **`label`** (no raw ids or internal jargon like "the
source user" / `intentId` in any field), **`greeting_format`** + **`greeting_length`** (the
intro is plain prose, no markdown, no "Hey Name," prefix, ≤500 chars), and **`non_empty`**.

Judged (skipped with `--no-judge`): **`grounding`** (the card reflects the real context and
doesn't invent facts), **`framing`** (introducer cards frame the viewer as the matchmaker;
introduction cards acknowledge the human introducer), and **`tone`** (warm and personal, not
a clinical third-party analysis).

The presenter takes pre-assembled string context (`PresenterInput`) — no database is needed,
so cases are authored directly in `opportunity.cases.ts`.

## Adding a case

Append an `OpportunityCase` to `CASES`. Set `rule`, `tier` (1 surgical, 2 realistic), the
`input` (viewer/other-party context, match reasoning, role, optional introduction), and
`expect`. The deterministic guarantees are on by default; add judged `mustReference` /
`framingCriteria` / `toneCriteria` for grounding, framing, and tone. To stress leakage, embed
a UUID or an internal label in the `input` and rely on the default `no_leakage` assertion.
Re-run with `--update-baseline` after an intentional change.

## Layout

- `opportunity.cases.ts` — the golden corpus.
- `opportunity.leakage.ts` — deterministic UUID / label / markdown / salutation detectors.
- `opportunity.types.ts` — harness types (specializes the shared scorecard types).
- `opportunity.runner.ts` — invokes the presenter N times (shared retry loop).
- `opportunity.scorer.ts` — per-run assertions → `CaseResult`.
- `opportunity.reporter.ts` — HTML scorecard via the shared shell (plain-language report on top).
- `opportunity.selection.ts` — `--rule` / `--case` / `--tier` filtering.
- `opportunity.eval.ts` — CLI.
- `baselines/opportunity.baseline.json` — committed baseline (per-run detail stripped).
- `runs/*.json` — gitignored full run reports (rolling-baseline fuel).
- `tests/` — unit tests (no live agents).
